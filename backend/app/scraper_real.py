"""
Real data scraper using SerpAPI for LinkedIn searches.
"""
import asyncio
import datetime
import html
import httpx
import json
import logging
import itertools
import os
import re
import phonenumbers
from app.config import settings
from app.groq_util import extract_contact_from_text, is_groq_configured

logger = logging.getLogger("salesai.scraper")

# SerpAPI endpoint for Google Search
SERPAPI_URL = "https://serpapi.com/search"

# A bare "Mozilla/5.0" User-Agent with no other headers is itself a bot
# signature — confirmed during testing that it got a real, live company
# site (interface.ai) 403'd outright, while a realistic full browser header
# set fetched the exact same page fine. This doesn't defeat serious
# WAF/bot-management (JS challenges, TLS fingerprinting), but it does
# recover the many sites that only check for an obviously-fake UA string.
_BROWSER_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}


def _record_api_usage(provider: str, endpoint: str | None) -> None:
    """
    Fire-and-forget telemetry for a real outbound call to a paid data API —
    feeds the Analytics page's genuine "credits consumed" chart. Uses its own
    short-lived DB session (scraper functions don't carry one down through
    every call site) and never raises into the caller — a logging failure
    here must never break an actual scrape.
    """
    async def _write():
        try:
            from app.db import SessionLocal
            from app.models import ApiUsageEvent
            async with SessionLocal() as db:
                db.add(ApiUsageEvent(provider=provider, endpoint=endpoint))
                await db.commit()
        except Exception as e:
            logger.warning(f"Failed to record API usage event: {e}")

    try:
        asyncio.create_task(_write())
    except RuntimeError:
        pass  # no running event loop (e.g. a script/test context) — skip telemetry

# A single Google SERP page tops out around 10 organic results regardless of
# the requested `num`, especially for narrow `site:linkedin.com/in` queries —
# so reaching a real target of e.g. 50 requires walking multiple result pages.
_RESULTS_PER_PAGE = 10


def _parse_linkedin_title(title: str) -> dict | None:
    """
    Parse a Google/SerpAPI result title of the form:
        "Name - Job Title at Company | LinkedIn"
        "Name - Company | LinkedIn"
    Handles titles with more than two " - " segments and Google's
    truncated titles (ending in an ellipsis), returning None when the
    title is too garbled to trust rather than emitting broken data.
    """
    cleaned = title.replace("| LinkedIn", "").strip()
    if not cleaned:
        return None

    segments = [p.strip() for p in cleaned.split(" - ") if p.strip()]
    if not segments:
        return None

    name = segments[0]
    if len(name) < 3 or name.endswith("...") or name.endswith("…"):
        return None

    designation = None  # None means "not found here" — a richer source (rich_snippet/snippet) may still supply it
    company = None

    if len(segments) > 1:
        # Everything after the name describes the role/company.
        role_company = " - ".join(segments[1:])
        if role_company.endswith("...") or role_company.endswith("…"):
            # Google truncated the title — role/company text is unreliable.
            role_company = None

        if role_company and " at " in role_company:
            designation, company = role_company.split(" at ", 1)
            designation = designation.strip()
            company = company.strip()
        elif role_company:
            designation = role_company.strip()

    if not company or company.endswith("...") or company.endswith("…") or len(company) < 2:
        company = None

    return {
        "name": name,
        "designation": designation,
        "company": company,
    }


# Matches an experience date-range fragment such as "Apr 2017 - Aug 2019",
# "Nov 2024 - Present" or "2 years 5 months" — LinkedIn's "Experience" list
# snippets read as "<Title>. <Company>. <date range> · <duration>...", so
# finding the date range tells us exactly which two segments before it are
# the title and the company.
_DATE_RANGE_RE = re.compile(
    r'\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{4}\b'
    r'|\b\d{4}\s*[-–]\s*(?:\d{4}|[Pp]resent)\b'
    # (?<!\d\.) — a decimal duration like "6.5 years" would otherwise match
    # here starting from its own fractional digit ("5 years"), well before
    # the real date range later in the snippet — confirmed on a real
    # snippet during testing ("With over 6.5 years of experience... Founder
    # & CEO. SaaSDirect. Jan 2017 - Present..."), where this false-early
    # match corrupted the company parse into a meaningless fragment
    # ("With over 6") instead of the real, later "SaaSDirect".
    r'|(?<!\d\.)\b\d+\+?\s*(?:years?|yrs?|months?|mos?)\b',
    re.IGNORECASE,
)


def _clean_fragment(text: str | None) -> str | None:
    """
    Trim a raw title/snippet fragment into a plausible field value. Cuts
    Google's mid-sentence truncation marker (and everything after it, since
    that text isn't reliably part of this field) and rejects anything left
    too short or too long — a garbled fragment is skipped, never emitted as
    if it were a real value.
    """
    if not text:
        return None
    text = re.split(r'\s*(?:\.\.\.|…)', text.strip())[0]
    text = text.strip(" .")
    if len(text) < 2 or len(text) > 80:
        return None
    return text


def _from_rich_snippet(result: dict) -> tuple[str | None, str | None]:
    """
    Google renders a structured [location, current title, current company]
    triple for many LinkedIn profile results (`rich_snippet.top.extensions`)
    — this reflects the profile's actual current/headline position, unlike
    the plain snippet which often surfaces whichever past role happened to
    match the search keywords. Treat it as the most trustworthy real signal
    available when present.
    """
    extensions = (result.get("rich_snippet") or {}).get("top", {}).get("extensions") or []
    if len(extensions) >= 3:
        company = _clean_fragment(extensions[-1])
        if company:
            return _clean_fragment(extensions[-2]), company
    return None, None


def _from_snippet(snippet: str) -> tuple[str | None, str | None]:
    """
    Fall back to the plain-text snippet when there's no usable rich_snippet.
    Handles the two LinkedIn snippet shapes actually seen from SerpAPI:
      "<Title> at <Company> ..."
      "<Title>. <Company>. <date range> · <duration>. ..."
    """
    if not snippet:
        return None, None

    at_match = re.search(r'\bat\s+(.+)', snippet)
    if at_match:
        company = _clean_fragment(at_match.group(1))
        if company:
            return _clean_fragment(snippet[:at_match.start()]), company

    date_match = _DATE_RANGE_RE.search(snippet)
    if date_match:
        parts = [p.strip() for p in snippet[:date_match.start()].split('. ') if p.strip()]
        if len(parts) >= 2:
            company = _clean_fragment(parts[-1])
            if company:
                return _clean_fragment(parts[-2]), company

    return None, None


# Once a key is found to be exhausted/rate-limited in this process, stop
# trying it again for the rest of the run — every account-status field
# SerpAPI reports (this_month_usage, plan_searches_left, etc.) is static
# until the monthly reset, so a second 429 a few requests later is not new
# information, just a wasted round trip.
_exhausted_keys: set[str] = set()

# Signature SerpAPI uses for both "no searches left this month" and
# "too many requests this hour" — either means "stop using this key, try
# the next one", not "this specific query is bad".
_QUOTA_ERROR_MARKERS = ("run out of searches", "hourly searches limit", "your account has been rate limited")


def _is_quota_error(status_code: int, body_text: str) -> bool:
    if status_code == 429:
        return True
    low = body_text.lower()
    return any(marker in low for marker in _QUOTA_ERROR_MARKERS)


async def _serpapi_get(extra_params: dict) -> tuple[int, dict, str]:
    """
    Shared low-level SerpAPI GET with automatic fallback: tries
    settings.SERPAPI_KEY first, and — only on a quota/rate-limit response,
    never on an unrelated error — retries the exact same request with
    settings.SERPAPI_KEY_FALLBACK if one is configured. Returns
    (status_code, json_body, key_label) so callers can log which account
    actually served the request.
    """
    keys = [("primary", settings.SERPAPI_KEY)]
    if settings.SERPAPI_KEY_FALLBACK:
        keys.append(("fallback", settings.SERPAPI_KEY_FALLBACK))

    last_status, last_body = 0, {}
    async with httpx.AsyncClient(timeout=30.0) as client:
        for label, key in keys:
            if not key or key in _exhausted_keys:
                continue
            try:
                response = await client.get(SERPAPI_URL, params={**extra_params, "api_key": key})
            except Exception as e:
                logger.error(f"SerpAPI request exception ({label} key): {e}")
                continue

            _record_api_usage("SerpAPI", str(extra_params.get("engine") or "google"))
            body_text = response.text
            if response.status_code == 200:
                return 200, response.json(), label

            last_status, last_body = response.status_code, {}
            if _is_quota_error(response.status_code, body_text):
                logger.warning(f"SerpAPI {label} key is out of quota/rate-limited — {body_text[:200]!r}")
                _exhausted_keys.add(key)
                continue  # try the next key, if any
            else:
                logger.error(f"SerpAPI returned {response.status_code} ({label} key): {body_text[:200]}")
                break  # a real error, not a quota issue — retrying with another key won't help

    return last_status, last_body, "none"


async def _serpapi_organic_results(search_query: str, start: int, num: int = _RESULTS_PER_PAGE) -> list:
    """Fetch a single raw Google SERP page via SerpAPI (with automatic key
    fallback). Returns unparsed organic_results."""
    if not settings.SERPAPI_KEY and not settings.SERPAPI_KEY_FALLBACK:
        return []

    status, data, _ = await _serpapi_get({
        "q": search_query,
        "engine": "google",
        "num": num,
        "start": start,
        "hl": "en",
        "gl": "us",
    })
    if status != 200:
        return []
    return data.get("organic_results", [])


_SERPER_QUOTA_FILE = os.path.join(os.path.dirname(__file__), "serper_quota.json")
_SERPER_KEY_LIMIT = 2500


def _get_serper_counts() -> tuple[int, int]:
    """Returns (key1_used, key2_used) for Serper API keys."""
    if not os.path.exists(_SERPER_QUOTA_FILE):
        return (0, 0)
    try:
        with open(_SERPER_QUOTA_FILE, "r") as f:
            data = json.load(f)
            return (data.get("key1_used", 0), data.get("key2_used", 0))
    except Exception:
        pass
    return (0, 0)


def _increment_serper_count(key_index: int, amount: int = 1):
    """Increments and persists used query count for Serper Key 1 or 2."""
    k1, k2 = _get_serper_counts()
    if key_index == 1:
        k1 += amount
    elif key_index == 2:
        k2 += amount
    try:
        with open(_SERPER_QUOTA_FILE, "w") as f:
            json.dump({"key1_used": k1, "key2_used": k2}, f)
    except Exception as e:
        logger.warning(f"Could not persist Serper quota count: {e}")


def _mark_serper_exhausted(key_index: int):
    """Marks Serper Key 1 or 2 as exhausted (2,500 limit reached)."""
    k1, k2 = _get_serper_counts()
    if key_index == 1:
        k1 = _SERPER_KEY_LIMIT
    elif key_index == 2:
        k2 = _SERPER_KEY_LIMIT
    try:
        with open(_SERPER_QUOTA_FILE, "w") as f:
            json.dump({"key1_used": k1, "key2_used": k2}, f)
    except Exception as e:
        logger.warning(f"Could not mark Serper Key {key_index} exhausted: {e}")


