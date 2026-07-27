from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import declarative_base
from app.config import settings

import urllib.parse


def get_async_db_url_and_connect_args():
    """
    Resolve settings.DATABASE_URL into (url, connect_args) actually usable by
    an async SQLAlchemy engine — asyncpg doesn't accept the `sslmode` /
    `channel_binding` query params Neon's connection string includes, so
    those get stripped and re-expressed as a connect_args `ssl` flag instead.
    Shared by the app's own engine below and by alembic/env.py, so migrations
    always connect exactly the same way the app does.
    """
    connect_args = {}
    db_url = settings.DATABASE_URL

    if db_url.startswith("sqlite"):
        connect_args = {"check_same_thread": False}
    elif "postgresql" in db_url:
        parsed = urllib.parse.urlparse(db_url)
        query_params = urllib.parse.parse_qs(parsed.query)
        query_params.pop("sslmode", None)
        query_params.pop("channel_binding", None)
        new_query = urllib.parse.urlencode(query_params, doseq=True)
        db_url = urllib.parse.urlunparse((
            parsed.scheme,
            parsed.netloc,
            parsed.path,
            parsed.params,
            new_query,
            parsed.fragment
        ))
        connect_args = {"ssl": True}

    return db_url, connect_args


db_url, connect_args = get_async_db_url_and_connect_args()

engine = create_async_engine(
    db_url,
    connect_args=connect_args,
    echo=False
)

SessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False
)

Base = declarative_base()

async def get_db():
    async with SessionLocal() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()
