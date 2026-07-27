from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import logging

from app.config import settings
from app.db import SessionLocal
from app.seed import seed_db
from app.migrate import run_migrations

# Sub-routers
from app.routes import auth, leads, searches, jobs, messages, templates, sequences, campaigns, inbox, integrations, team, audit_log, webhooks, notifications, dashboard, analytics, workspaces

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("salesai.main")

import asyncio
from app.scheduler import start_scheduler

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Applying database schema migrations...")
    await run_migrations()

    logger.info("Seeding initial demo data...")
    async with SessionLocal() as db:
        await seed_db(db)
        
    # Start the background task scheduler
    asyncio.create_task(start_scheduler())
    
    logger.info("Sales AI Backend Service successfully started.")
    yield
    logger.info("Sales AI Backend Service shutting down.")

app = FastAPI(
    title=settings.PROJECT_NAME,
    lifespan=lifespan,
    version="1.0.0"
)

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # In development, allow all origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include v1 endpoints
api_prefix = settings.API_V1_STR
app.include_router(auth.router, prefix=api_prefix)
app.include_router(workspaces.router, prefix=api_prefix)
app.include_router(leads.router, prefix=api_prefix)
app.include_router(searches.router, prefix=api_prefix)
app.include_router(jobs.router, prefix=api_prefix)
app.include_router(messages.router, prefix=api_prefix)
app.include_router(templates.router, prefix=api_prefix)
app.include_router(sequences.router, prefix=api_prefix)
app.include_router(campaigns.router, prefix=api_prefix)
app.include_router(inbox.router, prefix=api_prefix)
app.include_router(integrations.router, prefix=api_prefix)
app.include_router(team.router, prefix=api_prefix)
app.include_router(audit_log.router, prefix=api_prefix)
app.include_router(webhooks.router, prefix=api_prefix)
app.include_router(notifications.router, prefix=api_prefix)
app.include_router(dashboard.router, prefix=api_prefix)
app.include_router(analytics.router, prefix=api_prefix)

@app.get("/health", tags=["health"])
async def health_check():
    return {"status": "healthy", "service": "Sales AI Backend"}
