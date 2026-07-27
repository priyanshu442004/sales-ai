from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from typing import List

from app.db import get_db
from app.models import AuditLog, User
from app.routes.auth import get_current_user

router = APIRouter(prefix="/audit-log", tags=["audit-log"])

@router.get("", response_model=dict)
async def list_audit_logs(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    result = await db.execute(
        select(AuditLog)
        .filter_by(org_id=current_user.org_id)
        .order_by(AuditLog.created_at.desc())
    )
    logs = result.scalars().all()
    
    formatted = []
    for l in logs:
        formatted.append({
            "id": l.id,
            "timestamp": l.created_at.isoformat(),
            "actorName": l.actor_name or "System",
            "actorEmail": l.actor_email or "system@salesai.ai",
            "action": l.action,
            "category": l.category,
            "targetEntityLink": l.target_entity_link or "#",
            "targetEntityName": l.target_entity_name or "System configuration",
            "ipAddress": l.ip_address or "192.168.1.1",
            "deviceMetadata": l.device_metadata or "Server Process"
        })
        
    return {
        "data": formatted,
        "page": 1,
        "pageSize": len(formatted),
        "total": len(formatted)
    }
