from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload
from typing import List, Optional
from datetime import datetime

from app.db import get_db
from app.models import Conversation, ConversationMessage, User, Lead, Company, Contact, AuditLog, Workspace
from app.routes.auth import get_current_user
from app.routes.workspaces import get_current_workspace

router = APIRouter(prefix="/inbox", tags=["inbox"])

def format_thread(thread: Conversation) -> dict:
    lead = thread.lead
    messages = []
    for m in thread.messages:
        messages.append({
            "id": m.id,
            "direction": m.direction,
            "body": m.body,
            "timestamp": "Just now" if (datetime.utcnow() - m.timestamp).total_seconds() < 60 else m.timestamp.strftime("%Y-%m-%d %H:%M:%S"),
            "senderName": m.sender_name
        })
        
    return {
        "id": thread.id,
        "leadId": lead.id if lead else "",
        "leadName": lead.contact.full_name if (lead and lead.contact) else "Unknown Lead",
        "leadEmail": lead.contact.email if (lead and lead.contact) else None,
        "companyName": lead.company.name if (lead and lead.company) else "Unknown Company",
        "subject": thread.subject or "Direct Message Connection",
        "channel": thread.channel,
        "lastMessageSnippet": thread.last_message_snippet,
        "lastMessageTime": thread.last_message_time.isoformat() + "Z" if thread.last_message_time else None,
        "unread": thread.unread,
        "sentiment": thread.sentiment,
        "messages": messages
    }

@router.get("/conversations", response_model=dict)
async def get_conversations(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    current_workspace: Workspace = Depends(get_current_workspace),
):
    result = await db.execute(
        select(Conversation)
        .filter(Conversation.org_id == current_user.org_id, Conversation.workspace_id == current_workspace.id)
        .options(
            selectinload(Conversation.lead).selectinload(Lead.company),
            selectinload(Conversation.lead).selectinload(Lead.contact),
            selectinload(Conversation.messages)
        )
    )
    threads = result.scalars().all()

    formatted = [format_thread(t) for t in threads]
    return {
        "data": formatted,
        "page": 1,
        "pageSize": len(formatted),
        "total": len(formatted)
    }

@router.post("/conversations/{id}/reply")
async def send_inbox_reply(
    id: str,
    payload: dict,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    current_workspace: Workspace = Depends(get_current_workspace),
):
    body = payload.get("body", "")
    result = await db.execute(
        select(Conversation)
        .filter_by(id=id, org_id=current_user.org_id, workspace_id=current_workspace.id)
        .options(
            selectinload(Conversation.messages),
            selectinload(Conversation.lead).selectinload(Lead.contact),
        )
    )
    thread = result.scalars().first()
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found")
        
    reply = ConversationMessage(
        conversation_id=id,
        direction="outbound",
        body=body,
        timestamp=datetime.utcnow(),
        sender_name=current_user.name
    )
    db.add(reply)
    
    thread.last_message_snippet = body
    thread.last_message_time = datetime.utcnow()
    thread.unread = False
    
    # Audit log
    audit = AuditLog(
        org_id=current_user.org_id,
        workspace_id=current_workspace.id,
        actor_id=current_user.id,
        actor_name=current_user.name,
        actor_email=current_user.email,
        action="Sent Outbox Inbox Reply",
        category="OUTBOUND",
        target_entity_name=f"Reply to {thread.lead.contact.full_name if thread.lead else 'lead'}"
    )
    db.add(audit)

    await db.commit()
    return {"success": True}

@router.post("/conversations/{id}/sentiment")
async def update_thread_sentiment(
    id: str,
    payload: dict,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    current_workspace: Workspace = Depends(get_current_workspace),
):
    sentiment = payload.get("sentiment", "Neutral")
    result = await db.execute(select(Conversation).filter_by(id=id, org_id=current_user.org_id, workspace_id=current_workspace.id))
    thread = result.scalars().first()
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found")
        
    thread.sentiment = sentiment
    await db.commit()
    return {"success": True}
