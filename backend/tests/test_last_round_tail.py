# -*- coding: utf-8 -*-
"""마지막 라운드 꼬리 이벤트 배정(C1-b) 고정값 — tests/fixtures/tail_after_boundary.txt.

R2 스냅샷 hero_time_played 650(경계) < 실제 종료 700. 경계 뒤 675 ult·680 kill 은 마지막 라운드에 들어가야 하고,
상한은 match_end 시각(700) — match_end 뒤 720 kill 은 match_end 가 있으면 제외, 없으면 포함.
경계·라운드 길이·스탯과 마지막이 아닌 라운드의 이벤트는 바뀌지 않는다.
"""
from parsers.log_parser import parse_overwatch_log
from services.stats import calculate_pure_stats

FIXTURE = "tail_after_boundary.txt"


def _run(text):
    parsed = parse_overwatch_log(text)
    target = {}
    calculate_pure_stats(parsed, target, match_label=FIXTURE)
    return target["rounds"]


def _kill_times(rnd):
    return sorted(e["game_timestamp"] for e in rnd["events"] if e["event_type"] == "kill")


def _ult_times(rnd):
    return sorted(e["game_timestamp"] for e in rnd["events"] if e["event_type"] == "ultimate_start")


def test_tail_events_go_to_last_round_capped_by_match_end(fixture_text):
    r1, r2 = _run(fixture_text(FIXTURE))
    assert _kill_times(r1) == [60, 64, 66]
    assert _kill_times(r2) == [400, 430, 680]            # 680(경계 650 뒤) 포함, 720(match_end 뒤) 제외
    assert _ult_times(r2) == [675] and _ult_times(r1) == []
    types = [e["event_type"] for e in r2["events"]]
    assert "round_end" in types and "match_end" in types  # 700 의 round_end·match_end 도 꼬리였음
    assert r2["duration_sec"] == 350                      # 경계(650) 기반 길이는 그대로


def test_tail_without_match_end_has_no_upper_bound(fixture_text):
    text = "\n".join(ln for ln in fixture_text(FIXTURE).split("\n") if ",match_end," not in ln)
    r1, r2 = _run(text)
    assert _kill_times(r1) == [60, 64, 66]
    assert _kill_times(r2) == [400, 430, 680, 720]


def test_non_last_round_and_stats_unchanged_by_tail_rule(fixture_text):
    with_me = _run(fixture_text(FIXTURE))
    without_me = _run("\n".join(ln for ln in fixture_text(FIXTURE).split("\n") if ",match_end," not in ln))
    assert with_me[0]["events"] == without_me[0]["events"]
    for a, b in zip(with_me, without_me):
        assert a["stats"] == b["stats"] and a["duration_sec"] == b["duration_sec"]
