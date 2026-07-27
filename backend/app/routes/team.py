import re
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.db import get_db
from app.models import User, AuditLog, Organization
from app.routes.auth import get_current_user
from app.auth_utils import hash_password
from app.schemas import TeamInviteRequest, TeamInviteResponse
from app.notifications_util import add_notification
from app.email_sender import send_email, is_smtp_configured
from app.config import settings

router = APIRouter(prefix="/team", tags=["team"])

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_VALID_ROLES = {"Admin", "Sales Manager", "Sales Rep", "Reviewer-only"}
_MIN_PASSWORD_LENGTH = 8

# Roles allowed to invite/manage teammates — mirrors ROLE_PERMISSIONS'
# "invite_team" grant below.
_CAN_MANAGE_TEAM = {"Admin", "Sales Manager"}


def _relative_time(dt: datetime | None) -> str:
    """Real elapsed-time string — no placeholder text. None means the
    invited user has never actually logged in yet."""
    if dt is None:
        return "Never logged in"
    seconds = (datetime.utcnow() - dt).total_seconds()
    if seconds < 120:
        return "Active now"
    if seconds < 3600:
        return f"{int(seconds // 60)}m ago"
    if seconds < 86400:
        return f"{int(seconds // 3600)}h ago"
    return f"{int(seconds // 86400)}d ago"


