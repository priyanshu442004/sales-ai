from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload
from typing import List, Optional
from datetime import datetime
import uuid

from app.db import get_db
from app.models import Message, Lead, User, AuditLog, Company, Contact, MessageTemplate, ScrapeJob, Workspace
from app.schemas import MessageDraftCreate, MessageDraftResponse, MessageRefineRequest, MessageDraftUpdate, SendEmailRequest, AiRewriteRequest
from app.routes.auth import get_current_user
from app.routes.workspaces import get_current_workspace
from app.email_sender import send_email, is_smtp_configured
from app.notifications_util import add_notification
from app.s3_storage import upload_attachment, download_attachment, is_s3_configured
from app import ai_writer

router = APIRouter(prefix="/messages", tags=["messages"])


def _lead_loads():
    """Eager-load everything format_message() needs off a Lead — required
    since the async ORM has no implicit lazy-loading."""
    return (
        selectinload(Lead.company),
        selectinload(Lead.contact),
        selectinload(Lead.score_details),
        selectinload(Lead.scrape_job).selectinload(ScrapeJob.saved_search),
    )


def _message_lead_loads():
    """Same as _lead_loads(), reached via Message.lead."""
    return (
        selectinload(Message.lead).selectinload(Lead.company),
        selectinload(Message.lead).selectinload(Lead.contact),
        selectinload(Message.lead).selectinload(Lead.score_details),
        selectinload(Message.lead).selectinload(Lead.scrape_job).selectinload(ScrapeJob.saved_search),
    )

# Helper function to format message responses
def format_message(msg: Message, lead: Lead) -> dict:
    score_details = lead.score_details
    job = lead.scrape_job
    search = job.saved_search if job else None
    source_job_name = (search.name if search and search.name else (f"Job #{job.id[:8]}" if job else "Legacy Search"))

    return {
        "id": msg.id,
        "leadId": lead.id,
        "leadName": lead.contact.full_name,
        "leadDesignation": lead.contact.designation,
        "leadCompany": lead.company.name,
        "leadEmail": lead.contact.email,
        "score": score_details.total_score if score_details else None,
        "sourceJobName": source_job_name,
        "type": msg.type,
        "channel": msg.channel,
        "subject": msg.subject,
        "body": msg.body,
        "status": msg.status,
        "errorDetail": msg.error_detail,
        "cc": msg.cc or [],
        "attachments": msg.attachments or [],
        "batchId": msg.batch_id,
        "sentBy": msg.approved_by,
        "sentAt": msg.sent_at.isoformat() + "Z" if msg.sent_at else None,
        "createdAt": msg.created_at.isoformat()
    }


_PERSONALIZATION_TOKENS = ("{{first_name}}", "{{name}}", "{{company}}", "{{title}}", "{{designation}}")


def personalize(text: str, contact: Contact, company: Company) -> str:
    """Substitute {{first_name}}/{{name}}/{{company}}/{{title}} tokens with
    this specific lead's real, already-scraped data — never invented."""
    if not text:
        return text
    full_name = contact.full_name if contact.full_name and contact.full_name != "Not identified" else None
    first_name = full_name.split(" ")[0] if full_name else "there"
    replacements = {
        "{{first_name}}": first_name,
        "{{name}}": full_name or "there",
        "{{company}}": company.name if company.name and company.name != "Unknown Company" else "your company",
        "{{title}}": contact.designation if contact.designation and contact.designation != "Not available" else "",
        "{{designation}}": contact.designation if contact.designation and contact.designation != "Not available" else "",
    }
    result = text
    for token, value in replacements.items():
        result = result.replace(token, value)
    return result

