# -*- coding: utf-8 -*-
"""routers/stats.py — 통계/조회 라우터(리팩토링 2단계 분리).

main.py 의 @app 엔드포인트를 APIRouter 로 이동(경로·메서드·함수명·데코레이터 인자 무변경,
@app.->@router. 만 변경). main 은 include_router(router) 로 등록.
services/routers → main import 금지: 필요한 전역은 하위 모듈에서 직접 import.
"""
from fastapi import APIRouter, HTTPException

# DB 접근(가용성 가드는 main 과 독립적으로 자체 판정 — main import 금지 규칙)
_DB_IMPORT_ERROR = None
try:
    from sqlalchemy import select
    from db.database import AsyncSessionLocal
    from db.stat_rows import load_stat_sessions
    from db.models import Session as DBSession, Match as DBMatch, Pause as DBPause, Round as DBRound, PlayerStat as DBPlayerStat, Event as DBEvent
    _DB_AVAILABLE = True
except Exception as _e:
    _DB_AVAILABLE = False
    _DB_IMPORT_ERROR = f'{type(_e).__name__}: {_e}'

from config import (
    BASE_TEAM,
    MIN_SAMPLE_FOR_PERCENTILE_FIGHTS, MIN_SAMPLE_FOR_PERCENTILE_ROUNDS,
    PERCENTILE_MIN_POOL, TRADE_WINDOW_SEC, effective_video_delta,
)
from functools import partial
from fastapi.concurrency import run_in_threadpool
from fastapi.encoders import jsonable_encoder
from cache import cache_get_or_compute, register_warmer, _json_bytes, _json_response
from parsers.log_parser import resolve_map_type, is_match_level_map
from serializers import (
    _db_event_to_dict, _db_player_stat_to_dict, _aggregate_match_stats, _db_session_to_dict,
)
from services.fight_analysis import compute_fights, format_fights_for_api
from services.fight_metrics import (
    _build_match_pauses, _fight_to_record, _fightlab_side, _fightlab_hero_role,
)
from services.stats import compute_player_fight_stats
from services.fight_records import _build_fight_records_payload

router = APIRouter()


async def _compute_scrims() -> bytes:
    """/api/scrims 본문 bytes. 바이트는 기존(FastAPI 기본 직렬화: jsonable_encoder → JSONResponse)과 같다."""
    from sqlalchemy.orm import selectinload
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(DBSession)
            .where(DBSession.deleted_at.is_(None))
            .options(
                selectinload(DBSession.matches).selectinload(DBMatch.pauses),
            )
            .order_by(DBSession.date.desc(), DBSession.id.desc())
        )
        sessions = result.scalars().all()
        for s in sessions:
            s.matches = [m for m in (s.matches or []) if m.deleted_at is None]
        data = [_db_session_to_dict(s, full=False) for s in sessions]
    return _json_bytes(jsonable_encoder(data))


@router.get("/api/scrims")
async def get_scrim_list():
    # 세션 목록(경량). 응답 캐시 키 "scrims" — 히트면 DB 왕복 없이 저장된 bytes 그대로(무효화 규칙은 다른 키와 같음).
    # (docstring 이 아닌 주석: openapi 설명 불변)
    if not _DB_AVAILABLE:
        raise HTTPException(status_code=503, detail="Database not available")
    try:
        return _json_response(await cache_get_or_compute("scrims", _compute_scrims))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"DB error: {e}")


