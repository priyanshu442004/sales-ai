from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Header
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import func, delete as sa_delete, update as sa_update, or_
from pydantic import BaseModel

from app.db import get_db
from app.models import (
    Workspace, User, AuditLog, Company, Contact, Lead, LeadScore, Message,
    MessageTemplate, Sequence, SequenceEnrollment, SavedSearch, ScrapeJob,
    Integration, ScoringConfig, Conversation, ConversationMessage,
)
from app.routes.auth import get_current_user

router = APIRouter(prefix="/workspaces", tags=["workspaces"])

# Roles allowed to create/rename/delete workspaces — mirrors team.py's
# _CAN_MANAGE_TEAM (Admins and Sales Managers already manage workspace-level
# settings/invites there). Every role can switch between existing workspaces.
_CAN_MANAGE_WORKSPACES = {"Admin", "Sales Manager"}


class WorkspaceCreateRequest(BaseModel):
    name: str


class WorkspaceRenameRequest(BaseModel):
    name: str


class WorkspaceDeleteRequest(BaseModel):
    confirm_name: str


def format_workspace(ws: Workspace) -> dict:
    return {
        "id": ws.id,
        "name": ws.name,
        "isDefault": bool(ws.is_default),
        "createdAt": ws.created_at.isoformat() + "Z" if ws.created_at else None,
        "createdBy": ws.created_by,
    }


def get_user_workspace_conditions(current_user: User):
    """
    User-specific workspace isolation:
    A workspace is accessible to a user if:
    1. It was created by the user (created_by == current_user.id)
    2. It is the user's default_workspace_id
    3. If user was invited, it was created by the inviter (created_by == current_user.invited_by_id)
    """
    conditions = [
        Workspace.created_by == current_user.id,
        Workspace.id == current_user.default_workspace_id,
    ]
    if current_user.invited_by_id:
        conditions.append(Workspace.created_by == current_user.invited_by_id)
    return or_(*conditions)


