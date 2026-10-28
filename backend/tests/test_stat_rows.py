# -*- coding: utf-8 -*-
"""db/stat_rows.load_stat_sessions(컬럼 SELECT 로더) ↔ 기존 selectinload ORM 로드 동등성.

fight-records·full-events·player-fight-stats 빌더에 두 입력을 각각 넣어 응답 JSON 바이트가 같은지 본다.
공용 임시 DB(다른 테스트·골든이 공유)를 건드리지 않도록 이 테스트 전용 SQLite 파일·엔진을 만든다.
정렬 동점(같은 match_index·round_number·timestamp, rowid 역순 삽입)·soft delete 세션/매치·수기 매치·
기준 팀이 없는 매치·퍼즈·라운드 스탯을 일부러 넣는다.
"""
import json

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import selectinload, sessionmaker

from db.database import Base
from db.models import Event, Match, Pause, PlayerStat, Round, Session
from db.stat_rows import load_stat_sessions
from routers.stats import _db_session_to_dict_events_only
from services.fight_records import _build_fight_records_payload
from services.stats import compute_player_fight_stats

BASE = "Team A"
DELETED = "2026-10-02 00:00:00"


def _seed(db):
    from datetime import datetime
    deleted = datetime.fromisoformat(DELETED)
    db.add_all([
        Session(id="2610011900", scrim_name="s1", date="2026-10-01"),
        Session(id="2610012100", scrim_name="s2", date="2026-10-01"),       # 같은 날짜 → id DESC
        Session(id="2609300000", scrim_name="del", date="2026-09-30", deleted_at=deleted),
    ])
    matches = [  # (id, session, match_index, map, t1, t2, extra)
        ("m-b", "2610011900", 1, "리장 타워", "Team B", BASE, {}),
        ("m-a", "2610011900", 1, "남극 반도", BASE, "Team B", {"winner": BASE, "score_t1": 2}),  # 같은 index
        ("m-man", "2610011900", 2, "네팔", BASE, "Team B", {"source": "manual", "winner": "Draw"}),
        ("m-del", "2610011900", 3, "부산", BASE, "Team B", {"deleted_at": deleted}),
        ("m-other", "2610011900", 4, "일리오스", "Team C", "Team B", {}),
        ("m-s2", "2610012100", 1, "도라도", BASE, "Team C", {"winner_override": "Team C"}),
        ("m-gone", "2609300000", 1, "눔바니", BASE, "Team B", {}),
    ]
    for mid, sid, idx, mp, t1, t2, extra in matches:
        db.add(Match(id=mid, session_id=sid, match_index=idx, map_name=mp, team1_name=t1, team2_name=t2, **extra))
    rid = 100
    eid = 1000
    psid = 5000
    pzid = 9000
    for mid, _sid, _idx, _mp, t1, t2, extra in matches:
        if extra.get("source") == "manual":
            continue
        # round_number 2 가 두 개(동점), rowid 는 역순으로
        for rn in (2, 1, 2):
            rid -= 1
            db.add(Round(id=rid, match_id=mid, round_number=rn, duration_sec=100.0 + rn,
                         video_delta_sec=(5 if rn == 2 else None)))
            evs = [  # (ts, type, 공격팀, 피해팀) — 같은 ts 를 rowid 역순으로 넣어 정렬 동점 확인
                (10.0, "kill", t1, t2), (10.0, "ultimate_start", t2, ""), (10.0, "kill", t2, t1),
                (12.5, "kill", t1, t2), (40.0, "kill", t2, t1), (41.0, "ultimate_start", t1, ""),
                (5.0, "round_start", "", ""), (60.0, "round_end", "", ""),
            ]
            for k, (ts, et, pt, tt) in enumerate(evs):
                eid -= 1
                db.add(Event(id=eid, round_id=rid, match_id=mid, event_type=et, timestamp=ts,
                             game_timestamp=ts + 1, player_name=f"{pt}-p{k % 3}", player_team=pt,
                             player_hero="Ana" if k % 2 else "Reinhardt", ability="Ultimate" if k == 1 else "",
                             target_name=f"{tt}-p{k % 2}" if tt else None, target_team=tt or None,
                             target_hero="Mercy" if tt else None, round_number=rn, winner=t1 if et == "round_end" else None))
            for k, (team, pl) in enumerate([(t2, "y"), (t1, "x"), (t1, "x2")]):
                psid -= 1
                db.add(PlayerStat(id=psid, round_id=rid, match_id=mid, team_name=team, player_name=pl,
                                  hero_name="Ana" if k else "Mercy", slot_index=k, final_blows=k + 1.0,
                                  deaths=1.0, hero_damage_dealt=100.0 * k, healing_dealt=50.0,
                                  ultimates_used=1.0, hero_time_played=30.0 + k))
        for a, b in ((30, 40), (5, 9)):  # 퍼즈도 rowid 역순
            pzid -= 1
            db.add(Pause(id=pzid, match_id=mid, start_sec=a, end_sec=b, duration=b - a))


