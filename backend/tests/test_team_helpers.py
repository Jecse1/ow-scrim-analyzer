# -*- coding: utf-8 -*-
"""팀명 치환·자리 바꾸기·이름 교환 DB 헬퍼(routers/scrims.py) — 인메모리 aiosqlite.

plans/test_plans.py 와 같은 StaticPool 인메모리 DB. 각 헬퍼 1케이스 + 두 번 적용 시 원상 복귀.
승자 출처(winner_source)는 이름값이 아니므로 어떤 헬퍼도 바꾸지 않는다.
"""
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from db.database import Base
from db.models import Event, Match, PlayerStat, Round, Session
from routers.scrims import (
    _exchange_team_names_in_match_db, _rename_team_in_match_db, _swap_team_slots_db,
)


@pytest.fixture
async def S():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:",
                                 connect_args={"check_same_thread": False}, poolclass=StaticPool)
    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        maker = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
        async with maker() as db:
            db.add(Session(id="s1", scrim_name="t", date="2026-10-14"))
            db.add(Match(id="m1", session_id="s1", match_index=1, map_name="눔바니",
                         team1_name="Alpha", team2_name="Beta", winner="Alpha",
                         score_t1=2, score_t2=1, result="Alpha 승 (2 : 1)",
                         winner_source="score", total_final_blows_t1=7, total_final_blows_t2=4))
            await db.flush()
            db.add(Round(id=1, match_id="m1", round_number=1, winner="Alpha",
                         final_blows_t1=7, final_blows_t2=4))
            await db.flush()
            db.add(PlayerStat(round_id=1, match_id="m1", team_name="Alpha", player_name="p1", hero_name="아나"))
            db.add(PlayerStat(round_id=1, match_id="m1", team_name="Beta", player_name="p2", hero_name="겐지"))
            db.add(Event(round_id=1, match_id="m1", event_type="kill", timestamp=1.0,
                         player_team="Alpha", target_team="Beta"))
            db.add(Event(round_id=1, match_id="m1", event_type="round_end", timestamp=2.0,
                         winner="Alpha", score_t1=2, score_t2=1))
            await db.commit()
        yield maker
    finally:
        await engine.dispose()


async def _snapshot(db):
    m = (await db.execute(select(Match).where(Match.id == "m1"))).scalars().one()
    await db.refresh(m)
    r = (await db.execute(select(Round))).scalars().one()
    await db.refresh(r)
    ps = sorted((p.player_name, p.team_name) for p in (await db.execute(select(PlayerStat))).scalars())
    evs = (await db.execute(select(Event).order_by(Event.id))).scalars().all()
    for e in evs:
        await db.refresh(e)
    return {
        "match": (m.team1_name, m.team2_name, m.winner, m.result, m.score_t1, m.score_t2,
                  m.total_final_blows_t1, m.total_final_blows_t2, m.winner_source),
        "round": (r.winner, r.final_blows_t1, r.final_blows_t2),
        "player_stats": ps,
        "events": [(e.player_team, e.target_team, e.winner, e.score_t1, e.score_t2) for e in evs],
    }


async def _apply(maker, fn, *args):
    async with maker() as db:
        m = (await db.execute(select(Match).where(Match.id == "m1"))).scalars().one()
        await fn(db, m, *args)
        await db.commit()
    async with maker() as db:
        return await _snapshot(db)


async def test_rename_includes_round_winner(S):
    async with S() as db:
        before = await _snapshot(db)
    after = await _apply(S, _rename_team_in_match_db, "Alpha", "Gamma")
    assert after["match"] == ("Gamma", "Beta", "Gamma", "Gamma 승 (2 : 1)", 2, 1, 7, 4, "score")
    assert after["round"] == ("Gamma", 7, 4)                      # rounds.winner 도 치환
    assert after["player_stats"] == [("p1", "Gamma"), ("p2", "Beta")]
    assert after["events"] == [("Gamma", "Beta", None, None, None), (None, None, "Gamma", 2, 1)]
    assert await _apply(S, _rename_team_in_match_db, "Gamma", "Alpha") == before


async def test_swap_slots_includes_result_score(S):
    async with S() as db:
        before = await _snapshot(db)
    after = await _apply(S, _swap_team_slots_db)
    # 슬롯·숫자쌍만 교환: result 점수부도 교환, 승자명·선수 소속 등 이름값은 불변
    assert after["match"] == ("Beta", "Alpha", "Alpha", "Alpha 승 (1 : 2)", 1, 2, 4, 7, "score")
    assert after["round"] == ("Alpha", 4, 7)
    assert after["player_stats"] == before["player_stats"]
    assert after["events"] == [("Alpha", "Beta", None, None, None), (None, None, "Alpha", 1, 2)]
    assert await _apply(S, _swap_team_slots_db) == before


async def test_exchange_names(S):
    async with S() as db:
        before = await _snapshot(db)
    after = await _apply(S, _exchange_team_names_in_match_db, "Alpha", "Beta")
    # 이름값만 맞교환: 슬롯 숫자쌍(score·fb)은 그대로
    assert after["match"] == ("Beta", "Alpha", "Beta", "Beta 승 (2 : 1)", 2, 1, 7, 4, "score")
    assert after["round"] == ("Beta", 7, 4)
    assert after["player_stats"] == [("p1", "Beta"), ("p2", "Alpha")]
    assert after["events"] == [("Beta", "Alpha", None, None, None), (None, None, "Beta", 2, 1)]
    assert await _apply(S, _exchange_team_names_in_match_db, "Alpha", "Beta") == before