@router.get("", response_model=dict)
async def list_messages(
    status: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    current_workspace: Workspace = Depends(get_current_workspace),
):
    query = select(Message).filter_by(org_id=current_user.org_id, workspace_id=current_workspace.id).options(*_message_lead_loads())
    if status:
        query = query.filter(Message.status == status)
        
    result = await db.execute(query)
    messages = result.scalars().all()
    
    formatted = [format_message(m, m.lead) for m in messages if m.lead]
    return {
        "data": formatted,
        "page": 1,
        "pageSize": len(formatted),
        "total": len(formatted)
    }

@router.post("/generate", response_model=dict)
async def generate_message_draft(
    req: MessageDraftCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    current_workspace: Workspace = Depends(get_current_workspace),
):
    # Fetch lead
    res = await db.execute(
        select(Lead)
        .filter_by(id=req.leadId, org_id=current_user.org_id, workspace_id=current_workspace.id)
        .options(*_lead_loads())
    )
    lead = res.scalars().first()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")

    channel = "linkedin" if req.type == "LinkedIn Connection Note" else "email"

    if req.body:
        # Outreach Studio composer already resolved this lead's merge tags —
        # use the user's own text verbatim and skip straight to
        # pending_approval, since clicking "Send to Approval Queue" already
        # is the review step for hand-written content.
        subject = req.subject if channel == "email" else None
        body = req.body
        status = "pending_approval"
        generated_by = "human"
    else:
        subject, body = await ai_writer.generate_message(
            message_type=req.type,
            contact_name=lead.contact.full_name,
            designation=lead.contact.designation,
            company_name=lead.company.name,
            industry=lead.company.industry,
            employee_count=lead.company.employee_count,
            funding_stage=lead.company.funding_stage,
            sender_name=current_user.name,
            tone=req.tone or "Conversational",
            length=req.length or "Medium",
        )
        status = "draft"
        generated_by = "ai"

    msg = Message(
        org_id=current_user.org_id,
        workspace_id=current_workspace.id,
        lead_id=req.leadId,
        type=req.type,
        channel=channel,
        subject=subject,
        body=body,
        status=status,
        generated_by=generated_by,
    )
    db.add(msg)
    await db.commit()
    await db.refresh(msg)

    return format_message(msg, lead)


@router.post("/ai-rewrite", response_model=dict)
async def ai_rewrite_template(
    req: AiRewriteRequest,
    current_user: User = Depends(get_current_user),
):
    """
    Rewrites a not-yet-sent template from the Outreach Studio composer — the
    text still carries unresolved merge tags ({first_name}, {company_name},
    etc.), which the rewrite must preserve verbatim since they're resolved
    per-recipient later, not here.
    """
    if not ai_writer.is_ai_configured():
        raise HTTPException(status_code=503, detail="AI rewriting isn't configured yet — set ANTHROPIC_API_KEY.")
    try:
        subject, body = await ai_writer.rewrite_template(subject=req.subject, body=req.body, instruction=req.instruction)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"AI rewrite failed: {e}")
    return {"subject": subject, "body": body}

@router.post("/{id}/refine", response_model=dict)
async def refine_message_draft(
    id: str,
    req: MessageRefineRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    current_workspace: Workspace = Depends(get_current_workspace),
):
    result = await db.execute(
        select(Message)
        .filter_by(id=id, org_id=current_user.org_id, workspace_id=current_workspace.id)
        .options(*_message_lead_loads())
    )
    msg = result.scalars().first()
    if not msg:
        raise HTTPException(status_code=404, detail="Message draft not found")

    msg.body = await ai_writer.refine_message(
        current_body=msg.body,
        instruction=req.instruction,
        contact_name=msg.lead.contact.full_name,
        company_name=msg.lead.company.name,
        sender_name=current_user.name,
    )

    msg.generated_by = "hybrid"
    await db.commit()
    return format_message(msg, msg.lead)

