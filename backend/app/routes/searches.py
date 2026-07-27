from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm.attributes import flag_modified
from typing import List, Optional
from datetime import datetime
import hashlib
import logging
import re

from app.db import get_db
from app.models import SavedSearch, ScrapeJob, User, Company, Contact, Lead, LeadScore, AuditLog, Workspace
from app.schemas import SavedSearchCreate, SavedSearchResponse, ScrapeJobResponse, SearchEstimateRequest, SearchEstimateResponse
from app.routes.auth import get_current_user
from app.routes.workspaces import get_current_workspace
from app.notifications_util import add_notification

router = APIRouter(prefix="/searches", tags=["searches"])
logger = logging.getLogger("salesai.searches")


def DateNow() -> int:
    """Return current UTC timestamp as integer (used for unique ID generation)."""
    return int(datetime.utcnow().timestamp())


def _normalize_key(s: str | None) -> str:
    """Same normalization the scraper uses to match a company name against
    itself regardless of casing/punctuation — used here to recognize an
    already-scraped company by name even when its LinkedIn slug isn't known."""
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def _dedupe_hash(*parts: str) -> str:
    """Stable identity hash for a Lead — workspace-scoped so the same real
    company/person in two different workspaces never collides."""
    raw = "|".join(p for p in parts if p)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


async def _existing_company_identifiers(db, org_id: str, workspace_id: str) -> set:
    """
    Every company already scraped into this workspace (by either search
    mode — a company found while sourcing individuals is still a company the
    user already has), keyed by both its normalized name and LinkedIn slug
    so a repeat Companies-mode search can recognize and skip it even if one
    of those two identifiers wasn't captured. Excludes seeded demo data
    (source_provider != "SerpAPI"), which must never count as "already
    scraped" real inventory.
    """
    result = await db.execute(
        select(Company.name, Company.linkedin_url)
        .filter(Company.org_id == org_id, Company.workspace_id == workspace_id, Company.source_provider == "SerpAPI")
    )
    identifiers: set = set()
    for name, linkedin_url in result.all():
        if name:
            identifiers.add(_normalize_key(name))
        if linkedin_url and "/company/" in linkedin_url:
            slug = linkedin_url.split("/company/")[-1].strip("/").split("/")[0].lower()
            if slug:
                identifiers.add(slug)
    return identifiers


async def _existing_contact_linkedin_urls(db, org_id: str, workspace_id: str) -> set:
    """Every person already scraped into this workspace, by LinkedIn URL —
    used so a repeat Individuals-mode search doesn't resurface the same
    person it already found."""
    result = await db.execute(
        select(Contact.linkedin_url)
        .join(Company, Company.id == Contact.company_id)
        .filter(
            Company.org_id == org_id,
            Company.workspace_id == workspace_id,
            Contact.linkedin_url.isnot(None),
            Contact.linkedin_url != "",
        )
    )
    return {row[0] for row in result.all() if row[0]}


async def _existing_lead_dedupe_hashes(db, workspace_id: str) -> set:
    """Every lead dedupe_hash already present in this workspace, used to skip
    inserting duplicate leads if a re-scrape or search returns candidates
    already saved in the workspace."""
    result = await db.execute(
        select(Lead.dedupe_hash).filter(
            Lead.workspace_id == workspace_id,
            Lead.dedupe_hash.isnot(None),
        )
    )
    return {row[0] for row in result.all() if row[0]}


def build_extra_keywords(advanced_filters: dict) -> list:
    """
    Turn Advanced Filters into real search query terms rather than a
    post-hoc filter over fields we can't verify. This is what makes
    funding stage / hiring signal / required keyword genuinely affect
    the results instead of being decorative.
    """
    advanced_filters = advanced_filters or {}
    keywords = []
    for stage in advanced_filters.get("fundingStages") or []:
        keywords.append(stage)
    if advanced_filters.get("hiringSignal"):
        keywords.append("hiring")
    required_keyword = advanced_filters.get("requiredKeyword")
    if required_keyword:
        keywords.append(required_keyword)
    return keywords


