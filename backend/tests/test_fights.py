# -*- coding: utf-8 -*-
"""compute_fights 경계(20초 창 · 킬 +10초 연장 · 생존자 동수) 고정."""
from services.fight_analysis import compute_fights, format_fights_for_api

T1, T2 = "Alpha", "Beta"


def _kill(t, killer_team, target_team):
    return {"event_type": "kill", "timestamp": t, "game_timestamp": t,
            "player_team": killer_team, "player_name": "k", "target_team": target_team,
            "target_name": "v", "target_hero": "h", "ability": "x"}


def _ult(t, team):
    return {"event_type": "ultimate_start", "timestamp": t, "game_timestamp": t,
            "player_team": team, "player_name": "u"}


def test_initial_window_20s():
    # 궁극기(연장 없음)로 시작한 한타: 창은 시작+20초. 정확히 20.0 은 포함.
    fights = compute_fights([_ult(0, T1), _kill(20, T1, T2)], T1, T2)
    assert len(fights) == 1
    # 20.5 는 창 밖 → 새 한타
    fights = compute_fights([_ult(0, T1), _kill(20.5, T1, T2)], T1, T2)
    assert [len(f["events"]) for f in fights] == [1, 1]


def test_kill_extends_10s():
    # 15초 킬 → 종료가 max(20, 25)=25 로 연장 → 24초 킬도 같은 한타 → 34초까지 연장
    evs = [_kill(0, T1, T2), _kill(15, T1, T2), _kill(24, T2, T1), _kill(34, T2, T1), _kill(44.5, T1, T2)]
    fights = compute_fights(evs, T1, T2)
    assert [len(f["events"]) for f in fights] == [4, 1]
    assert fights[0]["duration_sec"] == 34


def test_equal_survivors_is_draw():
    fights = compute_fights([_kill(0, T1, T2), _kill(3, T2, T1)], T1, T2)
    assert len(fights) == 1
    assert (fights[0]["team1_deaths"], fights[0]["team2_deaths"]) == (1, 1)
    assert fights[0]["winner"] == "Draw"     # fight_metrics 에서 'unknown'(판정 불가)로 매핑됨
    api = format_fights_for_api(fights, T1, T2)
    assert api[0]["winner"] == "Draw" and api[0]["total_kills"] == 2
    # 한쪽이 더 많이 죽으면 생존자 많은 팀 승
    fights = compute_fights([_kill(0, T1, T2), _kill(1, T1, T2), _kill(2, T2, T1)], T1, T2)
    assert fights[0]["winner"] == T1