@router.patch("/{id}", response_model=dict)
async def update_message_body(
    id: str,
    req: MessageDraftUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    current_workspace: Workspace = Depends(get_current_workspace),
):
    result = await db.execute(
        select(Message)
        .filter_by(id=id, org_id=current_user.org_id, workspace_id=current_workspace.id)
        .options(*_message_lead_loads())
    )
    msg = result.scalars().first()
    if not msg:
        raise HTTPException(status_code=404, detail="Message draft not found")

    if req.subject is not None:
        msg.subject = req.subject
    if req.body is not None:
        msg.body = req.body
    if req.status is not None:
        msg.status = req.status

    await db.commit()
    return format_message(msg, msg.lead)

@router.post("/{id}/submit-for-approval", response_model=dict)
async def submit_for_approval(
    id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    current_workspace: Workspace = Depends(get_current_workspace),
):
    return await update_message_body(id, MessageDraftUpdate(status="pending_approval"), db, current_user, current_workspace)

@router.post("/{id}/approve", response_model=dict)
async def approve_message(
    id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    current_workspace: Workspace = Depends(get_current_workspace),
):
    result = await db.execute(
        select(Message)
        .filter_by(id=id, org_id=current_user.org_id, workspace_id=current_workspace.id)
        .options(*_message_lead_loads())
    )
    msg = result.scalars().first()
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")

    msg.status = "approved"
    msg.approved_by = current_user.name
    msg.approved_at = datetime.utcnow()

    # Audit log
    audit = AuditLog(
        org_id=current_user.org_id,
        workspace_id=current_workspace.id,
        actor_id=current_user.id,
        actor_name=current_user.name,
        actor_email=current_user.email,
        action="Approved outbound message send",
        category="OUTBOUND",
        target_entity_name=f"{msg.type} to {msg.lead.contact.full_name}"
    )
    db.add(audit)

    await db.commit()
    return format_message(msg, msg.lead)

@router.post("/{id}/reject", response_model=dict)
async def reject_message(
    id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    current_workspace: Workspace = Depends(get_current_workspace),
):
    return await update_message_body(id, MessageDraftUpdate(status="rejected"), db, current_user, current_workspace)

@router.post("/bulk-approve", response_model=dict)
async def bulk_approve_messages(
    ids: List[str],
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    current_workspace: Workspace = Depends(get_current_workspace),
):
    count = 0
    for m_id in ids:
        result = await db.execute(
            select(Message)
            .filter_by(id=m_id, org_id=current_user.org_id, workspace_id=current_workspace.id)
            .options(*_message_lead_loads())
        )
        msg = result.scalars().first()
        if msg and msg.status == "pending_approval":
            msg.status = "approved"
            msg.approved_by = current_user.name
            msg.approved_at = datetime.utcnow()
            count += 1

            # Audit log
            audit = AuditLog(
                org_id=current_user.org_id,
                workspace_id=current_workspace.id,
                actor_id=current_user.id,
                actor_name=current_user.name,
                actor_email=current_user.email,
                action="Bulk approved message send",
                category="OUTBOUND",
                target_entity_name=f"{msg.type} to {msg.lead.contact.full_name}"
            )
            db.add(audit)

    await db.commit()
    return {"success": True, "count": count}

