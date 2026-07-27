from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from app.models import (
    Organization, Workspace, User, ScoringConfig, MessageTemplate, Sequence, Integration, AuditLog
)
from app.auth_utils import hash_password
from datetime import datetime, timedelta

async def seed_db(db: AsyncSession):
    # Check if database is already seeded
    result = await db.execute(select(User).filter_by(email="admin@gmail.com"))
    existing_user = result.scalars().first()
    if existing_user:
        return # Already seeded

    # 1. Organization
    org = Organization(
        id="org-1",
        name="Sales AI Workspace",
        plan="Enterprise",
        settings={"timezone": "UTC", "currency": "USD"}
    )
    db.add(org)
    await db.flush()

    # 1b. Default workspace — every org always has at least one.
    workspace = Workspace(
        id="workspace-1",
        org_id=org.id,
        name="Default Workspace",
        is_default=True,
        created_by="user-admin",
    )
    db.add(workspace)
    await db.flush()

    # 1c. Separate Workspaces for Nitin, Anoop, Jobby, Saurabh
    admin_workspaces = {
        "user-nitin": Workspace(id="ws-nitin", org_id=org.id, name="Nitin's Workspace", is_default=False, created_by="user-nitin"),
        "user-anoop": Workspace(id="ws-anoop", org_id=org.id, name="Anoop's Workspace", is_default=False, created_by="user-anoop"),
        "user-jobby": Workspace(id="ws-jobby", org_id=org.id, name="Jobby's Workspace", is_default=False, created_by="user-jobby"),
        "user-saurabh": Workspace(id="ws-saurabh", org_id=org.id, name="Saurabh's Workspace", is_default=False, created_by="user-saurabh"),
    }
    for ws_obj in admin_workspaces.values():
        db.add(ws_obj)
    await db.flush()

    # 2. Users
    users_data = [
        {"id": "user-admin", "email": "admin@gmail.com", "name": "Admin User", "role": "Admin", "status": "Active", "password": "admin", "ws_id": workspace.id},
        {"id": "user-priya", "email": "priya@salesai.ai", "name": "Priya Patel", "role": "Sales Manager", "status": "Active", "password": "admin", "ws_id": workspace.id},
        {"id": "user-john", "email": "john@salesai.ai", "name": "John Doe", "role": "Admin", "status": "Active", "password": "admin", "ws_id": workspace.id},
        {"id": "user-marcus", "email": "marcus@salesai.ai", "name": "Marcus Taylor", "role": "Sales Rep", "status": "Active", "password": "admin", "ws_id": workspace.id},
        {"id": "user-sarah", "email": "sarah@salesai.ai", "name": "Sarah O'Connor", "role": "Reviewer-only", "status": "Active", "password": "admin", "ws_id": workspace.id},
        {"id": "user-nitin", "email": "nitin@salesai.ai", "name": "Nitin", "role": "Admin", "status": "Active", "password": "nitin123", "ws_id": "ws-nitin"},
        {"id": "user-anoop", "email": "anoop@salesai.ai", "name": "Anoop", "role": "Admin", "status": "Active", "password": "anoop123", "ws_id": "ws-anoop"},
        {"id": "user-jobby", "email": "jobby@salesai.ai", "name": "Jobby", "role": "Admin", "status": "Active", "password": "jobby123", "ws_id": "ws-jobby"},
        {"id": "user-saurabh", "email": "saurabh@salesai.ai", "name": "Saurabh", "role": "Admin", "status": "Active", "password": "saurabh123", "ws_id": "ws-saurabh"},
    ]

    for u in users_data:
        user = User(
            id=u["id"],
            org_id=org.id,
            email=u["email"],
            hashed_password=hash_password(u["password"]),
            name=u["name"],
            role=u["role"],
            status=u["status"],
            avatar_url=f"https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=100&h=100&q=80",
            default_workspace_id=u.get("ws_id", workspace.id),
        )
        db.add(user)

    # 3. Scoring Config
    scoring = ScoringConfig(
        id="score-conf-1",
        org_id=org.id,
        workspace_id=workspace.id,
        weights={
            "industry_match": 25,
            "location_match": 15,
            "company_size": 15,
            "company_activity": 25,
            "designation_match": 20
        },
        updated_by="user-admin"
    )
    db.add(scoring)

    # 4. Integrations
    integrations_data = [
        {"id": "int-1", "name": "Apollo.io", "category": "data_provider", "connected": True, "icon": "zap", "description": "B2B contact database and direct emails.", "quota_used": 840, "quota_limit": 2000, "quota_unit": "credits"},
        {"id": "int-2", "name": "Proxycurl (LinkedIn API)", "category": "data_provider", "connected": True, "icon": "link", "description": "Crawler for rich LinkedIn profile/company data.", "quota_used": 312, "quota_limit": 1000, "quota_unit": "lookups"},
        {"id": "int-3", "name": "SMTP / Google Workspace", "category": "outbound", "connected": True, "icon": "mail", "description": "Outbound email sending provider.", "quota_used": 142, "quota_limit": 500, "quota_unit": "emails/day"},
        {"id": "int-4", "name": "Unipile (LinkedIn API)", "category": "outbound", "connected": True, "icon": "linkedin", "description": "Send LinkedIn direct messages and connection notes.", "quota_used": 73, "quota_limit": 150, "quota_unit": "notes/day"},
        {"id": "int-5", "name": "HubSpot CRM Sync", "category": "crm", "connected": False, "icon": "refresh-cw", "description": "Push enriched and approved contacts directly into your CRM."},
        {"id": "int-6", "name": "Salesforce CRM Sync", "category": "crm", "connected": False, "icon": "database", "description": "Enterprise bidirectional synchronization for leads."}
    ]
    for i in integrations_data:
        integration = Integration(
            id=i["id"],
            org_id=org.id,
            workspace_id=workspace.id,
            name=i["name"],
            category=i["category"],
            connected=i["connected"],
            quota_used=i.get("quota_used", 0),
            quota_limit=i.get("quota_limit", 0),
            quota_unit=i.get("quota_unit", "credits"),
            description=i.get("description", ""),
            icon=i["icon"],
            last_synced_at=datetime.utcnow() - timedelta(minutes=15) if i["connected"] else None
        )
        db.add(integration)

    # 5. Templates — starter library covering all four outreach types from
    # the documented workflow (cold email, LinkedIn note, follow-up, proposal).
    # No performance_stats/usage seeded here — reply rate and usage count are
    # only ever real, derived from actual sends, never a starting fake number.
    templates_data = [
        {
            "id": "temp-1",
            "name": "Cold Introduction (High Score)",
            "type": "Cold Email",
            "subject": "Speeding up outreach at {{company}}",
            "body": "Hi {{first_name}},\n\nI noticed {{company}} has been expanding its operations and recently hired in {{industry}}.\n\nWith your team's size of {{employeeCount}}, coordination is key. We help growth leaders automate decision-maker enrichment.\n\nDo you have 10 minutes to discuss?\n\nBest,\n{{sender_name}}",
            "tags": ["Cold Outreach", "SaaS"],
        },
        {
            "id": "temp-2",
            "name": "LinkedIn Connect Request (Funding)",
            "type": "LinkedIn Connection Note",
            "body": "Hi {{first_name}}, congrats on {{company}}'s recent funding! Love what you're building in {{industry}}. Let's connect.",
            "tags": ["LinkedIn", "Funding"],
        },
        {
            "id": "temp-3",
            "name": "Outreach Follow-up (3 Days)",
            "type": "Follow-up",
            "subject": "Re: Sourcing tools at {{company}}",
            "body": "Hi {{first_name}}, following up on my previous note. I know you're busy scaling {{company}}. Just wanted to drop a quick link on how similar teams automate outbound checks. Let me know if that's interesting.",
            "tags": ["Follow-up"],
        },
        {
            "id": "temp-4",
            "name": "Enterprise Pilot Agreement Proposal",
            "type": "Proposal",
            "subject": "Sales AI Pilot Trial — {{company}}",
            "body": "Hi {{first_name}},\n\nAs discussed, here is the proposal outline for our enterprise pilot trial with {{company}}...",
            "tags": ["Closing", "Proposal"],
        }
    ]
    for t in templates_data:
        tmpl = MessageTemplate(
            id=t["id"],
            org_id=org.id,
            workspace_id=workspace.id,
            type=t["type"],
            name=t["name"],
            body=t["body"],
            subject=t.get("subject"),
            tags=t["tags"],
            performance_stats={},
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
            usage_count=0,
        )
        db.add(tmpl)

    # 6. Sequences — an empty starter sequence shell (steps reference the
    # template library above only, no fabricated leads/enrollments attached).
    seq = Sequence(
        id="seq-1",
        org_id=org.id,
        workspace_id=workspace.id,
        name="Sales AI Founders Sequencing Q3",
        steps=[
            {"id": "seq1-s1", "stepNumber": 1, "type": "email", "templateId": "temp-1"},
            {"id": "seq1-s2", "stepNumber": 2, "type": "delay", "delayDays": 3},
            {"id": "seq1-s3", "stepNumber": 3, "type": "linkedin_message", "templateId": "temp-2"}
        ],
        exit_conditions={"replyReceived": True, "meetingBooked": True, "unsubscribed": True},
        status="draft"
    )
    db.add(seq)

    # 7. Audit Logs
    audit = AuditLog(
        id="log-1",
        org_id=org.id,
        actor_id="user-priya",
        actor_name="Priya Patel",
        actor_email="priya@salesai.ai",
        action="Configured weights model parameters",
        category="WORKSPACE",
        target_entity_name="Weights configuration",
        ip_address="192.168.1.45",
        device_metadata="Chrome on macOS (14.5)"
    )
    db.add(audit)

    await db.commit()
