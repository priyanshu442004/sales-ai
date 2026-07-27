"""
Real SMTP outbound email delivery. No fabricated "sent" status — a message
is only ever recorded as sent after the SMTP server has actually accepted
it, and any failure (auth, connection, rejected recipient) is surfaced with
its real error text, never swallowed.
"""
import logging
import re
from email.message import EmailMessage

import aiosmtplib

from app.config import settings

logger = logging.getLogger("salesai.email")

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def is_smtp_configured() -> bool:
    return bool(settings.SMTP_HOST and settings.SMTP_USER and settings.SMTP_PASS)


async def send_email(
    to_email: str,
    subject: str,
    body: str,
    reply_to: str | None = None,
    cc: list[str] | None = None,
    attachments: list[dict] | None = None,
) -> tuple[bool, str | None]:
    """
    Send one real email via the configured SMTP account.
    Returns (success, error_message). error_message is None on success and
    is the genuine SMTP/network failure reason on failure — never invented.

    `attachments` is a list of {"filename": str, "content": bytes,
    "contentType": str} — real file bytes (already fetched from S3 by the
    caller), attached as genuine MIME parts, not just referenced by name.
    """
    if not is_smtp_configured():
        return False, "SMTP is not configured — set SMTP_HOST, SMTP_USER and SMTP_PASS."

    if not to_email or not _EMAIL_RE.match(to_email):
        return False, f"Invalid recipient address: {to_email!r}"

    valid_cc = [addr for addr in (cc or []) if addr and _EMAIL_RE.match(addr)]

    message = EmailMessage()
    message["From"] = settings.SMTP_USER
    message["To"] = to_email
    if valid_cc:
        message["Cc"] = ", ".join(valid_cc)
    message["Subject"] = subject or "(no subject)"
    if reply_to:
        message["Reply-To"] = reply_to
    message.set_content(body or "")

    for attachment in attachments or []:
        content_type = attachment.get("contentType") or "application/octet-stream"
        maintype, _, subtype = content_type.partition("/")
        message.add_attachment(
            attachment["content"],
            maintype=maintype or "application",
            subtype=subtype or "octet-stream",
            filename=attachment.get("filename") or "attachment",
        )

    all_recipients = [to_email, *valid_cc]

    try:
        # Port 465 is implicit TLS (the whole connection is encrypted from
        # the start) — use_tls=True, not start_tls, which is for port 587.
        use_implicit_tls = settings.SMTP_PORT == 465
        await aiosmtplib.send(
            message,
            recipients=all_recipients,
            hostname=settings.SMTP_HOST,
            port=settings.SMTP_PORT,
            username=settings.SMTP_USER,
            password=settings.SMTP_PASS,
            use_tls=use_implicit_tls,
            start_tls=None if use_implicit_tls else True,
            timeout=30,
        )
        return True, None
    except Exception as e:
        logger.error(f"SMTP send to {to_email!r} failed: {e}")
        return False, str(e)
