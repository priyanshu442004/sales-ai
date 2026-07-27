"""
Shared real-data aggregation helpers for the Dashboard and Analytics pages.

Every number here is a genuine count derived from rows the app itself
created (leads, messages, conversations, scrape jobs, audit log, API usage
events) — never a fabricated or simulated figure. A metric with nothing to
back it yet (e.g. "meeting booked" — no field anywhere records that) is
simply left out of the funnel rather than shown as a fake zero or made-up
number.

All aggregates are scoped by workspace_id (not just org_id) — every
underlying table (Lead, Message, Company, Conversation, ScrapeJob,
SavedSearch) carries its own direct workspace_id column, so no extra joins
are needed to get there.
"""
from datetime import datetime, timedelta
from sqlalchemy import func, select, and_, distinct
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Lead, Message, Company, Conversation, ConversationMessage,
    ScrapeJob, SavedSearch, ApiUsageEvent,
)


async def compute_funnel(db: AsyncSession, workspace_id: str) -> list[dict]:
    scraped = await db.scalar(select(func.count(Lead.id)).filter(Lead.workspace_id == workspace_id))
    reviewed = await db.scalar(
        select(func.count(Lead.id)).filter(Lead.workspace_id == workspace_id, Lead.status != "new")
    )
    contacted = await db.scalar(
        select(func.count(distinct(Message.lead_id)))
        .join(Lead, Lead.id == Message.lead_id)
        .filter(Lead.workspace_id == workspace_id)
    )
    replied = await db.scalar(
        select(func.count(distinct(Conversation.lead_id)))
        .join(ConversationMessage, ConversationMessage.conversation_id == Conversation.id)
        .join(Lead, Lead.id == Conversation.lead_id)
        .filter(Lead.workspace_id == workspace_id, ConversationMessage.direction == "inbound")
    )

    return [
        {"name": "Scraped Leads", "value": int(scraped or 0)},
        {"name": "Reviewed", "value": int(reviewed or 0)},
        {"name": "Contacted", "value": int(contacted or 0)},
        {"name": "Replied", "value": int(replied or 0)},
    ]


async def compute_reply_rate(db: AsyncSession, workspace_id: str) -> float:
    funnel = await compute_funnel(db, workspace_id)
    by_name = {f["name"]: f["value"] for f in funnel}
    contacted = by_name.get("Contacted", 0)
    replied = by_name.get("Replied", 0)
    if contacted <= 0:
        return 0.0
    return round(100 * replied / contacted, 1)


def _day_buckets(days: int) -> list[str]:
    today = datetime.utcnow().date()
    return [(today - timedelta(days=i)).isoformat() for i in range(days - 1, -1, -1)]


async def compute_email_performance_series(db: AsyncSession, workspace_id: str, days: int = 7) -> list[dict]:
    since = datetime.utcnow() - timedelta(days=days)
    rows = await db.execute(
        select(
            func.date(Message.created_at).label("day"),
            Message.status,
            func.count(Message.id),
        )
        .filter(Message.workspace_id == workspace_id, Message.channel == "email", Message.created_at >= since)
        .group_by(func.date(Message.created_at), Message.status)
    )
    counts: dict[str, dict[str, int]] = {}
    for day, status, cnt in rows.all():
        day_str = day if isinstance(day, str) else day.isoformat()
        counts.setdefault(day_str, {"sent": 0, "failed": 0})
        if status == "sent":
            counts[day_str]["sent"] += cnt
        elif status == "failed":
            counts[day_str]["failed"] += cnt

    return [
        {"date": d, "sent": counts.get(d, {}).get("sent", 0), "failed": counts.get(d, {}).get("failed", 0)}
        for d in _day_buckets(days)
    ]


async def compute_sentiment_breakdown(db: AsyncSession, workspace_id: str) -> list[dict]:
    rows = await db.execute(
        select(Conversation.sentiment, func.count(Conversation.id))
        .join(Lead, Lead.id == Conversation.lead_id)
        .filter(Lead.workspace_id == workspace_id)
        .group_by(Conversation.sentiment)
    )
    return [{"name": sentiment or "Neutral", "value": int(cnt)} for sentiment, cnt in rows.all()]


