import uuid
from datetime import datetime
from sqlalchemy import Column, String, Integer, Boolean, DateTime, ForeignKey, Table, JSON, Float
from sqlalchemy.orm import relationship
from app.db import Base

def gen_uuid():
    return str(uuid.uuid4())

class Organization(Base):
    __tablename__ = "organizations"

    id = Column(String, primary_key=True, default=gen_uuid)
    name = Column(String, nullable=False)
    plan = Column(String, default="Enterprise")
    created_at = Column(DateTime, default=datetime.utcnow)
    settings = Column(JSON, default=dict)

    users = relationship("User", back_populates="organization", cascade="all, delete-orphan")
    workspaces = relationship("Workspace", back_populates="organization", cascade="all, delete-orphan")
    saved_searches = relationship("SavedSearch", back_populates="organization")
    companies = relationship("Company", back_populates="organization")
    leads = relationship("Lead", back_populates="organization")
    messages = relationship("Message", back_populates="organization")
    sequences = relationship("Sequence", back_populates="organization")
    integrations = relationship("Integration", back_populates="organization")
    audit_logs = relationship("AuditLog", back_populates="organization")

class Workspace(Base):
    """
    A sub-tenant inside an Organization — each workspace has its own fully
    isolated leads/companies/jobs/messages/templates/sequences/conversations/
    integrations. An org always has at least one workspace (the seeded/
    migrated `is_default` one); users switch between whichever workspaces
    their org owns (org-wide visibility — no separate membership table).
    """
    __tablename__ = "workspaces"

    id = Column(String, primary_key=True, default=gen_uuid)
    org_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    name = Column(String, nullable=False)
    is_default = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    created_by = Column(String, nullable=True)

    organization = relationship("Organization", back_populates="workspaces")

class User(Base):
    __tablename__ = "users"

    id = Column(String, primary_key=True, default=gen_uuid)
    org_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    email = Column(String, unique=True, nullable=False, index=True)
    hashed_password = Column(String, nullable=False)
    name = Column(String, nullable=False)
    role = Column(String, default="Sales Rep") # Admin, Sales Manager, Sales Rep, Reviewer-only
    mfa_secret = Column(String, nullable=True)
    status = Column(String, default="Active") # Active, Invited, Suspended
    last_active_at = Column(DateTime, default=datetime.utcnow)
    avatar_url = Column(String, nullable=True)
    invited_by_id = Column(String, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)  # who invited this user, if invited (vs. the org's original seed user)
    default_workspace_id = Column(String, ForeignKey("workspaces.id", ondelete="SET NULL"), nullable=True)  # last-active workspace, remembered across sessions/devices

    organization = relationship("Organization", back_populates="users")

class ApiKey(Base):
    __tablename__ = "api_keys"
    
    id = Column(String, primary_key=True, default=gen_uuid)
    org_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    name = Column(String, nullable=False)
    hashed_key = Column(String, unique=True, nullable=False)
    scopes = Column(JSON, default=list) # e.g. ["read:leads", "write:leads"]
    last_used_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    created_by = Column(String, nullable=True)

class SavedSearch(Base):
    __tablename__ = "saved_searches"
    
    id = Column(String, primary_key=True, default=gen_uuid)
    org_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    workspace_id = Column(String, ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False)
    name = Column(String, nullable=False)
    countries = Column(JSON, default=list) # array of strings
    states = Column(JSON, default=list) # array of strings
    cities = Column(JSON, default=list) # array of strings
    industries = Column(JSON, default=list) # array of strings
    designations = Column(JSON, default=list) # array of strings
    lead_count_target = Column(Integer, default=50)
    # None means "no company-size constraint" (Companies mode only) — not a
    # fabricated default range.
    company_size_min = Column(Integer, nullable=True)
    company_size_max = Column(Integer, nullable=True)
    # Revenue tier(s) to match against — array of "startup"|"sme"|
    # "mid_market"|"enterprise" (Companies mode only). Empty means no
    # revenue constraint.
    revenue_bands = Column(JSON, default=list)
    advanced_filters = Column(JSON, default=dict)
    schedule = Column(JSON, default=dict) # e.g. {"recurrence": "weekly", "day": "monday"}
    search_mode = Column(String, default="individuals") # individuals | companies
    created_at = Column(DateTime, default=datetime.utcnow)
    created_by = Column(String, nullable=True)

    organization = relationship("Organization", back_populates="saved_searches")
    scrape_jobs = relationship("ScrapeJob", back_populates="saved_search")

