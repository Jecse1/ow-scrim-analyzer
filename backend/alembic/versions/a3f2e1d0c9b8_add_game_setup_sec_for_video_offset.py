"""add game_setup_sec for video offset

Revision ID: a3f2e1d0c9b8
Revises: c7c1300e5936
Create Date: 2026-05-29

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'a3f2e1d0c9b8'
down_revision: Union[str, Sequence[str], None] = 'c7c1300e5936'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('matches', sa.Column('game_setup_sec', sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column('matches', 'game_setup_sec')