def friendly_error_message(exc: Exception) -> str:
    """
    Map internal/technical failures to plain language a sales rep can
    act on. The real exception is only ever written to server logs.
    """
    return "This search couldn't be completed. Please try again — if it keeps happening, contact support."


async def _run_individual_mode(db, search, job, extra_keywords, _append_log) -> int:
    """Individual-mode scrape + insert — extracted into its own function so
    the pipeline can branch by search_mode. Excludes people already scraped
    into this workspace by a prior search, so a re-run doesn't insert the
    exact same person twice."""
    import asyncio
    from app.scraper_real import scrape_public_leads

    exclude_linkedin_urls = await _existing_contact_linkedin_urls(db, search.org_id, search.workspace_id)
    existing_hashes = await _existing_lead_dedupe_hashes(db, search.workspace_id)

    scraped_results = await scrape_public_leads(
        countries=search.countries or [],
        industries=search.industries or [],
        designations=search.designations or [],
        count_target=search.lead_count_target or 5,
        extra_keywords=extra_keywords,
        exclude_linkedin_urls=exclude_linkedin_urls,
    )

    _append_log(f"Found {len(scraped_results)} matching people so far...")
    _append_log("Reviewing and scoring each match...")
    job.per_source_breakdown = {"LinkedIn (SerpAPI)": len(scraped_results)}
    await db.commit()

    await asyncio.sleep(0.5)

    inserted = 0
    for idx, result_item in enumerate(scraped_results):
        full_name = result_item.get("name", "Candidate")
        comp_name = result_item.get("company") or "Unknown Company"
        hash_val = _dedupe_hash(
            search.workspace_id, "contact",
            result_item.get("linkedin_url") or _normalize_key(f"{full_name}{comp_name}"),
        )

        if hash_val in existing_hashes:
            continue
        existing_hashes.add(hash_val)

        ts_key = DateNow()
        comp_id = f"comp-{ts_key}-{idx}"
        dm_id = f"dm-{ts_key}-{idx}"
        lead_id = f"lead-{ts_key}-{idx}"

        website = result_item.get("website") or None

        # Fields we cannot verify from a public search stay unset —
        # never fabricated (no default funding stage, tech stack,
        # employee count, or "hiring" signal).
        comp = Company(
            id=comp_id,
            org_id=search.org_id,
            workspace_id=search.workspace_id,
            name=comp_name,
            website=website,
            industry=search.industries[0] if search.industries else None,
            size_range=None,
            employee_count=result_item.get("employee_count") or None,
            funding_stage=None,
            tech_stack=[],
            activity_signals={},
            linkedin_url=result_item.get("linkedin_url", ""),
            source_provider="SerpAPI",  # marks this as real scraped data, distinct from seeded demo companies
        )
        db.add(comp)

        email = result_item.get("email") or None
        phone = result_item.get("phone") or None
        if not email and not phone:
            continue

        contact = Contact(
            id=dm_id,
            company_id=comp_id,
            full_name=full_name,
            designation=result_item.get("designation") or (search.designations[0] if search.designations else "Professional"),
            email=email,
            phone=phone,
            linkedin_url=result_item.get("linkedin_url", ""),
            seniority_level="Executive",
            source_provider="SerpAPI",
        )
        db.add(contact)

        lead = Lead(
            id=lead_id,
            org_id=search.org_id,
            workspace_id=search.workspace_id,
            company_id=comp_id,
            contact_id=dm_id,
            job_id=job.id,
            status="new",
            search_mode="individuals",
            notes=result_item.get("snippet", "Found via public LinkedIn search."),
            dedupe_hash=hash_val,
        )
        db.add(lead)

        score_val = result_item.get("score", 50)
        factor_breakdown = {}
        if result_item.get("designation") and search.designations:
            if search.designations[0].lower() in result_item["designation"].lower():
                factor_breakdown["designation_match"] = 100
        if result_item.get("company") and search.industries:
            if search.industries[0].lower() in result_item["company"].lower():
                factor_breakdown["industry_match"] = 100

        score_obj = LeadScore(
            lead_id=lead_id,
            total_score=int(score_val),
            tier="High" if int(score_val) >= 80 else "Medium" if int(score_val) >= 60 else "Low",
            factor_breakdown=factor_breakdown,
        )
        db.add(score_obj)
        inserted += 1
        job.leads_found = inserted

        if inserted % 3 == 0:
            _append_log(f"Processed {inserted} of {len(scraped_results)} matches...")
            await db.commit()

    if inserted > 0:
        await db.commit()

    return inserted


