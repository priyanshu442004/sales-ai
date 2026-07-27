"""
Groq-backed fallback for contact-info extraction.

This is deliberately NOT a "find me this company's email" tool — Groq has no
browsing capability, and asking an LLM to produce an email address it can't
verify is exactly how fabricated/hallucinated addresses end up in outreach
lists. Instead, this module is handed text our own scraper already fetched
(real HTML/text from the company's own site) and asked to do one narrow
thing a plain regex sometimes misses: recognize an email/phone that's
genuinely published in that text but written in an obfuscated human-friendly
form (e.g. "name [at] company [dot] com", "call us: zero-two-oh...").

Every candidate the model returns is re-verified against the original source
text before being trusted — if the model's answer doesn't actually trace
back to something present in the page, it's discarded. This is what makes
the fallback safe against hallucination even if the model doesn't perfectly
follow instructions.
"""
import json
import logging
import re

import httpx

from app.config import settings

logger = logging.getLogger("salesai.groq")

_GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"

_SYSTEM_PROMPT = (
    "You are a precise data-extraction assistant. You will be given raw text "
    "scraped from a company's own website. Your ONLY job is to find a genuine "
    "email address and/or phone number that is ALREADY LITERALLY PRESENT in "
    "the given text (including obfuscated forms like 'name [at] company [dot] "
    "com' or 'name (at) company (dot) com').\n\n"
    "STRICT RULES:\n"
    "- Never invent, guess, infer, autocomplete, or construct an email or "
    "phone number that does not genuinely appear in the text.\n"
    "- Never build an email from a person's name and the company's domain — "
    "only report one if the exact address (or an obfuscated spelling of it) "
    "is actually written in the text.\n"
    "- If no real email appears in the text, the email field MUST be null.\n"
    "- If no real phone number appears in the text, the phone field MUST be null.\n"
    "- Respond with ONLY compact JSON, no explanation, no markdown fences: "
    '{"email": string|null, "phone": string|null}'
)

_EMAIL_RE = re.compile(r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}")
_DIGITS_RE = re.compile(r"\d")


def is_groq_configured() -> bool:
    return bool(settings.GROQ_API_KEY)


def _record_usage() -> None:
    """Same fire-and-forget telemetry pattern as SerpAPI usage — never
    raises into the caller."""
    async def _write():
        try:
            from app.db import SessionLocal
            from app.models import ApiUsageEvent
            async with SessionLocal() as db:
                db.add(ApiUsageEvent(provider="Groq", endpoint=settings.GROQ_MODEL))
                await db.commit()
        except Exception as e:
            logger.warning(f"Failed to record Groq API usage event: {e}")

    try:
        import asyncio
        asyncio.create_task(_write())
    except RuntimeError:
        pass


def _verify_email_in_source(email: str, source_text: str) -> bool:
    """The model's returned email must itself be a genuinely well-formed
    address AND appear verbatim (case-insensitive) somewhere in the fetched
    source text — guards against the model "cleaning up" an obfuscated
    fragment into a plausible-looking but non-existent address."""
    if not _EMAIL_RE.fullmatch(email.strip()):
        return False
    return email.strip().lower() in source_text.lower()


def _verify_phone_in_source(phone: str, source_text: str) -> bool:
    """Compares digit sequences only, since the model may normalize
    formatting (spaces/dashes/parens) — still requires the actual digit
    sequence to genuinely appear in the source text, not merely be
    plausible-looking."""
    digits = "".join(_DIGITS_RE.findall(phone))
    if len(digits) < 7:
        return False
    source_digits = "".join(_DIGITS_RE.findall(source_text))
    return digits in source_digits


async def extract_contact_from_text(source_text: str, company_name: str | None = None) -> dict:
    """
    Best-effort extraction of a genuine email/phone from already-fetched
    page text, used only when regex-based extraction found nothing. Returns
    {"email": str|None, "phone": str|None} — never raises, never fabricates.
    """
    result = {"email": None, "phone": None}
    if not is_groq_configured() or not source_text or not source_text.strip():
        return result

    # Bound token usage — a company's contact/about page rarely needs more
    # than a few thousand characters of context to find a published address.
    trimmed = source_text[:8000]
    user_prompt = f"Company: {company_name or 'unknown'}\n\nPage text:\n{trimmed}"

    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.post(
                _GROQ_URL,
                headers={
                    "Authorization": f"Bearer {settings.GROQ_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": settings.GROQ_MODEL,
                    "messages": [
                        {"role": "system", "content": _SYSTEM_PROMPT},
                        {"role": "user", "content": user_prompt},
                    ],
                    "temperature": 0,
                    "max_tokens": 200,
                    "response_format": {"type": "json_object"},
                },
            )
        _record_usage()

        if response.status_code != 200:
            logger.warning(f"Groq request failed ({response.status_code}): {response.text[:200]}")
            return result

        data = response.json()
        content = data["choices"][0]["message"]["content"]
        parsed = json.loads(content)

        candidate_email = parsed.get("email")
        if candidate_email and isinstance(candidate_email, str) and _verify_email_in_source(candidate_email, trimmed):
            result["email"] = candidate_email.strip()

        candidate_phone = parsed.get("phone")
        if candidate_phone and isinstance(candidate_phone, str) and _verify_phone_in_source(candidate_phone, trimmed):
            result["phone"] = candidate_phone.strip()

    except Exception as e:
        logger.warning(f"Groq contact extraction failed, skipping fallback: {e}")

    return result