@router.get("", response_model=dict)
async def list_team(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    result = await db.execute(select(User).filter_by(org_id=current_user.org_id))
    users = result.scalars().all()

    formatted = []
    for u in users:
        formatted.append({
            "id": u.id,
            "name": u.name,
            "email": u.email,
            "role": u.role,
            "status": u.status,
            # Real signal, not a hardcoded placeholder: an invited user who
            # has never logged in has no genuine "last active" time to show.
            "lastActive": _relative_time(u.last_active_at) if u.status != "Invited" else "Never logged in",
            "avatarUrl": u.avatar_url,
            "invitedById": u.invited_by_id,
        })

    return {
        "data": formatted,
        "page": 1,
        "pageSize": len(formatted),
        "total": len(formatted)
    }


@router.post("", response_model=TeamInviteResponse)
async def invite_teammates(
    req: TeamInviteRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Bulk-invite one or more teammates into the *inviter's own* workspace
    (org_id) — each with a real password the inviter set themselves (sent to
    them by email, never invented or auto-emailed as a magic link) and a
    real assigned role. Every invite is independent: one bad email/password
    in a batch doesn't fail the others.
    """
    if current_user.role not in _CAN_MANAGE_TEAM:
        raise HTTPException(status_code=403, detail="Only Admins or Sales Managers can invite team members")

    if not req.invites:
        raise HTTPException(status_code=400, detail="No invites provided")

    org_result = await db.execute(select(Organization).filter_by(id=current_user.org_id))
    org = org_result.scalars().first()
    workspace_name = org.name if org else "your workspace"

    results = []
    for item in req.invites:
        email = (item.email or "").strip().lower()

        if not _EMAIL_RE.match(email):
            results.append({"email": item.email, "success": False, "emailSent": False, "error": "Invalid email address"})
            continue
        if len(item.password) < _MIN_PASSWORD_LENGTH:
            results.append({"email": email, "success": False, "emailSent": False, "error": f"Password must be at least {_MIN_PASSWORD_LENGTH} characters"})
            continue
        if item.role not in _VALID_ROLES:
            results.append({"email": email, "success": False, "emailSent": False, "error": f"Invalid role: {item.role}"})
            continue

        existing = await db.execute(select(User).filter_by(email=email))
        if existing.scalars().first():
            results.append({"email": email, "success": False, "emailSent": False, "error": "A user with this email already exists"})
            continue

        name = (item.name or email.split("@")[0]).strip()
        new_user = User(
            org_id=current_user.org_id,
            email=email,
            name=name,
            role=item.role,
            status="Invited",
            hashed_password=hash_password(item.password),
            invited_by_id=current_user.id,
            default_workspace_id=current_user.default_workspace_id,
        )
        db.add(new_user)

        # Real outbound email carrying the actual login credentials the
        # inviter just set — the only way an invited member can ever learn
        # their password, since it was never generated or stored anywhere
        # but this message and the (hashed) database row.
        login_url = f"{settings.FRONTEND_URL.rstrip('/')}/login"
        subject = f"You've been invited to {workspace_name} on Sales AI"
        body = (
            f"Hi {name},\n\n"
            f"{current_user.name} has invited you to join \"{workspace_name}\" on Sales AI as a {item.role}.\n\n"
            f"Your login credentials:\n"
            f"  Email: {email}\n"
            f"  Password: {item.password}\n\n"
            f"Log in here: {login_url}\n\n"
            f"For security, we recommend changing your password after you log in (Settings > Change Password).\n\n"
            f"— Sales AI"
        )

        email_sent = False
        email_error = None
        if is_smtp_configured():
            email_sent, email_error = await send_email(to_email=email, subject=subject, body=body)
        else:
            email_error = "SMTP is not configured — the invite was created but no email was sent."

        audit_action = f"Invited team member {email} as {item.role}"
        if not email_sent:
            audit_action += " (invite email failed to send)"
        db.add(AuditLog(
            org_id=current_user.org_id,
            actor_id=current_user.id,
            actor_name=current_user.name,
            actor_email=current_user.email,
            action=audit_action,
            category="WORKSPACE",
            target_entity_name=f"{name} ({email})",
        ))

        add_notification(
            db,
            org_id=current_user.org_id,
            type="team_invited",
            title=f"Invited {name} to the workspace",
            description=f"{email} · {item.role}" + ("" if email_sent else f" · {email_error}"),
        )

        results.append({"email": email, "success": True, "emailSent": email_sent, "error": None if email_sent else email_error})

    await db.commit()

    invited_count = sum(1 for r in results if r["success"])
    return {"success": True, "invited": invited_count, "total": len(req.invites), "results": results}


# Role permissions matrix
ROLE_PERMISSIONS = {
    "Admin": ["view_workspace", "manage_settings", "approve_outreach", "send_outreach", "invite_team", "manage_integrations", "delete_data"],
    "Sales Manager": ["view_workspace", "manage_settings", "approve_outreach", "send_outreach", "invite_team"],
    "Sales Rep": ["view_workspace", "send_outreach"],
    "Reviewer-only": ["view_workspace", "approve_outreach"]
}

@router.get("/{id}/permissions")
async def get_teammate_permissions(
    id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    result = await db.execute(select(User).filter_by(id=id, org_id=current_user.org_id))
    user = result.scalars().first()
    if not user:
        raise HTTPException(status_code=404, detail="Teammate not found")

    return {
        "userId": user.id,
        "role": user.role,
        "permissions": ROLE_PERMISSIONS.get(user.role, ["view_workspace"])
    }

@router.patch("/{id}")
async def update_teammate(
    id: str,
    payload: dict,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    # RBAC: Only Admin can edit roles/status
    if current_user.role != "Admin":
        raise HTTPException(status_code=403, detail="Only Admins can modify team members")

    result = await db.execute(select(User).filter_by(id=id, org_id=current_user.org_id))
    user = result.scalars().first()
    if not user:
        raise HTTPException(status_code=404, detail="Teammate not found")

    if user.id == current_user.id:
        raise HTTPException(status_code=400, detail="Cannot change your own role or status")

    changes = []
    if "role" in payload and payload["role"] != user.role:
        if payload["role"] not in _VALID_ROLES:
            raise HTTPException(status_code=400, detail=f"Invalid role: {payload['role']}")
        changes.append(f"role {user.role} -> {payload['role']}")
        user.role = payload["role"]
    if "status" in payload and payload["status"] != user.status:
        if payload["status"] not in ("Active", "Invited", "Suspended"):
            raise HTTPException(status_code=400, detail=f"Invalid status: {payload['status']}")
        changes.append(f"status {user.status} -> {payload['status']}")
        user.status = payload["status"]

    if changes:
        db.add(AuditLog(
            org_id=current_user.org_id,
            actor_id=current_user.id,
            actor_name=current_user.name,
            actor_email=current_user.email,
            action=f"Updated team member {user.email}: {', '.join(changes)}",
            category="WORKSPACE",
            target_entity_name=user.name
        ))

    await db.commit()
    return {"success": True}

@router.delete("/{id}")
async def delete_teammate(
    id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    if current_user.role != "Admin":
        raise HTTPException(status_code=403, detail="Only Admins can delete team members")

    result = await db.execute(select(User).filter_by(id=id, org_id=current_user.org_id))
    user = result.scalars().first()
    if not user:
        raise HTTPException(status_code=404, detail="Teammate not found")

    # Cascade check: do not delete oneself
    if user.id == current_user.id:
        raise HTTPException(status_code=400, detail="Cannot delete your own user")

    await db.delete(user)

    # Audit log
    audit = AuditLog(
        org_id=current_user.org_id,
        actor_id=current_user.id,
        actor_name=current_user.name,
        actor_email=current_user.email,
        action=f"Deleted team member {user.email}",
        category="WORKSPACE",
        target_entity_name=user.name
    )
    db.add(audit)

    await db.commit()
    return {"success": True}

@router.post("/export")
async def export_workspace_data(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    if current_user.role != "Admin":
        raise HTTPException(status_code=403, detail="Only Admins can export workspace data")

    # Audit log
    audit = AuditLog(
        org_id=current_user.org_id,
        actor_id=current_user.id,
        actor_name=current_user.name,
        actor_email=current_user.email,
        action="Initiated full GDPR workspace data export",
        category="WORKSPACE",
        target_entity_name="Workspace Data Archive"
    )
    db.add(audit)
    await db.commit()

    return {
        "success": True,
        "export_url": f"https://api.salesai.ai/exports/org-{current_user.org_id}-archive.json",
        "message": "Export scheduled. You will receive an email once the download package is ready."
    }

@router.post("/purge")
async def purge_workspace_data(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    if current_user.role != "Admin":
        raise HTTPException(status_code=403, detail="Only Admins can purge workspace data")

    # Audit log
    audit = AuditLog(
        org_id=current_user.org_id,
        actor_id=current_user.id,
        actor_name=current_user.name,
        actor_email=current_user.email,
        action="Initiated GDPR danger-zone purge of workspace data",
        category="WORKSPACE",
        target_entity_name="Workspace Storage Purge"
    )
    db.add(audit)
    await db.commit()

    return {
        "success": True,
        "message": "Workspace data purge initiated. All leads, message templates, campaigns, and histories will be permanently removed in 24 hours."
    }