async def _run_company_mode(db, search, job, extra_keywords, _append_log) -> int:
    """Company-mode scrape + insert — same Company/Contact/Lead/LeadScore
    tables as individual mode (they already cover every field the Companies
    mode needs), just populated from scrape_companies() instead, and with no
    job-title filter since a company search doesn't target one person."""
    import asyncio
    from app.scraper_real import scrape_companies

    exclude_identifiers = await _existing_company_identifiers(db, search.org_id, search.workspace_id)
    existing_hashes = await _existing_lead_dedupe_hashes(db, search.workspace_id)

    scraped_results = await scrape_companies(
        countries=search.countries or [],
        industries=search.industries or [],
        count_target=search.lead_count_target or 5,
        extra_keywords=extra_keywords,
        size_min=search.company_size_min,
        size_max=search.company_size_max,
        revenue_bands=search.revenue_bands or [],
        exclude_identifiers=exclude_identifiers,
    )

    _append_log(f"Found {len(scraped_results)} matching companies so far...")
    _append_log("Reviewing each company profile...")

    # Real per-source counts (LinkedIn, Google Maps, Twitter/X, Web) — how
    # many companies actually got data from each, not just which sources
    # were *attempted*.
    source_breakdown: dict = {}
    for r in scraped_results:
        for s in r.get("sources") or []:
            source_breakdown[s] = source_breakdown.get(s, 0) + 1
    job.per_source_breakdown = source_breakdown
    await db.commit()

    await asyncio.sleep(0.5)

    inserted = 0
    for idx, result_item in enumerate(scraped_results):
        comp_name = result_item.get("name") or "Unknown Company"
        hash_val = _dedupe_hash(
            search.workspace_id, "company",
            result_item.get("slug") or _normalize_key(comp_name),
        )

        if hash_val in existing_hashes:
            continue
        existing_hashes.add(hash_val)

        ts_key = DateNow()
        comp_id = f"comp-{ts_key}-{idx}"
        dm_id = f"dm-{ts_key}-{idx}"
        lead_id = f"lead-{ts_key}-{idx}"

        website = result_item.get("website") or None
        activity_signals = result_item.get("activity_signals") or {}

        # employee_count is only ever set to a real, exact figure (min ==
        # max, e.g. LinkedIn's "1 employee"); a bucketed range (the common
        # case, e.g. "51-200") is never collapsed into an invented midpoint —
        # size_range carries that real, LinkedIn-published text instead.
        emp_min = result_item.get("employee_count_min")
        emp_max = result_item.get("employee_count_max")
        exact_employee_count = emp_min if (emp_min is not None and emp_min == emp_max) else None

        comp = Company(
            id=comp_id,
            org_id=search.org_id,
            workspace_id=search.workspace_id,
            name=comp_name,
            website=website,
            industry=search.industries[0] if search.industries else None,
            size_range=result_item.get("size_range"),
            employee_count=exact_employee_count,
            revenue_range=result_item.get("revenue_range"),
            revenue_band=result_item.get("revenue_band"),
            funding_stage=None,
            tech_stack=[],
            summary_text=result_item.get("summary") or None,
            activity_signals=activity_signals,
            linkedin_url=result_item.get("linkedin_url") or "",
            source_provider="SerpAPI",
            raw_source_payload={
                "address": result_item.get("address"),
                "twitter_url": result_item.get("twitter_url"),
                "sources": result_item.get("sources") or [],
            },
        )
        db.add(comp)

        # A decision-maker isn't always found — the contact row is required
        # by the schema (Lead needs a contact_id), so it's created either
        # way, but with honest placeholder text rather than an invented name
        # when nothing genuine turned up. Email/phone come from the
        # company's own website (LinkedIn search results never expose
        # either) — a real, published contact channel for the company, used
        # here even when it isn't the decision-maker's personal address.
        dm = result_item.get("decision_maker") or {}
        found_dm = bool(dm.get("name"))
        email = dm.get("email") or result_item.get("contact_email") or None
        phone = dm.get("phone") or result_item.get("contact_phone") or None

        if not email and not phone:
            continue

        contact = Contact(
            id=dm_id,
            company_id=comp_id,
            full_name=dm.get("name") or "Not identified",
            designation=dm.get("designation") or "Not available",
            email=email,
            phone=phone,
            linkedin_url=dm.get("linkedin_url") or "",
            seniority_level="Executive" if found_dm else None,
            source_provider="SerpAPI" if found_dm else None,
        )
        db.add(contact)

        lead = Lead(
            id=lead_id,
            org_id=search.org_id,
            workspace_id=search.workspace_id,
            company_id=comp_id,
            contact_id=dm_id,
            job_id=job.id,
            status="new",
            search_mode="companies",
            notes=result_item.get("summary") or "Found via public company search.",
            dedupe_hash=hash_val,
        )
        db.add(lead)

        # Score reflects genuine data completeness for this mode — how much
        # of the requested field set (website, decision-maker, contact
        # details, activity signals) was actually found — not a
        # title/industry text match, which doesn't apply when there's no
        # targeted title.
        score_val = 40
        factor_breakdown = {}
        if website:
            score_val += 12
            factor_breakdown["website_found"] = 100
        if found_dm:
            score_val += 18
            factor_breakdown["decision_maker_found"] = 100
        if contact.email:
            score_val += 12
            factor_breakdown["email_found"] = 100
        if contact.phone:
            score_val += 8
            factor_breakdown["phone_found"] = 100
        if activity_signals.get("hiring", {}).get("active"):
            score_val += 6
            factor_breakdown["hiring_signal"] = 100
        if activity_signals.get("achievements"):
            score_val += 4
            factor_breakdown["achievement_signal"] = 100

        score_obj = LeadScore(
            lead_id=lead_id,
            total_score=int(min(100, score_val)),
            tier="High" if score_val >= 80 else "Medium" if score_val >= 60 else "Low",
            factor_breakdown=factor_breakdown,
        )
        db.add(score_obj)
        inserted += 1
        job.leads_found = inserted

        if inserted % 3 == 0:
            _append_log(f"Processed {inserted} of {len(scraped_results)} companies...")
            await db.commit()

    if inserted > 0:
        await db.commit()

    return inserted


