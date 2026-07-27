import re
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import delete as sa_delete
from sqlalchemy.orm import selectinload
from typing import List, Optional
from datetime import datetime

from app.db import get_db
from app.models import Lead, User, Company, Contact, LeadScore, ScoringConfig, AuditLog, Message, ScrapeJob, Workspace
from app.schemas import LeadResponse, LeadUpdate, ScoringConfigUpdate, ScoringConfigResponse, BulkDeleteRequest, AdHocRecipientRequest
from app.routes.auth import get_current_user
from app.routes.workspaces import get_current_workspace

router = APIRouter(prefix="/leads", tags=["leads"])

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

# Helper function to construct lead response payload
def format_lead(lead: Lead) -> dict:
    company = lead.company
    contact = lead.contact
    score_details = lead.score_details

    # Construct structured hiring signals and achievements
    hiring_roles = company.activity_signals.get("hiring", {}).get("open_roles", [])
    achievements = [a.get("title") for a in company.activity_signals.get("achievements", [])]
    activity_signals = []
    hiring_signals = []
    if company.activity_signals.get("hiring", {}).get("active"):
        hiring_label = f"Hiring for: {', '.join(hiring_roles)}" if hiring_roles else "Hiring"
        activity_signals.append(hiring_label)
        hiring_signals.append(hiring_label)
    activity_signals.extend(achievements)

    # The real search/job name behind this lead — was previously a hardcoded
    # "Scrape Job" placeholder for every row, which isn't useful once there's
    # more than one search running.
    job = lead.scrape_job
    search = job.saved_search if job else None
    source_job_name = (search.name if search and search.name else (f"Job #{job.id[:8]}" if job else "Legacy Search"))

    search_mode = lead.search_mode or (search.search_mode if search else None) or "individuals"
    raw_payload = company.raw_source_payload or {}

    return {
        "id": lead.id,
        "org_id": lead.org_id,
        "status": lead.status,
        "search_mode": search_mode,
        "reviewed_by": lead.reviewed_by,
        "reviewed_at": lead.reviewed_at,
        "notes": lead.notes,
        "company": {
            "id": company.id,
            "name": company.name,
            "website": company.website,
            "domain": company.website or "",
            "industry": company.industry,
            "employeeCount": company.employee_count,
            "sizeRange": company.size_range,
            "revenueRange": company.revenue_range,
            "revenueBand": company.revenue_band,
            "fundingStage": company.funding_stage,
            "techStack": company.tech_stack or [],
            "overview": company.summary_text or "",
            "activity_signals": company.activity_signals or {},
            "hiringSignals": hiring_signals,
            "linkedin_url": company.linkedin_url or "",
            "twitter_url": raw_payload.get("twitter_url") or "",
            "address": raw_payload.get("address") or "",
            "sources": raw_payload.get("sources") or [],
        },
        "decisionMaker": {
            "id": contact.id,
            "full_name": contact.full_name,
            "designation": contact.designation,
            "email": contact.email,
            "phone": contact.phone,
            "linkedin_url": contact.linkedin_url,
            "seniority_level": contact.seniority_level or "Executive"
        },
        "score": score_details.total_score if score_details else None,
        "priority": score_details.tier if score_details else None,
        "scoreExplanation": (
            f"Matched criteria on {company.industry or 'the searched criteria'} and title {contact.designation}."
            if search_mode != "companies"
            else f"Company profile completeness: {', '.join(k.replace('_', ' ') for k in (score_details.factor_breakdown or {}).keys()) or 'core company details only'}."
        ),
        "sourceJobId": lead.job_id,
        "sourceJobName": source_job_name,
        "dateScraped": company.first_seen_at.isoformat() + "Z" if company.first_seen_at else None,
        "activitySignals": activity_signals
    }

@router.get("", response_model=dict)
async def get_leads(
    status: Optional[str] = None,
    industry: Optional[str] = None,
    priority: Optional[str] = None,
    job_id: Optional[str] = None,
    search_mode: Optional[str] = None,
    has_email: bool = False,
    page: int = 1,
    pageSize: int = 50,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    current_workspace: Workspace = Depends(get_current_workspace),
):
    query = select(Lead).filter_by(org_id=current_user.org_id, workspace_id=current_workspace.id).options(
        selectinload(Lead.company),
        selectinload(Lead.contact),
        selectinload(Lead.score_details),
        selectinload(Lead.scrape_job).selectinload(ScrapeJob.saved_search),
      )

    if status:
        query = query.filter(Lead.status == status)
    if job_id:
        query = query.filter(Lead.job_id == job_id)
    if search_mode:
        query = query.filter(Lead.search_mode == search_mode)
    if has_email:
        query = query.join(Contact, Contact.id == Lead.contact_id).filter(Contact.email.isnot(None), Contact.email != "")

    result = await db.execute(query)
    all_leads = result.scalars().all()

    # Apply client-side sorting/filtering on priority/industry if needed
    formatted_leads = [format_lead(l) for l in all_leads]

    if priority:
        formatted_leads = [l for l in formatted_leads if l["priority"] == priority]
    if industry:
        formatted_leads = [l for l in formatted_leads if (l["company"]["industry"] or "").lower() == industry.lower()]

    total = len(formatted_leads)
    start = (page - 1) * pageSize
    end = start + pageSize

    return {
        "data": formatted_leads[start:end],
        "page": page,
        "pageSize": pageSize,
        "total": total
    }

