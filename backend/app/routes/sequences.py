from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from typing import List, Optional
from datetime import datetime

from app.db import get_db
from app.models import Sequence, User, Workspace
from app.routes.auth import get_current_user
from app.routes.workspaces import get_current_workspace

router = APIRouter(prefix="/sequences", tags=["sequences"])

@router.get("", response_model=dict)
async def list_sequences(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    current_workspace: Workspace = Depends(get_current_workspace),
):
    result = await db.execute(select(Sequence).filter_by(org_id=current_user.org_id, workspace_id=current_workspace.id))
    seqs = result.scalars().all()

    formatted = []
    for s in seqs:
        formatted.append({
            "id": s.id,
            "name": s.name,
            "status": s.status,
            "enrolledLeadsCount": 15,
            "conversionMetrics": {"sent": 32, "replied": 8, "meetings": 2},
            "exitConditions": s.exit_conditions or {},
            "steps": s.steps or []
        })

    return {
        "data": formatted,
        "page": 1,
        "pageSize": len(formatted),
        "total": len(formatted)
    }

@router.post("")
async def save_sequence(
    payload: dict,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    current_workspace: Workspace = Depends(get_current_workspace),
):
    s_id = payload.get("id")
    if s_id:
        result = await db.execute(select(Sequence).filter_by(id=s_id, org_id=current_user.org_id, workspace_id=current_workspace.id))
        seq = result.scalars().first()
        if not seq:
            raise HTTPException(status_code=404, detail="Sequence not found")
        seq.name = payload.get("name", seq.name)
        seq.steps = payload.get("steps", seq.steps)
        seq.exit_conditions = payload.get("exit_conditions", seq.exit_conditions)
        seq.status = payload.get("status", seq.status)
    else:
        seq = Sequence(
            org_id=current_user.org_id,
            workspace_id=current_workspace.id,
            name=payload.get("name", "New Sequence"),
            steps=payload.get("steps", []),
            exit_conditions=payload.get("exit_conditions", {}),
            status=payload.get("status", "draft")
        )
        db.add(seq)

    await db.commit()
    return {"success": True}
