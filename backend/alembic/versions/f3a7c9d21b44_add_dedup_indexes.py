"""add dedup-lookup indexes for companies/contacts/leads

Revision ID: f3a7c9d21b44
Revises: bcf162487934
Create Date: 2026-07-22 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'f3a7c9d21b44'
down_revision: Union[str, Sequence[str], None] = 'bcf162487934'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Cross-search "don't resurface a company/person I've already scraped in
    # this workspace" dedup (routes/searches.py) now runs a lookup against
    # these columns on every search — index them so that stays fast as a
    # workspace's scraped history grows.
    op.create_index('ix_companies_workspace_name', 'companies', ['workspace_id', 'name'])
    op.create_index('ix_companies_workspace_linkedin_url', 'companies', ['workspace_id', 'linkedin_url'])
    op.create_index('ix_contacts_linkedin_url', 'contacts', ['linkedin_url'])


def downgrade() -> None:
    op.drop_index('ix_contacts_linkedin_url', table_name='contacts')
    op.drop_index('ix_companies_workspace_linkedin_url', table_name='companies')
    op.drop_index('ix_companies_workspace_name', table_name='companies')