# Background scraping pipeline — runs as a FastAPI BackgroundTask
async def run_sourcing_pipeline(search_id: str, job_id: str, db_session_factory):
    async with db_session_factory() as db:
        job = None
        try:
            result = await db.execute(select(SavedSearch).filter_by(id=search_id))
            search = result.scalars().first()
            if not search:
                return

            result2 = await db.execute(select(ScrapeJob).filter_by(id=job_id))
            job = result2.scalars().first()
            if not job:
                return

            def _append_log(msg: str):
                from datetime import datetime as _dt
                ts = _dt.utcnow().strftime("%H:%M:%S")
                logs = list(job.logs or [])
                logs.append(f"[{ts}] {msg}")
                job.logs = logs

            search_mode = search.search_mode or "individuals"
            job.search_mode = search_mode

            job.status = "Running"
            job.logs = []
            _append_log("Getting your search ready...")
            industries_str = ", ".join(search.industries or []) or "any industry"
            countries_str = ", ".join(search.countries or []) or "any location"
            if search_mode == "companies":
                _append_log(f"Looking for companies in {industries_str} ({countries_str})")
            else:
                titles_str = ", ".join(search.designations or []) or "any title"
                _append_log(f"Looking for {titles_str} in {industries_str} ({countries_str})")
            await db.commit()

            import asyncio
            await asyncio.sleep(0.5)
            _append_log("Searching LinkedIn and the web...")
            await db.commit()

            extra_keywords = build_extra_keywords(search.advanced_filters or {})

            if search_mode == "companies":
                inserted = await _run_company_mode(db, search, job, extra_keywords, _append_log)
            else:
                inserted = await _run_individual_mode(db, search, job, extra_keywords, _append_log)

            target = search.lead_count_target or 5
            noun = "companies" if search_mode == "companies" else "leads"
            job.leads_found = inserted
            if inserted == 0:
                job.status = "Completed"
                _append_log(f"Done — matching {noun} found are already saved in your workspace.")
            elif 0 < inserted < target:
                # Genuinely exhausted every real query variant short of the
                # target — say so plainly instead of a misleading "Completed"
                # that implies the full target was met.
                job.status = "Partial"
                _append_log(
                    f"Done — saved {inserted} new {noun} of {target} requested. "
                    f"That's the maximum number of genuine, verifiable matches "
                    f"currently available for these criteria — try broadening "
                    f"your filters (fewer/looser titles, a wider region) to discover more."
                )
            else:
                job.status = "Completed"
                _append_log(f"Done — saved {inserted} {noun} to your workspace.")
            job.completed_at = datetime.utcnow()

            add_notification(
                db,
                org_id=search.org_id,
                type="job_partial" if job.status == "Partial" else "job_completed",
                title=f"Search {'partially ' if job.status == 'Partial' else ''}completed" + (f" — {inserted} of {target} found" if job.status == "Partial" else f" — {inserted} {noun} found"),
                description=search.name,
                related_job_id=job.id,
            )
            await db.commit()

        except Exception as e:
            logger.error(f"Sourcing pipeline failed for job {job_id}: {e}", exc_info=True)
            if job is not None:
                try:
                    await db.rollback()
                    res_job = await db.execute(select(ScrapeJob).filter_by(id=job_id))
                    job = res_job.scalars().first()
                    if job:
                        job.status = "Failed"
                        job.error_detail = friendly_error_message(e)
                        logs = list(job.logs or [])
                        ts = datetime.utcnow().strftime("%H:%M:%S")
                        logs.append(f"[{ts}] This search couldn't be completed. Please try again.")
                        job.logs = logs
                        job.completed_at = datetime.utcnow()

                        if search is not None:
                            add_notification(
                                db,
                                org_id=search.org_id,
                                type="job_failed",
                                title="Search failed",
                                description=search.name,
                                related_job_id=job.id,
                            )
                        await db.commit()
                except Exception as inner_e:
                    logger.error(f"Failed to update job status to Failed: {inner_e}")