@router.post("/{id}/send", response_model=dict)
async def send_message(
    id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    current_workspace: Workspace = Depends(get_current_workspace),
):
    result = await db.execute(
        select(Message)
        .filter_by(id=id, org_id=current_user.org_id, workspace_id=current_workspace.id)
        .options(*_message_lead_loads())
    )
    msg = result.scalars().first()
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")

    # Enforce approval status check
    if msg.status != "approved":
        raise HTTPException(
            status_code=400,
            detail="Forbidden: Cannot send an unapproved draft. Ensure status = approved first."
        )

    if msg.channel == "email":
        # Real delivery — no other channel here has a live integration
        # (no LinkedIn API access), so email is the only one that can
        # genuinely fail; that failure is recorded honestly, not masked.
        ok, error = await send_email(
            to_email=msg.lead.contact.email,
            subject=msg.subject or "",
            body=msg.body,
        )
        msg.status = "sent" if ok else "failed"
        msg.error_detail = None if ok else error
        if ok:
            msg.sent_at = datetime.utcnow()
    else:
        msg.status = "sent"
        msg.sent_at = datetime.utcnow()

    # Audit log
    audit = AuditLog(
        org_id=current_user.org_id,
        workspace_id=current_workspace.id,
        actor_id=current_user.id,
        actor_name=current_user.name,
        actor_email=current_user.email,
        action="Dispatched outbound message" if msg.status == "sent" else "Outbound message failed to send",
        category="OUTBOUND",
        target_entity_name=f"{msg.type} to {msg.lead.contact.full_name}"
    )
    db.add(audit)

    add_notification(
        db,
        org_id=current_user.org_id,
        type="email_sent" if msg.status == "sent" else "email_failed",
        title="Email sent" if msg.status == "sent" else "Email failed to send",
        description=f"{msg.type} to {msg.lead.contact.full_name} ({msg.lead.company.name})" + (f" — {msg.error_detail}" if msg.error_detail else ""),
    )

    await db.commit()
    return format_message(msg, msg.lead)


