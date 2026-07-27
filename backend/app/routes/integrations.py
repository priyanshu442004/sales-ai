from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from typing import List

from app.db import get_db
from app.models import Integration, User, Workspace
from app.routes.auth import get_current_user
from app.routes.workspaces import get_current_workspace

router = APIRouter(prefix="/integrations", tags=["integrations"])

@router.get("", response_model=dict)
async def list_integrations(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    current_workspace: Workspace = Depends(get_current_workspace),
):
    result = await db.execute(select(Integration).filter_by(org_id=current_user.org_id, workspace_id=current_workspace.id))
    integrations = result.scalars().all()

    formatted = []
    for i in integrations:
        formatted.append({
            "id": i.id,
            "name": i.name,
            "category": i.category,
            "connected": i.connected,
            "description": i.description,
            "lastSyncedAt": i.last_synced_at.strftime("%M minutes ago") if i.last_synced_at else "Never",
            "icon": i.icon,
            "quota": {
                "used": i.quota_used,
                "limit": i.quota_limit,
                "unit": i.quota_unit
            } if i.quota_limit > 0 else None
        })

    return {
        "data": formatted,
        "page": 1,
        "pageSize": len(formatted),
        "total": len(formatted)
    }

@router.post("/{id}/toggle")
async def toggle_integration(
    id: str,
    payload: dict,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    current_workspace: Workspace = Depends(get_current_workspace),
):
    connected = payload.get("connected", False)
    result = await db.execute(select(Integration).filter_by(id=id, org_id=current_user.org_id, workspace_id=current_workspace.id))
    integration = result.scalars().first()
    if not integration:
        raise HTTPException(status_code=404, detail="Integration not found")

    integration.connected = connected
    if connected:
        from datetime import datetime
        integration.last_synced_at = datetime.utcnow()

    await db.commit()
    return {"success": True}
