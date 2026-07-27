from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from datetime import datetime

from sqlalchemy import or_

from app.db import get_db
from app.models import MessageTemplate, User, Workspace
from app.schemas import TemplateCreate
from app.routes.auth import get_current_user
from app.routes.workspaces import get_current_workspace

router = APIRouter(prefix="/templates", tags=["templates"])

# LinkedIn is its own channel — everything else in this taxonomy sends by email.
_LINKEDIN_TYPES = {"LinkedIn Connection Note"}


def _channel_for(template_type: str) -> str:
    return "linkedin" if template_type in _LINKEDIN_TYPES else "email"


def format_template(t: MessageTemplate) -> dict:
    return {
        "id": t.id,
        "name": t.name,
        "type": t.type,
        "channel": _channel_for(t.type),
        "subject": t.subject,
        "body": t.body,
        "tags": t.tags or [],
        "usageCount": t.usage_count or 0,
        "lastUsedAt": t.last_used_at.isoformat() + "Z" if t.last_used_at else None,
        "createdAt": t.created_at.isoformat() + "Z" if t.created_at else None,
        "updatedAt": t.updated_at.isoformat() + "Z" if t.updated_at else None,
    }


@router.get("", response_model=dict)
async def list_templates(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    current_workspace: Workspace = Depends(get_current_workspace),
):
    stmt = select(MessageTemplate).filter(
        MessageTemplate.org_id == current_user.org_id,
        or_(
            MessageTemplate.workspace_id == current_workspace.id,
            MessageTemplate.workspace_id.is_(None),
            MessageTemplate.workspace_id == ""
        )
    )
    result = await db.execute(stmt)
    templates = result.scalars().all()
    formatted = [format_template(t) for t in templates]
    formatted.sort(key=lambda t: t["updatedAt"] or "", reverse=True)

    return {
        "data": formatted,
        "page": 1,
        "pageSize": len(formatted),
        "total": len(formatted)
    }


@router.post("")
async def save_template(
    payload: TemplateCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    current_workspace: Workspace = Depends(get_current_workspace),
):
    if not payload.name.strip():
        raise HTTPException(status_code=400, detail="Template name is required.")
    if not payload.body.strip():
        raise HTTPException(status_code=400, detail="Template body is required.")

    if payload.id:
        result = await db.execute(select(MessageTemplate).filter_by(id=payload.id, org_id=current_user.org_id, workspace_id=current_workspace.id))
        tmpl = result.scalars().first()
        if not tmpl:
            raise HTTPException(status_code=404, detail="Template not found")
        tmpl.name = payload.name
        tmpl.type = payload.type
        tmpl.subject = payload.subject if payload.type != "LinkedIn Connection Note" else None
        tmpl.body = payload.body
        tmpl.tags = payload.tags
        tmpl.updated_at = datetime.utcnow()
    else:
        tmpl = MessageTemplate(
            org_id=current_user.org_id,
            workspace_id=current_workspace.id,
            name=payload.name,
            type=payload.type,
            subject=payload.subject if payload.type != "LinkedIn Connection Note" else None,
            body=payload.body,
            tags=payload.tags,
            performance_stats={},
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
            usage_count=0,
        )
        db.add(tmpl)

    await db.commit()
    await db.refresh(tmpl)
    return format_template(tmpl)


@router.delete("/{template_id}")
async def delete_template(
    template_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    current_workspace: Workspace = Depends(get_current_workspace),
):
    result = await db.execute(select(MessageTemplate).filter_by(id=template_id, org_id=current_user.org_id, workspace_id=current_workspace.id))
    tmpl = result.scalars().first()
    if not tmpl:
        raise HTTPException(status_code=404, detail="Template not found")

    await db.delete(tmpl)
    await db.commit()
    return {"success": True}
