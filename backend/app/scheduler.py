import asyncio
import logging
from datetime import datetime, timedelta, timezone
from sqlalchemy.future import select
from sqlalchemy.orm.attributes import flag_modified

from app.db import SessionLocal
from app.models import SavedSearch, ScrapeJob
from app.routes.searches import run_sourcing_pipeline, SEED_DEMO_SEARCH_ID

logger = logging.getLogger("salesai.scheduler")

async def start_scheduler():
    logger.info("Starting Sales AI background scraper scheduler...")
    while True:
        try:
            await check_and_trigger_scheduled_scrapes()
        except Exception as e:
            logger.error(f"Error in scheduler check loop: {e}")
        # Check every 15 seconds
        await asyncio.sleep(15)


def _parse_scheduled_dt(dt_str: str) -> datetime | None:
    """
    Parse a schedule's stored datetime into a naive UTC datetime, comparable
    directly against datetime.utcnow(). Accepts both a timezone-aware ISO
    string (e.g. "2026-07-18T14:30:00.000Z", what the frontend now sends —
    converted from the user's local time) and a bare naive string (legacy
    rows created before that fix, already intended as a literal UTC
    wall-clock time). Returns None for anything unparseable rather than
    ever guessing.
    """
    try:
        normalized = dt_str.replace("Z", "+00:00")
        dt = datetime.fromisoformat(normalized)
        if dt.tzinfo is not None:
            dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
        return dt
    except Exception:
        return None


async def check_and_trigger_scheduled_scrapes():
    async with SessionLocal() as db:
        # Exclude the fixed-ID demo search seeded once at startup — it's
        # never a real user schedule, same exclusion GET /searches applies.
        result = await db.execute(
            select(SavedSearch).filter(SavedSearch.id != SEED_DEMO_SEARCH_ID)
        )
        searches = result.scalars().all()

        for search in searches:
            # Always work on a fresh copy — `search.schedule or {}` would
            # otherwise hand back the exact same dict object backing the
            # ORM-tracked column. Mutating that object in place before later
            # reassigning `search.schedule = dict(...)` made the "before"
            # and "after" values compare equal to SQLAlchemy's change
            # tracking (since both pointed at content already mutated to
            # include "executed": true), so the UPDATE was silently
            # skipped and the schedule kept re-firing forever. That was the
            # actual cause of jobs (and SerpAPI calls) continuing to fire
            # long after the app was otherwise idle.
            schedule = dict(search.schedule or {})
            if not schedule:
                continue

            schedule_type = schedule.get("type")
            should_run = False

            if schedule_type == "one-time":
                dt_str = schedule.get("datetime")
                if dt_str and not schedule.get("executed"):
                    scheduled_dt = _parse_scheduled_dt(dt_str)
                    if scheduled_dt is None:
                        logger.error(f"Failed to parse scheduled datetime '{dt_str}' for search {search.id}")
                    elif scheduled_dt <= datetime.utcnow():
                        should_run = True
                        schedule["executed"] = True
                        search.schedule = schedule
                        flag_modified(search, "schedule")  # belt-and-braces: force the UPDATE even if content-equality ever tricks the ORM again
                        db.add(search)

            elif schedule_type == "recurring":
                rec = schedule.get("recurrence")
                if rec in ["daily", "weekly", "monthly"]:
                    # Find last job for this search
                    job_result = await db.execute(
                        select(ScrapeJob)
                        .filter_by(search_id=search.id)
                        .order_by(ScrapeJob.started_at.desc())
                        .limit(1)
                    )
                    last_job = job_result.scalars().first()

                    if not last_job:
                        # Run now if it has never run before
                        should_run = True
                    else:
                        now = datetime.utcnow()
                        time_since_last_run = now - last_job.started_at
                        if rec == "daily" and time_since_last_run >= timedelta(days=1):
                            should_run = True
                        elif rec == "weekly" and time_since_last_run >= timedelta(weeks=1):
                            should_run = True
                        elif rec == "monthly" and time_since_last_run >= timedelta(days=30):
                            should_run = True

            if not should_run:
                continue

            # Second guard, independent of the dict-persistence fix above:
            # never queue a new run for a search that already has one
            # in flight, one-time or recurring — stops any pile-up of
            # duplicate concurrent scrapes outright.
            active_result = await db.execute(
                select(ScrapeJob)
                .filter(ScrapeJob.search_id == search.id, ScrapeJob.status.in_(["Queued", "Running"]))
                .limit(1)
            )
            if active_result.scalars().first():
                continue

            logger.info(f"Scheduler: Triggering scheduled scrape job for search '{search.name}' (ID: {search.id})")
            job = ScrapeJob(
                search_id=search.id,
                workspace_id=search.workspace_id,
                status="Queued",
                search_mode=search.search_mode or "individuals",
                leads_found=0,
                per_source_breakdown={},
                triggered_by="System Scheduler",
                logs=["Scheduled scrape job initiated.", "Initializing background worker task..."]
            )
            db.add(job)
            await db.commit()
            await db.refresh(job)

            # Run the background pipeline
            asyncio.create_task(run_sourcing_pipeline(search.id, job.id, SessionLocal))

        await db.commit()