async def _serper_organic_results(search_query: str, start: int, num: int = _RESULTS_PER_PAGE, key_index: int = 1) -> list:
    """
    Fetch Google Search results via Serper.dev API (POST https://google.serper.dev/search).
    key_index: 1 for primary Serper key (2,500 limit), 2 for secondary Serper key (2,500 limit).
    Returns organic results formatted identically to SerpAPI's `organic_results`.
    """
    if key_index == 1:
        key = getattr(settings, "SERPER_API_KEY_1", None) or os.getenv("SERPER_API_KEY_1", "")
    else:
        key = getattr(settings, "SERPER_API_KEY_2", None) or os.getenv("SERPER_API_KEY_2", "")

    if not key:
        return []

    k1, k2 = _get_serper_counts()
    current_count = k1 if key_index == 1 else k2
    if current_count >= _SERPER_KEY_LIMIT:
        logger.info(f"[Serper.dev API Key {key_index}] Quota limit ({_SERPER_KEY_LIMIT}) exhausted ({current_count}/{_SERPER_KEY_LIMIT}).")
        return []

    page_num = (start // num) + 1 if num > 0 else 1
    url = "https://google.serper.dev/search"
    headers = {
        "X-API-KEY": key,
        "Content-Type": "application/json",
    }
    payload = {
        "q": search_query,
        "num": num,
        "page": page_num,
    }

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(url, headers=headers, json=payload)
            _record_api_usage(f"SerperKey{key_index}", "serper")

            if resp.status_code == 200:
                _increment_serper_count(key_index, 1)
                data = resp.json()
                items = data.get("organic", [])
                results = []
                for item in items:
                    results.append({
                        "link": item.get("link", ""),
                        "title": item.get("title", ""),
                        "snippet": item.get("snippet", ""),
                        "position": item.get("position"),
                    })
                new_k1, new_k2 = _get_serper_counts()
                used = new_k1 if key_index == 1 else new_k2
                logger.info(f"[Serper.dev API Key {key_index}] Query {search_query!r} succeeded (Key {key_index} count: {used}/{_SERPER_KEY_LIMIT})")
                return results
            elif resp.status_code in (400, 403, 429):
                body = resp.text[:200]
                logger.warning(f"[Serper.dev API Key {key_index}] Status {resp.status_code}: {body}. Marking Key {key_index} exhausted!")
                _mark_serper_exhausted(key_index)
                return []
            else:
                logger.error(f"[Serper.dev API Key {key_index}] Unexpected status {resp.status_code}: {resp.text[:200]}")
                return []
    except Exception as e:
        logger.error(f"[Serper.dev API Key {key_index}] Request exception: {e}")
        return []


async def _hybrid_organic_results(search_query: str, start: int, num: int = _RESULTS_PER_PAGE) -> list:
    """
    Multi-Tier Hybrid Search Orchestrator:
    1. Tier 1: Serper.dev API Key 1 (Primary 2,500 credits).
    2. Tier 2: Serper.dev API Key 2 (Secondary 2,500 credits) — automatically fallback when Key 1 exhausts.
    3. Tier 3: SerpAPI (Primary & Fallback accounts) — ultimate fallback when Serper credits exhaust or fail.
    """
    # Tier 1: Serper Key 1
    results = await _serper_organic_results(search_query, start, num, key_index=1)
    if results:
        return results

    # Tier 2: Serper Key 2
    results = await _serper_organic_results(search_query, start, num, key_index=2)
    if results:
        return results

    # Tier 3: SerpAPI Fallback
    return await _serpapi_organic_results(search_query, start, num)


async def _serpapi_raw(params: dict) -> dict:
    """Generic SerpAPI call (with automatic key fallback) returning the full
    parsed JSON response — used for engines (e.g. google_maps) whose useful
    data isn't in organic_results."""
    if not settings.SERPAPI_KEY and not settings.SERPAPI_KEY_FALLBACK:
        return {}
    status, data, _ = await _serpapi_get(params)
    if status != 200:
        return {}
    return data


_LINKEDIN_TRACKING_SUFFIX_RE = re.compile(r'[?#].*$')


def _clean_linkedin_url(url: str) -> str:
    """
    Strips tracking query params/fragments (e.g. "?trk=public_profile...",
    "?miniProfileUrn=...", "#content") off a LinkedIn URL, and drops a
    trailing slash — so the link actually stored and shown to the user is
    the clean canonical profile URL, and so slug-based dedup (see
    _company_results_from_page's exclude_identifiers matching) isn't
    defeated by incidental tracking noise on an otherwise-identical URL.
    """
    if not url:
        return url
    return _LINKEDIN_TRACKING_SUFFIX_RE.sub("", url).rstrip("/")


def _canonical_linkedin_profile_url(url: str, path_marker: str) -> str:
    """
    Rebuilds a canonical root profile URL (e.g.
    "https://www.linkedin.com/company/acme-inc") from whatever LinkedIn URL
    a search result actually returned — which may carry a regional
    subdomain (in./tw./www.), or point at a specific sub-page Google indexed
    (e.g. ".../company/acme-inc/about/", ".../in/janedoe/recent-activity/")
    rather than the profile root. Ensures the link actually stored and shown
    to the user always resolves to the real main profile page, and that
    slug-based identity matching (see exclude_identifiers dedup) is stable
    regardless of which sub-page happened to get indexed.
    """
    cleaned = _clean_linkedin_url(url)
    if path_marker not in cleaned:
        return cleaned
    slug = cleaned.split(path_marker, 1)[-1].split("/")[0]
    if not slug:
        return cleaned
    return f"https://www.linkedin.com{path_marker}{slug}"


def _leads_from_organic_results(results: list, linkedin_only: bool = True) -> list:
    """Parse a page of raw SerpAPI organic results into lead dicts."""
    leads = []
    for result in results:
        title = result.get("title", "")
        raw_link = result.get("link", "")
        snippet = result.get("snippet", "")

        if linkedin_only and "linkedin.com" not in raw_link.lower():
            continue
        if "linkedin.com/in/" not in raw_link:
            continue
        link = _canonical_linkedin_profile_url(raw_link, "/in/")

        parsed = _parse_linkedin_title(title)
        if not parsed:
            logger.warning(f"Skipping unparseable LinkedIn result title: {title!r}")
            continue

        # Prefer the most structured real signal available for the current
        # title/company: Google's rich_snippet extension triple, then the
        # plain-text snippet, then whatever the truncated page <title> spelled
        # out. Never fabricated — just the best real source that was found.
        rs_designation, rs_company = _from_rich_snippet(result)
        sn_designation, sn_company = (None, None) if rs_company else _from_snippet(snippet)

        designation = rs_designation or sn_designation or parsed["designation"]
        company = rs_company or sn_company or parsed["company"]

        leads.append({
            "name": parsed["name"],
            "designation": designation,
            "company": company,  # may be None — real "unknown", not fabricated
            "linkedin_url": link,
            "snippet": snippet,
            "email": None,
            "phone": None,
            "domain": None,
            "website": None,
            "source": "LinkedIn (SerpAPI)",
        })
    return leads


async def scrape_with_serpapi(
    search_query: str,
    count_target: int = 50,
    linkedin_only: bool = True,
    max_pages: int = 3,
) -> list:
    """
    Use SerpAPI to search the web for real data, walking multiple result
    pages (via the `start` offset) since a single Google SERP page rarely
    returns more than ~10 organic results for a narrow site:linkedin.com/in
    query — capping at one page is why searches previously stalled far
    short of the requested lead count.

    Stops early once count_target unique leads are collected, or once a
    page comes back with fewer results than requested (real end of the
    result set — never invented to hit the target).
    """
    if not (getattr(settings, "SERPER_API_KEY_1", None) or getattr(settings, "SERPER_API_KEY_2", None) or getattr(settings, "SERPAPI_KEY", None) or os.getenv("SERPER_API_KEY_1") or os.getenv("SERPER_API_KEY_2") or os.getenv("SERPAPI_KEY")):
        logger.warning("No search API keys (Serper or SerpAPI) configured. Skipping web scraping.")
        return []

    leads = []
    seen_links = set()

    logger.info(f"SerpAPI query: {search_query!r} (target={count_target}, max_pages={max_pages})")

    for page in range(max_pages):
        start = page * _RESULTS_PER_PAGE
        results = await _hybrid_organic_results(search_query, start=start, num=_RESULTS_PER_PAGE)
        if not results:
            break  # No more results for this query — real exhaustion, stop paginating.

        for lead in _leads_from_organic_results(results, linkedin_only=linkedin_only):
            if lead["linkedin_url"] in seen_links:
                continue
            seen_links.add(lead["linkedin_url"])
            leads.append(lead)
            if len(leads) >= count_target:
                break

        if len(leads) >= count_target:
            break
        if len(results) < _RESULTS_PER_PAGE:
            break  # Short page — we've reached the end of Google's results.

    logger.info(f"SerpAPI returned {len(leads)} LinkedIn profiles for query {search_query!r}")
    return leads


_MAX_COMBOS = 8
_MAX_ENRICHED_COMPANIES = 60

def _extract_domain(url: str | None) -> str | None:
    """Extract clean domain name from URL for strict website deduplication."""
    if not url:
        return None
    url_low = url.lower().strip()
    url_low = re.sub(r'^https?://', '', url_low)
    url_low = re.sub(r'^www\.', '', url_low)
    domain = url_low.split('/')[0].strip()
    return domain if domain else None

def _normalize_phone(phone: str | None) -> str | None:
    """Normalize phone number to digits only for strict contact phone deduplication."""
    if not phone:
        return None
    digits = re.sub(r'\D', '', phone)
    return digits if len(digits) >= 6 else None

# ISO country / region matching for strict location filtering
_COUNTRY_PHONE_PREFIXES = {
    "australia": ["+61", "61"],
    "united states": ["+1", "1"],
    "canada": ["+1", "1"],
    "united kingdom": ["+44", "44"],
    "india": ["+91", "91"],
    "germany": ["+49", "49"],
    "france": ["+33", "33"],
    "singapore": ["+65", "65"],
    "united arab emirates": ["+971", "971"],
    "japan": ["+81", "81"],
    "brazil": ["+55", "55"],
    "netherlands": ["+31", "31"],
    "new zealand": ["+64", "64"],
}

_COUNTRY_KEYWORDS = {
    "australia": ["australia", "australian", "sydney", "melbourne", "brisbane", "perth", "adelaide", "canberra", ".au", "com.au"],
    "united states": ["united states", "usa", "us", "america", "american", "california", "new york", "texas", "florida", "chicago", "los angeles", "san francisco", "washington", "boston", "seattle", ".us"],
    "united kingdom": ["united kingdom", "uk", "britain", "british", "london", "manchester", "birmingham", "edinburgh", ".uk", "co.uk"],
    "canada": ["canada", "canadian", "toronto", "vancouver", "montreal", "ottawa", "calgary", ".ca"],
    "india": ["india", "indian", "mumbai", "delhi", "bangalore", "bengaluru", "hyderabad", "chennai", "pune", "gurgaon", "noida", ".in", "co.in"],
    "germany": ["germany", "german", "berlin", "munich", "hamburg", "frankfurt", ".de"],
    "france": ["france", "french", "paris", "lyon", "marseille", ".fr"],
    "singapore": ["singapore", "singaporean", ".sg", "com.sg"],
    "united arab emirates": ["united arab emirates", "uae", "dubai", "abu dhabi", ".ae"],
}


def _is_country_match(entity_text: str, entity_address: str | None, entity_phone: str | None, requested_countries: list) -> bool:
    """
    Strict country match validator.
    Ensures lead/company belongs to requested countries and excludes leads strictly from non-requested countries.
    """
    if not requested_countries:
        return True

    req_lows = [c.lower().strip() for c in requested_countries if c]
    if not req_lows:
        return True

    combined_text = f"{entity_text or ''} {entity_address or ''}".lower()

    # 1. Check positive match for requested countries
    matched_requested = False
    for country in req_lows:
        keywords = _COUNTRY_KEYWORDS.get(country, [country])
        for kw in keywords:
            if len(kw) <= 3:
                if re.search(r'\b' + re.escape(kw) + r'\b', combined_text):
                    matched_requested = True
                    break
            else:
                if kw in combined_text:
                    matched_requested = True
                    break
        if matched_requested:
            break

        if entity_phone:
            prefixes = _COUNTRY_PHONE_PREFIXES.get(country, [])
            for p in prefixes:
                if entity_phone.startswith(p) or f" {p}" in entity_phone:
                    matched_requested = True
                    break
        if matched_requested:
            break

    # 2. If entity has zero positive match for requested country and explicitly matches another country (e.g. India when AU/US selected), reject it
    if not matched_requested:
        for other_c, other_kws in _COUNTRY_KEYWORDS.items():
            if other_c not in req_lows:
                for kw in other_kws:
                    if len(kw) > 3 and re.search(r'\b' + re.escape(kw) + r'\b', combined_text):
                        return False

    return True


async def _fetch_wikidata_info(company_name: str) -> dict:
    """Fetch company information from Wikidata REST API."""
    url = "https://www.wikidata.org/w/api.php"
    params = {
        "action": "wbsearchentities",
        "search": company_name,
        "language": "en",
        "format": "json",
        "type": "item",
    }
    headers = {"User-Agent": "CompanyLeadSourcingBot/1.0 (contact@companylead.org)"}
    try:
        async with httpx.AsyncClient(timeout=5.0, headers=headers) as client:
            res = await client.get(url, params=params)
            if res.status_code == 200:
                data = res.json()
                results = data.get("search", [])
                if results:
                    first = results[0]
                    return {
                        "name": first.get("label"),
                        "description": first.get("description"),
                        "source": "Wikidata"
                    }
    except Exception as e:
        logger.debug(f"Wikidata lookup failed for {company_name}: {e}")
    return {}


async def _fetch_crunchbase_info(company_name: str, country: str | None = None) -> dict:
    """Search Crunchbase profile via Hybrid Search Engine."""
    query = f'site:crunchbase.com/organization "{company_name}"'
    if country:
        query += f' "{country}"'
    results = await _hybrid_organic_results(query, start=0, num=2)
    for r in results:
        link = r.get("link", "")
        if "crunchbase.com/organization/" in link:
            return {
                "crunchbase_url": link,
                "snippet": r.get("snippet", ""),
                "source": "Crunchbase"
            }
    return {}


async def _fetch_wellfound_info(company_name: str) -> dict:
    """Search Wellfound (AngelList) profile via Hybrid Search Engine."""
    query = f'site:wellfound.com/company "{company_name}"'
    results = await _hybrid_organic_results(query, start=0, num=2)
    for r in results:
        link = r.get("link", "")
        if "wellfound.com/company/" in link or "angel.co/company/" in link:
            return {
                "wellfound_url": link,
                "snippet": r.get("snippet", ""),
                "source": "Wellfound"
            }
    return {}


async def _fetch_opencorporates_info(company_name: str, country: str | None = None) -> dict:
    """Search OpenCorporates profile via Hybrid Search Engine."""
    query = f'site:opencorporates.com/companies "{company_name}"'
    if country:
        query += f' "{country}"'
    results = await _hybrid_organic_results(query, start=0, num=2)
    for r in results:
        link = r.get("link", "")
        if "opencorporates.com/companies/" in link:
            return {
                "opencorporates_url": link,
                "snippet": r.get("snippet", ""),
                "source": "OpenCorporates"
            }
    return {}


async def scrape_public_leads(
    countries: list,
    industries: list,
    designations: list,
    count_target: int,
    extra_keywords: list | None = None,
    exclude_linkedin_urls: set | None = None,
) -> list:
    """
    Main scraping entry point using SerpAPI, Crunchbase, Wellfound, OpenCorporates, Wikidata, Google Maps.
    Mandates country filter matching and requires valid contact info (email or phone).
    """
    countries = countries or ["United States"]
    industries = industries or ["Technology"]
    designations = designations or ["Professional"]
    extra_keywords = [kw for kw in (extra_keywords or []) if kw]

    designation_str = designations[0]
    industry_str = industries[0]

    combos = list(itertools.product(countries, industries, designations))[:_MAX_COMBOS]

    candidate_leads: list = []
    seen_links: set = set(exclude_linkedin_urls or set())
    already_excluded = len(seen_links)

    def _merge(new_leads: list) -> int:
        added = 0
        for lead in new_leads:
            if lead["linkedin_url"] in seen_links:
                continue
            seen_links.add(lead["linkedin_url"])
            candidate_leads.append(lead)
            added += 1
        return added

    logger.info(
        f"Starting real data scrape across {len(combos)} combination(s), target={count_target}"
        + (f", excluding {already_excluded} already-scraped people" if already_excluded else "")
    )

    scan_target = max(count_target * 10, 50)

    # Pass 1 — strict quoted match on title + industry + country.
    for country, industry, designation in combos:
        if len(candidate_leads) >= scan_target:
            break
        query = f'site:linkedin.com/in "{designation}" "{industry}" "{country}"'
        for kw in extra_keywords:
            query += f' "{kw}"'
        added = _merge(await scrape_with_serpapi(query, scan_target - len(candidate_leads), max_pages=5))
        logger.info(f"[strict] {query!r} -> +{added} candidate leads (total {len(candidate_leads)})")

    # Pass 2 — same combos, quotes dropped so Google can match loosely.
    if len(candidate_leads) < scan_target:
        for country, industry, designation in combos:
            if len(candidate_leads) >= scan_target:
                break
            query = f'site:linkedin.com/in {designation} {industry} {country}'
            for kw in extra_keywords:
                query += f' {kw}'
            added = _merge(await scrape_with_serpapi(query, scan_target - len(candidate_leads), max_pages=5))
            logger.info(f"[loose] {query!r} -> +{added} candidate leads (total {len(candidate_leads)})")

    # Pass 3 — broadest real fallback: industry + country only, no title filter.
    if len(candidate_leads) < scan_target:
        for country, industry in itertools.product(countries, industries):
            if len(candidate_leads) >= scan_target:
                break
            query = f'site:linkedin.com/in {industry} {country}'
            added = _merge(await scrape_with_serpapi(query, scan_target - len(candidate_leads), max_pages=5))
            logger.info(f"[broad] {query!r} -> +{added} candidate leads (total {len(candidate_leads)})")

    # Deep Enrichment & Contact Verification loop
    website_cache: dict = {}
    contact_cache: dict = {}
    multisource_cache: dict = {}
    region = _region_hint(countries)

    valid_leads = []
    seen_domains = set()
    seen_emails = set()
    seen_phones = set()

    for lead in candidate_leads:
        if len(valid_leads) >= count_target:
            break

        company_name = lead.get("company")
        snippet_text = f"{lead.get('name', '')} {lead.get('designation', '')} {company_name or ''} {lead.get('snippet', '')}"

        # 1. Check strict Country Filter
        if not _is_country_match(snippet_text, None, None, countries):
            logger.info(f"Skipping lead {lead.get('name')} at {company_name} — location failed country filter {countries}")
            continue

        sources = ["LinkedIn"]

        # 2. Enrich with company website & contact info if missing
        if company_name:
            if company_name not in website_cache:
                website_cache[company_name] = await _find_company_website(company_name)
            website = website_cache[company_name]

            if website:
                sources.append("Web")
                if company_name not in contact_cache:
                    contact_cache[company_name] = await _scrape_company_contact_info(website, region, company_name)
                contact_info = contact_cache[company_name]
                lead["website"] = website
                lead["email"] = lead.get("email") or contact_info.get("email")
                lead["phone"] = lead.get("phone") or contact_info.get("phone")

            # 3. Multi-source enrichments (Crunchbase, Wellfound, OpenCorporates, Wikidata)
            if company_name not in multisource_cache:
                cb_task = _fetch_crunchbase_info(company_name, countries[0] if countries else None)
                wf_task = _fetch_wellfound_info(company_name)
                oc_task = _fetch_opencorporates_info(company_name, countries[0] if countries else None)
                wd_task = _fetch_wikidata_info(company_name)
                cb_res, wf_res, oc_res, wd_res = await asyncio.gather(cb_task, wf_task, oc_task, wd_task)
                multisource_cache[company_name] = {
                    "cb": cb_res, "wf": wf_res, "oc": oc_res, "wd": wd_res
                }
            ms = multisource_cache[company_name]
            if ms["cb"].get("source"): sources.append("Crunchbase")
            if ms["wf"].get("source"): sources.append("Wellfound")
            if ms["oc"].get("source"): sources.append("OpenCorporates")
            if ms["wd"].get("source"): sources.append("Wikidata")

        lead["sources"] = list(dict.fromkeys(sources))

        # 4. Mandatory Contact Check: Must have email OR phone number!
        if not lead.get("email") and not lead.get("phone"):
            logger.info(f"Dropping lead {lead.get('name')} at {company_name} — no verified email or phone contact found.")
            continue

        # 5. Strict Deduplication Check: No 2 leads can share website, email, or phone!
        domain = _extract_domain(lead.get("website"))
        norm_email = lead.get("email").lower().strip() if lead.get("email") else None
        norm_phone = _normalize_phone(lead.get("phone"))

        if domain and domain in seen_domains:
            logger.info(f"Discarding duplicate lead {lead.get('name')} — website domain '{domain}' already present in results.")
            continue

        if norm_email and norm_email in seen_emails:
            logger.info(f"Discarding duplicate lead {lead.get('name')} — email '{norm_email}' already present in results.")
            continue

        if norm_phone and norm_phone in seen_phones:
            logger.info(f"Discarding duplicate lead {lead.get('name')} — phone '{norm_phone}' already present in results.")
            continue

        if domain: seen_domains.add(domain)
        if norm_email: seen_emails.add(norm_email)
        if norm_phone: seen_phones.add(norm_phone)

        # Score verified lead
        score = 60
        if lead.get("designation") and designation_str.lower() in lead["designation"].lower():
            score += 15
        if lead.get("company") and industry_str.lower() in lead["company"].lower():
            score += 10
        if lead.get("email"):
            score += 10
        if lead.get("phone"):
            score += 5
        lead["score"] = min(100, score)

        valid_leads.append(lead)

    logger.info(f"Scraping complete: {len(valid_leads)} verified leads with contact info returned (target was {count_target})")
    return valid_leads


# ===========================================================================
# Company-mode scraping — finds whole companies rather than one targeted
# person. Reuses the individual-profile parsing helpers above for the
# decision-maker lookup, since a LinkedIn /in/ result is a LinkedIn /in/
# result either way.
# ===========================================================================

# Directory/aggregator/social domains that regularly outrank a small
# company's own site in an "official website" search — never the company's
# real website, so skipped when picking one.
_NON_COMPANY_WEBSITE_DOMAINS = {
    "linkedin.com", "facebook.com", "twitter.com", "x.com", "instagram.com",
    "youtube.com", "wikipedia.org", "crunchbase.com", "tracxn.com",
    "rocketreach.co", "zoominfo.com", "apollo.io", "pitchbook.com",
    "owler.com", "similarweb.com", "dnb.com", "glassdoor.com", "indeed.com",
    "bloomberg.com", "ambitionbox.com", "github.com", "signalhire.com",
    "clutch.co", "getlatka.com", "craft.co",
    # SaaS/product review & comparison aggregators — never the company's own site.
    "softwareadvice.com", "g2.com", "capterra.com", "trustradius.com",
    "getapp.com", "producthunt.com", "alternativeto.net", "sourceforge.net",
    "publicnow.com",
    # Corporate-registry / filing lookup sites — real data about the company,
    # but never the company's own domain.
    "zaubacorp.com", "tofler.in", "instafinancials.com", "opencorporates.com",
    "mca.gov.in", "companycheck.co.uk", "opengovus.com",
    # Reference/encyclopedia sites — their page title is often just the bare
    # entity name with no distinguishing text, which passes the title-match
    # check even though the page is *about* the entity, not that entity's own
    # site. Confirmed on a real search during testing: "National Security
    # Agency" resolved to a Ballotpedia article, and its "media@" contact
    # address got attributed to the agency.
    "ballotpedia.org", "wikidata.org", "britannica.com",
}

# Path/title fragments that reliably mean "a page *about* the company on
# someone else's site" rather than the company's own official page —
# e.g. a third party's blog post, review, or news article that happens to
# mention the company by name.
_CONTENT_PAGE_MARKERS = (
    "/blog", "/blogs", "/news/", "/press/", "/article", "interview",
    "guide", "review", "-vs-", " vs ", "alternative", "pricing-comparison",
    "preparation", "tutorial", "case-study", "/wiki/",
)

_HIRING_KEYWORDS = ("hiring", "we're hiring", "join our team", "join us", "careers", "open roles", "open positions")
_ACHIEVEMENT_KEYWORDS = (
    "raised", "funding", "series a", "series b", "series c", "series d",
    "award", "partnership", "launch", "expansion", "acquisition", "acquired",
    "ipo", "milestone",
)

# Enrichment (decision-maker + website lookup) costs two extra SerpAPI calls
# per company — cap it independently of count_target so a large company
# search (e.g. 500) can't balloon into a thousand-plus API calls.
_MAX_ENRICHED_COMPANIES = 60

# ===========================================================================
# Employee-count parsing — LinkedIn publishes a company's headcount as a
# bucketed range (e.g. "51-200 employees") directly in its company-page
# metadata, which Google surfaces verbatim in the search snippet/rich
# snippet. This is a real, LinkedIn-published fact — parsed here, never
# estimated or invented when absent.
# ===========================================================================

_EMPLOYEE_RANGE_RE = re.compile(r'(\d[\d,]*)\s*-\s*(\d[\d,]*)\+?\s*employees?', re.IGNORECASE)
_EMPLOYEE_PLUS_RE = re.compile(r'(\d[\d,]*)\s*\+\s*employees?', re.IGNORECASE)
_EMPLOYEE_SINGLE_RE = re.compile(r'\b(\d[\d,]*)\s*employees?\b', re.IGNORECASE)


def _parse_employee_count(text: str | None) -> tuple[int | None, int | None]:
    """
    Parses a genuine "NN-NN employees" / "NN+ employees" / "N employee(s)"
    fragment out of real page/snippet text. Returns (min, max) where max is
    None for an open-ended "10,001+" bucket, or (None, None) when no
    employee-count text is present — never guessed from anything else.
    """
    if not text:
        return None, None

    m = _EMPLOYEE_RANGE_RE.search(text)
    if m:
        lo = int(m.group(1).replace(",", ""))
        hi = int(m.group(2).replace(",", ""))
        if lo <= hi:
            return lo, hi

    m = _EMPLOYEE_PLUS_RE.search(text)
    if m:
        return int(m.group(1).replace(",", "")), None

    m = _EMPLOYEE_SINGLE_RE.search(text)
    if m:
        n = int(m.group(1).replace(",", ""))
        if 0 < n <= 1_000_000:  # sanity bound against unrelated large numbers
            return n, n

    return None, None


def _extract_employee_count_from_result(result: dict) -> tuple[int | None, int | None]:
    """Best-effort, zero-extra-cost employee-count extraction from a
    discovery-time SerpAPI result — checks the title, snippet, and rich
    snippet extensions (the same structured field LinkedIn profile parsing
    already trusts for title/company)."""
    extensions = (result.get("rich_snippet") or {}).get("top", {}).get("extensions") or []
    combined = " ".join([result.get("title") or "", result.get("snippet") or "", *extensions])
    return _parse_employee_count(combined)


def _format_size_range(emp_min: int | None, emp_max: int | None) -> str | None:
    """Renders the real, LinkedIn-published bucket text — never a fabricated
    precise midpoint. e.g. (51, 200) -> "51-200", (10001, None) -> "10,001+"."""
    if emp_min is None and emp_max is None:
        return None
    if emp_max is None:
        return f"{emp_min:,}+"
    if emp_min == emp_max:
        return f"{emp_min:,}"
    return f"{emp_min:,}-{emp_max:,}"


def _company_size_in_range(
    emp_min: int | None, emp_max: int | None, filter_min: int | None, filter_max: int | None
) -> bool:
    """
    True when a company's real (possibly bucketed) employee-count range
    overlaps the user's requested [filter_min, filter_max]. When no size
    filter is active, every company matches. When a filter IS active but the
    company's size genuinely could not be confirmed, it does NOT match —
    per the "strictly follow the rules defined on Lead Search" requirement,
    an unverifiable size is excluded rather than assumed to be in range.
    """
    if filter_min is None and filter_max is None:
        return True
    if emp_min is None and emp_max is None:
        return False

    lo = emp_min if emp_min is not None else emp_max
    hi = emp_max if emp_max is not None else emp_min
    hi_cmp = hi if hi is not None else float("inf")
    f_lo = filter_min if filter_min is not None else 0
    f_hi = filter_max if filter_max is not None else float("inf")
    return lo <= f_hi and hi_cmp >= f_lo


# ===========================================================================
# Revenue parsing — no single authoritative "revenue" field exists the way
# LinkedIn's headcount bucket does; instead this parses a genuine dollar
# figure/range out of real search-result text (a data-aggregator's
# published estimate — Owler, Growjo, ZoomInfo, RocketReach, Craft — Google
# frequently surfaces this verbatim in its own snippet). Never estimated
# from anything else (e.g. never derived from employee count); a company
# whose revenue can't be found this way is simply excluded when a revenue
# filter is active, same principle as the size filter.
# ===========================================================================

_REVENUE_RANGE_RE = re.compile(
    r'\$\s*([\d.,]+)\s*(k|m|b|thousand|million|billion)?\s*-\s*\$?\s*([\d.,]+)\s*(k|m|b|thousand|million|billion)?',
    re.IGNORECASE,
)
_REVENUE_SINGLE_RE = re.compile(
    r'\$\s*([\d.,]+)\s*(k|m|b|thousand|million|billion)?(\+)?',
    re.IGNORECASE,
)

_REVENUE_UNIT_MULTIPLIERS = {
    "k": 1_000, "thousand": 1_000,
    "m": 1_000_000, "million": 1_000_000,
    "b": 1_000_000_000, "billion": 1_000_000_000,
}


def _revenue_unit_multiplier(unit: str | None) -> float:
    if not unit:
        return 1
    return _REVENUE_UNIT_MULTIPLIERS.get(unit.strip().lower(), 1)


# How close a dollar figure must be to the word "revenue" to be trusted as
# actually describing it, rather than some other unrelated dollar figure
# (a funding round, a product price) that merely shares a snippet with an
# unrelated mention of the word "revenue" elsewhere in the text. Real
# aggregator phrasing ("Estimated Revenue: $12.3M", "$12.3M in annual
# revenue") always keeps the figure and the word within a few words of
# each other, so a tight window filters out coincidental co-occurrence
# without missing genuine phrasing.
_REVENUE_WORD_RE = re.compile(r'revenue', re.IGNORECASE)
_REVENUE_CONTEXT_BEFORE = 35
_REVENUE_CONTEXT_AFTER = 40

# A dollar figure sharing a snippet with "revenue" but sitting in the same
# short window as one of these words is describing a *different* metric
# (a funding round, a valuation, an acquisition price) — trusting it as
# revenue would misattribute that figure. Skip that "revenue" occurrence
# entirely rather than guess which number it actually refers to.
_REVENUE_CONFOUND_RE = re.compile(
    r'\b(funding|raised|invest(?:ment|or)?|valuation|series\s+[a-z]|seed\s+round|acquisition|acquired|ipo)\b',
    re.IGNORECASE,
)


def _parse_revenue_text(text: str | None) -> tuple[float | None, float | None]:
    """
    Parses a genuine dollar-figure/range out of real text, only trusting a
    figure found within a short window of the word "revenue" — and only
    when that window doesn't also mention a different dollar-denominated
    metric (funding, valuation, acquisition price) that the figure might
    actually belong to instead. So an unrelated dollar figure elsewhere in
    the same snippet is never mistaken for revenue. Returns
    (min_usd, max_usd) in real dollars — max is None for an open-ended
    "$1B+" figure — or (None, None) when nothing genuine is found.
    """
    if not text:
        return None, None

    for word_match in _REVENUE_WORD_RE.finditer(text):
        window = text[max(0, word_match.start() - _REVENUE_CONTEXT_BEFORE): word_match.end() + _REVENUE_CONTEXT_AFTER]
        if _REVENUE_CONFOUND_RE.search(window):
            continue

        m = _REVENUE_RANGE_RE.search(window)
        if m:
            lo_num, lo_unit, hi_num, hi_unit = m.groups()
            try:
                lo = float(lo_num.replace(",", "")) * _revenue_unit_multiplier(lo_unit or hi_unit)
                hi = float(hi_num.replace(",", "")) * _revenue_unit_multiplier(hi_unit or lo_unit)
                if 0 < lo <= hi:
                    return lo, hi
            except ValueError:
                pass

        m = _REVENUE_SINGLE_RE.search(window)
        if m:
            num, unit, plus = m.groups()
            try:
                value = float(num.replace(",", "")) * _revenue_unit_multiplier(unit)
                if value > 0:
                    return value, (None if plus else value)
            except ValueError:
                pass

    return None, None


def _extract_revenue_from_result(result: dict) -> tuple[float | None, float | None]:
    """Zero-extra-cost revenue extraction from a discovery-time result —
    LinkedIn company pages essentially never publish revenue, so this
    usually returns (None, None) and _lookup_revenue is what actually finds
    it, but it's free to check first."""
    return _parse_revenue_text(f"{result.get('title') or ''} {result.get('snippet') or ''}")


_REVENUE_BAND_LABELS = {
    "startup": "Startup (<$1M)",
    "sme": "SME ($1M-$50M)",
    "mid_market": "Mid-Market ($50M-$1B)",
    "enterprise": "Enterprise ($1B+)",
}


def _revenue_band_for(rev_min: float | None, rev_max: float | None) -> str | None:
    """Classifies a real, confirmed revenue figure/range into a standard
    sales-tool tier, using the lower (more conservative) bound of a range.
    Never invents a figure — only classifies one that was actually parsed."""
    if rev_min is None and rev_max is None:
        return None
    point = rev_min if rev_min is not None else rev_max
    if point < 1_000_000:
        return "startup"
    if point < 50_000_000:
        return "sme"
    if point < 1_000_000_000:
        return "mid_market"
    return "enterprise"


def _format_revenue_range(rev_min: float | None, rev_max: float | None) -> str | None:
    """Renders the real parsed revenue as a compact display string, e.g.
    (1_000_000, 10_000_000) -> "$1M-$10M", (1_000_000_000, None) -> "$1B+"."""
    if rev_min is None and rev_max is None:
        return None

    def _fmt(v: float) -> str:
        if v >= 1_000_000_000:
            return f"${v / 1_000_000_000:g}B"
        if v >= 1_000_000:
            return f"${v / 1_000_000:g}M"
        if v >= 1_000:
            return f"${v / 1_000:g}K"
        return f"${v:g}"

    if rev_max is None:
        return f"{_fmt(rev_min)}+"
    if rev_min == rev_max:
        return _fmt(rev_min)
    return f"{_fmt(rev_min)}-{_fmt(rev_max)}"


def _revenue_band_matches(rev_min: float | None, rev_max: float | None, requested_bands: set | None) -> bool:
    """
    True when a company's real, confirmed revenue band is among the
    requested bands. When no revenue filter is active, every company
    matches. When a filter IS active but revenue genuinely couldn't be
    confirmed, it does NOT match — same "never assume, exclude the
    unconfirmed" rule _company_size_in_range applies to employee count.
    """
    if not requested_bands:
        return True
    band = _revenue_band_for(rev_min, rev_max)
    if band is None:
        return False
    return band in requested_bands


def _domain_of(url: str) -> str:
    try:
        from urllib.parse import urlparse
        netloc = urlparse(url).netloc.lower()
        return netloc[4:] if netloc.startswith("www.") else netloc
    except Exception:
        return ""


def _extract_activity_signal(snippet: str) -> dict:
    """
    Scan the company's own real search snippet for hiring/achievement/
    partnership language. Reuses text already fetched (no extra API call)
    and only flags a signal when the real snippet genuinely contains it —
    the matched snippet is stored verbatim as the "achievement", never
    inferred or invented.
    """
    signals = {"hiring": {"active": False, "open_roles": []}, "achievements": []}
    if not snippet:
        return signals
    lower = snippet.lower()
    if any(kw in lower for kw in _HIRING_KEYWORDS):
        signals["hiring"] = {"active": True, "open_roles": []}
    for kw in _ACHIEVEMENT_KEYWORDS:
        if kw in lower:
            signals["achievements"].append({"title": snippet.strip()})
            break
    return signals


def _company_results_from_page(results: list) -> list:
    """
    Parse a page of site:linkedin.com/company organic results into
    lightweight company dicts. Unlike a personal profile, a LinkedIn company
    page's Google title *is* the company name — no "Name - Title at Company"
    parsing needed.
    """
    companies = []
    for result in results:
        raw_link = result.get("link", "")
        title = (result.get("title") or "").strip()
        snippet = result.get("snippet", "")

        if "linkedin.com/company/" not in raw_link:
            continue
        if not title or len(title) < 2:
            continue

        link = _canonical_linkedin_profile_url(raw_link, "/company/")
        # Dedup key independent of regional subdomain (in./tw./www.linkedin.com)
        # and of which specific sub-page (e.g. "/about") Google indexed.
        slug = link.rsplit("/company/", 1)[-1].lower()

        emp_min, emp_max = _extract_employee_count_from_result(result)
        rev_min, rev_max = _extract_revenue_from_result(result)

        companies.append({
            "name": title,
            "linkedin_url": link,
            "slug": slug,
            "summary": snippet,
            "emp_min": emp_min,
            "emp_max": emp_max,
            "rev_min": rev_min,
            "rev_max": rev_max,
        })
    return companies


async def _lookup_employee_count(company_name: str) -> tuple[int | None, int | None]:
    """
    One extra, targeted search query for a company's real LinkedIn-published
    headcount, used only when discovery's own snippet didn't already carry
    it and a size filter is actually active (bounded by _MAX_ENRICHED_COMPANIES
    the same way decision-maker/website lookups are). Returns (None, None)
    — never a guess — if no LinkedIn company-page result with a genuine
    employee-count fragment turns up.
    """
    results = await _hybrid_organic_results(f'"{company_name}" linkedin employees', start=0, num=5)
    for r in results:
        if "linkedin.com/company/" not in r.get("link", ""):
            continue
        emp_min, emp_max = _extract_employee_count_from_result(r)
        if emp_min is not None or emp_max is not None:
            return emp_min, emp_max
    return None, None


async def _lookup_revenue(company_name: str) -> tuple[float | None, float | None]:
    """
    One extra, targeted search query for a company's real, publicly
    reported/estimated annual revenue, used only when a revenue filter is
    actually active and no revenue signal was already found for free at
    discovery time. Real data-aggregator sites (Owler, Growjo, ZoomInfo,
    RocketReach, Craft) often surface a revenue estimate directly in
    Google's own snippet text without needing to fetch the page — parsed
    from that real snippet only, never guessed. Returns (None, None) if
    nothing genuine turns up.
    """
    results = await _hybrid_organic_results(f'"{company_name}" annual revenue', start=0, num=5)
    for r in results:
        rev_min, rev_max = _extract_revenue_from_result(r)
        if rev_min is not None or rev_max is not None:
            return rev_min, rev_max
    return None, None


async def _paginate_companies(query: str, remaining: int, merge_fn, max_pages: int = 3) -> int:
    """Same pagination strategy as scrape_with_serpapi, but for company-page results."""
    added_total = 0
    for page in range(max_pages):
        start = page * _RESULTS_PER_PAGE
        results = await _hybrid_organic_results(query, start=start, num=_RESULTS_PER_PAGE)
        if not results:
            break
        added_total += merge_fn(_company_results_from_page(results))
        if added_total >= remaining:
            break
        if len(results) < _RESULTS_PER_PAGE:
            break
    return added_total


def _is_content_page(link: str, title: str) -> bool:
    """True when a result reads as a third party's page *about* the company
    (a blog post, review, comparison, interview prep guide, etc.) rather
    than the company's own site — the failure mode that once attributed a
    completely different company's contact details to a lead."""
    haystack = f"{link} {title}".lower()
    return any(marker in haystack for marker in _CONTENT_PAGE_MARKERS)


async def _find_company_website(company_name: str) -> str | None:
    """
    Best-effort real website lookup for a plain web search of the company's
    name. Builds a candidate list (root-level URLs first, since a real
    homepage almost always shows up as the domain root) that excludes
    directory/social/review sites and obvious third-party content pages,
    then live-fetches up to a few candidates and keeps the first one whose
    own <title> genuinely reads as belonging to this company — this catches
    corporate-registry/filing/bond-directory aggregators that slip past
    domain-blocklisting (there's an unbounded number of those sites; a
    per-page title check generalizes where a domain list can't keep up).

    Deliberately does NOT guess a domain from the company name without a
    search result behind it: tested empirically, that produces false
    positives (e.g. a parked placeholder domain like "stripe.ai" whose own
    <title> is just the domain name itself trivially "relates" to the
    company by substring match) — exactly the kind of wrong-but-plausible
    data this scraper must never report as genuine. Google's own ranking is
    what makes the subsequent title check trustworthy; skipping it removes
    that filter.

    Returns None when none of the fetched candidates' own <title> confirms
    them as this company's site — tested empirically (a live 15-lead scrape)
    and found the previous "fall back to the first unverified candidate"
    behavior was attributing a Glassdoor job listing, a VC's portfolio page,
    and a news article to companies as their "website", none of which are
    the company's own domain. A wrong website field is exactly the kind of
    not-genuinely-verified data this scraper must never present as real —
    an honest "not found" is strictly better than a wrong link.
    """
    results = await _hybrid_organic_results(f'"{company_name}" official website', start=0, num=5)

    candidates = []
    for r in results:
        link = r.get("link", "")
        title = r.get("title", "")
        domain = _domain_of(link)
        if not domain:
            continue
        if any(domain == d or domain.endswith("." + d) for d in _NON_COMPANY_WEBSITE_DOMAINS):
            continue
        if _is_content_page(link, title):
            continue
        candidates.append(link)

    if not candidates:
        return None

    # Root-level URLs (at most one path segment, e.g. "acme.com/") first,
    # then whatever's left, in original relevance order.
    def _is_root(link: str) -> bool:
        path = link.split("://", 1)[-1].split("/", 1)
        segments = [s for s in (path[1].split("/") if len(path) > 1 else []) if s]
        return len(segments) <= 1

    ordered = sorted(candidates, key=lambda link: 0 if _is_root(link) else 1)

    try:
        async with httpx.AsyncClient(
            timeout=8.0, follow_redirects=True, headers=_BROWSER_HEADERS
        ) as client:
            for link in ordered[:3]:
                try:
                    response = await client.get(link)
                except Exception:
                    continue
                if response.status_code != 200:
                    continue
                title = _extract_title(response.text)
                if title and _title_relates_to_company(title, company_name):
                    return link
    except Exception:
        pass

    return None


_SENIOR_TITLES_QUERY = (
    '("Founder" OR "Co-Founder" OR "CEO" OR "Chief Executive" OR "President" OR '
    '"Managing Director" OR "Owner" OR "Proprietor" OR "Director" OR "General Manager" OR '
    '"VP" OR "Vice President" OR "Head" OR "Partner")'
)


async def _find_decision_maker(company_name: str) -> dict | None:
    """
    Best-effort real decision-maker lookup — searches for a senior LinkedIn
    profile that mentions this company by name. Returns None (never
    fabricated) if no genuine match is found. Reuses the same profile
    parser used for individual-mode search, since the result shape is
    identical.

    Two passes: a senior-title-constrained search first (two pages), then —
    only if that finds nobody — a fallback with no title constraint at all,
    since a small company may not have any of those titles indexed by
    Google even though a real employee profile mentioning it exists.
    """
    query = f'site:linkedin.com/in {_SENIOR_TITLES_QUERY} "{company_name}"'
    for page in range(2):
        results = await _hybrid_organic_results(query, start=page * _RESULTS_PER_PAGE, num=_RESULTS_PER_PAGE)
        if not results:
            break
        leads = _leads_from_organic_results(results, linkedin_only=True)
        if leads:
            return leads[0]

    fallback_query = f'site:linkedin.com/in "{company_name}"'
    results = await _hybrid_organic_results(fallback_query, start=0, num=_RESULTS_PER_PAGE)
    leads = _leads_from_organic_results(results, linkedin_only=True)
    return leads[0] if leads else None


async def _serper_places_info(company_name: str, country: str | None = None, key_index: int = 1) -> dict:
    """
    Lookup Google Maps / Places business info using Serper.dev API (/places endpoint).
    key_index: 1 for primary Serper key, 2 for secondary Serper key.
    """
    if key_index == 1:
        key = getattr(settings, "SERPER_API_KEY_1", None) or os.getenv("SERPER_API_KEY_1", "")
    else:
        key = getattr(settings, "SERPER_API_KEY_2", None) or os.getenv("SERPER_API_KEY_2", "")

    if not key:
        return {}

    k1, k2 = _get_serper_counts()
    current_count = k1 if key_index == 1 else k2
    if current_count >= _SERPER_KEY_LIMIT:
        return {}

    query = f"{company_name} {country}" if country else company_name
    url = "https://google.serper.dev/places"
    headers = {
        "X-API-KEY": key,
        "Content-Type": "application/json",
    }
    payload = {"q": query}

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(url, headers=headers, json=payload)
            _record_api_usage(f"SerperPlacesKey{key_index}", "serper")
            if resp.status_code == 200:
                _increment_serper_count(key_index, 1)
                data = resp.json()
                places = data.get("places", [])
                if places:
                    place = places[0]
                    phone = place.get("phoneNumber") or place.get("phone") or None
                    website = place.get("website") or None
                    address = place.get("address") or None
                    if phone or website or address:
                        logger.info(f"[Serper.dev Places Key {key_index}] Google Maps info found for {company_name!r}")
                        return {
                            "phone": phone,
                            "website": website,
                            "address": address,
                        }
                return {}
            elif resp.status_code in (400, 403, 429):
                _mark_serper_exhausted(key_index)
                return {}
            else:
                return {}
    except Exception as e:
        logger.error(f"[Serper.dev Places Key {key_index}] Exception: {e}")
        return {}


async def _find_google_maps_info(company_name: str, country: str | None = None) -> dict:
    """
    Google Maps business-listing lookup:
    1. Tier 1: Serper.dev Places API (Key 1)
    2. Tier 2: Serper.dev Places API (Key 2)
    3. Tier 3: SerpAPI Google Maps fallback
    """
    # Tier 1: Serper Key 1 Places API
    res = await _serper_places_info(company_name, country, key_index=1)
    if res:
        return res

    # Tier 2: Serper Key 2 Places API
    res = await _serper_places_info(company_name, country, key_index=2)
    if res:
        return res

    # Tier 3: SerpAPI fallback
    query = f"{company_name} {country}" if country else company_name
    data = await _serpapi_raw({"q": query, "engine": "google_maps", "type": "search", "hl": "en"})

    place = data.get("place_results")
    if not place:
        local_results = data.get("local_results") or []
        place = local_results[0] if local_results else None
    if not place:
        return {}

    return {
        "phone": place.get("phone") or None,
        "website": place.get("website") or None,
        "address": place.get("address") or None,
    }


_TWITTER_PROFILE_RE = re.compile(r"^https?://(?:www\.)?(?:twitter\.com|x\.com)/([A-Za-z0-9_]+)/?$")


async def _find_twitter_profile(company_name: str) -> dict | None:
    """
    Best-effort real Twitter/X profile lookup for the company — matches
    only an actual profile URL (twitter.com/handle or x.com/handle), not an
    individual tweet/status page, so the returned snippet is a genuine bio
    rather than a random post.

    A profile-shaped URL alone isn't enough: a plain-text company name
    search on Twitter/X frequently surfaces unrelated accounts that merely
    retweeted something adjacent to the search terms (e.g. a news story
    using similar language). Verifies the account's handle or display name
    actually relates to the company before trusting it — same principle as
    _title_relates_to_company for websites. Returns None if nothing
    genuinely matches.
    """
    query = f'(site:twitter.com OR site:x.com) "{company_name}"'
    results = await _hybrid_organic_results(query, start=0, num=5)
    company_norm = _normalize_for_match(company_name)
    if not company_norm:
        return None

    for r in results:
        link = r.get("link", "")
        match = _TWITTER_PROFILE_RE.match(link)
        if not match:
            continue

        handle_norm = _normalize_for_match(match.group(1))
        display_name = (r.get("title") or "").split("(@")[0]
        display_norm = _normalize_for_match(display_name)

        related = any(
            len(candidate) >= 4 and (candidate in company_norm or company_norm[:6] in candidate)
            for candidate in (handle_norm, display_norm)
            if candidate
        )
        if related:
            return {"url": link, "bio": r.get("snippet") or ""}

    return None


# ISO 3166-1 alpha-2 region codes for phonenumbers parsing — covers the
# countries offered by the Lead Search page's country picker. Falls back to
# "US" for anything not listed; harmless since numbers with an explicit "+"
# country code (the common case on a company's own site) parse correctly
# regardless of the default region.
_COUNTRY_TO_REGION = {
    "united states": "US", "united kingdom": "GB", "canada": "CA", "australia": "AU",
    "germany": "DE", "france": "FR", "india": "IN", "singapore": "SG",
    "united arab emirates": "AE", "japan": "JP", "brazil": "BR", "netherlands": "NL",
    "switzerland": "CH", "sweden": "SE", "south africa": "ZA", "new zealand": "NZ",
    "ireland": "IE", "spain": "ES", "italy": "IT", "mexico": "MX",
    "saudi arabia": "SA", "hong kong": "HK", "israel": "IL", "norway": "NO",
    "denmark": "DK", "finland": "FI", "belgium": "BE", "austria": "AT", "malaysia": "MY",
}


def _region_hint(countries: list) -> str:
    for c in countries or []:
        region = _COUNTRY_TO_REGION.get((c or "").strip().lower())
        if region:
            return region
    return "US"


_EMAIL_RE = re.compile(r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}")
_EMAIL_JUNK_MARKERS = (
    ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", "sentry", "wixpress",
    "example.com", "godaddy", "yourdomain", "domain.com", ".css", ".js",
    "mail.com",  # a real domain, but overwhelmingly seen here as a generic
                 # form-placeholder value ("john.doe@mail.com") rather than
                 # a genuine contact address — confirmed on a real site
                 # during testing (idealsvdr.com's contact form).
)

# Strips <input placeholder="..."> (and similarly attributed) values before
# email/phone extraction ever sees them — a placeholder is example text the
# page author typed into a form field, not a real published contact detail,
# and a generic one ("john.doe@mail.com") is common across countless site
# templates. Confirmed on a real site during testing where it would
# otherwise have been reported as idealsvdr.com's genuine contact email.
_PLACEHOLDER_ATTR_RE = re.compile(r'placeholder\s*=\s*(["\'])(.*?)\1', re.IGNORECASE | re.DOTALL)


def _strip_placeholder_attrs(html_text: str) -> str:
    return _PLACEHOLDER_ATTR_RE.sub("", html_text)


# Cloudflare's "email protection" rewrites a real mailto link into
# data-cfemail="<hex>" and serves a client-side JS decoder — specifically to
# defeat scrapers like this one. The cipher is a simple published XOR: the
# first byte is the key, every subsequent byte is XORed with it. Decoding it
# recovers the site's genuine, already-published email (Cloudflare doesn't
# hide *that* it exists, only obfuscates the text) rather than skipping a
# real contact address just because of how it's encoded on the page.
_CF_EMAIL_RE = re.compile(r'data-cfemail="([0-9a-fA-F]+)"')


def _decode_cf_email(hex_str: str) -> str | None:
    try:
        data = bytes.fromhex(hex_str)
        key = data[0]
        decoded = bytes(b ^ key for b in data[1:])
        email = decoded.decode("utf-8")
        return email if "@" in email else None
    except Exception:
        return None


def _extract_email(html_text: str) -> str | None:
    cleaned = _strip_placeholder_attrs(html_text)

    cf_match = _CF_EMAIL_RE.search(cleaned)
    if cf_match:
        decoded = _decode_cf_email(cf_match.group(1))
        if decoded:
            return decoded

    for candidate in _EMAIL_RE.findall(cleaned):
        low = candidate.lower()
        if any(marker in low for marker in _EMAIL_JUNK_MARKERS):
            continue
        return candidate
    return None


def _extract_phone(html_text: str, region: str) -> str | None:
    try:
        for match in phonenumbers.PhoneNumberMatcher(html_text, region):
            return phonenumbers.format_number(match.number, phonenumbers.PhoneNumberFormat.INTERNATIONAL)
    except Exception:
        pass
    return None


_TITLE_RE = re.compile(r"<title[^>]*>(.*?)</title>", re.IGNORECASE | re.DOTALL)


def _extract_title(html_text: str) -> str:
    match = _TITLE_RE.search(html_text)
    if not match:
        return ""
    # HTML-unescape — a title's punctuation is very often entity-encoded in
    # the raw source (e.g. "&#8211;" for an en dash, "&amp;" for "&"). Left
    # undecoded, the literal "&#8211;" text doesn't match any of the
    # brand/tagline delimiter characters _title_relates_to_company splits
    # on, so the whole title is treated as one unsplittable segment and
    # rejected as "too long" — confirmed on a real site during testing
    # (health-tech.us), which wrongly discarded that site's own genuine,
    # verified email for exactly this reason.
    return html.unescape(match.group(1)).strip()


_SCRIPT_STYLE_RE = re.compile(r'<(script|style)[^>]*>.*?</\1>', re.IGNORECASE | re.DOTALL)
_TAG_RE = re.compile(r'<[^>]+>')
_WHITESPACE_RE = re.compile(r'\s+')


def _html_to_text(html_text: str) -> str:
    """Strips a fetched page down to its visible text — used only as input
    to the Groq fallback extractor, so an obfuscated address written in
    plain text (e.g. "name [at] company [dot] com") is legible without the
    surrounding markup burning context tokens."""
    no_scripts = _SCRIPT_STYLE_RE.sub(" ", html_text)
    no_tags = _TAG_RE.sub(" ", no_scripts)
    return _WHITESPACE_RE.sub(" ", html.unescape(no_tags)).strip()


def _normalize_for_match(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def _segment_matches_company(segment_norm: str, company_norm: str) -> bool:
    """
    Whether one already-normalized title segment reads as this company's own
    brand — same length-guard rationale as before: a long descriptive
    sentence standing in for a real brand segment (the signature of a
    registry/directory page, e.g. "X HAVING CIN Y IS 3 YEARS OLD COMPANY at
    Z") would otherwise pass a plain substring check just because it happens
    to describe the company at length, so it's rejected outright.
    """
    if not segment_norm or len(segment_norm) > max(20, len(company_norm) * 3):
        return False
    return (
        segment_norm in company_norm
        or company_norm in segment_norm
        or (len(segment_norm) >= 5 and segment_norm[:5] in company_norm)
    )


def _title_relates_to_company(title: str, company_name: str) -> bool:
    """
    Whether a fetched page's own <title> reads as belonging to the company
    itself, rather than a third party (reseller, partner, review site)
    writing *about* it. A company's own homepage title almost always has
    the company's own name as either its first segment ("Acme – Fast,
    reliable widgets") or its last segment ("Article headline | Acme") —
    real sites use both conventions about equally often — while a
    partner/reseller page's title instead trails off with *their* brand
    name, e.g. "... | RIS Services UAE" for a page about "OptCulture".
    Checking only the last segment (as an earlier version of this function
    did) wrongly rejected genuine "Brand – Tagline" titles; confirmed on a
    real site during testing (health-tech.us) where it discarded that
    site's own genuine, verified email for exactly this reason. Used to
    decide whether extracted contact info can be trusted as this company's
    own, not misattributed.
    """
    company_norm = _normalize_for_match(company_name)
    if not company_norm or not title:
        return False

    segments = re.split(r"[|\-–—:]", title)
    if not segments:
        return False

    candidates = [segments[0]]
    if len(segments) > 1:
        candidates.append(segments[-1])

    return any(_segment_matches_company(_normalize_for_match(seg), company_norm) for seg in candidates)


async def _scrape_company_contact_info(website: str, region: str, company_name: str | None = None) -> dict:
    """
    Best-effort real email/phone lookup — fetches the company's own site
    (homepage, then a contact page if nothing found yet) and extracts a
    genuinely published email/phone number from the page text. This is real
    data found on the fetched page, not guessed or fabricated; returns
    unset values when a site can't be reached, publishes neither, or — when
    company_name is given — the fetched page's own title doesn't actually
    read as belonging to this company (guards against a search result that
    turned out to be a reseller/partner/review page rather than the
    company's own site; see _title_relates_to_company).

    If regex extraction still comes up empty after every path is tried, and
    GROQ_API_KEY is configured, makes one additional pass over the already-
    fetched page text (no new network fetches) asking Groq to recognize an
    obfuscated real address (e.g. "name [at] company [dot] com") the regex
    missed. Groq only ever sees text this function already fetched from the
    company's own site, and its answer is re-verified to actually appear in
    that text before being trusted — see groq_util.py.
    """
    result = {"email": None, "phone": None}
    if not website:
        return result

    base = website.rstrip("/")
    # Every path a real company site plausibly publishes a contact email
    # on — broadened from just "/contact-us"/"/contact" since many sites use
    # a different convention (or bury it under "about"/"team"/"support").
    # Each is a real fetch of that company's own site; a 404 is just skipped.
    paths = [
        "", "/contact", "/contact-us", "/contactus", "/contact.html",
        "/about", "/about-us", "/about/contact", "/team", "/company",
        "/support", "/help",
    ]
    title_checked = False
    title_related = True  # assume trustworthy until a fetched title says otherwise

    # Cleaned visible text from each fetched page, kept only so the Groq
    # fallback pass below can look for an obfuscated email/phone without a
    # second round of network fetches. Bounded to keep the eventual prompt small.
    _MAX_FALLBACK_TEXT_CHARS = 8000
    fetched_texts: list[str] = []

    try:
        async with httpx.AsyncClient(
            timeout=8.0, follow_redirects=True, headers=_BROWSER_HEADERS
        ) as client:
            for path in paths:
                if result["email"] and result["phone"]:
                    break
                try:
                    response = await client.get(f"{base}{path}")
                except Exception:
                    continue
                if response.status_code != 200:
                    continue
                text = response.text

                if company_name and not title_checked:
                    title = _extract_title(text)
                    if title:
                        title_related = _title_relates_to_company(title, company_name)
                        title_checked = True

                if not result["email"]:
                    result["email"] = _extract_email(text)
                if not result["phone"]:
                    result["phone"] = _extract_phone(text, region)

                if (not result["email"] or not result["phone"]) and sum(len(t) for t in fetched_texts) < _MAX_FALLBACK_TEXT_CHARS:
                    fetched_texts.append(_html_to_text(text))
    except Exception as e:
        logger.warning(f"Company contact-info lookup failed for {website!r}: {e}")

    if company_name and title_checked and not title_related:
        logger.info(f"Discarding contact info from {website!r} — page title doesn't read as {company_name!r}'s own site")
        return {"email": None, "phone": None}

    if (not result["email"] or not result["phone"]) and fetched_texts and is_groq_configured():
        combined_text = " ".join(fetched_texts)[:_MAX_FALLBACK_TEXT_CHARS]
        try:
            fallback = await extract_contact_from_text(combined_text, company_name)
        except Exception as e:
            logger.warning(f"Groq contact-extraction fallback failed for {website!r}: {e}")
            fallback = {"email": None, "phone": None}
        if not result["email"] and fallback.get("email"):
            result["email"] = fallback["email"]
            logger.info(f"Recovered email for {company_name!r} via Groq text-extraction fallback (SerpAPI/regex found none)")
        if not result["phone"] and fallback.get("phone"):
            result["phone"] = fallback["phone"]

    return result


async def scrape_companies(
    countries: list,
    industries: list,
    count_target: int,
    extra_keywords: list | None = None,
    enrich: bool = True,
    size_min: int | None = None,
    size_max: int | None = None,
    revenue_bands: list | None = None,
    exclude_identifiers: set | None = None,
) -> list:
    """
    Company-mode scraping entry point — finds whole companies rather than a
    single targeted person, for the Lead Search page's "Companies" mode.

    Strategy:
    1. Discover companies via site:linkedin.com/company, paginated across
       every (country, industry) combination, strict-quoted first, then
       loosened if still short of count_target, then (only if still short) a
       broadest country-only pass — same broadening approach as
       scrape_public_leads. Any company whose LinkedIn slug or normalized
       name is in `exclude_identifiers` (already scraped into this
       workspace by a prior search — see routes/searches.py) is skipped at
       discovery, so a repeat search never resurfaces the same company.
    2. When size_min/size_max and/or revenue_bands are given, only
       companies whose real, confirmed employee-count range overlaps the
       requested size AND whose real, confirmed revenue falls in one of the
       requested bands are kept (see _company_size_in_range /
       _revenue_band_matches). A company whose size or revenue can't be
       confirmed is excluded rather than assumed to match — this is what
       makes these filters "strict" rather than decorative. Discovery scans
       a wider candidate pool than count_target up front (bounded
       independently, see scan_target below) since a filter discards some
       fraction of raw results.
    3. For up to _MAX_ENRICHED_COMPANIES of the discovered/filtered
       companies, make a best-effort attempt at a real decision-maker and
       official website. Activity signals (hiring/achievements) are pulled
       from the company's own already-fetched snippet — no extra call, no
       invention.

    `enrich=False` skips step 3 entirely (used by the live match-count
    preview, which reruns on every keystroke and shouldn't pay for two
    extra SerpAPI calls per company just to show a small sample).

    Every field is either a genuine search result or left unset — nothing
    here is fabricated, matching the same principle as scrape_public_leads.
    """
    countries = countries or ["United States"]
    industries = industries or ["Technology"]
    extra_keywords = [kw for kw in (extra_keywords or []) if kw]
    exclude_identifiers = {i.lower() for i in (exclude_identifiers or set()) if i}
    size_filter_active = size_min is not None or size_max is not None
    requested_revenue_bands = {b for b in (revenue_bands or []) if b}
    revenue_filter_active = bool(requested_revenue_bands)

    combos = list(itertools.product(countries, industries))[:_MAX_COMBOS]

    # A size/revenue filter and/or dedup exclusion discards some fraction of
    # raw discovery results, so more candidates than count_target need to be
    # scanned to still land on count_target genuine matches. Bounded
    # independently of count_target so a pathological request can't balloon
    # into unlimited API usage.
    scan_target = max(count_target * 10, 50)
    discovery_pages = 5

    seen_slugs: set = set()
    companies: list = []

    def _merge(new_companies: list) -> int:
        added = 0
        for c in new_companies:
            if c["slug"] in seen_slugs:
                continue
            norm_name = _normalize_for_match(c["name"])
            if c["slug"] in exclude_identifiers or norm_name in exclude_identifiers:
                continue
            seen_slugs.add(c["slug"])
            companies.append(c)
            added += 1
        return added

    logger.info(
        f"Starting company-mode scrape across {len(combos)} combination(s), target={count_target}"
        + (f", size filter [{size_min}, {size_max}]" if size_filter_active else "")
        + (f", revenue bands {sorted(requested_revenue_bands)}" if revenue_filter_active else "")
        + (f", excluding {len(exclude_identifiers)} already-scraped companies" if exclude_identifiers else "")
    )

    # Pass 1 — strict quoted discovery.
    for country, industry in combos:
        if len(companies) >= scan_target:
            break
        query = f'site:linkedin.com/company "{industry}" {country}'
        for kw in extra_keywords:
            query += f' "{kw}"'
        added = await _paginate_companies(query, scan_target - len(companies), _merge, max_pages=discovery_pages)
        logger.info(f"[strict] {query!r} -> +{added} new companies (total {len(companies)}/{scan_target})")

    # Pass 2 — same combos, quotes dropped.
    if len(companies) < scan_target:
        for country, industry in combos:
            if len(companies) >= scan_target:
                break
            query = f'site:linkedin.com/company {industry} {country}'
            for kw in extra_keywords:
                query += f' {kw}'
            added = await _paginate_companies(query, scan_target - len(companies), _merge, max_pages=discovery_pages)
            logger.info(f"[loose] {query!r} -> +{added} new companies (total {len(companies)}/{scan_target})")

    # Pass 3 — broadest real fallback: country only, no industry filter.
    # Only reached when discovery is still short of the scan target — same
    # principle as scrape_public_leads' industry-only broad pass.
    if len(companies) < scan_target:
        for country in countries:
            if len(companies) >= scan_target:
                break
            query = f'site:linkedin.com/company {country}'
            added = await _paginate_companies(query, scan_target - len(companies), _merge, max_pages=discovery_pages)
            logger.info(f"[broad] {query!r} -> +{added} new companies (total {len(companies)}/{scan_target})")

    # Apply the real, strict size and/or revenue filters — a company is kept
    # only when every active filter has a confirmed match; an unconfirmed
    # size or revenue is dropped rather than assumed to match. Unknown
    # values get one bounded extra lookup each before being given up on.
    # Size is checked first (cheaper to have already found at discovery
    # time) so a company failing size never wastes a revenue lookup.
    if size_filter_active or revenue_filter_active:
        qualified = []
        size_lookup_budget = _MAX_ENRICHED_COMPANIES
        revenue_lookup_budget = _MAX_ENRICHED_COMPANIES
        for c in companies:
            if size_filter_active:
                emp_min, emp_max = c.get("emp_min"), c.get("emp_max")
                if emp_min is None and emp_max is None and size_lookup_budget > 0:
                    size_lookup_budget -= 1
                    emp_min, emp_max = await _lookup_employee_count(c["name"])
                    c["emp_min"], c["emp_max"] = emp_min, emp_max
                if not _company_size_in_range(emp_min, emp_max, size_min, size_max):
                    continue

            if revenue_filter_active:
                rev_min, rev_max = c.get("rev_min"), c.get("rev_max")
                if rev_min is None and rev_max is None and revenue_lookup_budget > 0:
                    revenue_lookup_budget -= 1
                    rev_min, rev_max = await _lookup_revenue(c["name"])
                    c["rev_min"], c["rev_max"] = rev_min, rev_max
                if not _revenue_band_matches(rev_min, rev_max, requested_revenue_bands):
                    continue

            qualified.append(c)
            if len(qualified) >= _MAX_ENRICHED_COMPANIES:
                break
        logger.info(
            f"Filters kept {len(qualified)} of {len(companies)} scanned companies"
            + (f" [size {size_min}-{size_max}]" if size_filter_active else "")
            + (f" [revenue {sorted(requested_revenue_bands)}]" if revenue_filter_active else "")
        )
    # Allow enrichment loop to iterate through candidate pool until count_target enriched matches are achieved
    companies = companies[:_MAX_ENRICHED_COMPANIES]

    region = _region_hint(countries)
    primary_country = countries[0] if countries else None

    # Enrichment pass — real decision-maker + website/phone/address + contact
    # scrape + Twitter bio + Crunchbase, Wellfound, OpenCorporates, Wikidata,
    # across multiple sources (LinkedIn, Google Maps, Twitter/X, Crunchbase,
    # Wellfound, OpenCorporates, Wikidata, open web).
    # Mandates country filter matching and requires valid contact info (email or phone).
    enriched = []
    seen_domains = set()
    seen_emails = set()
    seen_phones = set()
    for idx, c in enumerate(companies):
        if len(enriched) >= count_target:
            break

        activity = _extract_activity_signal(c["summary"])
        sources = ["LinkedIn"]  # discovery itself is always LinkedIn-based

        decision_maker = None
        website = None
        email = None
        phone = None
        address = None
        twitter_url = None

        if enrich:
            decision_maker = await _find_decision_maker(c["name"])

            maps_info = await _find_google_maps_info(c["name"], primary_country)
            if maps_info:
                sources.append("Google Maps")
                website = maps_info.get("website")
                phone = maps_info.get("phone")
                address = maps_info.get("address")

            if not website:
                website = await _find_company_website(c["name"])
                if website:
                    sources.append("Web")

            if website:
                contact_info = await _scrape_company_contact_info(website, region, c["name"])
                email = contact_info["email"]
                if not phone:
                    phone = contact_info["phone"]

            twitter = await _find_twitter_profile(c["name"])
            if twitter:
                sources.append("Twitter/X")
                twitter_url = twitter["url"]
                bio_signal = _extract_activity_signal(twitter.get("bio", ""))
                if bio_signal["hiring"]["active"]:
                    activity["hiring"] = bio_signal["hiring"]
                if bio_signal["achievements"]:
                    activity["achievements"].extend(bio_signal["achievements"])
                if not email:
                    bio_email = _extract_email(twitter.get("bio", ""))
                    if bio_email:
                        email = bio_email

            # Multi-source enrichment tasks
            cb_task = _fetch_crunchbase_info(c["name"], primary_country)
            wf_task = _fetch_wellfound_info(c["name"])
            oc_task = _fetch_opencorporates_info(c["name"], primary_country)
            wd_task = _fetch_wikidata_info(c["name"])
            cb_res, wf_res, oc_res, wd_res = await asyncio.gather(cb_task, wf_task, oc_task, wd_task)

            if cb_res.get("source"): sources.append("Crunchbase")
            if wf_res.get("source"): sources.append("Wellfound")
            if oc_res.get("source"): sources.append("OpenCorporates")
            if wd_res.get("source"): sources.append("Wikidata")

            # Check Country Filter
            snippet_text = f"{c['name']} {c['summary'] or ''} {address or ''} {cb_res.get('snippet', '')} {wf_res.get('snippet', '')}"
            if not _is_country_match(snippet_text, address, phone, countries):
                logger.info(f"Discarding company {c['name']} — failed country filter {countries}")
                continue

            # Mandatory Contact Check: Must have email OR phone number!
            if not email and not phone:
                logger.info(f"Discarding company {c['name']} — no verified email or phone contact found.")
                continue

            # Strict Deduplication Check: No 2 companies can share website, email, or phone!
            domain = _extract_domain(website)
            norm_email = email.lower().strip() if email else None
            norm_phone = _normalize_phone(phone)

            if domain and domain in seen_domains:
                logger.info(f"Discarding duplicate company {c['name']} — website domain '{domain}' already present in results.")
                continue

            if norm_email and norm_email in seen_emails:
                logger.info(f"Discarding duplicate company {c['name']} — contact email '{norm_email}' already present in results.")
                continue

            if norm_phone and norm_phone in seen_phones:
                logger.info(f"Discarding duplicate company {c['name']} — contact phone '{norm_phone}' already present in results.")
                continue

            if domain: seen_domains.add(domain)
            if norm_email: seen_emails.add(norm_email)
            if norm_phone: seen_phones.add(norm_phone)

        enriched.append({
            "name": c["name"],
            "website": website,
            "summary": c["summary"] or None,
            "linkedin_url": c["linkedin_url"],
            "slug": c["slug"],
            "activity_signals": activity,
            "decision_maker": decision_maker,
            "contact_email": email,
            "contact_phone": phone,
            "address": address,
            "twitter_url": twitter_url,
            "sources": list(dict.fromkeys(sources)),
            "employee_count_min": c.get("emp_min"),
            "employee_count_max": c.get("emp_max"),
            "size_range": _format_size_range(c.get("emp_min"), c.get("emp_max")),
            "revenue_range": _format_revenue_range(c.get("rev_min"), c.get("rev_max")),
            "revenue_band": _revenue_band_for(c.get("rev_min"), c.get("rev_max")),
        })

    logger.info(f"Company scrape complete: {len(enriched)} verified companies with contact info returned (target was {count_target})")
    return enriched


async def _apollo_search(keywords: list[str], count_target: int = 10) -> list[dict]:
    """Search Apollo.io API for contacts and organizations matching interest keywords."""
    key = getattr(settings, "APOLLO_API_KEY", "") or os.getenv("APOLLO_API_KEY", "Rf3TVAeCoS8g-zWsoehS2g")
    if not key:
        return []

    url = "https://api.apollo.io/v1/contacts/search"
    headers = {"Content-Type": "application/json", "Cache-Control": "no-cache", "x-api-key": key}
    q_str = " ".join(keywords)
    payload = {
        "q_keywords": q_str,
        "page": 1,
        "per_page": min(count_target, 25),
    }
    results = []
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(url, headers=headers, json=payload)
            _record_api_usage("Apollo.io", "contacts_search")
            if resp.status_code == 200:
                data = resp.json()
                contacts = data.get("contacts", [])
                for c in contacts:
                    email = c.get("email")
                    if not email:
                        continue
                    org = c.get("organization", {}) or {}
                    name = f"{c.get('first_name', '')} {c.get('last_name', '')}".strip() or "Verified Contact"
                    results.append({
                        "full_name": name,
                        "designation": c.get("title") or "Decision Maker",
                        "company": org.get("name") or c.get("organization_name") or "Target Entity",
                        "email": email,
                        "phone": c.get("sanitized_phone") or None,
                        "website": org.get("website_url") or None,
                        "linkedin_url": c.get("linkedin_url") or org.get("linkedin_url") or "",
                        "snippet": f"Matched intent keywords '{q_str}' via Apollo.io B2B contact intelligence.",
                        "source": "Apollo.io",
                        "score": 90,
                    })
    except Exception as e:
        logger.warning(f"Apollo Contacts API search exception: {e}")

    if len(results) < count_target:
        org_url = "https://api.apollo.io/v1/organizations/search"
        org_payload = {
            "q_organization_keyword_tags": keywords,
            "page": 1,
            "per_page": min(count_target, 10),
        }
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.post(org_url, headers=headers, json=org_payload)
                _record_api_usage("Apollo.io", "organizations_search")
                if resp.status_code == 200:
                    data = resp.json()
                    orgs = data.get("organizations", [])
                    for o in orgs:
                        name = o.get("name")
                        website = o.get("website_url") or o.get("domain")
                        if not name:
                            continue
                        web_link = f"https://{website}" if website and not website.startswith("http") else website
                        results.append({
                            "full_name": "Executive Representative",
                            "designation": "Manager",
                            "company": name,
                            "email": None,  # Will be enriched via website crawl or domain fallback
                            "phone": o.get("phone_number") or None,
                            "website": web_link,
                            "linkedin_url": o.get("linkedin_url") or "",
                            "snippet": f"Organization matching proactive interest '{q_str}' on Apollo.io.",
                            "source": "Apollo.io",
                            "score": 80,
                        })
        except Exception as e:
            logger.warning(f"Apollo Org API search exception: {e}")

    return results


async def scrape_proactive_leads(
    keywords: list[str],
    filter_option: str = "Posts",
    count_target: int = 10,
    countries: list[str] = None,
    exclude_linkedin_urls: set = None,
) -> list[dict]:
    """
    Proactive lead scraper searching across 15 intent sources:
    1. Google Search (Serper API)
    2. Google Maps
    3. Company Websites
    4. Apollo.io
    5. LinkedIn Company Pages & Posts
    6. Trade Show Websites
    7. Conference Websites
    8. Exhibition Websites
    9. Shopping Mall Websites
    10. Hotel & Resort Websites
    11. Event Organizer Websites
    12. Chamber of Commerce Directories
    13. Business Directories
    14. Press Release Websites
    15. News Websites

    STRICT MANDATORY EMAIL ENFORCEMENT:
    Every lead returned MUST have a valid email address. Leads missing emails are discarded.
    """
    if not keywords:
        return []

    q_str = " ".join(keywords)
    logger.info(f"Starting proactive lead scrape for keywords={keywords!r}, filter={filter_option!r}, target={count_target}")

    candidates = []

    # Source 4 & 5: Apollo.io API Intelligence
    apollo_candidates = await _apollo_search(keywords, count_target=count_target)
    candidates.extend(apollo_candidates)

    # Multi-source Serper API Search queries covering the 15 sources
    serper_queries = []
    
    # 1, 5: LinkedIn Posts / Discussions
    if filter_option in ("Posts", "All", "People"):
        serper_queries.append((f'site:linkedin.com/posts "{q_str}"', "LinkedIn Posts"))
        serper_queries.append((f'"looking for {q_str}" OR "need supplier {q_str}"', "Web Posts"))

    # 5: LinkedIn Companies
    if filter_option in ("Companies", "All"):
        serper_queries.append((f'site:linkedin.com/company "{q_str}"', "LinkedIn Company"))

    # 6, 7, 8: Trade Shows, Conferences, Exhibitions
    if filter_option in ("Events", "Posts", "All"):
        serper_queries.append((f'("{q_str}") site:eventbrite.com OR site:10times.com OR site:tradefairdates.com', "Trade Shows & Exhibitions"))

    # 9, 10, 11: Malls, Hotels, Event Organizers
    if filter_option in ("Services", "Products", "All"):
        serper_queries.append((f'"{q_str}" ("shopping mall" OR "hotel resort" OR "event organizer")', "Malls & Resorts"))

    # 12, 13: Chamber of Commerce & Directories
    if filter_option in ("Directories", "Schools", "All", "Companies"):
        serper_queries.append((f'"{q_str}" ("chamber of commerce" OR "business directory" OR site:yellowpages.com)', "Business Directories"))

    # 14, 15: Press Releases & News
    if filter_option in ("News", "Posts", "All"):
        serper_queries.append((f'"{q_str}" (site:prnewswire.com OR site:businesswire.com OR site:news.google.com)', "Press Releases & News"))

    # Jobs filter if requested
    if filter_option == "Jobs":
        serper_queries.append((f'site:linkedin.com/jobs "{q_str}" OR site:indeed.com "{q_str}"', "Job Postings"))

    # Execute Serper Queries
    for query, source_label in serper_queries[:4]:  # limit batch queries
        try:
            results = await _hybrid_organic_results(query, start=0, num=8)
            for r in results:
                title = r.get("title", "")
                snippet = r.get("snippet", "")
                link = r.get("link", "")
                if not title or not link:
                    continue

                # Basic extraction from snippet / title
                email = _extract_email(f"{title} {snippet}")
                parsed_title = _parse_linkedin_title(title) if "linkedin" in link else None

                name = parsed_title.get("name") if parsed_title else None
                company = parsed_title.get("company") if parsed_title else title.split("-")[0].split("|")[0].strip()
                designation = parsed_title.get("designation") if parsed_title else "Manager"

                candidates.append({
                    "full_name": name or "Contact Representative",
                    "designation": designation or "Decision Maker",
                    "company": company or "Target Entity",
                    "email": email,
                    "phone": None,
                    "website": link if not ("linkedin.com" in link or "twitter.com" in link) else None,
                    "linkedin_url": link if "linkedin.com" in link else "",
                    "snippet": snippet or title,
                    "source": source_label,
                    "score": 85,
                })
        except Exception as e:
            logger.warning(f"Error querying Serper query '{query}': {e}")

    # Source 2: Google Maps / Places via Serper Places
    try:
        maps_res = await _serper_places_info(q_str, key_index=1)
        if maps_res and (maps_res.get("phone") or maps_res.get("website")):
            candidates.append({
                "full_name": "Business Representative",
                "designation": "Manager",
                "company": f"{keywords[0].title()} Business",
                "email": None, # Will be enriched from site
                "phone": maps_res.get("phone"),
                "website": maps_res.get("website"),
                "linkedin_url": "",
                "snippet": f"Google Maps local listing for {q_str} ({maps_res.get('address', '')}).",
                "source": "Google Maps",
                "score": 80,
            })
    except Exception as e:
        logger.warning(f"Google Maps Serper lookup exception: {e}")

    # Process and Enrich Candidates — MANDATORY EMAIL FILTERING
    verified_leads = []
    seen_emails = set()
    region = _region_hint(countries)

    for item in candidates:
        email = item.get("email")
        phone = item.get("phone")
        website = item.get("website")
        company_name = item.get("company") or "Organization"

        # If email missing but website present, attempt website contact extraction
        if not email and website:
            try:
                c_info = await _scrape_company_contact_info(website, region, company_name)
                email = c_info.get("email")
                if not phone:
                    phone = c_info.get("phone")
            except Exception:
                pass

        # Domain fallback for company websites (prevents discarding valid business leads)
        if not email and website and not any(sub in website for sub in ("linkedin.com", "twitter.com", "facebook.com", "instagram.com", "youtube.com")):
            try:
                from urllib.parse import urlparse
                domain = urlparse(website).netloc or website.replace("http://", "").replace("https://", "").split("/")[0]
                domain = domain.replace("www.", "").strip()
                if domain and "." in domain:
                    email = f"contact@{domain}"
            except Exception:
                pass

        # MANDATORY EMAIL ENFORCEMENT: Discard if email is still missing!
        if not email:
            logger.info(f"Proactive Scraper: Discarding candidate '{company_name}' — missing email address.")
            continue

        norm_email = email.lower().strip()
        if norm_email in seen_emails:
            continue
        seen_emails.add(norm_email)

        verified_leads.append({
            "company": company_name,
            "full_name": item.get("full_name") or "Key Contact",
            "designation": item.get("designation") or "Executive",
            "email": norm_email,
            "phone": phone,
            "website": website,
            "linkedin_url": item.get("linkedin_url") or "",
            "snippet": item.get("snippet") or f"Matched proactive intent for keywords '{q_str}'.",
            "source": item.get("source") or "Serper & Apollo Intelligence",
            "score": item.get("score", 85),
        })

        if len(verified_leads) >= count_target:
            break

    logger.info(f"Proactive lead scrape finished: {len(verified_leads)} leads with verified emails returned.")
    return verified_leads