@router.post("/send-email")
async def send_cold_emails(
    req: SendEmailRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    current_workspace: Workspace = Depends(get_current_workspace),
):
    """
    Direct compose-and-send: the user has already written and reviewed the
    email themselves (the approval gate that MessageDraftCreate's AI-drafted
    flow needs is redundant here — clicking Send *is* the approval), so this
    sends immediately rather than routing through draft/pending_approval.
    Used by the Job Queue's bulk/individual "Send Email" action.
    """
    if not is_smtp_configured():
        raise HTTPException(status_code=503, detail="Outbound email isn't configured yet — set SMTP_HOST/SMTP_USER/SMTP_PASS.")

    # Separate mode (each recipient has their own edited subject/body) takes
    # priority when present; otherwise fall back to the together-mode shape
    # (one subject/body applied to every id in leadIds).
    if req.messages:
        recipients = [(m.leadId, m.subject, m.body) for m in req.messages]
    else:
        recipients = [(lead_id, req.subject, req.body) for lead_id in req.leadIds]

    if not recipients:
        raise HTTPException(status_code=400, detail="No leads selected.")

    # Download each attachment's bytes exactly once, before the per-recipient
    # loop — attaching the same file to 50 recipients shouldn't mean 50 S3
    # round-trips.
    downloaded_attachments = []
    attachment_metadata = []
    for ref in req.attachments:
        try:
            content = await download_attachment(ref.key)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Couldn't read attachment {ref.filename!r}: {e}")
        downloaded_attachments.append({
            "filename": ref.filename,
            "content": content,
            "contentType": ref.contentType,
        })
        attachment_metadata.append({
            "filename": ref.filename,
            "key": ref.key,
            "url": ref.url,
            "size": ref.size,
            "contentType": ref.contentType,
        })

    batch_id = str(uuid.uuid4()) if len(recipients) > 1 else None

    results = []
    sent = 0
    failed = 0

    for lead_id, subject_template, body_template in recipients:
        lead_result = await db.execute(
            select(Lead)
            .filter_by(id=lead_id, org_id=current_user.org_id, workspace_id=current_workspace.id)
            .options(selectinload(Lead.company), selectinload(Lead.contact))
        )
        lead = lead_result.scalars().first()

        if not lead:
            failed += 1
            results.append({"leadId": lead_id, "status": "failed", "error": "Lead not found"})
            continue

        contact = lead.contact
        company = lead.company

        if not contact.email:
            failed += 1
            results.append({"leadId": lead_id, "status": "failed", "error": "No email address on file for this lead"})
            continue

        # Re-run personalization even in separate mode: catches any token the
        # user left untouched instead of silently mailing a literal {{token}}.
        personalized_subject = personalize(subject_template, contact, company)
        personalized_body = personalize(body_template, contact, company)

        ok, error = await send_email(
            to_email=contact.email,
            subject=personalized_subject,
            body=personalized_body,
            cc=req.cc,
            attachments=downloaded_attachments,
        )

        message = Message(
            org_id=current_user.org_id,
            workspace_id=current_workspace.id,
            lead_id=lead.id,
            type="Cold Email",
            channel="email",
            subject=personalized_subject,
            body=personalized_body,
            generated_by="human",
            status="sent" if ok else "failed",
            approved_by=current_user.name,
            approved_at=datetime.utcnow(),
            sent_at=datetime.utcnow() if ok else None,
            error_detail=None if ok else error,
            cc=req.cc,
            attachments=attachment_metadata,
            batch_id=batch_id,
        )
        db.add(message)

        if ok:
            sent += 1
            results.append({"leadId": lead_id, "status": "sent", "recipient": contact.email})
        else:
            failed += 1
            results.append({"leadId": lead_id, "status": "failed", "error": error, "recipient": contact.email})

    audit = AuditLog(
        org_id=current_user.org_id,
        workspace_id=current_workspace.id,
        actor_id=current_user.id,
        actor_name=current_user.name,
        actor_email=current_user.email,
        action=f"Sent cold email batch ({sent} sent, {failed} failed)",
        category="OUTBOUND",
        target_entity_name=f"{len(recipients)} recipient(s)",
    )
    db.add(audit)

    if sent > 0 and failed == 0:
        notif_type, title = "email_sent", f"Sent {sent} email{'s' if sent != 1 else ''}"
    elif sent > 0 and failed > 0:
        notif_type, title = "email_partial", f"Sent {sent} of {sent + failed} emails — {failed} failed"
    else:
        notif_type, title = "email_failed", f"All {failed} email{'s' if failed != 1 else ''} failed to send"

    failure_lines = [f"{r.get('recipient', r['leadId'])}: {r['error']}" for r in results if r["status"] == "failed"]
    description = "; ".join(failure_lines[:5]) if failure_lines else f"Delivered to {sent} recipient{'s' if sent != 1 else ''}."
    add_notification(db, org_id=current_user.org_id, type=notif_type, title=title, description=description)

    # Usage is only ever counted from a real send that actually went out —
    # opening a template or starting a draft from it doesn't count.
    if req.templateId and sent > 0:
        tmpl_result = await db.execute(
            select(MessageTemplate).filter_by(id=req.templateId, org_id=current_user.org_id, workspace_id=current_workspace.id)
        )
        tmpl = tmpl_result.scalars().first()
        if tmpl:
            tmpl.usage_count = (tmpl.usage_count or 0) + 1
            tmpl.last_used_at = datetime.utcnow()

    await db.commit()
    return {"sent": sent, "failed": failed, "results": results, "batchId": batch_id}


@router.post("/attachments")
async def upload_message_attachment(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
):
    """
    Uploads one file to S3 ahead of a send-email call. The frontend calls
    this per selected file, collects the returned metadata (filename/key/
    url/size/contentType), and passes that list as `attachments` on the
    subsequent POST /messages/send-email request.
    """
    if not is_s3_configured():
        raise HTTPException(status_code=503, detail="File attachments aren't configured yet — set AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY/AWS_BUCKET_NAME.")

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail=f"{file.filename!r} is empty.")

    MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024  # 15MB — matches common SMTP relay limits
    if len(content) > MAX_ATTACHMENT_BYTES:
        raise HTTPException(status_code=400, detail=f"{file.filename!r} is too large ({len(content) // 1024 // 1024}MB) — the limit is 15MB per file.")

    try:
        metadata = await upload_attachment(
            org_id=current_user.org_id,
            filename=file.filename or "attachment",
            content=content,
            content_type=file.content_type or "application/octet-stream",
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Upload failed for {file.filename!r}: {e}")

    return metadata