@router.get("/scoring-config", response_model=ScoringConfigResponse)
async def get_scoring_config(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    current_workspace: Workspace = Depends(get_current_workspace),
):
    result = await db.execute(select(ScoringConfig).filter_by(org_id=current_user.org_id, workspace_id=current_workspace.id))
    config = result.scalars().first()
    if not config:
        # Create default config
        config = ScoringConfig(
            org_id=current_user.org_id,
            workspace_id=current_workspace.id,
            weights={
                "industry_match": 25,
                "location_match": 15,
                "company_size": 15,
                "company_activity": 25,
                "designation_match": 20
            }
        )
        db.add(config)
        await db.commit()
        await db.refresh(config)
    return config

@router.patch("/scoring-config", response_model=ScoringConfigResponse)
async def update_scoring_config(
    req: ScoringConfigUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    current_workspace: Workspace = Depends(get_current_workspace),
):
    # Enforce sum to 100 rule
    total = sum(req.weights.values())
    if total != 100:
        raise HTTPException(
            status_code=400,
            detail=f"VALIDATION_ERROR: Aggregate weights must sum to exactly 100. Computed sum: {total}"
        )

    result = await db.execute(select(ScoringConfig).filter_by(org_id=current_user.org_id, workspace_id=current_workspace.id))
    config = result.scalars().first()
    if not config:
        config = ScoringConfig(org_id=current_user.org_id, workspace_id=current_workspace.id)
        db.add(config)

    config.weights = req.weights
    config.updated_by = current_user.id
    config.updated_at = datetime.utcnow()
    
    # Audit log
    audit = AuditLog(
        org_id=current_user.org_id,
        workspace_id=current_workspace.id,
        actor_id=current_user.id,
        actor_name=current_user.name,
        actor_email=current_user.email,
        action="Updated scoring model config weights",
        category="WORKSPACE",
        target_entity_name="Scoring Weight Model",
        created_at=datetime.utcnow()
    )
    db.add(audit)
    
    await db.commit()
    await db.refresh(config)
    return config

@router.get("/{id}")
async def get_lead_by_id(
    id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    current_workspace: Workspace = Depends(get_current_workspace),
):
    result = await db.execute(
        select(Lead)
        .filter_by(id=id, org_id=current_user.org_id, workspace_id=current_workspace.id)
        .options(
            selectinload(Lead.company),
            selectinload(Lead.contact),
            selectinload(Lead.score_details),
            selectinload(Lead.scrape_job).selectinload(ScrapeJob.saved_search),
        )
    )
    lead = result.scalars().first()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    return format_lead(lead)

@router.patch("/{id}")
async def update_lead(
    id: str,
    req: LeadUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    current_workspace: Workspace = Depends(get_current_workspace),
):
    result = await db.execute(select(Lead).filter_by(id=id, org_id=current_user.org_id, workspace_id=current_workspace.id))
    lead = result.scalars().first()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")

    if req.status is not None:
        lead.status = req.status
        lead.reviewed_by = current_user.name
        lead.reviewed_at = datetime.utcnow()

        # Write to audit log
        audit = AuditLog(
            org_id=current_user.org_id,
            workspace_id=current_workspace.id,
            actor_id=current_user.id,
            actor_name=current_user.name,
            actor_email=current_user.email,
            action=f"Changed Lead Status to {req.status}",
            category="WORKSPACE",
            target_entity_name=f"Lead {id}",
            created_at=datetime.utcnow()
        )
        db.add(audit)

        # Auto-create message draft if approved
        if req.status == "approved":
            # Check if draft already exists
            msg_res = await db.execute(select(Message).filter_by(lead_id=id))
            if not msg_res.scalars().first():
                # Fetch details
                db_lead = await db.execute(
                    select(Lead)
                    .filter_by(id=id)
                    .options(selectinload(Lead.company), selectinload(Lead.contact))
                )
                l_obj = db_lead.scalars().first()
                if l_obj:
                    new_msg = Message(
                        org_id=current_user.org_id,
                        workspace_id=current_workspace.id,
                        lead_id=id,
                        type="Cold Email",
                        channel="email",
                        subject=f"Speeding up outreach at {l_obj.company.name}",
                        body=f"Hi {l_obj.contact.full_name},\n\nI noticed {l_obj.company.name} is actively expanding. With a team size of {l_obj.company.employee_count}, coordination is key.\n\nLet's discuss.\n\nBest,\n{current_user.name}",
                        status="pending_approval"
                    )
                    db.add(new_msg)

    if req.notes is not None:
        lead.notes = req.notes

    await db.commit()
    return {"success": True}

@router.post("/{id}/approve")
async def approve_lead(
    id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    current_workspace: Workspace = Depends(get_current_workspace),
):
    return await update_lead(id, LeadUpdate(status="approved"), db, current_user, current_workspace)

