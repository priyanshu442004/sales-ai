import os
from dotenv import load_dotenv

# Load workspace .env files
load_dotenv()

class Settings:
    PROJECT_NAME: str = "Sales AI API"
    API_V1_STR: str = "/api/v1"
    
    # Database (uses async sqlite by default, but can be overridden to PostgreSQL asyncpg)
    raw_db_url = os.getenv("DATABASE_URL", "sqlite+aiosqlite:///./salesai.db")
    if raw_db_url.startswith("postgresql://"):
        DATABASE_URL = raw_db_url.replace("postgresql://", "postgresql+asyncpg://", 1)
    else:
        DATABASE_URL = raw_db_url
    
    # Redis
    REDIS_URL: str = os.getenv("REDIS_URL", "redis://localhost:6379/0")
    
    # Security
    SECRET_KEY: str = os.getenv("SECRET_KEY", "super-secret-sales-ai-cryptographic-signing-key-2026")
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 1440  # 24 hours
    
    # API Keys & Integrations
    ANTHROPIC_API_KEY: str = os.getenv("ANTHROPIC_API_KEY", "")
    SENDGRID_API_KEY: str = os.getenv("SENDGRID_API_KEY", "")
    SERPAPI_KEY: str = os.getenv("SERPAPI_KEY", "")
    # Used automatically whenever the primary key is rate-limited or out of
    # quota (HTTP 429 / "run out of searches") — same real SerpAPI results,
    # just a different account, so scraping keeps working instead of
    # silently going quiet the moment one plan's monthly quota is spent.
    SERPAPI_KEY_FALLBACK: str = os.getenv("SERPAPI_KEY_FALLBACK", "")

    # Serper API Keys (Primary 2,500 credits, Secondary 2,500 credits)
    SERPER_API_KEY_1: str = os.getenv("SERPER_API_KEY_1", "")
    SERPER_API_KEY_2: str = os.getenv("SERPER_API_KEY_2", "")

    # Apollo API Key (Org & Contact Intelligence)
    APOLLO_API_KEY: str = os.getenv("APOLLO_API_KEY", "Rf3TVAeCoS8g-zWsoehS2g")

    # Groq — used ONLY as a text-extraction fallback when SerpAPI/regex
    # scraping can't find an email or phone on a company's own already-fetched
    # website text (e.g. an obfuscated "name [at] company [dot] com" format a
    # plain regex misses). Never used to guess/invent contact info that isn't
    # literally present in the fetched page.
    GROQ_API_KEY: str = os.getenv("GROQ_API_KEY", "")
    GROQ_MODEL: str = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")

    # Outbound email (SMTP) — used to actually send cold emails to scraped leads
    SMTP_HOST: str = os.getenv("SMTP_HOST", "")
    SMTP_PORT: int = int(os.getenv("SMTP_PORT", "587"))
    SMTP_USER: str = os.getenv("SMTP_USER", "")
    SMTP_PASS: str = os.getenv("SMTP_PASS", "")

    # S3 — persists email attachments (source of truth for send-history + what actually gets attached)
    AWS_ACCESS_KEY_ID: str = os.getenv("AWS_ACCESS_KEY_ID", "")
    AWS_SECRET_ACCESS_KEY: str = os.getenv("AWS_SECRET_ACCESS_KEY", "")
    AWS_REGION: str = os.getenv("AWS_REGION", "us-east-1")
    AWS_BUCKET_NAME: str = os.getenv("AWS_BUCKET_NAME", "")
    
    # MFA Settings
    MFA_ENABLED: bool = True

    # Where the frontend actually lives — used to build a real, clickable
    # login link in team-invite emails. Defaults to the Vite dev server.
    FRONTEND_URL: str = os.getenv("FRONTEND_URL", "http://localhost:5173")

settings = Settings()