SEED_DEMO_SEARCH_ID = "search-1"  # the single fixed-ID row seed.py creates once — never a real user search


@router.get("", response_model=List[SavedSearchResponse])
async def list_searches(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    current_workspace: Workspace = Depends(get_current_workspace),
):
    result = await db.execute(
        select(SavedSearch)
        .filter_by(org_id=current_user.org_id, workspace_id=current_workspace.id)
        .filter(SavedSearch.id != SEED_DEMO_SEARCH_ID)
    )
    return result.scalars().all()

@router.post("", response_model=SavedSearchResponse)
async def create_search(
    req: SavedSearchCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    current_workspace: Workspace = Depends(get_current_workspace),
):
    search = SavedSearch(
        org_id=current_user.org_id,
        workspace_id=current_workspace.id,
        name=req.name,
        countries=req.countries,
        states=req.states,
        cities=req.cities,
        industries=req.industries,
        designations=req.designations,
        lead_count_target=req.lead_count_target,
        company_size_min=req.company_size_min,
        company_size_max=req.company_size_max,
        revenue_bands=req.revenue_bands,
        advanced_filters=req.advanced_filters,
        schedule=req.schedule,
        search_mode=req.search_mode or "individuals",
        created_by=current_user.id
    )
    db.add(search)

    # Audit log
    audit = AuditLog(
        org_id=current_user.org_id,
        workspace_id=current_workspace.id,
        actor_id=current_user.id,
        actor_name=current_user.name,
        actor_email=current_user.email,
        action="Created saved search parameters",
        category="WORKSPACE",
        target_entity_name=req.name
    )
    db.add(audit)

    await db.commit()
    await db.refresh(search)
    return search