class ScrapeJob(Base):
    __tablename__ = "scrape_jobs"

    id = Column(String, primary_key=True, default=gen_uuid)
    search_id = Column(String, ForeignKey("saved_searches.id", ondelete="SET NULL"), nullable=True)
    workspace_id = Column(String, ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False)  # denormalized from the search so jobs can be filtered directly, without a join through the (nullable) search_id
    status = Column(String, default="Queued") # Queued, Running, Completed, Failed, Partial
    search_mode = Column(String, default="individuals") # individuals | companies — denormalized from the search for quick display
    started_at = Column(DateTime, default=datetime.utcnow)
    completed_at = Column(DateTime, nullable=True)
    leads_found = Column(Integer, default=0)
    per_source_breakdown = Column(JSON, default=dict)
    error_detail = Column(String, nullable=True)
    triggered_by = Column(String, nullable=True)
    logs = Column(JSON, default=list)

    saved_search = relationship("SavedSearch", back_populates="scrape_jobs")
    leads = relationship("Lead", back_populates="scrape_job")

class Company(Base):
    __tablename__ = "companies"
    
    id = Column(String, primary_key=True, default=gen_uuid)
    org_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    workspace_id = Column(String, ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False)
    name = Column(String, nullable=False)
    website = Column(String, nullable=True)
    industry = Column(String, nullable=True)
    size_range = Column(String, nullable=True) # e.g. "50-100"
    employee_count = Column(Integer, nullable=True)  # None means genuinely unknown — never fabricate a count
    revenue_range = Column(String, nullable=True)  # real parsed figure/range, e.g. "$1M-$10M" — never fabricated
    revenue_band = Column(String, nullable=True)  # "startup"|"sme"|"mid_market"|"enterprise", derived from revenue_range
    funding_stage = Column(String, nullable=True) # e.g. "Series A"
    tech_stack = Column(JSON, default=list) # array of strings
    summary_text = Column(String, nullable=True)
    activity_signals = Column(JSON, default=dict) # shape: { "hiring": {...}, "achievements": [...] }
    linkedin_url = Column(String, nullable=True)
    source_provider = Column(String, nullable=True)
    raw_source_payload = Column(JSON, default=dict)
    first_seen_at = Column(DateTime, default=datetime.utcnow)
    
    organization = relationship("Organization", back_populates="companies")
    contacts = relationship("Contact", back_populates="company", cascade="all, delete-orphan")
    leads = relationship("Lead", back_populates="company", cascade="all, delete-orphan")

class Contact(Base):
    __tablename__ = "contacts"
    
    id = Column(String, primary_key=True, default=gen_uuid)
    company_id = Column(String, ForeignKey("companies.id", ondelete="CASCADE"), nullable=False)
    full_name = Column(String, nullable=False)
    designation = Column(String, nullable=False)
    email = Column(String, nullable=True)
    phone = Column(String, nullable=True)
    linkedin_url = Column(String, nullable=True)
    seniority_level = Column(String, nullable=True)
    source_provider = Column(String, nullable=True)
    raw_source_payload = Column(JSON, default=dict)
    
    company = relationship("Company", back_populates="contacts")
    leads = relationship("Lead", back_populates="contact", cascade="all, delete-orphan")

class Lead(Base):
    __tablename__ = "leads"
    
    id = Column(String, primary_key=True, default=gen_uuid)
    org_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    workspace_id = Column(String, ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False)
    company_id = Column(String, ForeignKey("companies.id", ondelete="CASCADE"), nullable=False)
    contact_id = Column(String, ForeignKey("contacts.id", ondelete="CASCADE"), nullable=False)
    job_id = Column(String, ForeignKey("scrape_jobs.id", ondelete="SET NULL"), nullable=True)
    status = Column(String, default="new") # new, approved, rejected, needs_info
    search_mode = Column(String, default="individuals") # individuals | companies — denormalized so the Lead Validation page can filter without a join
    reviewed_by = Column(String, nullable=True)
    reviewed_at = Column(DateTime, nullable=True)
    notes = Column(String, default="")
    dedupe_hash = Column(String, unique=True, nullable=True)
    
    organization = relationship("Organization", back_populates="leads")
    company = relationship("Company", back_populates="leads")
    contact = relationship("Contact", back_populates="leads")
    scrape_job = relationship("ScrapeJob", back_populates="leads")
    score_details = relationship("LeadScore", back_populates="lead", uselist=False, cascade="all, delete-orphan")
    messages = relationship("Message", back_populates="lead", cascade="all, delete-orphan")
    enrollments = relationship("SequenceEnrollment", back_populates="lead", cascade="all, delete-orphan")

