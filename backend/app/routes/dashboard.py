from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload
from sqlalchemy import func, desc

from app.db import get_db
from app.models import ScrapeJob, Lead, Message, AuditLog, LeadScore, SavedSearch, Workspace
from app.routes.auth import get_current_user
from app.routes.workspaces import get_current_workspace
from app.models import User
from app import analytics_util as au

router = APIRouter(prefix="/dashboard", tags=["dashboard"])

# Each dashboard section is its own endpoint (rather than one bundled
# /summary response) so the frontend can fire them all in parallel and
# render each section the moment its own request resolves — a slow query
# for one section (e.g. the funnel) no longer holds up the KPI cards or
# activity feed from appearing.


@router.get("/kpis", response_model=dict)
async def get_dashboard_kpis(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    current_workspace: Workspace = Depends(get_current_workspace),
):
    workspace_id = current_workspace.id

    active_scrapes = await db.scalar(
        select(func.count(ScrapeJob.id))
        .filter(ScrapeJob.workspace_id == workspace_id, ScrapeJob.status.in_(["Queued", "Running"]))
    )
    leads_for_review = await db.scalar(
        select(func.count(Lead.id)).filter(Lead.workspace_id == workspace_id, Lead.status == "new")
    )
    pending_sends = await db.scalar(
        select(func.count(Message.id)).filter(Message.workspace_id == workspace_id, Message.status == "pending_approval")
    )
    replies_series = await au.compute_reply_series(db, workspace_id, days=7)

    return {
        "activeScrapes": {"value": int(active_scrapes or 0), "sparkline": await au.compute_job_creation_series(db, workspace_id)},
        "leadsForReview": {"value": int(leads_for_review or 0), "sparkline": await au.compute_lead_creation_series(db, workspace_id)},
        "pendingSends": {"value": int(pending_sends or 0), "sparkline": await au.compute_message_creation_series(db, workspace_id, status="pending_approval")},
        "repliesThisWeek": {"value": int(sum(replies_series)), "sparkline": replies_series},
    }


@router.get("/funnel", response_model=dict)
async def get_dashboard_funnel(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    current_workspace: Workspace = Depends(get_current_workspace),
):
    funnel = await au.compute_funnel(db, current_workspace.id)
    reply_rate = await au.compute_reply_rate(db, current_workspace.id)
    return {"funnel": funnel, "replyRate": reply_rate}


@router.get("/leads-over-time", response_model=dict)
async def get_dashboard_leads_over_time(
    days: int = 30,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    current_workspace: Workspace = Depends(get_current_workspace),
):
    series = await au.compute_leads_over_time(db, current_workspace.id, days=days)
    return {"series": series}


@router.get("/activities", response_model=dict)
async def get_dashboard_activities(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    current_workspace: Workspace = Depends(get_current_workspace),
):
    # The dedicated Audit Log page stays org-wide (security/ops visibility
    # isn't meant to be siloed per workspace) — but this dashboard widget
    # filters to the current workspace so "Recent Activity" feels scoped
    # like the rest of the page.
    audit_res = await db.execute(
        select(AuditLog)
        .filter(AuditLog.org_id == current_user.org_id, AuditLog.workspace_id == current_workspace.id)
        .order_by(desc(AuditLog.created_at)).limit(6)
    )
    activities = [
        {
            "actor": a.actor_name or "System",
            "action": a.action,
            "details": a.target_entity_name or "",
            "time": a.created_at.isoformat() + "Z",
        }
        for a in audit_res.scalars().all()
    ]
    return {"activities": activities}


@router.get("/attention", response_model=dict)
async def get_dashboard_attention(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    current_workspace: Workspace = Depends(get_current_workspace),
):
    workspace_id = current_workspace.id

    lead_res = await db.execute(
        select(Lead)
        .options(selectinload(Lead.company), selectinload(Lead.contact), selectinload(Lead.score_details))
        .filter(Lead.workspace_id == workspace_id, Lead.status == "new")
        .join(LeadScore, LeadScore.lead_id == Lead.id, isouter=True)
        .order_by(desc(LeadScore.total_score))
        .limit(3)
    )
    attention_items = []
    for lead in lead_res.scalars().all():
        score = lead.score_details.total_score if lead.score_details else None
        attention_items.append({
            "type": "Lead Review",
            "title": f"{lead.company.name} ({lead.contact.designation})",
            "desc": f"Sourced {lead.contact.full_name}." + (" Email found." if lead.contact.email else " No email found yet."),
            "priority": "High" if (score or 0) >= 80 else "Medium",
            "score": score,
            "link": "/leads",
        })

    msg_res = await db.execute(
        select(Message)
        .options(selectinload(Message.lead).selectinload(Lead.contact), selectinload(Message.lead).selectinload(Lead.company))
        .filter(Message.workspace_id == workspace_id, Message.status == "pending_approval")
        .order_by(desc(Message.created_at))
        .limit(3)
    )
    for msg in msg_res.scalars().all():
        if not msg.lead:
            continue
        attention_items.append({
            "type": "Outbound Send",
            "title": f"{msg.type} to {msg.lead.contact.full_name}",
            "desc": f"Awaiting approval for {msg.lead.company.name}.",
            "priority": "High",
            "score": None,
            "link": "/outreach/approval",
        })

    return {"attentionItems": attention_items[:6]}