def _db_match_to_dict_events_only(m: "DBMatch") -> dict:
    """stats + rounds.events만. dynamicPlayersData, UltimateStats, FirstKillStats, FirstDeathStats 전용."""
    return {
        "id": m.id,
        "match_index": m.match_index,
        "map_name": m.map_name,
        "team1_name": m.team1_name,
        "team2_name": m.team2_name,
        "team_1_name": m.team1_name,
        "team_2_name": m.team2_name,
        # winner = 유효 승자(수기 보정 우선) — _db_match_to_dict와 동일 규칙.
        "winner": (m.winner_override or m.winner) or "",
        "winner_original": m.winner or "",
        "winner_override": m.winner_override or "",
        "stats": _aggregate_match_stats(m),
        "rounds": [
            {
                "round_number": r.round_number,
                # 라운드별 VOD 보정(모먼트 링크용): 직접 입력값(null=자동)과 실제 적용값
                "video_delta_sec": getattr(r, "video_delta_sec", None),
                "effective_delta": effective_video_delta(
                    getattr(r, "video_delta_sec", None), resolve_map_type(m.map_name), r.round_number),
                # 라운드별 선수 스탯 — 전체 통계 탭이 matches/{id} 대신 이 응답을 쓰기 위해 필요.
                # (player_stats는 위 stats 집계용으로 이미 로드되어 있어 추가 DB 비용 없음)
                "stats": [_db_player_stat_to_dict(ps) for ps in (r.player_stats or [])],
                "events": [_db_event_to_dict(ev) for ev in (r.events or [])]
            }
            for r in (m.rounds or [])
        ],
    }


def _db_session_to_dict_events_only(s: "DBSession") -> dict:
    return {
        "id": s.id,
        "scrim_name": s.scrim_name,
        "date": s.date,
        "matches": [
            _db_match_to_dict_events_only(m)
            for m in (s.matches or [])
            if m.deleted_at is None
        ],
    }


async def _compute_full_events() -> bytes:
    async with AsyncSessionLocal() as db:
        sessions = await load_stat_sessions(db, events=True, player_stats=True)
    for s in sessions:
        # 수기(source='manual') 매치 제외 — 이 응답은 로그 표본(이벤트) 전용
        s.matches = [m for m in (s.matches or []) if m.deleted_at is None and (getattr(m, 'source', None) or 'log') == 'log']
    # 변환·직렬화는 스레드풀(로더 출력은 DB 세션과 무관한 행 객체라 루프 밖에서 읽어도 안전)
    return await run_in_threadpool(
        lambda: _json_bytes([_db_session_to_dict_events_only(s) for s in sessions]))


@router.get("/api/scrims/full-events")
async def get_scrims_full_events():
    """UltimateStats, FirstKillStats, FirstDeathStats, dynamicPlayersData 전용.
    stats + rounds.events 포함. fights/pauses/timeline/fight_metrics 제외."""
    if not _DB_AVAILABLE:
        raise HTTPException(status_code=503, detail="Database not available")
    try:
        return _json_response(await cache_get_or_compute("full-events", _compute_full_events))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"DB error: {e}")


def _first_fight_from_events(events: list, t1: str, t2: str):
    """compute_fights/format_fights_for_api 재사용. 가장 먼저 시작된 한타 1개(dict) 또는 None."""
    ev_dicts = [_db_event_to_dict(ev) for ev in (events or [])]
    fights = format_fights_for_api(compute_fights(ev_dicts, t1, t2), t1, t2)
    return fights[0] if fights else None


def _round_start_sec(r: "DBRound", m: "DBMatch") -> float:
    """라운드 시작 시점을 '실제(real) 좌표' 초로 반환. buildVideoLink가 game_setup_sec를 빼서
    영상 위치로 환산하므로, 여기서는 -2 보정을 되돌린 real 좌표를 돌려준다 (round 1 == game_setup_sec).

    events.timestamp는 -2 보정된 stored 좌표, rounds.duration_sec는 게임시간 누적이므로
    (round_end_ts - duration_sec)는 stored 좌표의 라운드 시작이고, +2 하면 real 좌표가 된다.
    round_start 이벤트 자체는 결측/부정확이 많아 쓰지 않는다.
    """
    round_end_ts = None
    for ev in (r.events or []):
        if ev.event_type == "round_end" and ev.timestamp is not None:
            if round_end_ts is None or ev.timestamp > round_end_ts:
                round_end_ts = ev.timestamp
    if round_end_ts is not None and r.duration_sec is not None:
        return (round_end_ts - r.duration_sec) + 2.0
    # 폴백 1: 1라운드는 game_setup_sec(=real 좌표 라운드 시작)
    if r.round_number == 1 and m.game_setup_sec is not None:
        return float(m.game_setup_sec)
    # 폴백 2: 라운드 첫 교전 이벤트(real 좌표). round_end 결측 + 비1라운드인 드문 경우.
    kts = [ev.timestamp for ev in (r.events or [])
           if ev.event_type in ("kill", "ultimate_start") and ev.timestamp is not None]
    if kts:
        return min(kts) + 2.0
    return 0.0