@router.post("/{id}/reject")
async def reject_lead(
    id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    current_workspace: Workspace = Depends(get_current_workspace),
):
    return await update_lead(id, LeadUpdate(status="rejected"), db, current_user, current_workspace)

async def _delete_lead_cascade(id: str, db: AsyncSession, current_user: User, current_workspace: Workspace) -> bool:
    """Deletes one lead and its dependent rows. Returns False if the lead
    wasn't found (or doesn't belong to this org/workspace) instead of
    raising, so bulk callers can tally per-id results without aborting the
    whole batch."""
    result = await db.execute(select(Lead).filter_by(id=id, org_id=current_user.org_id, workspace_id=current_workspace.id))
    lead = result.scalars().first()
    if not lead:
        return False

    # Cascade delete associated records — real DELETE statements, not a
    # Select (Select has no .delete() in SQLAlchemy 2.0).
    await db.execute(sa_delete(Message).where(Message.lead_id == id))
    await db.execute(sa_delete(LeadScore).where(LeadScore.lead_id == id))
    await db.delete(lead)
    return True


@router.delete("/{id}")
async def delete_lead(
    id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    current_workspace: Workspace = Depends(get_current_workspace),
):
    deleted = await _delete_lead_cascade(id, db, current_user, current_workspace)
    if not deleted:
        raise HTTPException(status_code=404, detail="Lead not found")

    # Audit log
    audit = AuditLog(
        org_id=current_user.org_id,
        workspace_id=current_workspace.id,
        actor_id=current_user.id,
        actor_name=current_user.name,
        actor_email=current_user.email,
        action="Hard deleted lead (GDPR Compliance)",
        category="WORKSPACE",
        target_entity_name=f"Lead {id}"
    )
    db.add(audit)

    await db.commit()
    return {"success": True}


@router.post("/bulk-delete")
async def bulk_delete_leads(
    req: BulkDeleteRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    current_workspace: Workspace = Depends(get_current_workspace),
):
    deleted_count = 0
    for lead_id in req.ids:
        if await _delete_lead_cascade(lead_id, db, current_user, current_workspace):
            deleted_count += 1

    if deleted_count > 0:
        audit = AuditLog(
            org_id=current_user.org_id,
            workspace_id=current_workspace.id,
            actor_id=current_user.id,
            actor_name=current_user.name,
            actor_email=current_user.email,
            action=f"Hard deleted {deleted_count} lead(s) (GDPR Compliance)",
            category="WORKSPACE",
            target_entity_name=f"{deleted_count} lead(s)"
        )
        db.add(audit)

    await db.commit()
    return {"success": True, "deleted": deleted_count, "requested": len(req.ids)}


@router.post("/adhoc")
async def create_adhoc_lead(
    req: AdHocRecipientRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    current_workspace: Workspace = Depends(get_current_workspace),
):
    """
    "Add your own" compose recipient — the user typed a name/email that
    isn't an existing lead yet. Reuses the exact ad-hoc Company/Contact/
    Lead/LeadScore creation pattern routes/searches.py already uses for
    scraped results, so it's fully real data (visible afterward in All
    Leads/Lead Validation, fully auditable) rather than a special-cased
    send-only record, and needs zero schema changes to Message.
    """
    email = (req.email or "").strip().lower()
    if not _EMAIL_RE.match(email):
        raise HTTPException(status_code=400, detail="Enter a valid email address.")
    name = (req.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Enter a name.")

    company_name = (req.company or "").strip() or "Unknown Company"

    # Dedupe by name within this workspace so re-adding the same company
    # doesn't create a new row every time.
    existing_company = await db.execute(
        select(Company).filter_by(org_id=current_user.org_id, workspace_id=current_workspace.id, name=company_name)
    )
    company = existing_company.scalars().first()
    if not company:
        company = Company(
            org_id=current_user.org_id,
            workspace_id=current_workspace.id,
            name=company_name,
            source_provider="Manual Entry",
        )
        db.add(company)
        await db.flush()

    contact = Contact(
        company_id=company.id,
        full_name=name,
        designation=(req.title or "").strip() or "Not available",
        email=email,
        source_provider="Manual Entry",
    )
    db.add(contact)
    await db.flush()

    lead = Lead(
        org_id=current_user.org_id,
        workspace_id=current_workspace.id,
        company_id=company.id,
        contact_id=contact.id,
        status="approved",
        search_mode="individuals",
        notes="Added manually via compose.",
    )
    db.add(lead)
    await db.flush()

    # Neutral score — there's no scrapeable signal to score an ad-hoc entry on.
    score = LeadScore(lead_id=lead.id, total_score=0, tier="Low", factor_breakdown={})
    db.add(score)

    await db.commit()

    result = await db.execute(
        select(Lead)
        .filter_by(id=lead.id)
        .options(
            selectinload(Lead.company),
            selectinload(Lead.contact),
            selectinload(Lead.score_details),
            selectinload(Lead.scrape_job).selectinload(ScrapeJob.saved_search),
        )
    )
    return format_lead(result.scalars().first())