async def get_current_workspace(
    x_workspace_id: Optional[str] = Header(None, alias="X-Workspace-Id"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Workspace:
    candidate_id = x_workspace_id or current_user.default_workspace_id

    if candidate_id:
        result = await db.execute(select(Workspace).filter_by(id=candidate_id))
        ws = result.scalars().first()
        if ws and ws.org_id == current_user.org_id:
            # Check user ownership / invite access
            if (
                ws.created_by == current_user.id
                or ws.id == current_user.default_workspace_id
                or (current_user.invited_by_id and ws.created_by == current_user.invited_by_id)
            ):
                return ws
            if x_workspace_id:
                raise HTTPException(status_code=400, detail="Invalid or inaccessible workspace")

    result = await db.execute(
        select(Workspace)
        .filter(Workspace.org_id == current_user.org_id, get_user_workspace_conditions(current_user))
        .order_by(Workspace.created_at.asc())
    )
    ws = result.scalars().first()
    if not ws:
        # Create personal workspace if none exists for this user
        ws = Workspace(
            org_id=current_user.org_id,
            name=f"{current_user.name}'s Workspace",
            is_default=False,
            created_by=current_user.id
        )
        db.add(ws)
        current_user.default_workspace_id = ws.id
        await db.commit()
        await db.refresh(ws)
    return ws


@router.get("", response_model=dict)
async def list_workspaces(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Workspace)
        .filter(Workspace.org_id == current_user.org_id, get_user_workspace_conditions(current_user))
        .order_by(Workspace.created_at.asc())
    )
    workspaces = result.scalars().all()
    if not workspaces:
        ws = Workspace(
            org_id=current_user.org_id,
            name=f"{current_user.name}'s Workspace",
            is_default=False,
            created_by=current_user.id
        )
        db.add(ws)
        current_user.default_workspace_id = ws.id
        await db.commit()
        await db.refresh(ws)
        workspaces = [ws]
    return {"data": [format_workspace(w) for w in workspaces]}


@router.post("", response_model=dict)
async def create_workspace(
    req: WorkspaceCreateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role not in _CAN_MANAGE_WORKSPACES:
        raise HTTPException(status_code=403, detail="Only Admins or Sales Managers can create workspaces")
    if not req.name.strip():
        raise HTTPException(status_code=400, detail="Workspace name is required.")

    # Starts fully empty — no integrations/templates/leads cloned in, so
    # each workspace's data stays genuinely isolated from the start.
    ws = Workspace(
        org_id=current_user.org_id,
        name=req.name.strip(),
        is_default=False,
        created_by=current_user.id,
    )
    db.add(ws)

    db.add(AuditLog(
        org_id=current_user.org_id,
        actor_id=current_user.id,
        actor_name=current_user.name,
        actor_email=current_user.email,
        action=f"Created workspace {ws.name}",
        category="WORKSPACE",
        target_entity_name=ws.name,
    ))

    await db.commit()
    await db.refresh(ws)
    return format_workspace(ws)


@router.patch("/{workspace_id}", response_model=dict)
async def rename_workspace(
    workspace_id: str,
    req: WorkspaceRenameRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role not in _CAN_MANAGE_WORKSPACES:
        raise HTTPException(status_code=403, detail="Only Admins or Sales Managers can rename workspaces")
    if not req.name.strip():
        raise HTTPException(status_code=400, detail="Workspace name is required.")

    result = await db.execute(select(Workspace).filter_by(id=workspace_id, org_id=current_user.org_id))
    ws = result.scalars().first()
    if not ws:
        raise HTTPException(status_code=404, detail="Workspace not found")

    old_name = ws.name
    ws.name = req.name.strip()

    db.add(AuditLog(
        org_id=current_user.org_id,
        actor_id=current_user.id,
        actor_name=current_user.name,
        actor_email=current_user.email,
        action=f"Renamed workspace \"{old_name}\" to \"{ws.name}\"",
        category="WORKSPACE",
        target_entity_name=ws.name,
    ))

    await db.commit()
    return format_workspace(ws)


@router.delete("/{workspace_id}")
async def delete_workspace(
    workspace_id: str,
    req: WorkspaceDeleteRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role not in _CAN_MANAGE_WORKSPACES:
        raise HTTPException(status_code=403, detail="Only Admins or Sales Managers can delete workspaces")

    result = await db.execute(select(Workspace).filter_by(id=workspace_id, org_id=current_user.org_id))
    ws = result.scalars().first()
    if not ws:
        raise HTTPException(status_code=404, detail="Workspace not found")

    if ws.is_default:
        raise HTTPException(status_code=400, detail="The default workspace can't be deleted.")

    total_result = await db.execute(select(func.count(Workspace.id)).filter_by(org_id=current_user.org_id))
    if (total_result.scalar() or 0) <= 1:
        raise HTTPException(status_code=400, detail="An organization must always have at least one workspace.")

    if req.confirm_name.strip() != ws.name:
        raise HTTPException(status_code=400, detail="Type the workspace's exact name to confirm deletion.")

    # Explicit, ordered cascade rather than relying on the DB-level
    # ondelete="CASCADE" in models.py: this app runs on SQLite in dev/test,
    # which silently does NOT enforce foreign-key constraints unless a
    # per-connection PRAGMA is set (it isn't, here) — so deleting just the
    # Workspace row would leave every child row orphaned on SQLite while
    # only working correctly on Postgres. Children deleted before parents,
    # the same manual-cascade approach routes/jobs.py already uses when
    # deleting a job's leads.
    lead_ids_subq = select(Lead.id).filter_by(workspace_id=ws.id).scalar_subquery()
    company_ids_subq = select(Company.id).filter_by(workspace_id=ws.id).scalar_subquery()
    sequence_ids_subq = select(Sequence.id).filter_by(workspace_id=ws.id).scalar_subquery()
    conversation_ids_subq = select(Conversation.id).filter_by(workspace_id=ws.id).scalar_subquery()

    await db.execute(sa_delete(Message).where(Message.workspace_id == ws.id))
    await db.execute(sa_delete(SequenceEnrollment).where(SequenceEnrollment.sequence_id.in_(sequence_ids_subq)))
    await db.execute(sa_delete(Sequence).where(Sequence.workspace_id == ws.id))
    await db.execute(sa_delete(ConversationMessage).where(ConversationMessage.conversation_id.in_(conversation_ids_subq)))
    await db.execute(sa_delete(Conversation).where(Conversation.workspace_id == ws.id))
    await db.execute(sa_delete(LeadScore).where(LeadScore.lead_id.in_(lead_ids_subq)))
    await db.execute(sa_delete(Lead).where(Lead.workspace_id == ws.id))
    await db.execute(sa_delete(Contact).where(Contact.company_id.in_(company_ids_subq)))
    await db.execute(sa_delete(Company).where(Company.workspace_id == ws.id))
    await db.execute(sa_delete(ScrapeJob).where(ScrapeJob.workspace_id == ws.id))
    await db.execute(sa_delete(SavedSearch).where(SavedSearch.workspace_id == ws.id))
    await db.execute(sa_delete(MessageTemplate).where(MessageTemplate.workspace_id == ws.id))
    await db.execute(sa_delete(Integration).where(Integration.workspace_id == ws.id))
    await db.execute(sa_delete(ScoringConfig).where(ScoringConfig.workspace_id == ws.id))

    # Any user remembering this workspace as their default falls back
    # cleanly on next login instead of a dangling reference.
    await db.execute(sa_update(User).where(User.default_workspace_id == ws.id).values(default_workspace_id=None))

    ws_name = ws.name
    await db.delete(ws)

    db.add(AuditLog(
        org_id=current_user.org_id,
        actor_id=current_user.id,
        actor_name=current_user.name,
        actor_email=current_user.email,
        action=f"Deleted workspace \"{ws_name}\" and all its data",
        category="WORKSPACE",
        target_entity_name=ws_name,
    ))

    await db.commit()
    return {"success": True}


@router.post("/{workspace_id}/switch", response_model=dict)
async def switch_workspace(
    workspace_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(select(Workspace).filter_by(id=workspace_id, org_id=current_user.org_id))
    ws = result.scalars().first()
    if not ws:
        raise HTTPException(status_code=404, detail="Workspace not found")

    current_user.default_workspace_id = ws.id
    await db.commit()
    return format_workspace(ws)