@router.post("/{id}/run", response_model=ScrapeJobResponse)
async def run_search_now(
    id: str,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    current_workspace: Workspace = Depends(get_current_workspace),
):
    result = await db.execute(select(SavedSearch).filter_by(id=id, org_id=current_user.org_id, workspace_id=current_workspace.id))
    search = result.scalars().first()
    if not search:
        raise HTTPException(status_code=404, detail="Saved search parameter set not found")

    job = ScrapeJob(
        search_id=search.id,
        workspace_id=search.workspace_id,
        status="Queued",
        search_mode=search.search_mode or "individuals",
        leads_found=0,
        per_source_breakdown={},
        triggered_by=current_user.name,
        logs=["Search queued.", "Getting ready to start..."]
    )
    db.add(job)

    # Audit log
    audit = AuditLog(
        org_id=current_user.org_id,
        workspace_id=current_workspace.id,
        actor_id=current_user.id,
        actor_name=current_user.name,
        actor_email=current_user.email,
        action="Triggered scrape job manually",
        category="SCRAPE",
        target_entity_name=f"Scrape Job for {search.name}"
    )
    db.add(audit)

    await db.commit()
    await db.refresh(job)

    # Run the background pipeline
    from app.db import SessionLocal
    background_tasks.add_task(run_sourcing_pipeline, search.id, job.id, SessionLocal)

    return job

@router.delete("/{id}/schedule")
async def cancel_search_schedule(
    id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    current_workspace: Workspace = Depends(get_current_workspace),
):
    """Cancel a search's schedule (one-time or recurring) without deleting
    the saved search itself — it drops out of the Jobs Queue "Scheduled"
    section but the target parameters remain available to run manually or
    reschedule later."""
    result = await db.execute(select(SavedSearch).filter_by(id=id, org_id=current_user.org_id, workspace_id=current_workspace.id))
    search = result.scalars().first()
    if not search:
        raise HTTPException(status_code=404, detail="Saved search parameter set not found")

    search.schedule = {}
    flag_modified(search, "schedule")

    audit = AuditLog(
        org_id=current_user.org_id,
        workspace_id=current_workspace.id,
        actor_id=current_user.id,
        actor_name=current_user.name,
        actor_email=current_user.email,
        action="Cancelled scheduled scrape",
        category="SCRAPE",
        target_entity_name=search.name
    )
    db.add(audit)

    await db.commit()
    return {"success": True}


@router.delete("/{id}")
async def delete_search(
    id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    current_workspace: Workspace = Depends(get_current_workspace),
):
    result = await db.execute(select(SavedSearch).filter_by(id=id, org_id=current_user.org_id, workspace_id=current_workspace.id))
    search = result.scalars().first()
    if not search:
        raise HTTPException(status_code=404, detail="Saved search parameter set not found")

    await db.delete(search)
    await db.commit()
    return {"success": True}

# Short-lived cache for the live-probe branch of /estimate below — this
# endpoint reruns on every filter tweak while a user sits on the Lead Search
# page, and each miss costs 1-3 real SerpAPI calls. Caching identical
# requests for a few minutes stops rapid repeated/duplicate calls (e.g. two
# effect runs in quick succession, or a user nudging a filter back and
# forth) from re-hitting SerpAPI for the exact same criteria.
_ESTIMATE_CACHE_TTL_SECONDS = 300
_estimate_cache: dict = {}


def _estimate_cache_key(req: "SearchEstimateRequest") -> tuple:
    return (
        req.search_mode,
        tuple(sorted(req.countries or [])),
        tuple(sorted(req.industries or [])),
        tuple(sorted(req.designations or [])),
        req.company_size_min,
        req.company_size_max,
        tuple(sorted(req.revenue_bands or [])),
    )


