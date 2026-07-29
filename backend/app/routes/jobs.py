from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload
import asyncio
from datetime import datetime

from app.db import get_db, SessionLocal
from app.models import ScrapeJob, User, SavedSearch, AuditLog, Lead, Workspace
from app.routes.auth import get_current_user
from app.routes.workspaces import get_current_workspace

router = APIRouter(prefix="/jobs", tags=["jobs"])


def format_job(job: ScrapeJob) -> dict:
    """Serialize a ScrapeJob into a frontend-compatible shape with full null safety."""
    search = job.saved_search

    # Build parameters block — always complete, never None
    if search:
        parameters = {
            "countries": search.countries or [],
            "states": search.states or [],
            "cities": search.cities or [],
            "industries": search.industries or [],
            "titles": search.designations or [],
            "limit": int(search.lead_count_target or 50),
            # None means "no size constraint" was set for this search —
            # not a fabricated 10-500 default.
            "sizeRange": [search.company_size_min, search.company_size_max],
            "revenueBands": search.revenue_bands or [],
            "advancedFilters": search.advanced_filters or {},
        }
        job_name = search.name or f"Job #{job.id[:8]}"
    else:
        parameters = {
            "countries": [],
            "states": [],
            "cities": [],
            "industries": [],
            "titles": [],
            "limit": 50,
            "sizeRange": [None, None],
            "revenueBands": [],
            "advancedFilters": {},
        }
        job_name = f"Job #{job.id[:8]}"

    # Serialize datetimes to ISO strings (JS-compatible)
    started_at = job.started_at.isoformat() + "Z" if job.started_at else datetime.utcnow().isoformat() + "Z"
    completed_at = job.completed_at.isoformat() + "Z" if job.completed_at else None

    # Compute human-readable duration
    duration = None
    if job.completed_at and job.started_at:
        secs = int((job.completed_at - job.started_at).total_seconds())
        if secs < 60:
            duration = f"{secs}s"
        else:
            duration = f"{secs // 60}m {secs % 60}s"

    leads_found = int(job.leads_found or 0)

    return {
        "id": str(job.id),
        "search_id": str(job.search_id) if job.search_id else None,
        "name": job_name,
        "status": job.status or "Unknown",
        "searchMode": job.search_mode or (search.search_mode if search else None) or "individuals",
        "startedAt": started_at,
        "completedAt": completed_at,
        "duration": duration,
        "triggeredBy": job.triggered_by or "System",
        "logs": list(job.logs or []),
        "errors": job.error_detail or None,
        "leadsFound": leads_found,
        "per_source_breakdown": dict(job.per_source_breakdown or {}),
        "parameters": parameters,
        "progress": {
            "scraped": leads_found,
            "target": parameters["limit"],
        },
    }


@router.get("")
async def list_jobs(
    page: int = 1,
    pageSize: int = 50,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    current_workspace: Workspace = Depends(get_current_workspace),
):
    """Return every scrape job in the current workspace — a direct SQL
    filter now that ScrapeJob carries its own workspace_id column."""
    result = await db.execute(
        select(ScrapeJob)
        .options(selectinload(ScrapeJob.saved_search))
        .filter(ScrapeJob.workspace_id == current_workspace.id)
        .order_by(ScrapeJob.started_at.desc())
    )
    workspace_jobs = result.scalars().unique().all()

    total = len(workspace_jobs)
    start = (page - 1) * pageSize
    end = start + pageSize
    page_jobs = workspace_jobs[start:end]

    return {
        "data": [format_job(j) for j in page_jobs],
        "page": page,
        "pageSize": pageSize,
        "total": total,
    }


@router.get("/{job_id}")
async def get_job(
    job_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    current_workspace: Workspace = Depends(get_current_workspace),
):
    result = await db.execute(
        select(ScrapeJob)
        .options(selectinload(ScrapeJob.saved_search))
        .filter(ScrapeJob.id == job_id, ScrapeJob.workspace_id == current_workspace.id)
    )
    job = result.scalars().first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return format_job(job)


@router.post("/{job_id}/cancel")
async def cancel_job(
    job_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    current_workspace: Workspace = Depends(get_current_workspace),
):
    result = await db.execute(select(ScrapeJob).filter(ScrapeJob.id == job_id, ScrapeJob.workspace_id == current_workspace.id))
    job = result.scalars().first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    if job.status in ["Queued", "Running"]:
        job.status = "Failed"
        job.error_detail = f"Cancelled by {current_user.name}"
        logs = list(job.logs or [])
        ts = datetime.utcnow().strftime("%H:%M:%S")
        logs.append(f"[{ts}] Job terminated by user: {current_user.name}")
        job.logs = logs
        job.completed_at = datetime.utcnow()

        db.add(AuditLog(
            org_id=current_user.org_id,
            workspace_id=current_workspace.id,
            actor_id=current_user.id,
            actor_name=current_user.name,
            actor_email=current_user.email,
            action="Cancelled scrape job",
            category="SCRAPE",
            target_entity_name=f"Job {job_id}",
        ))
        await db.commit()

    return {"success": True}


@router.delete("/{job_id}")
async def delete_job(
    job_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    current_workspace: Workspace = Depends(get_current_workspace),
):
    result = await db.execute(
        select(ScrapeJob)
        .filter(ScrapeJob.id == job_id, ScrapeJob.workspace_id == current_workspace.id)
    )
    job = result.scalars().first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    if job.status in ["Queued", "Running"]:
        raise HTTPException(status_code=400, detail="Cancel the job before deleting it.")

    leads_result = await db.execute(select(Lead).filter(Lead.job_id == job_id))
    for lead in leads_result.scalars().all():
        await db.delete(lead)

    db.add(AuditLog(
        org_id=current_user.org_id,
        workspace_id=current_workspace.id,
        actor_id=current_user.id,
        actor_name=current_user.name,
        actor_email=current_user.email,
        action="Deleted scrape job",
        category="SCRAPE",
        target_entity_name=f"Job {job_id}",
    ))

    await db.delete(job)
    await db.commit()
    return {"success": True}


async def _poll_job_logs(job_id: str):
    """Fetch-based log polling generator for SSE-compatible streaming."""
    last_idx = 0
    max_iters = 360  # 6 minutes max

    for _ in range(max_iters):
        try:
            async with SessionLocal() as db:
                res = await db.execute(
                    select(ScrapeJob).filter(ScrapeJob.id == job_id)
                )
                job = res.scalars().first()
                if not job:
                    yield "data: [ERROR] Job not found.\n\n"
                    return

                logs = list(job.logs or [])
                if len(logs) > last_idx:
                    for line in logs[last_idx:]:
                        yield f"data: {line}\n\n"
                    last_idx = len(logs)

                if job.status in ["Completed", "Failed"]:
                    yield f"data: [DONE] status={job.status}\n\n"
                    return
        except Exception as e:
            yield f"data: [STREAM_ERROR] {e}\n\n"
            return

        await asyncio.sleep(1.5)


@router.get("/{job_id}/stream")
async def stream_job_logs(
    job_id: str,
    current_user: User = Depends(get_current_user),
):
    return StreamingResponse(
        _poll_job_logs(job_id),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
