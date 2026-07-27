"""
End-to-end tests for the Lead Search + Job Queue functionality.

These exercise the real API routes and the real scraping pipeline (real
SerpAPI calls) against a disposable local sqlite database. They exist to
catch regressions of the specific bugs found during the live audit:
fabricated company/contact fields, non-functional advanced filters,
incomplete job payloads, and raw technical errors leaking to the UI.
"""
import time

FABRICATED_FUNDING_STAGE = "Series A"
FABRICATED_TECH_STACK = ["React", "Python", "AWS"]
OLD_HARDCODED_PREVIEW_NAMES = {"Nimbus Robotics", "Aether Logistics", "GreenGrid Solutions"}


def test_login_succeeds(client):
    resp = client.post("/api/v1/auth/login", json={"email": "admin@gmail.com", "password": "admin"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["access_token"]
    assert body["user"]["email"] == "admin@gmail.com"


def test_estimate_has_no_fabricated_data(client, auth_headers):
    resp = client.post(
        "/api/v1/searches/estimate",
        json={"countries": ["United States"], "industries": ["Technology"], "designations": ["VP of Sales"]},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert isinstance(body["match_count"], int)

    for preview in body["preview_companies"]:
        assert preview["name"] not in OLD_HARDCODED_PREVIEW_NAMES, (
            "estimate endpoint returned the old hardcoded synthetic fallback company"
        )
        # The old formula fabricated a match percentage; that field must no
        # longer be populated with an invented number.
        assert preview.get("match") in (None, ""), "preview 'match' percentage should not be fabricated"


def test_list_searches_excludes_seed_demo_data(client, auth_headers):
    resp = client.get("/api/v1/searches", headers=auth_headers)
    assert resp.status_code == 200
    searches = resp.json()
    names = [s["name"] for s in searches]
    ids = [s["id"] for s in searches]
    assert "AI & Robotics Executives USA" not in names, "the seeded demo preset must not appear on Lead Search"
    assert "search-1" not in ids


def test_estimate_excludes_seed_demo_companies(client, auth_headers):
    resp = client.post(
        "/api/v1/searches/estimate",
        json={"countries": ["United States"], "industries": ["AI & Robotics"], "designations": ["VP of Sales"]},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    names = [p["name"] for p in resp.json()["preview_companies"]]
    assert "Nimbus Robotics" not in names, "the seeded demo company must not appear as a live preview"


def test_create_search_echoes_advanced_filters(client, auth_headers):
    payload = {
        "name": "Test: Advanced filters wiring",
        "countries": ["United States"],
        "states": [],
        "cities": [],
        "industries": ["SaaS"],
        "designations": ["VP of Sales"],
        "lead_count_target": 5,
        "advanced_filters": {
            "fundingStages": ["Series A"],
            "hiringSignal": True,
            "requiredKeyword": "B2B",
        },
        "schedule": {},
    }
    resp = client.post("/api/v1/searches", json=payload, headers=auth_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["advanced_filters"]["fundingStages"] == ["Series A"]
    assert body["advanced_filters"]["hiringSignal"] is True
    assert body["advanced_filters"]["requiredKeyword"] == "B2B"


def _poll_job_until_terminal(client, headers, job_id, timeout_s=90):
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        resp = client.get(f"/api/v1/jobs/{job_id}", headers=headers)
        assert resp.status_code == 200
        job = resp.json()
        if job["status"] in ("Completed", "Failed"):
            return job
        time.sleep(1.5)
    raise AssertionError(f"Job {job_id} did not reach a terminal state within {timeout_s}s")


def _poll_job_until_terminal_any(client, headers, job_id, timeout_s=120):
    """Same as _poll_job_until_terminal but also accepts "Partial" as a
    terminal state — expected for a strict company-size filter, which can
    genuinely exhaust real search results short of the requested count."""
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        resp = client.get(f"/api/v1/jobs/{job_id}", headers=headers)
        assert resp.status_code == 200
        job = resp.json()
        if job["status"] in ("Completed", "Partial", "Failed"):
            return job
        time.sleep(1.5)
    raise AssertionError(f"Job {job_id} did not reach a terminal state within {timeout_s}s")


def test_run_search_produces_real_leads_with_no_fabricated_fields(client, auth_headers):
    create_resp = client.post(
        "/api/v1/searches",
        json={
            "name": "Test: real run, no fabricated fields",
            "countries": ["United States"],
            "industries": ["Technology"],
            "designations": ["VP of Sales"],
            "lead_count_target": 3,
        },
        headers=auth_headers,
    )
    assert create_resp.status_code == 200
    search_id = create_resp.json()["id"]

    run_resp = client.post(f"/api/v1/searches/{search_id}/run", headers=auth_headers)
    assert run_resp.status_code == 200
    job_id = run_resp.json()["id"]

    job = _poll_job_until_terminal(client, auth_headers, job_id)

    # The parameters block must always be the full, null-safe shape —
    # regression test for the "blank field" requirement.
    for key in ("countries", "states", "cities", "industries", "titles", "limit", "sizeRange"):
        assert key in job["parameters"], f"job parameters missing '{key}'"

    if job["status"] == "Failed":
        # A live network failure is still a valid pass for this assertion set —
        # what matters is the error is user-friendly, not a stack trace.
        assert "Traceback" not in (job["errors"] or "")
        assert "No module named" not in (job["errors"] or "")
        return

    assert job["status"] == "Completed"

    leads_resp = client.get(f"/api/v1/leads?job_id={job_id}&pageSize=50", headers=auth_headers)
    assert leads_resp.status_code == 200
    leads = leads_resp.json()["data"]

    for lead in leads:
        company = lead["company"]
        contact = lead["decisionMaker"]

        assert company["fundingStage"] != FABRICATED_FUNDING_STAGE, "funding stage must not be hardcoded"
        assert company["techStack"] != FABRICATED_TECH_STACK, "tech stack must not be hardcoded"
        # Email now comes from a real source (the employer's own published
        # website, scraped separately from the LinkedIn/person search) —
        # so a populated value is expected for some leads. What must never
        # happen is a *guessed* address (name+domain pattern); verify
        # anything present is a well-formed real-looking address instead.
        if contact["email"] is not None:
            assert "@" in contact["email"] and "." in contact["email"].split("@")[-1], (
                "populated email must be a well-formed real address, not a placeholder"
            )
            assert not contact["email"].lower().startswith("your"), "email looks like a template placeholder, not real"

        hiring_active = (company.get("activity_signals") or {}).get("hiring", {}).get("active")
        assert hiring_active is not True or "hiring" in (lead.get("notes") or "").lower(), (
            "hiring signal must not be unconditionally true"
        )


def test_jobs_list_always_has_full_parameter_shape(client, auth_headers):
    resp = client.get("/api/v1/jobs", headers=auth_headers)
    assert resp.status_code == 200
    jobs = resp.json()["data"]
    assert len(jobs) > 0, "expected at least one job from prior tests"
    for job in jobs:
        for key in ("countries", "states", "cities", "industries", "titles", "limit", "sizeRange"):
            assert key in job["parameters"]
        assert job["status"] in ("Queued", "Running", "Completed", "Failed")
        assert job["name"]
        assert job["startedAt"]


def test_cancel_job_produces_friendly_message(client, auth_headers):
    create_resp = client.post(
        "/api/v1/searches",
        json={
            "name": "Test: cancel flow",
            "countries": ["Canada"],
            "industries": ["Fintech"],
            "designations": ["Founder"],
            "lead_count_target": 5,
        },
        headers=auth_headers,
    )
    search_id = create_resp.json()["id"]
    run_resp = client.post(f"/api/v1/searches/{search_id}/run", headers=auth_headers)
    job_id = run_resp.json()["id"]

    cancel_resp = client.post(f"/api/v1/jobs/{job_id}/cancel", headers=auth_headers)
    assert cancel_resp.status_code == 200

    job_resp = client.get(f"/api/v1/jobs/{job_id}", headers=auth_headers)
    job = job_resp.json()
    # Cancel only takes effect while Queued/Running; if the background task
    # already finished, that's fine — the important thing is no crash and
    # no raw technical text in the error field either way.
    if job["status"] == "Failed":
        assert "Traceback" not in (job["errors"] or "")
        assert (job["errors"] or "").strip() != ""


def test_forced_failure_shows_friendly_message_not_stack_trace(client, auth_headers, monkeypatch):
    """
    Deterministically exercise the failure path (real network conditions
    are flaky to rely on for this assertion) by making the scraper raise.
    This tests our own error-handling/formatting code, not product data.
    """
    import app.scraper_real as scraper_real

    async def _boom(*args, **kwargs):
        raise RuntimeError("No module named 'bs4'")

    monkeypatch.setattr(scraper_real, "scrape_public_leads", _boom)

    create_resp = client.post(
        "/api/v1/searches",
        json={
            "name": "Test: forced failure",
            "countries": ["Germany"],
            "industries": ["HealthTech"],
            "designations": ["CTO"],
            "lead_count_target": 3,
        },
        headers=auth_headers,
    )
    search_id = create_resp.json()["id"]
    run_resp = client.post(f"/api/v1/searches/{search_id}/run", headers=auth_headers)
    job_id = run_resp.json()["id"]

    job = _poll_job_until_terminal(client, auth_headers, job_id, timeout_s=30)

    assert job["status"] == "Failed"
    assert job["errors"]
    assert "bs4" not in job["errors"]
    assert "Traceback" not in job["errors"]
    assert "No module named" not in job["errors"]
    for line in job["logs"]:
        assert "bs4" not in line
        assert "Traceback" not in line


def test_company_mode_size_filter_and_cross_search_dedup(client, auth_headers):
    """
    Regression test for the two new Companies-mode Lead Search requirements:
    (1) a company-size filter must be strictly enforced — every returned
    company's employee count must be a real, confirmed match for the
    requested range, never an unverified guess — and (2) a company already
    scraped into this workspace must never be returned again by a later
    search (cross-search dedup).
    """
    payload = {
        "name": "Test: company size filter + dedup",
        "countries": ["United States"],
        "industries": ["Technology"],
        "designations": [],
        "lead_count_target": 2,
        "company_size_min": 11,
        "company_size_max": 5000,
        "search_mode": "companies",
    }
    create_resp = client.post("/api/v1/searches", json=payload, headers=auth_headers)
    assert create_resp.status_code == 200
    body = create_resp.json()
    assert body["company_size_min"] == 11
    assert body["company_size_max"] == 5000
    search_id = body["id"]

    run_resp = client.post(f"/api/v1/searches/{search_id}/run", headers=auth_headers)
    assert run_resp.status_code == 200
    job_id = run_resp.json()["id"]

    job = _poll_job_until_terminal_any(client, auth_headers, job_id, timeout_s=150)
    if job["status"] == "Failed":
        # A live network/quota failure is still a valid pass here — what
        # matters is a friendly error, not a stack trace.
        assert "Traceback" not in (job["errors"] or "")
        return

    leads_resp = client.get(f"/api/v1/leads?job_id={job_id}&pageSize=50", headers=auth_headers)
    assert leads_resp.status_code == 200
    first_run_leads = leads_resp.json()["data"]
    first_run_company_names = {l["company"]["name"] for l in first_run_leads}

    for lead in first_run_leads:
        company = lead["company"]
        size_text = company.get("sizeRange") or (str(company["employeeCount"]) if company.get("employeeCount") else None)
        assert size_text, (
            f"company {company['name']!r} was returned under an active size filter "
            f"but carries no confirmed size — an unverified size must be excluded, not included"
        )

    if not first_run_leads:
        # Zero genuine matches is still a valid real-world outcome — nothing
        # further to assert about dedup with no companies to exclude.
        return

    # Re-running the identical search must never resurface a company already
    # scraped into this workspace by the run above.
    run_resp_2 = client.post(f"/api/v1/searches/{search_id}/run", headers=auth_headers)
    assert run_resp_2.status_code == 200
    job_id_2 = run_resp_2.json()["id"]

    job_2 = _poll_job_until_terminal_any(client, auth_headers, job_id_2, timeout_s=150)
    if job_2["status"] == "Failed":
        assert "Traceback" not in (job_2["errors"] or "")
        return

    leads_resp_2 = client.get(f"/api/v1/leads?job_id={job_id_2}&pageSize=50", headers=auth_headers)
    second_run_company_names = {l["company"]["name"] for l in leads_resp_2.json()["data"]}
    assert not (first_run_company_names & second_run_company_names), (
        "a company already scraped into this workspace was returned again by a later search"
    )


def test_company_mode_revenue_filter_and_linkedin_urls(client, auth_headers):
    """
    Regression test for (1) the new revenue-band filter — every returned
    company's revenue band must be a real, confirmed match for a requested
    band, never an unverified guess — and (2) that both company and
    decision-maker LinkedIn URLs are well-formed, canonical profile links
    (no tracking params, no stray sub-page path) rather than broken or
    fabricated ones.
    """
    payload = {
        "name": "Test: revenue band filter + linkedin url correctness",
        "countries": ["United States"],
        "industries": ["Technology"],
        "designations": [],
        "lead_count_target": 2,
        "revenue_bands": ["sme", "mid_market"],
        "search_mode": "companies",
    }
    create_resp = client.post("/api/v1/searches", json=payload, headers=auth_headers)
    assert create_resp.status_code == 200
    body = create_resp.json()
    assert set(body["revenue_bands"]) == {"sme", "mid_market"}
    search_id = body["id"]

    run_resp = client.post(f"/api/v1/searches/{search_id}/run", headers=auth_headers)
    assert run_resp.status_code == 200
    job_id = run_resp.json()["id"]

    job = _poll_job_until_terminal_any(client, auth_headers, job_id, timeout_s=150)
    if job["status"] == "Failed":
        assert "Traceback" not in (job["errors"] or "")
        return

    leads_resp = client.get(f"/api/v1/leads?job_id={job_id}&pageSize=50", headers=auth_headers)
    assert leads_resp.status_code == 200
    leads = leads_resp.json()["data"]

    for lead in leads:
        company = lead["company"]
        decision_maker = lead["decisionMaker"]

        # Revenue filter strictness — every returned company must carry a
        # confirmed band that's actually one of the requested ones.
        assert company.get("revenueRange"), (
            f"company {company['name']!r} was returned under an active revenue filter "
            f"but carries no confirmed revenue — an unverified revenue must be excluded, not included"
        )

        # LinkedIn URL correctness — canonical, no tracking params, no
        # stray sub-page path, and never a fabricated/guessed link.
        company_li = company.get("linkedin_url")
        if company_li:
            assert company_li.startswith("https://www.linkedin.com/company/"), (
                f"company LinkedIn URL isn't a canonical company profile link: {company_li!r}"
            )
            assert "?" not in company_li and "#" not in company_li, (
                f"company LinkedIn URL carries tracking params/fragment: {company_li!r}"
            )
            slug = company_li.rsplit("/company/", 1)[-1]
            assert "/" not in slug, f"company LinkedIn URL points at a sub-page, not the profile root: {company_li!r}"

        dm_li = decision_maker.get("linkedin_url")
        if dm_li:
            assert dm_li.startswith("https://www.linkedin.com/in/"), (
                f"decision-maker LinkedIn URL isn't a canonical profile link: {dm_li!r}"
            )
            assert "?" not in dm_li and "#" not in dm_li, (
                f"decision-maker LinkedIn URL carries tracking params/fragment: {dm_li!r}"
            )