@router.post("/estimate", response_model=SearchEstimateResponse)
async def estimate_search_reach(
    req: SearchEstimateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    current_workspace: Workspace = Depends(get_current_workspace),
):
    from sqlalchemy import and_
    import time

    cache_key = (current_workspace.id,) + _estimate_cache_key(req)
    cached = _estimate_cache.get(cache_key)
    if cached and (time.monotonic() - cached[0]) < _ESTIMATE_CACHE_TTL_SECONDS:
        return cached[1]

    # 1. Query database for existing real matching companies already discovered
    #    by our own scraper in this workspace — excludes seeded demo companies
    #    (source_provider "Apollo.io"), which must never surface on the Lead
    #    Search page, and excludes every other workspace's real data too.
    filters = [Company.source_provider == "SerpAPI", Company.workspace_id == current_workspace.id]
    if req.industries:
        filters.append(Company.industry.in_(req.industries))

    size_filter_active = req.search_mode == "companies" and (req.company_size_min is not None or req.company_size_max is not None)
    requested_revenue_bands = set(req.revenue_bands or []) if req.search_mode == "companies" else set()
    revenue_filter_active = bool(requested_revenue_bands)

    previews = []
    if req.industries:
        res = await db.execute(
            select(Company)
            .filter(and_(*filters))
            .limit(20 if (size_filter_active or revenue_filter_active) else 3)
        )
        candidates = res.scalars().all()

        if size_filter_active or revenue_filter_active:
            from app.scraper_real import _parse_employee_count, _company_size_in_range, _parse_revenue_text, _revenue_band_matches
            matched = []
            for c in candidates:
                if size_filter_active:
                    emp_min, emp_max = _parse_employee_count(c.size_range or "")
                    if emp_min is None and emp_max is None and c.employee_count is not None:
                        emp_min = emp_max = c.employee_count
                    if not _company_size_in_range(emp_min, emp_max, req.company_size_min, req.company_size_max):
                        continue
                if revenue_filter_active:
                    rev_min, rev_max = _parse_revenue_text(c.revenue_range or "")
                    if not _revenue_band_matches(rev_min, rev_max, requested_revenue_bands):
                        continue
                matched.append(c)
                if len(matched) >= 3:
                    break
            candidates = matched
        else:
            candidates = candidates[:3]

        for c in candidates:
            previews.append({
                "name": c.name,
                "size": c.size_range or (f"{c.employee_count} employees" if c.employee_count else "Not available"),
                "domain": c.website or "Not available",
                "match": None,
            })

    # 2. If not enough real previews in the DB yet, run a small live probe
    #    against the same real scraper the actual job run uses.
    if len(previews) < 3:
        try:
            seen = set(p["name"] for p in previews)
            if req.search_mode == "companies":
                from app.scraper_real import scrape_companies
                # enrich=False: this reruns on every filter change, so skip the
                # per-company decision-maker/website lookups — a real full run
                # (Scrape Now / scheduled) always does the full enrichment.
                scraped_companies = await scrape_companies(
                    countries=req.countries,
                    industries=req.industries,
                    count_target=3 - len(previews),
                    enrich=False,
                    size_min=req.company_size_min,
                    size_max=req.company_size_max,
                    revenue_bands=list(requested_revenue_bands),
                )
                for c in scraped_companies:
                    c_name = c.get("name")
                    if c_name and c_name not in seen and len(previews) < 3:
                        seen.add(c_name)
                        previews.append({
                            "name": c_name,
                            "size": c.get("size_range") or "Not available",
                            "domain": c.get("website") or "Not available",
                            "match": None,
                        })
            else:
                from app.scraper_real import scrape_public_leads
                scraped_leads = await scrape_public_leads(
                    countries=req.countries,
                    industries=req.industries,
                    designations=req.designations,
                    count_target=3 - len(previews),
                )
                for lead in scraped_leads:
                    c_name = lead.get("company")
                    if c_name and c_name not in seen and len(previews) < 3:
                        seen.add(c_name)
                        previews.append({
                            "name": c_name,
                            "size": "Not available",
                            "domain": "Not available",
                            "match": None,
                        })
        except Exception as e:
            logger.warning(f"Live preview probe failed: {e}")

    # No fabricated fallback list — if nothing real was found, previews stays empty
    # and the UI shows an honest "no preview companies found yet" state.

    response = {
        "match_count": len(previews),
        "preview_companies": previews
    }
    _estimate_cache[cache_key] = (time.monotonic(), response)
    return response
