# -*- coding: utf-8 -*-
"""add matches.source and manual VOD fields

수기(로그 없는) 매치 등록 지원:
- source: 'log'(기존 매치 전부, server_default로 백필) / 'manual'
- video_start_sec / video_end_sec: 수기 매치 전용 VOD 구간(초), NULL 허용

Revision ID: d4e5f6a7b8c9
Revises: b7c8d9e0f1a2
Create Date: 2026-09-21
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'd4e5f6a7b8c9'
down_revision: Union[str, Sequence[str], None] = 'b7c8d9e0f1a2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # SQLite ADD COLUMN — 무중단. server_default='log' 로 기존 행 자동 백필.
    op.add_column('matches', sa.Column('source', sa.String(), nullable=False, server_default='log'))
    op.add_column('matches', sa.Column('video_start_sec', sa.Integer(), nullable=True))
    op.add_column('matches', sa.Column('video_end_sec', sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column('matches', 'video_end_sec')
    op.drop_column('matches', 'video_start_sec')
    op.drop_column('matches', 'source')
