# -*- coding: utf-8 -*-
"""승패 판정·승자 출처 회귀(tests/fixtures/*.txt 합성 로그).

현재 동작을 고정하는 테스트다 — 기대값이 '정답'이라는 보증은 아니다.
"""
import pytest

from parsers.log_parser import parse_overwatch_log
from services.stats import calculate_pure_stats
from services.winner_source import derive_winner_source

T1, T2 = "Team B", "Team A"


def _judge(text):
    parsed = parse_overwatch_log(text, custom_t1=T1, custom_t2=T2)
    m = {}
    calculate_pure_stats(parsed, m, match_label="test")
    m["source"] = "log"
    return m


@pytest.mark.parametrize("name, winner, score, source", [
    ("hybrid_score.txt", T1, (2, 1), "score"),
    ("hybrid_progress.txt", T1, (1, 1), "progress"),
    ("escort_draw.txt", "Draw", (0, 0), "undetermined"),   # 2라운드 진행도 동률 — 로그로 못 가림
    ("push.txt", "Draw", (0, 0), "undetermined"),          # 밀기 0:0 — 로그에 거리 없음
    ("control_simple.txt", T1, (2, 0), "score"),
])
def test_winner_and_source(fixture_text, name, winner, score, source):
    m = _judge(fixture_text(name))
    assert m["winner"] == winner
    assert (m["score_t1"], m["score_t2"]) == score
    assert derive_winner_source(m) == source


def test_progress_result_note(fixture_text):
    m = _judge(fixture_text("hybrid_progress.txt"))
    assert "진행도 우세" in m["result"]


def test_push_override_flow(fixture_text):
    # 밀기는 로그 판정이 항상 Draw(미확정) → winner_override 로 보정하면 출처가 override, 해제하면 undetermined 로 복귀
    m = _judge(fixture_text("push.txt"))
    m["winner_override"] = T2
    assert derive_winner_source(m) == "override"
    m["winner_override"] = None
    assert derive_winner_source(m) == "undetermined"


@pytest.mark.parametrize("match, expected", [
    ({"winner": "A", "winner_override": "B", "source": "log", "score_t1": 1, "score_t2": 0}, "override"),
    ({"winner": "A", "winner_override": "", "source": "manual", "score_t1": 0, "score_t2": 0}, "manual"),
    ({"winner": "", "winner_override": None, "source": "manual"}, None),
    ({"winner": "", "winner_override": None, "source": "log"}, None),
    ({"winner": "Draw", "source": "log", "score_t1": 2, "score_t2": 2}, "undetermined"),   # 근거(winner_detail) 없음
    ({"winner": "Draw", "source": "log", "winner_detail": {"path": "draw_match_end_tie"}}, "draw"),
    ({"winner": "Draw", "source": "log", "winner_detail": '{"path": "draw_match_end_tie"}'}, "draw"),  # DB 문자열
    ({"winner": "Draw", "source": "log", "winner_detail": {"path": "undetermined_push"}}, "undetermined"),
    ({"winner": "Draw", "source": "manual", "score_t1": 1, "score_t2": 1}, "draw"),          # 사용자 입력 무승부
    ({"winner": "Draw", "winner_override": "A", "source": "log"}, "override"),
    ({"winner": "A", "source": "log", "score_t1": 3, "score_t2": 2}, "score"),
    ({"winner": "A", "source": "log", "score_t1": 2, "score_t2": 2}, "progress"),
    ({"winner": "A", "source": None, "score_t1": None, "score_t2": 1}, "score"),
])
def test_derive_rules(match, expected):
    assert derive_winner_source(match) == expected
