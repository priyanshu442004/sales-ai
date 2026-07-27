"""add invited_by_id to users

Revision ID: de337b8ff8bb
Revises: 54ae78fb50a0
Create Date: 2026-07-18 18:57:11.467824

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'de337b8ff8bb'
down_revision: Union[str, Sequence[str], None] = '54ae78fb50a0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # batch_alter_table (rather than plain op.add_column/create_foreign_key)
    # so this also works on SQLite, which can't ALTER a table to add a
    # foreign key constraint directly — batch mode does copy-and-move there
    # and is a harmless passthrough to the plain ALTER on Postgres.
    with op.batch_alter_table('users') as batch_op:
        batch_op.add_column(sa.Column('invited_by_id', sa.String(), nullable=True))
        batch_op.create_foreign_key(
            'fk_users_invited_by_id_users', 'users', ['invited_by_id'], ['id'], ondelete='SET NULL'
        )


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('users') as batch_op:
        batch_op.drop_constraint('fk_users_invited_by_id_users', type_='foreignkey')
        batch_op.drop_column('invited_by_id')
