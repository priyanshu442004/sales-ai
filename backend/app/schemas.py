from pydantic import BaseModel, Field, EmailStr
from typing import List, Dict, Any, Optional
from datetime import datetime

# Auth schemas
class LoginRequest(BaseModel):
    email: str
    password: str

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: Dict[str, Any]

class MfaVerifyRequest(BaseModel):
    token: str
    code: str

# Team invite schemas — email format is validated manually in the route
# (same regex approach as email_sender.py) rather than via pydantic's
# EmailStr, since the email-validator package EmailStr requires isn't
# installed and this avoids adding a new dependency for it.
class TeamInviteItem(BaseModel):
    email: str
    password: str
    role: str = "Sales Rep"
    name: Optional[str] = None

class TeamInviteRequest(BaseModel):
    invites: List[TeamInviteItem]

class TeamInviteResult(BaseModel):
    email: str
    success: bool
    emailSent: bool = False
    error: Optional[str] = None

class TeamInviteResponse(BaseModel):
    success: bool
    invited: int
    total: int
    results: List[TeamInviteResult]

# User schemas
class UserResponse(BaseModel):
    id: str
    name: str
    email: str
    role: str
    status: str
    last_active: Optional[str] = None
    avatar_url: Optional[str] = None
    default_workspace_id: Optional[str] = None

    class Config:
        from_attributes = True

# SavedSearch schemas
class SavedSearchCreate(BaseModel):
    name: str
    countries: List[str] = []
    states: List[str] = []
    cities: List[str] = []
    industries: List[str] = []
    designations: List[str] = []
    lead_count_target: int = 50
    # Company headcount range — Companies mode only. None means "no size
    # constraint", not "unlimited 10-500" (that was a misleading default);
    # when set, the scraper strictly excludes companies whose real,
    # LinkedIn-published employee count can't be confirmed to overlap it.
    company_size_min: Optional[int] = None
    company_size_max: Optional[int] = None
    # Revenue tier(s) — Companies mode only. Empty list means "no revenue
    # constraint". Each entry must be one of "startup"|"sme"|"mid_market"|
    # "enterprise"; the scraper strictly excludes companies whose real
    # revenue can't be confirmed to fall in a requested band.
    revenue_bands: List[str] = []
    advanced_filters: Dict[str, Any] = {}
    schedule: Dict[str, Any] = {}
    search_mode: str = "individuals"  # individuals | companies

class SavedSearchResponse(BaseModel):
    id: str
    org_id: str
    name: str
    countries: List[str]
    states: List[str]
    cities: List[str]
    industries: List[str]
    designations: List[str]
    lead_count_target: int
    company_size_min: Optional[int] = None
    company_size_max: Optional[int] = None
    revenue_bands: List[str] = []
    advanced_filters: Dict[str, Any]
    schedule: Dict[str, Any]
    search_mode: str = "individuals"
    created_at: datetime

    class Config:
        from_attributes = True

# ScrapeJob schemas
class ScrapeJobResponse(BaseModel):
    id: str
    search_id: Optional[str]
    status: str
    search_mode: str = "individuals"
    started_at: datetime
    completed_at: Optional[datetime] = None
    leads_found: int
    per_source_breakdown: Dict[str, Any]
    error_detail: Optional[str] = None
    triggered_by: Optional[str] = None
    logs: List[str] = []

    class Config:
        from_attributes = True

class PaginatedJobsResponse(BaseModel):
    data: List[ScrapeJobResponse]
    page: int
    pageSize: int
    total: int

# Lead / Company / Contact schemas
class CompanyResponse(BaseModel):
    id: str
    name: str
    website: Optional[str] = None
    domain: Optional[str] = None
    industry: Optional[str] = None
    employeeCount: Optional[int] = None
    sizeRange: Optional[str] = None
    revenueRange: Optional[str] = None
    revenueBand: Optional[str] = None
    fundingStage: Optional[str] = None
    techStack: List[str] = []
    overview: Optional[str] = None
    activity_signals: Dict[str, Any] = {}
    linkedin_url: Optional[str] = None

    class Config:
        from_attributes = True

class ContactResponse(BaseModel):
    id: str
    full_name: str
    designation: str
    email: Optional[str] = None
    phone: Optional[str] = None
    linkedin_url: Optional[str] = None
    seniority_level: Optional[str] = None

    class Config:
        from_attributes = True

class LeadScoreResponse(BaseModel):
    total_score: int
    tier: str
    factor_breakdown: Dict[str, int]
    scored_at: datetime

    class Config:
        from_attributes = True

class LeadResponse(BaseModel):
    id: str
    org_id: str
    status: str
    reviewed_by: Optional[str] = None
    reviewed_at: Optional[datetime] = None
    notes: str
    company: CompanyResponse
    decisionMaker: ContactResponse
    score: int
    priority: str
    scoreExplanation: Optional[str] = None
    sourceJobName: Optional[str] = None
    activitySignals: List[str] = []

    class Config:
        from_attributes = True

