# -*- coding: utf-8 -*-
"""routers/summary.py — 봇·외부 조회용 집계 API(GET, 읽기 전용). 집계 정의는 services/summary.py.

records·match_summaries 는 /api/fight-records 와 같은 함수(services/fight_records.py)로 매 요청 계산하고,
세션 목록은 /api/scrims 와 같은 직렬화(serializers._db_match_to_dict, full=False)로 만든다.
summary 자체 캐시는 두지 않는다(fight-records 응답 캐시와도 무관 — 매 요청 DB 조회).
services/routers → main import 금지. DB 가용성 가드는 자체 판정.
"""
import re
from datetime import date, datetime
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

_DB_IMPORT_ERROR = None
try:
    from sqlalchemy import select
    from db.database import AsyncSessionLocal
    from db.models import Session as DBSession, Match as DBMatch, Round as DBRound
    _DB_AVAILABLE = True
except Exception as _e:
    _DB_AVAILABLE = False
    _DB_IMPORT_ERROR = f'{type(_e).__name__}: {_e}'

from config import BASE_TEAM
from serializers import _db_match_to_dict
from services.fight_records import _build_fight_records_payload
from services.summary import (
    DEFINITIONS_VERSION, RESPONSE_WINDOW_SEC, DEFAULT_MIN_SAMPLE, DEFAULT_COUNTER_LIMIT,
    PERIOD_TZ, POPULATION_FIGHT_MATCHES_PLUS_MANUAL, POPULATION_ALL_MATCHES, POPULATION_LOG_FIGHTS,
    default_period, summarize_maps, summarize_opponents, summarize_period, summarize_ults,
)
from schemas_summary import (
    MapSummaryResponse, OpponentSummaryResponse, PeriodSummaryResponse, UltSummaryResponse,
)

router = APIRouter()

_DAY_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

_FROM_Q = Query(None, alias="from", description="기간 시작 YYYY-MM-DD(포함). 미지정 시 to − 13일")
_TO_Q = Query(None, description="기간 끝 YYYY-MM-DD(포함). 미지정 시 오늘(Asia/Seoul)")
_BASE_Q = Query(BASE_TEAM, description="기준 팀(기본 = 환경변수 BASE_TEAM)")


def _parse_day(value: Optional[str], name: str) -> Optional[date]:
    if value is None:
        return None
    try:
        if not _DAY_RE.match(value):
            raise ValueError
        return date.fromisoformat(value)
    except ValueError:
        raise HTTPException(status_code=422, detail=f"'{name}' must be YYYY-MM-DD")


def _resolve_period(frm: Optional[str], to: Optional[str]) -> tuple[str, str]:
    """D4 기본값: to 미지정 = 오늘(Asia/Seoul), from 미지정 = to − (DEFAULT_PERIOD_DAYS − 1)일."""
    f, t = _parse_day(frm, "from"), _parse_day(to, "to")
    if t is None:
        t = datetime.now(PERIOD_TZ).date()
    if f is None:
        f = date.fromisoformat(default_period(t)[0])
    if f > t:
        raise HTTPException(status_code=422, detail="'from' must be on or before 'to'")
    return f.isoformat(), t.isoformat()


def _meta(base_team: str, frm: str, to: str, population: str) -> dict:
    return {
        "base_team": base_team, "from": frm, "to": to,
        "generated_at": datetime.now(PERIOD_TZ).isoformat(timespec="seconds"),
        "definitions_version": DEFINITIONS_VERSION, "population": population,
    }


async def _load(base_team: str) -> tuple[dict, list]:
    """(fight-records payload, /api/scrims 형식 세션 목록). 조회 조건·정렬은 두 기존 엔드포인트와 동일."""
    if not _DB_AVAILABLE:
        raise HTTPException(status_code=503, detail="Database not available")
    try:
        from sqlalchemy.orm import selectinload
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(DBSession)
                .where(DBSession.deleted_at.is_(None))
                .options(
                    selectinload(DBSession.matches).selectinload(DBMatch.rounds).selectinload(DBRound.events),
                    selectinload(DBSession.matches).selectinload(DBMatch.pauses),
                )
                .order_by(DBSession.date.desc(), DBSession.id.desc())
            )
            sessions = result.scalars().all()
            payload = _build_fight_records_payload(sessions, base_team)
            scrims = [{
                "id": s.id, "scrim_name": s.scrim_name, "date": s.date,
                "start_time": s.start_time or "", "end_time": s.end_time or "",
                "matches": [_db_match_to_dict(m, full=False) for m in (s.matches or []) if m.deleted_at is None],
            } for s in sessions]
            return payload, scrims
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"DB error: {e}")


@router.get("/api/summary/maps", response_model=MapSummaryResponse)
async def get_summary_maps(frm: Optional[str] = _FROM_Q, to: Optional[str] = _TO_Q,
                           opponent: Optional[str] = Query(None, description="상대 팀명(정확 일치)"),
                           base_team: str = _BASE_Q):
    f, t = _resolve_period(frm, to)
    payload, scrims = await _load(base_team)
    out = summarize_maps(payload["records"], payload["match_summaries"], f, t, opponent=opponent, scrims=scrims)
    return {"meta": _meta(base_team, f, t, POPULATION_FIGHT_MATCHES_PLUS_MANUAL), **out}


@router.get("/api/summary/opponents", response_model=OpponentSummaryResponse)
async def get_summary_opponents(frm: Optional[str] = _FROM_Q, to: Optional[str] = _TO_Q,
                                base_team: str = _BASE_Q):
    f, t = _resolve_period(frm, to)
    payload, scrims = await _load(base_team)
    out = summarize_opponents(payload["records"], payload["match_summaries"], f, t, scrims=scrims)
    return {"meta": _meta(base_team, f, t, POPULATION_FIGHT_MATCHES_PLUS_MANUAL), **out}


@router.get("/api/summary/period", response_model=PeriodSummaryResponse)
async def get_summary_period(frm: Optional[str] = _FROM_Q, to: Optional[str] = _TO_Q,
                             base_team: str = _BASE_Q):
    f, t = _resolve_period(frm, to)
    _, scrims = await _load(base_team)
    out = summarize_period(scrims, f, t, base_team=base_team)
    return {"meta": _meta(base_team, f, t, POPULATION_ALL_MATCHES), **out}


@router.get("/api/summary/ults", response_model=UltSummaryResponse)
async def get_summary_ults(frm: Optional[str] = _FROM_Q, to: Optional[str] = _TO_Q,
                           opponent: Optional[str] = Query(None, description="상대 팀명(정확 일치)"),
                           response_window: float = Query(RESPONSE_WINDOW_SEC, ge=1, le=30,
                                                          description="응수 창(초), 프론트 범위 1~30"),
                           min_sample: int = Query(DEFAULT_MIN_SAMPLE, ge=1, description="카운터 행 최소 표본"),
                           limit: int = Query(DEFAULT_COUNTER_LIMIT, ge=1, le=100, description="카운터 최대 행 수"),
                           base_team: str = _BASE_Q):
    f, t = _resolve_period(frm, to)
    payload, _ = await _load(base_team)
    out = summarize_ults(payload["records"], f, t, opponent=opponent,
                         response_window=response_window, min_sample=min_sample, limit=limit)
    return {"meta": _meta(base_team, f, t, POPULATION_LOG_FIGHTS), **out}