def _first_fight_item(m: "DBMatch", s: "DBSession", map_type: str,
                      round_number, fight: dict, round_start_sec: float,
                      effective_delta: int = 0) -> dict:
    """첫 한타 1건을 평탄한 응답 항목으로 직렬화."""
    return {
        "session_id": s.id,
        "session_date": s.date,
        "match_id": m.id,
        "match_index": m.match_index,
        "map_name": m.map_name,
        "map_type": map_type,
        "team1_name": m.team1_name,
        "team2_name": m.team2_name,
        "round_number": round_number,
        # 라운드 전환 연출 타이머 정지 보정(초) — 프론트 buildVideoLink에서 t에 가산
        "effective_delta": effective_delta,
        "start_timestamp": fight.get("start_timestamp"),
        "start_game_timestamp": fight.get("start_game_timestamp"),
        "round_start_sec": round_start_sec,  # real 좌표 라운드 시작 (영상 점프 기준점)
        "video_url": m.video_url or "",
        "video_offset": m.video_offset or 0,
        "game_setup_sec": m.game_setup_sec,
        "pauses": _build_match_pauses(m),
    }


@router.get("/api/first-fights")
async def get_first_fights():
    """첫 한타(첫 교전) 모아보기 전용. 맵 종류 규칙에 따라 라운드/매치별 첫 한타를 평탄한 리스트로 반환.
    - 쟁탈/화물/혼합/격돌: 라운드마다 첫 한타 1개씩 (round_number 채움).
    - 플래시포인트/밀기: 매치 전체에서 가장 먼저 시작된 한타 1개만 (round_number = None).
    한타가 0개인 라운드/매치는 건너뜀. soft-delete(deleted_at) 숨김. compute_fights 재사용·미수정.
    """
    if not _DB_AVAILABLE:
        raise HTTPException(status_code=503, detail="Database not available")
    try:
        from sqlalchemy.orm import selectinload
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(DBSession)
                .where(DBSession.deleted_at.is_(None))
                .options(
                    selectinload(DBSession.matches).options(
                        selectinload(DBMatch.pauses),
                        selectinload(DBMatch.rounds).selectinload(DBRound.events),
                    )
                )
                .order_by(DBSession.date.desc(), DBSession.id.desc())
            )
            sessions = result.scalars().all()

            items: list = []
            for s in sessions:
                for m in (s.matches or []):
                    if m.deleted_at is not None:
                        continue
                    if (getattr(m, 'source', None) or 'log') != 'log':
                        continue  # 수기 매치 — 이벤트 없음, 로그 표본 지표에서 제외
                    t1, t2 = m.team1_name, m.team2_name
                    map_type = resolve_map_type(m.map_name)
                    rounds = m.rounds or []
                    if is_match_level_map(map_type):
                        # 매치 전체 이벤트에서 첫 한타 1개 (가장 먼저 시작된 = 첫 라운드의 첫 한타)
                        all_events = [ev for r in rounds for ev in (r.events or [])]
                        fight = _first_fight_from_events(all_events, t1, t2)
                        if fight and rounds:
                            rs = _round_start_sec(rounds[0], m)  # 첫 라운드 시작 기준
                            fd = effective_video_delta(
                                getattr(rounds[0], "video_delta_sec", None), map_type, rounds[0].round_number)
                            items.append(_first_fight_item(m, s, map_type, None, fight, rs, fd))
                    else:
                        # 라운드마다 첫 한타 1개씩
                        for r in rounds:
                            fight = _first_fight_from_events(r.events or [], t1, t2)
                            if fight:
                                rs = _round_start_sec(r, m)
                                fd = effective_video_delta(
                                    getattr(r, "video_delta_sec", None), map_type, r.round_number)
                                items.append(_first_fight_item(m, s, map_type, r.round_number, fight, rs, fd))
            return items
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"DB error: {e}")


async def _compute_fight_records(base_team: str) -> bytes:
    async with AsyncSessionLocal() as db:
        sessions = await load_stat_sessions(db, events=True, pauses=True)
    # 변환(한타 계산)·직렬화는 스레드풀
    return await run_in_threadpool(lambda: _json_bytes(_build_fight_records_payload(sessions, base_team)))


