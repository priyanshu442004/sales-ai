"""
Real AI copywriting for outbound messages, via the Anthropic API.

Every call here is grounded in the lead's own already-scraped, real data
(name, company, industry, designation) — the model is asked to write
persuasive phrasing around those facts, never to invent facts (funding
stage, employee count, achievements) that weren't actually found by the
scraper. Falls back to a plain templated draft only when ANTHROPIC_API_KEY
isn't configured, so the feature degrades instead of hard-failing.
"""
import logging
from anthropic import AsyncAnthropic
from app.config import settings

logger = logging.getLogger("salesai.ai_writer")

_MODEL = "claude-opus-4-8"

_client: AsyncAnthropic | None = None


def is_ai_configured() -> bool:
    return bool(settings.ANTHROPIC_API_KEY)


def _get_client() -> AsyncAnthropic:
    global _client
    if _client is None:
        _client = AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
    return _client


def _fallback_email(contact_name: str, company_name: str, industry: str, employee_count, sender_name: str) -> tuple[str, str]:
    subject = f"Speeding up outreach at {company_name}"
    body = (
        f"Hi {contact_name},\n\n"
        f"I noticed {company_name} has been expanding its operations and recently hired in {industry}.\n\n"
        f"With your team's size of {employee_count}, coordination is key. We help growth leaders automate decision-maker enrichment.\n\n"
        f"Do you have 10 minutes to discuss?\n\nBest,\n{sender_name}"
    )
    return subject, body


def _fallback_linkedin(contact_name: str, company_name: str, industry: str) -> str:
    return f"Hi {contact_name}, congrats on {company_name}'s latest achievements in {industry}. Let's connect!"


async def generate_message(
    *,
    message_type: str,
    contact_name: str,
    designation: str,
    company_name: str,
    industry: str | None,
    employee_count: int | None,
    funding_stage: str | None,
    sender_name: str,
    tone: str = "Conversational",
    length: str = "Medium",
) -> tuple[str | None, str]:
    """Returns (subject_or_None, body) for a fresh AI-drafted message. Falls
    back to a plain template if no ANTHROPIC_API_KEY is configured."""
    industry_str = industry or "their industry"
    channel = "LinkedIn connection note" if message_type == "LinkedIn Connection Note" else "cold email"

    if not is_ai_configured():
        if message_type == "LinkedIn Connection Note":
            return None, _fallback_linkedin(contact_name, company_name, industry_str)
        return _fallback_email(contact_name, company_name, industry_str, employee_count or "their team", sender_name)

    facts = [f"Contact name: {contact_name}", f"Title: {designation}", f"Company: {company_name}"]
    if industry:
        facts.append(f"Industry: {industry}")
    if employee_count:
        facts.append(f"Employee count: {employee_count}")
    if funding_stage:
        facts.append(f"Funding stage: {funding_stage}")

    prompt = (
        f"Write a {tone.lower()}, {length.lower()}-length {channel} from {sender_name} to this prospect. "
        f"Use ONLY the facts listed below — never invent a statistic, achievement, or detail that isn't given. "
        f"If a fact isn't listed, don't mention it.\n\n"
        f"{chr(10).join(facts)}\n\n"
        + ("Respond with exactly two lines: the subject line, then a blank line, then the email body.\n"
           if message_type != "LinkedIn Connection Note"
           else "Respond with just the message body (1-3 sentences, no subject line).\n")
        + "Sign the email 'Best,\\n" + sender_name + "' if it's an email. No preamble, no explanation — just the message."
    )

    try:
        client = _get_client()
        response = await client.messages.create(
            model=_MODEL,
            max_tokens=1024,
            output_config={"effort": "low"},
            messages=[{"role": "user", "content": prompt}],
        )
        text = "".join(b.text for b in response.content if b.type == "text").strip()
        if not text:
            raise ValueError("empty AI response")

        if message_type == "LinkedIn Connection Note":
            return None, text

        # Split subject from body — first non-empty line is the subject, rest is the body.
        lines = text.split("\n")
        subject = lines[0].strip().lstrip("Subject:").strip()
        body = "\n".join(lines[1:]).strip()
        if not body:
            # Model didn't separate subject/body — treat the whole thing as body.
            return f"Speeding up outreach at {company_name}", text
        return subject, body
    except Exception as e:
        logger.warning(f"AI message generation failed, falling back to template: {e}")
        if message_type == "LinkedIn Connection Note":
            return None, _fallback_linkedin(contact_name, company_name, industry_str)
        return _fallback_email(contact_name, company_name, industry_str, employee_count or "their team", sender_name)


async def refine_message(*, current_body: str, instruction: str, contact_name: str, company_name: str, sender_name: str) -> str:
    """Applies a free-text editing instruction to an existing draft. Falls
    back to appending the instruction as a visible note if AI isn't configured."""
    if not is_ai_configured():
        return current_body + f"\n\n(Follow-up request: {instruction})"

    prompt = (
        f"Here is a cold outreach message draft to {contact_name} at {company_name}:\n\n"
        f"---\n{current_body}\n---\n\n"
        f"Apply this editing instruction: \"{instruction}\"\n\n"
        f"Don't invent new facts about {company_name} that weren't already in the draft. "
        f"Respond with only the revised message body — no preamble, no explanation."
    )
    try:
        client = _get_client()
        response = await client.messages.create(
            model=_MODEL,
            max_tokens=1024,
            output_config={"effort": "low"},
            messages=[{"role": "user", "content": prompt}],
        )
        text = "".join(b.text for b in response.content if b.type == "text").strip()
        return text or current_body
    except Exception as e:
        logger.warning(f"AI message refine failed, falling back to appended note: {e}")
        return current_body + f"\n\n(Follow-up request: {instruction})"


async def rewrite_template(*, subject: str | None, body: str, instruction: str | None = None) -> tuple[str | None, str]:
    """
    Rewrites a user-authored template (Outreach Studio composer) that still
    contains merge tags like {first_name}/{company_name}/{location}/{industry}.
    The tags must survive verbatim — they get resolved per-recipient later,
    not by this call.
    """
    if not is_ai_configured():
        raise RuntimeError("AI rewriting isn't configured — set ANTHROPIC_API_KEY.")

    instruction_str = instruction or "Make it more compelling and concise while keeping the same intent."
    prompt = (
        "Rewrite this outreach message template. It contains merge tags in curly braces "
        "(e.g. {first_name}, {company_name}, {location}, {industry}) that MUST appear in your "
        f"output exactly as written, verbatim — never resolve or remove them.\n\n"
        f"Instruction: {instruction_str}\n\n"
    )
    if subject:
        prompt += f"Subject: {subject}\n\n"
    prompt += f"Body:\n{body}\n\n"
    prompt += (
        "Respond with the subject line on the first line (omit if there was none), a blank line, "
        "then the rewritten body. No preamble, no explanation."
    )

    client = _get_client()
    response = await client.messages.create(
        model=_MODEL,
        max_tokens=1024,
        output_config={"effort": "low"},
        messages=[{"role": "user", "content": prompt}],
    )
    text = "".join(b.text for b in response.content if b.type == "text").strip()
    if not text:
        raise ValueError("empty AI response")

    if not subject:
        return None, text

    lines = text.split("\n")
    new_subject = lines[0].strip()
    new_body = "\n".join(lines[1:]).strip()
    return (new_subject or subject), (new_body or text)