async def _orm(db, *, pauses, player_stats):
    opts = [selectinload(Session.matches).selectinload(Match.rounds).selectinload(Round.events)]
    if pauses:
        opts.append(selectinload(Session.matches).selectinload(Match.pauses))
    if player_stats:
        opts.append(selectinload(Session.matches).selectinload(Match.rounds).selectinload(Round.player_stats))
    res = await db.execute(select(Session).where(Session.deleted_at.is_(None)).options(*opts)
                           .order_by(Session.date.desc(), Session.id.desc()))
    return res.scalars().all()


def _log_only(sessions):
    for s in sessions:
        s.matches = [m for m in (s.matches or [])
                     if m.deleted_at is None and (getattr(m, "source", None) or "log") == "log"]
    return sessions


def _bytes(obj):
    return json.dumps(obj, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode("utf-8")


@pytest.fixture
async def maker(tmp_path):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'rows.db'}")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    mk = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with mk() as db:
        _seed(db)
        await db.commit()
    yield mk
    await engine.dispose()


async def test_fight_records_same_bytes(maker):
    async with maker() as db:
        rows = await load_stat_sessions(db, events=True, pauses=True)
    async with maker() as db:
        orm = await _orm(db, pauses=True, player_stats=False)
        expected = _bytes(_build_fight_records_payload(orm, BASE))
    actual = _bytes(_build_fight_records_payload(rows, BASE))
    assert json.loads(actual)["meta"]["total_fights"] > 0
    assert json.loads(actual)["meta"]["skipped_matches_without_base_team"] == 1
    assert actual == expected


async def test_full_events_same_bytes(maker):
    async with maker() as db:
        rows = _log_only(await load_stat_sessions(db, events=True, player_stats=True))
    async with maker() as db:
        orm = _log_only(await _orm(db, pauses=False, player_stats=True))
        expected = _bytes([_db_session_to_dict_events_only(s) for s in orm])
    actual = _bytes([_db_session_to_dict_events_only(s) for s in rows])
    assert [s["id"] for s in json.loads(actual)] == ["2610012100", "2610011900"]
    assert actual == expected


async def test_player_fight_stats_same_bytes(maker):
    async with maker() as db:
        rows = _log_only(await load_stat_sessions(db, events=True, player_stats=True))
    async with maker() as db:
        orm = _log_only(await _orm(db, pauses=False, player_stats=True))
        expected = _bytes(list(compute_player_fight_stats(orm, BASE).values()))
    actual = _bytes(list(compute_player_fight_stats(rows, BASE).values()))
    assert len(json.loads(actual)) > 0
    assert actual == expected


async def test_unrequested_relation_is_absent(maker):
    """요청하지 않은 관계는 빈 리스트가 아니라 속성 자체가 없다(빌더가 읽으면 바로 드러나게)."""
    async with maker() as db:
        rows = await load_stat_sessions(db, events=True)
    m = rows[-1].matches[0]
    assert not hasattr(m, "pauses") and not hasattr(m.rounds[0], "player_stats")
    assert [mm.id for mm in rows[-1].matches] == ["m-b", "m-a", "m-man", "m-other"]  # 같은 index 는 rowid 순, 삭제 제외
