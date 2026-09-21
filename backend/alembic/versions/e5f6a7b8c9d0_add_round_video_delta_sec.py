"""add rounds.video_delta_sec for per-round VOD drift correction

Revision ID: e5f6a7b8c9d0
Revises: d4e5f6a7b8c9
Create Date: 2026-09-21
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'e5f6a7b8c9d0'
down_revision: Union[str, Sequence[str], None] = 'd4e5f6a7b8c9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # SQLite ADD COLUMN — 무중단. NULL = 자동 보정(모드 기본값 × (round_number−1)).
    op.add_column('rounds', sa.Column('video_delta_sec', sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column('rounds', 'video_delta_sec')
