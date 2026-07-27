"""
Pytest fixtures for the Lead Search + Job Queue API test suite.

These tests hit the real FastAPI app (real routes, real background scrape
pipeline, real SerpAPI calls) but point at a disposable local sqlite file
instead of the shared Postgres database, so they never touch production data.
"""
import os
import sys
import pathlib

TEST_DB_PATH = pathlib.Path(__file__).parent / "test_salesai.db"

# Must happen before `app.config`/`app.db` are imported anywhere, since the
# async engine is created at import time from this env var.
os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{TEST_DB_PATH}"

sys.path.insert(0, str(pathlib.Path(__file__).parent.parent))

import pytest
from fastapi.testclient import TestClient


@pytest.fixture(scope="session", autouse=True)
def _cleanup_test_db():
    yield
    try:
        if TEST_DB_PATH.exists():
            TEST_DB_PATH.unlink()
    except OSError:
        # Windows can still hold a file lock briefly after the async sqlite
        # engine's connections close; leaving the temp file behind is harmless.
        pass


@pytest.fixture(scope="session")
def client():
    from app.main import app
    from app.db import engine

    with TestClient(app) as c:
        yield c

    import asyncio
    asyncio.run(engine.dispose())


@pytest.fixture(scope="session")
def auth_headers(client):
    resp = client.post("/api/v1/auth/login", json={"email": "admin@gmail.com", "password": "admin"})
    assert resp.status_code == 200, resp.text
    token = resp.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}
