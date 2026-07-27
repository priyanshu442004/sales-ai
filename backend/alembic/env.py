import asyncio
import sys
from logging.config import fileConfig
from pathlib import Path

from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import create_async_engine

from alembic import context

# Make `app.*` importable regardless of the working directory alembic is
# invoked from (the app package lives at backend/app, and alembic.ini's
# script_location is backend/alembic).
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.db import Base, get_async_db_url_and_connect_args  # noqa: E402
from app import models  # noqa: E402,F401 — import registers every mapped class on Base.metadata

# this is the Alembic Config object, which provides
# access to the values within the .ini file in use.
config = context.config

# Interpret the config file for Python logging.
# This line sets up loggers basically.
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Autogenerate support — reflects every model in app/models.py. The actual
# connection URL is resolved at runtime from the app's own settings (below),
# not from a static value in alembic.ini, so the same migrations apply
# correctly whether DATABASE_URL points at Neon Postgres or a local/test
# sqlite file.
target_metadata = Base.metadata


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode."""
    url, _ = get_async_db_url_and_connect_args()
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    context.configure(connection=connection, target_metadata=target_metadata)

    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    """Create an engine using the same URL-cleaning logic as the app's own
    engine (app.db.get_async_db_url_and_connect_args), and run migrations
    against it."""
    url, connect_args = get_async_db_url_and_connect_args()

    connectable = create_async_engine(
        url,
        connect_args=connect_args,
        poolclass=pool.NullPool,
    )

    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)

    await connectable.dispose()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode."""
    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
