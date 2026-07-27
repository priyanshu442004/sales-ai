"""
Shared notification-creation helper — imported by any pipeline that needs
to raise a real, persisted notification (job completion, email sends,
etc.) without creating circular imports between route modules.
"""
from app.models import Notification


def add_notification(db, org_id: str, type: str, title: str, description: str | None = None, related_job_id: str | None = None) -> Notification:
    notification = Notification(
        org_id=org_id,
        type=type,
        title=title,
        description=description,
        related_job_id=related_job_id,
    )
    db.add(notification)
    return notification