@router.get("/api/fight-records")
async def get_fight_records(base_team: str = BASE_TEAM):
    """한타 분석(베타) 탭 전용. 모든 한타를 평탄 리스트로 반환하고 프론트가 기간별 집계만 수행.
    - 한타 그룹핑/승자: compute_fights 재사용(미수정). 라운드 단위로 계산(기존 UltimateStats와 동일).
    - 승자 판정: 생존자 수 비교(fight_analysis.py). 무승부(동수)는 winner='unknown' → 프론트 집계 제외.
    - base_team(기본값 = 환경변수 BASE_TEAM)이 참가하지 않은 매치는 건너뜀. soft-delete(deleted_at) 숨김.
    """
    if not _DB_AVAILABLE:
        raise HTTPException(status_code=503, detail="Database not available")
    try:
        return _json_response(await cache_get_or_compute(
            f"fight-records:{base_team}", partial(_compute_fight_records, base_team)))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"DB error: {e}")


async def _compute_player_fight_stats(base_team: str) -> bytes:
    async with AsyncSessionLocal() as db:
        sessions = await load_stat_sessions(db, events=True, player_stats=True)
    for _s in sessions:
        # 수기(source='manual') 매치 제외 — 선수 통계는 로그 표본 전용
        _s.matches = [m for m in (_s.matches or [])
                      if m.deleted_at is None and (getattr(m, 'source', None) or 'log') == 'log']

    def _build() -> bytes:  # 집계·직렬화 — 스레드풀
        items = compute_player_fight_stats(sessions, base_team)

        payload = {
            "meta": {
                "base_team": base_team,
                "min_sample_for_percentile_fights": MIN_SAMPLE_FOR_PERCENTILE_FIGHTS,
                "min_sample_for_percentile_rounds": MIN_SAMPLE_FOR_PERCENTILE_ROUNDS,
                "percentile_min_pool": PERCENTILE_MIN_POOL,
                "items": len(items),
            },
            "items": list(items.values()),
        }
        return _json_bytes(payload)

    return await run_in_threadpool(_build)


@router.get("/api/player-fight-stats")
async def get_player_fight_stats(base_team: str = BASE_TEAM):
    """선수별 한타/라운드 지표의 원자료.
    - 한타 지표: 라운드별 compute_fights 결과에서 선수·영웅 단위로 집계.
      · fights(한타 수)는 그 라운드에 player_stats 엔트리가 있는 선수(=출전)에게 라운드의 한타 수를 부여.
      · kp_sum/kp_fights: 팀 킬>0인 한타에서 (본인 킬/팀 킬)의 합과 그 한타 수 → 킬 관여율 = kp_sum/kp_fights.
      · first_kills/first_deaths: 한타 첫 킬의 킬러/희생자 기준.
      · ult_*: 한타 내 ultimate_start 기준. ult_fight_known은 승자 판정 가능한 궁 사용 한타 수.
    - 라운드 지표: player_stats(라운드 요약)를 그대로 합산. duration_sec 없는(<=0) 라운드는 제외.
    - side: base_team(기준 팀) 기준 'us'/'them'. 상대 선수도 동일 구조로 집계(백분위 풀·상대 시점용).
    """
    if not _DB_AVAILABLE:
        raise HTTPException(status_code=503, detail="Database not available")
    try:
        return _json_response(await cache_get_or_compute(
            f"player-fight-stats:{base_team}", partial(_compute_player_fight_stats, base_team)))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"DB error: {e}")


# 선채우기 대상·순서(cache.py): 목록 → 전체 이벤트 → 한타 기록(기준 팀) → 선수 한타 통계(기준 팀).
# summary 4종은 fight-records 키를 공유하므로 따로 등록하지 않는다.
register_warmer("scrims", _compute_scrims)
register_warmer("full-events", _compute_full_events)
register_warmer(f"fight-records:{BASE_TEAM}", partial(_compute_fight_records, BASE_TEAM))
register_warmer(f"player-fight-stats:{BASE_TEAM}", partial(_compute_player_fight_stats, BASE_TEAM))
