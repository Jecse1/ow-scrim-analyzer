# -*- coding: utf-8 -*-
"""routers/abilities.py — 스킬 사용(ability_1/2_used) 관련 엔드포인트.

POST /api/admin/backfill-abilities : 원문 → 스킬 데이터 백필을 백그라운드로 시작하고 바로 응답(멱등 — 처리한 매치는 건너뜀).
GET  /api/admin/backfill-abilities : 진행 상태(done/total, 저장 수, 매치당 쓰기 잠금 최댓값, 소요).
진행 로그는 서버 로그 "[ABILITY] backfill n/N". 구현은 services/abilities.py.
"""
from fastapi import APIRouter

from services.abilities import start_backfill, backfill_state

router = APIRouter()


@router.post("/api/admin/backfill-abilities")
async def backfill_abilities():
    return start_backfill(force=False)


@router.get("/api/admin/backfill-abilities")
async def backfill_abilities_status():
    return backfill_state()
