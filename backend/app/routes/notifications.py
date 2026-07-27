from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from typing import Optional
from pydantic import BaseModel

from app.db import get_db
from app.models import Notification, User
from app.routes.auth import get_current_user

router = APIRouter(prefix="/notifications", tags=["notifications"])


def format_notification(n: Notification) -> dict:
    return {
        "id": n.id,
        "type": n.type,
        "title": n.title,
        "description": n.description,
        "read": bool(n.read),
        "relatedJobId": n.related_job_id,
        "createdAt": n.created_at.isoformat() + "Z" if n.created_at else None,
    }


class NotificationUpdate(BaseModel):
    read: Optional[bool] = None


@router.get("")
async def list_notifications(
    unreadOnly: bool = False,
    limit: int = 50,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = select(Notification).filter_by(org_id=current_user.org_id).order_by(Notification.created_at.desc())
    if unreadOnly:
        query = query.filter(Notification.read == False)  # noqa: E712
    query = query.limit(limit)

    result = await db.execute(query)
    notifications = result.scalars().all()
    unread_count_result = await db.execute(
        select(Notification).filter_by(org_id=current_user.org_id, read=False)
    )
    unread_count = len(unread_count_result.scalars().all())

    return {
        "data": [format_notification(n) for n in notifications],
        "unreadCount": unread_count,
    }


@router.patch("/{id}")
async def update_notification(
    id: str,
    req: NotificationUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(select(Notification).filter_by(id=id, org_id=current_user.org_id))
    notification = result.scalars().first()
    if not notification:
        raise HTTPException(status_code=404, detail="Notification not found")

    if req.read is not None:
        notification.read = req.read

    await db.commit()
    return format_notification(notification)


@router.delete("/{id}")
async def delete_notification(
    id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(select(Notification).filter_by(id=id, org_id=current_user.org_id))
    notification = result.scalars().first()
    if not notification:
        raise HTTPException(status_code=404, detail="Notification not found")

    await db.delete(notification)
    await db.commit()
    return {"success": True}


@router.post("/mark-all-read")
async def mark_all_read(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(select(Notification).filter_by(org_id=current_user.org_id, read=False))
    for notification in result.scalars().all():
        notification.read = True
    await db.commit()
    return {"success": True}
