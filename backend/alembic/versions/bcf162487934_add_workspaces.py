"""add workspaces (multi-workspace support)

Revision ID: bcf162487934
Revises: de337b8ff8bb
Create Date: 2026-07-21 00:00:00.000000

"""
from typing import Sequence, Union
import uuid
from datetime import datetime

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'bcf162487934'
down_revision: Union[str, Sequence[str], None] = 'de337b8ff8bb'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Every table that gets its own direct workspace_id column, tightened to
# NOT NULL once backfilled.
_ALL_WORKSPACE_TABLES = [
    "companies", "leads", "message_templates", "messages",
    "sequences", "integrations", "scoring_configs", "saved_searches", "scrape_jobs",
]

# Subset of the above that already carries an org_id column today — these
# can be backfilled directly (`WHERE org_id = ...`). `scrape_jobs` has no
# org_id column at all (it's only ever been reachable transitively through
# `saved_searches`), so it's backfilled separately below.
_ORG_SCOPED_BACKFILL_TABLES = [
    "companies", "leads", "message_templates", "messages",
    "sequences", "integrations", "scoring_configs", "saved_searches",
]


def upgrade() -> None:
    bind = op.get_bind()

    # 1. New workspaces table — a sub-tenant inside an Organization.
    op.create_table(
        'workspaces',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('org_id', sa.String(), nullable=False),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('is_default', sa.Boolean(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('created_by', sa.String(), nullable=True),
        sa.ForeignKeyConstraint(['org_id'], ['organizations.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )

    # 2. Nullable workspace_id (+ FK) on every workspace-scoped table.
    #    batch_alter_table so this also works on SQLite (dev/test), which
    #    can't ALTER a table to add a foreign key constraint directly.
    for table in _ALL_WORKSPACE_TABLES:
        with op.batch_alter_table(table) as batch_op:
            batch_op.add_column(sa.Column('workspace_id', sa.String(), nullable=True))
            batch_op.create_foreign_key(
                f'fk_{table}_workspace_id_workspaces', 'workspaces', ['workspace_id'], ['id'], ondelete='CASCADE'
            )

    # 3. conversations: add org_id + workspace_id — it carried neither
    #    before, which is why get_conversations() previously returned every
    #    conversation in the database with no tenant filtering at all.
    with op.batch_alter_table('conversations') as batch_op:
        batch_op.add_column(sa.Column('org_id', sa.String(), nullable=True))
        batch_op.add_column(sa.Column('workspace_id', sa.String(), nullable=True))
        batch_op.create_foreign_key(
            'fk_conversations_org_id_organizations', 'organizations', ['org_id'], ['id'], ondelete='CASCADE'
        )
        batch_op.create_foreign_key(
            'fk_conversations_workspace_id_workspaces', 'workspaces', ['workspace_id'], ['id'], ondelete='CASCADE'
        )

    # 4. audit_log, notifications: nullable workspace_id, stays nullable
    #    forever — org-level actions (invites, workspace mgmt itself) have
    #    no single workspace to attribute to.
    for table in ('audit_log', 'notifications'):
        with op.batch_alter_table(table) as batch_op:
            batch_op.add_column(sa.Column('workspace_id', sa.String(), nullable=True))
            batch_op.create_foreign_key(
                f'fk_{table}_workspace_id_workspaces', 'workspaces', ['workspace_id'], ['id'], ondelete='SET NULL'
            )

    # 5. users: default_workspace_id — remembers each user's last-active
    #    workspace across sessions/devices.
    with op.batch_alter_table('users') as batch_op:
        batch_op.add_column(sa.Column('default_workspace_id', sa.String(), nullable=True))
        batch_op.create_foreign_key(
            'fk_users_default_workspace_id_workspaces', 'workspaces', ['default_workspace_id'], ['id'], ondelete='SET NULL'
        )

    # 6. Backfill: one "Default Workspace" per existing org, then point
    #    every existing row at it. A no-op against a brand-new, org-less
    #    database (fresh test runs), which is exactly what's needed there.
    org_rows = bind.execute(sa.text("SELECT id FROM organizations")).fetchall()
    # A real datetime object, not an ISO string — asyncpg (Postgres) requires
    # an actual datetime.datetime for a DateTime column parameter and raises
    # a DataError on a string; aiosqlite is lenient about this, which is why
    # this only surfaces against Postgres.
    now = datetime.utcnow()
    org_to_workspace: dict[str, str] = {}
    for (org_id,) in org_rows:
        ws_id = str(uuid.uuid4())
        org_to_workspace[org_id] = ws_id
        bind.execute(
            sa.text(
                "INSERT INTO workspaces (id, org_id, name, is_default, created_at, created_by) "
                "VALUES (:id, :org_id, :name, :is_default, :created_at, NULL)"
            ),
            {"id": ws_id, "org_id": org_id, "name": "Default Workspace", "is_default": True, "created_at": now},
        )

    for org_id, ws_id in org_to_workspace.items():
        for table in _ORG_SCOPED_BACKFILL_TABLES:
            bind.execute(
                sa.text(f"UPDATE {table} SET workspace_id = :ws_id WHERE org_id = :org_id"),
                {"ws_id": ws_id, "org_id": org_id},
            )

    # scrape_jobs: inherit workspace_id from the linked saved_search where
    # one exists...
    bind.execute(
        sa.text(
            "UPDATE scrape_jobs SET workspace_id = "
            "(SELECT workspace_id FROM saved_searches WHERE saved_searches.id = scrape_jobs.search_id) "
            "WHERE search_id IS NOT NULL"
        )
    )
    # ...and orphan jobs (search_id IS NULL — legacy/manual triggers, today
    # shown to every org since scrape_jobs has never carried an org_id of
    # its own) fall back to the first backfilled org's default workspace.
    # This app has only ever run against a single seeded org (no signup
    # flow exists), so this is unambiguous in practice; it also incidentally
    # fixes the latent cross-org visibility those orphan jobs had before.
    fallback_ws_id = next(iter(org_to_workspace.values()), None)
    if fallback_ws_id:
        bind.execute(
            sa.text("UPDATE scrape_jobs SET workspace_id = :ws_id WHERE workspace_id IS NULL"),
            {"ws_id": fallback_ws_id},
        )

    # conversations: inherit org_id/workspace_id from the linked lead.
    bind.execute(
        sa.text(
            "UPDATE conversations SET "
            "org_id = (SELECT org_id FROM leads WHERE leads.id = conversations.lead_id), "
            "workspace_id = (SELECT workspace_id FROM leads WHERE leads.id = conversations.lead_id)"
        )
    )

    # users: remember a sensible starting default workspace for every
    # existing user.
    for org_id, ws_id in org_to_workspace.items():
        bind.execute(
            sa.text("UPDATE users SET default_workspace_id = :ws_id WHERE org_id = :org_id"),
            {"ws_id": ws_id, "org_id": org_id},
        )

    # 7. Tighten to NOT NULL now that every row has a value.
    for table in _ALL_WORKSPACE_TABLES:
        with op.batch_alter_table(table) as batch_op:
            batch_op.alter_column('workspace_id', existing_type=sa.String(), nullable=False)
    with op.batch_alter_table('conversations') as batch_op:
        batch_op.alter_column('org_id', existing_type=sa.String(), nullable=False)
        batch_op.alter_column('workspace_id', existing_type=sa.String(), nullable=False)


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('conversations') as batch_op:
        batch_op.drop_constraint('fk_conversations_workspace_id_workspaces', type_='foreignkey')
        batch_op.drop_constraint('fk_conversations_org_id_organizations', type_='foreignkey')
        batch_op.drop_column('workspace_id')
        batch_op.drop_column('org_id')

    with op.batch_alter_table('users') as batch_op:
        batch_op.drop_constraint('fk_users_default_workspace_id_workspaces', type_='foreignkey')
        batch_op.drop_column('default_workspace_id')

    for table in ('audit_log', 'notifications'):
        with op.batch_alter_table(table) as batch_op:
            batch_op.drop_constraint(f'fk_{table}_workspace_id_workspaces', type_='foreignkey')
            batch_op.drop_column('workspace_id')

    for table in _ALL_WORKSPACE_TABLES:
        with op.batch_alter_table(table) as batch_op:
            batch_op.drop_constraint(f'fk_{table}_workspace_id_workspaces', type_='foreignkey')
            batch_op.drop_column('workspace_id')

    op.drop_table('workspaces')
