"""add winner_override for manual match-result correction (Push maps etc.)

컬럼 추가만(NULL 기본) — 기존 행·기존 winner 값 무변경.

Revision ID: b7c8d9e0f1a2
Revises: a3f2e1d0c9b8
Create Date: 2026-07-05

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'b7c8d9e0f1a2'
down_revision: Union[str, Sequence[str], None] = 'a3f2e1d0c9b8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('matches', sa.Column('winner_override', sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column('matches', 'winner_override')
