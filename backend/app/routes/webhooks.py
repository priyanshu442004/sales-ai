from fastapi import APIRouter, Depends, Request, HTTPException, Header
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List, Dict, Any
import logging

from app.db import get_db
from app.models import User
from app.routes.auth import get_current_user

router = APIRouter(prefix="/webhooks", tags=["webhooks"])
logger = logging.getLogger("salesai.webhooks")

# In-memory storage for test payloads, indexed by organization ID
payloads_store: Dict[str, List[Dict[str, Any]]] = {}

def verify_provider_signature(payload_bytes: bytes, signature: str, secret: str) -> bool:
    # Standard HMAC SHA256 verification
    import hmac
    import hashlib
    if not signature or not secret:
        return False
    expected = hmac.new(secret.encode(), payload_bytes, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)

@router.post("/sales-ai")
async def receive_generic_webhook(request: Request):
    payload = await request.json()
    org_id = "org-1"
    
    if org_id not in payloads_store:
        payloads_store[org_id] = []
        
    payloads_store[org_id].insert(0, payload)
    if len(payloads_store[org_id]) > 20:
        payloads_store[org_id].pop()
        
    logger.info(f"Received Sales AI generic webhook payload: {payload}")
    return {"status": "success", "received": True}

@router.get("/sales-ai/recent", response_model=List[Dict[str, Any]])
async def get_recent_webhooks(
    current_user: User = Depends(get_current_user)
):
    org_id = current_user.org_id
    return payloads_store.get(org_id, [])

@router.post("/email/inbound")
async def email_inbound_webhook(
    request: Request,
    x_signature: str = Header(None, alias="X-SendGrid-Signature")
):
    body = await request.body()
    # Security: Verify webhook provider signature
    # In production, check against settings.SENDGRID_INBOUND_SECRET
    # if not verify_provider_signature(body, x_signature, "inbound_secret"):
    #     raise HTTPException(status_code=403, detail="Invalid webhook signature")
    
    payload = await request.json()
    logger.info(f"Inbound email webhook received payload: {payload}")
    return {"status": "processed"}

@router.post("/email/events")
async def email_events_webhook(
    request: Request,
    x_signature: str = Header(None, alias="X-Signature")
):
    body = await request.body()
    # Security check
    # if not verify_provider_signature(body, x_signature, "events_secret"):
    #     raise HTTPException(status_code=403, detail="Invalid signature")
        
    payload = await request.json()
    logger.info(f"Email events webhook received: {payload}")
    return {"status": "processed"}

@router.post("/linkedin/events")
async def linkedin_events_webhook(
    request: Request,
    x_signature: str = Header(None, alias="X-Unipile-Signature")
):
    body = await request.body()
    # Security: Verify provider signature
    # if not verify_provider_signature(body, x_signature, "linkedin_secret"):
    #     raise HTTPException(status_code=403, detail="Invalid signature")
        
    payload = await request.json()
    logger.info(f"LinkedIn event webhook received: {payload}")
    return {"status": "processed"}

