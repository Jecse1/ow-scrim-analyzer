"""add winner_source (match winner provenance: override/manual/draw/score/progress)

컬럼 추가만(NULL 기본) — 기존 행·winner 값 무변경. 값 채우기는 기동 시 init_db 백필이 담당
(db/database.py _backfill_winner_source). _COLUMN_PATCHES 와 동일 정의.

Revision ID: f6a7b8c9d0e1
Revises: e5f6a7b8c9d0
Create Date: 2026-10-14

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'f6a7b8c9d0e1'
down_revision: Union[str, Sequence[str], None] = 'e5f6a7b8c9d0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('matches', sa.Column('winner_source', sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column('matches', 'winner_source')
