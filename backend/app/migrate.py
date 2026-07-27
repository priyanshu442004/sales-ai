"""
Database schema migrations — Alembic-backed.

Replaces the earlier hand-rolled additive-column list: schema changes now
live as versioned migration files under alembic/versions/, generated with
`alembic revision --autogenerate -m "..."` and reviewed before commit. This
runs `alembic upgrade head` once at startup so a deploy always converges the
live database (Postgres in production, sqlite in tests/local dev) to
whatever migrations are checked in — no manual step, and unlike the old
approach, actual column types/constraints/renames can change safely instead
of only ever adding a nullable column.
"""
import asyncio
import logging
from pathlib import Path

from alembic import command
from alembic.config import Config

logger = logging.getLogger("salesai.migrate")

_ALEMBIC_INI = Path(__file__).resolve().parent.parent / "alembic.ini"


def _run_upgrade():
    cfg = Config(str(_ALEMBIC_INI))
    command.upgrade(cfg, "head")


async def run_migrations():
    """Applies any pending Alembic migrations. Safe to call on every
    startup — a no-op when the database is already at head. Runs in a
    worker thread since Alembic's command API is synchronous and its async
    env.py internally calls asyncio.run(), which cannot nest inside the
    already-running event loop of the FastAPI lifespan."""
    logger.info("Applying database migrations (alembic upgrade head)...")
    await asyncio.to_thread(_run_upgrade)
    logger.info("Database schema is up to date.")