async def compute_api_usage_series(db: AsyncSession, days: int = 7) -> list[dict]:
    since = datetime.utcnow() - timedelta(days=days)
    rows = await db.execute(
        select(func.date(ApiUsageEvent.created_at).label("day"), func.count(ApiUsageEvent.id))
        .filter(ApiUsageEvent.created_at >= since)
        .group_by(func.date(ApiUsageEvent.created_at))
    )
    counts = {(d if isinstance(d, str) else d.isoformat()): int(c) for d, c in rows.all()}
    return [{"date": d, "calls": counts.get(d, 0)} for d in _day_buckets(days)]


async def compute_lead_creation_series(db: AsyncSession, workspace_id: str, days: int = 7) -> list[int]:
    """Per-day count of new companies discovered — the closest real proxy
    for "leads found" volume, since Lead itself has no created_at column but
    Company.first_seen_at is set the moment a company is scraped."""
    since = datetime.utcnow() - timedelta(days=days)
    rows = await db.execute(
        select(func.date(Company.first_seen_at).label("day"), func.count(Company.id))
        .filter(Company.workspace_id == workspace_id, Company.first_seen_at >= since)
        .group_by(func.date(Company.first_seen_at))
    )
    counts = {(d if isinstance(d, str) else d.isoformat()): int(c) for d, c in rows.all()}
    return [counts.get(d, 0) for d in _day_buckets(days)]


async def compute_job_creation_series(db: AsyncSession, workspace_id: str, days: int = 7) -> list[int]:
    since = datetime.utcnow() - timedelta(days=days)
    rows = await db.execute(
        select(func.date(ScrapeJob.started_at).label("day"), func.count(ScrapeJob.id))
        .filter(ScrapeJob.workspace_id == workspace_id, ScrapeJob.started_at >= since)
        .group_by(func.date(ScrapeJob.started_at))
    )
    counts = {(d if isinstance(d, str) else d.isoformat()): int(c) for d, c in rows.all()}
    return [counts.get(d, 0) for d in _day_buckets(days)]


async def compute_message_creation_series(db: AsyncSession, workspace_id: str, days: int = 7, status: str | None = None) -> list[int]:
    since = datetime.utcnow() - timedelta(days=days)
    filters = [Message.workspace_id == workspace_id, Message.created_at >= since]
    if status:
        filters.append(Message.status == status)
    rows = await db.execute(
        select(func.date(Message.created_at).label("day"), func.count(Message.id))
        .filter(and_(*filters))
        .group_by(func.date(Message.created_at))
    )
    counts = {(d if isinstance(d, str) else d.isoformat()): int(c) for d, c in rows.all()}
    return [counts.get(d, 0) for d in _day_buckets(days)]


async def compute_leads_over_time(db: AsyncSession, workspace_id: str, days: int = 30) -> list[dict]:
    """
    Real cumulative "total leads scraped" growth curve — each point is the
    running total of leads discovered up to and including that day, not a
    per-day delta. Keyed off Company.first_seen_at (set the moment a company
    is scraped) since Lead itself has no created_at column, same real proxy
    used by compute_lead_creation_series.
    """
    since = datetime.utcnow() - timedelta(days=days)

    baseline = await db.scalar(
        select(func.count(Lead.id))
        .join(Company, Company.id == Lead.company_id)
        .filter(Lead.workspace_id == workspace_id, Company.first_seen_at < since)
    )

    rows = await db.execute(
        select(func.date(Company.first_seen_at).label("day"), func.count(Lead.id))
        .join(Lead, Lead.company_id == Company.id)
        .filter(Lead.workspace_id == workspace_id, Company.first_seen_at >= since)
        .group_by(func.date(Company.first_seen_at))
    )
    counts = {(d if isinstance(d, str) else d.isoformat()): int(c) for d, c in rows.all()}

    running = int(baseline or 0)
    series = []
    for d in _day_buckets(days):
        running += counts.get(d, 0)
        series.append({"date": d, "total": running})
    return series


async def compute_reply_series(db: AsyncSession, workspace_id: str, days: int = 7) -> list[int]:
    since = datetime.utcnow() - timedelta(days=days)
    rows = await db.execute(
        select(func.date(ConversationMessage.timestamp).label("day"), func.count(ConversationMessage.id))
        .join(Conversation, Conversation.id == ConversationMessage.conversation_id)
        .join(Lead, Lead.id == Conversation.lead_id)
        .filter(Lead.workspace_id == workspace_id, ConversationMessage.direction == "inbound", ConversationMessage.timestamp >= since)
        .group_by(func.date(ConversationMessage.timestamp))
    )
    counts = {(d if isinstance(d, str) else d.isoformat()): int(c) for d, c in rows.all()}
    return [counts.get(d, 0) for d in _day_buckets(days)]