class LeadScore(Base):
    __tablename__ = "lead_scores"
    
    id = Column(String, primary_key=True, default=gen_uuid)
    lead_id = Column(String, ForeignKey("leads.id", ondelete="CASCADE"), unique=True, nullable=False)
    total_score = Column(Integer, default=0) # 0-100
    tier = Column(String, default="Low") # High, Medium, Low
    factor_breakdown = Column(JSON, default=dict) # {"industry_match": X, "location_match": Y, ...}
    scored_at = Column(DateTime, default=datetime.utcnow)
    manually_overridden = Column(Boolean, default=False)
    
    lead = relationship("Lead", back_populates="score_details")

class ScoringConfig(Base):
    __tablename__ = "scoring_configs"
    
    id = Column(String, primary_key=True, default=gen_uuid)
    org_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    workspace_id = Column(String, ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False)
    weights = Column(JSON, default=dict) # {"industry_match": 25, "location_match": 15, "company_size": 15, "company_activity": 25, "designation_match": 20}
    updated_by = Column(String, nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class MessageTemplate(Base):
    __tablename__ = "message_templates"

    id = Column(String, primary_key=True, default=gen_uuid)
    org_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    workspace_id = Column(String, ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False)
    type = Column(String, nullable=False) # Cold Email, LinkedIn Connection Note, Follow-up, Proposal
    name = Column(String, nullable=False)
    body = Column(String, nullable=False)
    subject = Column(String, nullable=True)
    tags = Column(JSON, default=list)
    performance_stats = Column(JSON, default=dict) # {"replyRate": 24.5}
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    last_used_at = Column(DateTime, nullable=True)  # set only when a real send actually used this template
    usage_count = Column(Integer, default=0)

class Message(Base):
    __tablename__ = "messages"
    
    id = Column(String, primary_key=True, default=gen_uuid)
    org_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    workspace_id = Column(String, ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False)
    lead_id = Column(String, ForeignKey("leads.id", ondelete="CASCADE"), nullable=False)
    type = Column(String, nullable=False) # e.g. "Cold Email", "LinkedIn Connection Note"
    channel = Column(String, nullable=False) # email, linkedin
    subject = Column(String, nullable=True)
    body = Column(String, nullable=False)
    generated_by = Column(String, default="ai") # ai, human, hybrid
    status = Column(String, default="draft") # draft, pending_approval, approved, rejected, sent, failed
    approved_by = Column(String, nullable=True)
    approved_at = Column(DateTime, nullable=True)
    sent_at = Column(DateTime, nullable=True)
    error_detail = Column(String, nullable=True) # real SMTP/delivery failure reason when status == "failed"
    cc = Column(JSON, default=list) # array of CC email addresses, actually included in the SMTP send
    attachments = Column(JSON, default=list) # [{filename, url, size, contentType}] — url points at S3, real uploaded files
    batch_id = Column(String, nullable=True) # groups every recipient of one compose-and-send action (bulk or single)
    created_at = Column(DateTime, default=datetime.utcnow)

    organization = relationship("Organization", back_populates="messages")
    lead = relationship("Lead", back_populates="messages")

class Sequence(Base):
    __tablename__ = "sequences"
    
    id = Column(String, primary_key=True, default=gen_uuid)
    org_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    workspace_id = Column(String, ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False)
    name = Column(String, nullable=False)
    steps = Column(JSON, default=list) # [{type: "email", templateId: "X"}, {type: "delay", delayDays: 3}]
    exit_conditions = Column(JSON, default=dict) # {replyReceived: true, meetingBooked: true}
    status = Column(String, default="draft") # active, draft
    created_at = Column(DateTime, default=datetime.utcnow)
    
    organization = relationship("Organization", back_populates="sequences")
    enrollments = relationship("SequenceEnrollment", back_populates="sequence", cascade="all, delete-orphan")

class SequenceEnrollment(Base):
    __tablename__ = "sequence_enrollments"
    
    id = Column(String, primary_key=True, default=gen_uuid)
    sequence_id = Column(String, ForeignKey("sequences.id", ondelete="CASCADE"), nullable=False)
    lead_id = Column(String, ForeignKey("leads.id", ondelete="CASCADE"), nullable=False)
    current_step = Column(Integer, default=1)
    status = Column(String, default="active") # active, completed, exited
    enrolled_at = Column(DateTime, default=datetime.utcnow)
    
    sequence = relationship("Sequence", back_populates="enrollments")
    lead = relationship("Lead", back_populates="enrollments")

class OutreachEvent(Base):
    __tablename__ = "outreach_events"
    
    id = Column(String, primary_key=True, default=gen_uuid)
    message_id = Column(String, nullable=False)
    event_type = Column(String, nullable=False) # sent, delivered, opened, clicked, bounced, linkedin_accepted, replied
    occurred_at = Column(DateTime, default=datetime.utcnow)
    metadata_json = Column(JSON, default=dict)

class Conversation(Base):
    __tablename__ = "conversations"
    
    id = Column(String, primary_key=True, default=gen_uuid)
    org_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    workspace_id = Column(String, ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False)
    lead_id = Column(String, ForeignKey("leads.id", ondelete="CASCADE"), nullable=False)
    channel = Column(String, default="email") # email, linkedin
    subject = Column(String, nullable=True)
    sentiment = Column(String, default="Neutral") # Positive, Neutral, Negative, Out-of-office
    unread = Column(Boolean, default=False)
    last_message_snippet = Column(String, nullable=True)
    last_message_time = Column(DateTime, default=datetime.utcnow)

    lead = relationship("Lead")
    messages = relationship("ConversationMessage", back_populates="conversation", cascade="all, delete-orphan")

class ConversationMessage(Base):
    __tablename__ = "conversation_messages"
    
    id = Column(String, primary_key=True, default=gen_uuid)
    conversation_id = Column(String, ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False)
    direction = Column(String, nullable=False) # inbound, outbound
    body = Column(String, nullable=False)
    timestamp = Column(DateTime, default=datetime.utcnow)
    sender_name = Column(String, nullable=True)
    
    conversation = relationship("Conversation", back_populates="messages")

class Integration(Base):
    __tablename__ = "integrations"
    
    id = Column(String, primary_key=True, default=gen_uuid)
    org_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    workspace_id = Column(String, ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False)
    name = Column(String, nullable=False) # Apollo.io, Proxycurl, etc.
    category = Column(String, nullable=False) # data_provider, outbound, crm
    connected = Column(Boolean, default=False)
    encrypted_credentials = Column(String, nullable=True)
    quota_used = Column(Integer, default=0)
    quota_limit = Column(Integer, default=0)
    quota_unit = Column(String, default="credits")
    description = Column(String, nullable=True)
    last_synced_at = Column(DateTime, nullable=True)
    icon = Column(String, default="zap")
    
    organization = relationship("Organization", back_populates="integrations")

class AuditLog(Base):
    __tablename__ = "audit_log"
    
    id = Column(String, primary_key=True, default=gen_uuid)
    org_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    workspace_id = Column(String, ForeignKey("workspaces.id", ondelete="SET NULL"), nullable=True)  # nullable forever — org-level actions (invites, workspace mgmt itself) have no single workspace
    actor_id = Column(String, nullable=True)
    actor_name = Column(String, nullable=True)
    actor_email = Column(String, nullable=True)
    action = Column(String, nullable=False)
    category = Column(String, default="WORKSPACE") # SCRAPE, OUTBOUND, WORKSPACE, SECURITY
    target_entity_link = Column(String, default="#")
    target_entity_name = Column(String, nullable=True)
    ip_address = Column(String, nullable=True)
    device_metadata = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    organization = relationship("Organization", back_populates="audit_logs")

class ApiUsageEvent(Base):
    """One row per real outbound call to a paid third-party data API (currently
    SerpAPI). Purely additive telemetry — never read by the scraping logic
    itself — used only to show genuine usage/cost figures on the Analytics
    page instead of a fabricated number."""
    __tablename__ = "api_usage_events"

    id = Column(String, primary_key=True, default=gen_uuid)
    provider = Column(String, nullable=False)  # e.g. "SerpAPI"
    endpoint = Column(String, nullable=True)  # e.g. "google", "google_maps"
    created_at = Column(DateTime, default=datetime.utcnow)


class Notification(Base):
    __tablename__ = "notifications"

    id = Column(String, primary_key=True, default=gen_uuid)
    org_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    workspace_id = Column(String, ForeignKey("workspaces.id", ondelete="SET NULL"), nullable=True)  # nullable forever — stays org-wide (a job-completed alert for another workspace is still useful to see)
    type = Column(String, nullable=False) # job_completed, job_partial, job_failed, email_sent, email_partial, email_failed
    title = Column(String, nullable=False)
    description = Column(String, nullable=True)
    read = Column(Boolean, default=False)
    related_job_id = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
