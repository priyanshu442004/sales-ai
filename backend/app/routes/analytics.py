from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.models import User, Workspace
from app.routes.auth import get_current_user
from app.routes.workspaces import get_current_workspace
from app import analytics_util as au

router = APIRouter(prefix="/analytics", tags=["analytics"])

_RANGE_DAYS = {"7d": 7, "30d": 30, "90d": 90}


@router.get("/summary", response_model=dict)
async def get_analytics_summary(
    range: str = "7d",
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    current_workspace: Workspace = Depends(get_current_workspace),
):
    workspace_id = current_workspace.id
    days = _RANGE_DAYS.get(range, 7)

    email_performance = await au.compute_email_performance_series(db, workspace_id, days=days)
    sentiment = await au.compute_sentiment_breakdown(db, workspace_id)
    api_usage = await au.compute_api_usage_series(db, days=days)
    funnel = await au.compute_funnel(db, workspace_id)
    reply_rate = await au.compute_reply_rate(db, workspace_id)

    total_sent = sum(d["sent"] for d in email_performance)
    total_failed = sum(d["failed"] for d in email_performance)

    return {
        "range": range,
        "emailPerformance": email_performance,
        "sentiment": sentiment,
        "apiUsage": api_usage,
        "funnel": funnel,
        "replyRate": reply_rate,
        "totals": {"sent": total_sent, "failed": total_failed},
    }
