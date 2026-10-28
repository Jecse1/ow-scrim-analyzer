# -*- coding: utf-8 -*-
"""routers/summary.py — 봇·외부 조회용 집계 API(GET, 읽기 전용). 집계 정의는 services/summary.py.

records·match_summaries 는 /api/fight-records 의 응답 캐시(cache.py, 키 "fight-records:{base_team}")를 그대로 재사용한다.
캐시가 없으면 같은 함수(services/fight_records.py)로 만들어 같은 키·같은 형식(JSON bytes)으로 저장한다 — 이후
/api/fight-records 도 그 캐시를 쓴다. 무효화는 기존대로 DB 변경 API 의 _invalidate_response_cache() 하나뿐(새 키·새 지점 없음).
요청마다 전 라운드 compute_fights 를 다시 돌리던 비용(FLC 서버 실측 약 10초)을 없애기 위함.
세션 목록은 /api/scrims 와 같은 직렬화(serializers._db_match_to_dict, full=False)로 매 요청 DB 에서 만든다.
services/routers → main import 금지. DB 가용성 가드는 자체 판정.
"""
import json
import re
from datetime import date, datetime
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from fastapi.concurrency import run_in_threadpool

_DB_IMPORT_ERROR = None
try:
    from sqlalchemy import select
    from db.database import AsyncSessionLocal
    from db.models import Session as DBSession, Match as DBMatch
    from db.stat_rows import load_stat_sessions
    _DB_AVAILABLE = True
except Exception as _e:
    _DB_AVAILABLE = False
    _DB_IMPORT_ERROR = f'{type(_e).__name__}: {_e}'

from config import BASE_TEAM
from cache import _response_cache_get, _response_cache_put, _json_bytes
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
    """(fight-records payload, /api/scrims 형식 세션 목록). 조회 조건·정렬은 두 기존 엔드포인트와 동일.
    payload 는 항상 캐시에 저장된 JSON bytes 를 디코드한 값을 쓴다(히트·미스 결과가 같도록)."""
    if not _DB_AVAILABLE:
        raise HTTPException(status_code=503, detail="Database not available")
    cache_key = f"fight-records:{base_team}"  # routers/stats.py get_fight_records 와 같은 키
    cached = _response_cache_get(cache_key)
    try:
        from sqlalchemy.orm import selectinload
        async with AsyncSessionLocal() as db:
            # 세션 목록용으로는 매치·퍼즈만 읽는다(라운드·이벤트 불필요) — 히트·미스 공통.
            result = await db.execute(
                select(DBSession)
                .where(DBSession.deleted_at.is_(None))
                .options(selectinload(DBSession.matches).selectinload(DBMatch.pauses))
                .order_by(DBSession.date.desc(), DBSession.id.desc())
            )
            sessions = result.scalars().all()
            scrims = [{
                "id": s.id, "scrim_name": s.scrim_name, "date": s.date,
                "start_time": s.start_time or "", "end_time": s.end_time or "",
                "matches": [_db_match_to_dict(m, full=False) for m in (s.matches or []) if m.deleted_at is None],
            } for s in sessions]
            # 캐시 미스: /api/fight-records 와 같은 컬럼 SELECT 로더 → 같은 빌더 → 같은 키에 저장.
            rows = await load_stat_sessions(db, events=True, pauses=True) if cached is None else None
        # 아래 계산·디코드는 DB 세션을 돌려준 뒤 스레드풀에서(이벤트 루프 비차단)
        if cached is not None:
            body = cached.body
        else:
            body = await run_in_threadpool(lambda: _json_bytes(_build_fight_records_payload(rows, base_team)))
            _response_cache_put(cache_key, body)
            del rows
        payload = await run_in_threadpool(json.loads, body)
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
    out = await run_in_threadpool(summarize_maps, payload["records"], payload["match_summaries"], f, t,
                                  opponent=opponent, scrims=scrims)
    return {"meta": _meta(base_team, f, t, POPULATION_FIGHT_MATCHES_PLUS_MANUAL), **out}


@router.get("/api/summary/opponents", response_model=OpponentSummaryResponse)
async def get_summary_opponents(frm: Optional[str] = _FROM_Q, to: Optional[str] = _TO_Q,
                                base_team: str = _BASE_Q):
    f, t = _resolve_period(frm, to)
    payload, scrims = await _load(base_team)
    out = await run_in_threadpool(summarize_opponents, payload["records"], payload["match_summaries"], f, t,
                                  scrims=scrims)
    return {"meta": _meta(base_team, f, t, POPULATION_FIGHT_MATCHES_PLUS_MANUAL), **out}


@router.get("/api/summary/period", response_model=PeriodSummaryResponse)
async def get_summary_period(frm: Optional[str] = _FROM_Q, to: Optional[str] = _TO_Q,
                             base_team: str = _BASE_Q):
    f, t = _resolve_period(frm, to)
    _, scrims = await _load(base_team)
    out = await run_in_threadpool(summarize_period, scrims, f, t, base_team=base_team)
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
    out = await run_in_threadpool(summarize_ults, payload["records"], f, t, opponent=opponent,
                                  response_window=response_window, min_sample=min_sample, limit=limit)
    return {"meta": _meta(base_team, f, t, POPULATION_LOG_FIGHTS), **out}
