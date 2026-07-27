from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from app.db import get_db
from app.models import User
from app.routes.auth import get_current_user

router = APIRouter(prefix="/campaigns", tags=["campaigns"])

@router.get("", response_model=dict)
async def list_campaigns(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    # Standard initial campaigns response matching the high-fidelity mock charts
    data = [
        {
            "id": "camp-1",
            "name": "Robotics Founders East Coast Q3",
            "status": "active",
            "metrics": {
                "sent": 142,
                "delivered": 138,
                "opened": 92,
                "replied": 24,
                "bounced": 4,
                "linkedinAccepted": 38,
                "meetingsBooked": 6
            },
            "recipientStatus": [
                {
                    "leadId": "lead-1",
                    "leadName": "John Chen",
                    "companyName": "Nimbus Robotics",
                    "status": "Replied",
                    "lastUpdated": "2h ago"
                },
                {
                    "leadId": "lead-2",
                    "leadName": "Sarah Patel",
                    "companyName": "Acme Healthtech",
                    "status": "Opened",
                    "lastUpdated": "1d ago"
                }
            ]
        }
    ]
    return {
        "data": data,
        "page": 1,
        "pageSize": len(data),
        "total": len(data)
    }
