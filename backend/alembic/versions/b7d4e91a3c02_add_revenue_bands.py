"""add revenue bands (companies mode search criterion)

Revision ID: b7d4e91a3c02
Revises: f3a7c9d21b44
Create Date: 2026-07-23 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b7d4e91a3c02'
down_revision: Union[str, Sequence[str], None] = 'f3a7c9d21b44'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('saved_searches') as batch_op:
        batch_op.add_column(sa.Column('revenue_bands', sa.JSON(), nullable=True))

    with op.batch_alter_table('companies') as batch_op:
        batch_op.add_column(sa.Column('revenue_range', sa.String(), nullable=True))
        batch_op.add_column(sa.Column('revenue_band', sa.String(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('companies') as batch_op:
        batch_op.drop_column('revenue_band')
        batch_op.drop_column('revenue_range')

    with op.batch_alter_table('saved_searches') as batch_op:
        batch_op.drop_column('revenue_bands')