class LeadUpdate(BaseModel):
    status: Optional[str] = None
    notes: Optional[str] = None

class BulkDeleteRequest(BaseModel):
    ids: List[str]

# Ad-hoc "Add your own" compose recipient — not yet a lead, typed directly
# into the compose modal.
class AdHocRecipientRequest(BaseModel):
    name: str
    email: str
    company: Optional[str] = None
    title: Optional[str] = None

# ScoringConfig schemas
class ScoringConfigUpdate(BaseModel):
    weights: Dict[str, int]

class ScoringConfigResponse(BaseModel):
    id: str
    org_id: str
    weights: Dict[str, int]
    updated_at: datetime

    class Config:
        from_attributes = True

# Message/Draft schemas
class MessageDraftCreate(BaseModel):
    leadId: str
    type: str # Cold Email, LinkedIn Connection Note, etc.
    tone: Optional[str] = "Conversational"
    length: Optional[str] = "Medium"
    templateId: Optional[str] = None
    # When provided (Outreach Studio's composer, already resolved with this
    # lead's merge-tag values), used verbatim instead of an AI-generated
    # draft, and the resulting message goes straight to pending_approval —
    # the user already wrote and reviewed it, so there's no separate draft step.
    subject: Optional[str] = None
    body: Optional[str] = None

class AiRewriteRequest(BaseModel):
    subject: Optional[str] = None
    body: str
    instruction: Optional[str] = None

class MessageDraftResponse(BaseModel):
    id: str
    leadId: str
    leadName: str
    leadCompany: str
    type: str
    channel: str
    subject: Optional[str] = None
    body: str
    status: str
    createdAt: str

    class Config:
        from_attributes = True

class MessageDraftUpdate(BaseModel):
    subject: Optional[str] = None
    body: Optional[str] = None
    status: Optional[str] = None

class EmailAttachmentRef(BaseModel):
    filename: str
    key: str  # S3 object key from a prior /messages/attachments upload
    contentType: Optional[str] = None
    size: Optional[int] = None
    url: Optional[str] = None

class PerRecipientMessage(BaseModel):
    leadId: str
    subject: str
    body: str

class SendEmailRequest(BaseModel):
    # Together mode: one subject/body applied (with personalization tokens
    # resolved) to every id in leadIds.
    leadIds: List[str] = []
    subject: str = ""
    body: str = ""
    # Separate mode: each recipient already has their own edited
    # subject/body — when present, this takes priority over leadIds/subject/body.
    messages: List[PerRecipientMessage] = []
    cc: List[str] = []
    attachments: List[EmailAttachmentRef] = []
    templateId: Optional[str] = None

class MessageRefineRequest(BaseModel):
    instruction: str

# Templates
class TemplateResponse(BaseModel):
    id: str
    name: str
    type: str
    channel: str  # "email" | "linkedin" — derived from type
    subject: Optional[str] = None
    body: str
    tags: List[str] = []
    usageCount: int = 0
    lastUsedAt: Optional[str] = None
    createdAt: Optional[str] = None
    updatedAt: Optional[str] = None

    class Config:
        from_attributes = True

class TemplateCreate(BaseModel):
    id: Optional[str] = None  # present on update
    name: str
    type: str  # "Cold Email" | "LinkedIn Connection Note" | "Follow-up" | "Proposal"
    subject: Optional[str] = None
    body: str
    tags: List[str] = []

# Integrations
class IntegrationResponse(BaseModel):
    id: str
    name: str
    category: str
    connected: bool
    description: Optional[str] = None
    lastSyncedAt: Optional[str] = None
    icon: str
    quota: Optional[Dict[str, Any]] = None

    class Config:
        from_attributes = True

# Audit log
class AuditLogResponse(BaseModel):
    id: str
    timestamp: str
    actorName: str
    actorEmail: str
    action: str
    category: str
    targetEntityLink: str
    targetEntityName: str
    ipAddress: Optional[str] = None
    deviceMetadata: Optional[str] = None

    class Config:
        from_attributes = True

class SearchEstimateRequest(BaseModel):
    countries: List[str] = []
    states: List[str] = []
    cities: List[str] = []
    industries: List[str] = []
    designations: List[str] = []
    search_mode: str = "individuals"  # individuals | companies
    company_size_min: Optional[int] = None
    company_size_max: Optional[int] = None
    revenue_bands: List[str] = []

class PreviewCompanySchema(BaseModel):
    name: str
    size: str
    domain: str
    match: Optional[str] = None

class SearchEstimateResponse(BaseModel):
    match_count: int
    preview_companies: List[PreviewCompanySchema]
