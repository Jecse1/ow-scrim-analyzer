# -*- coding: utf-8 -*-
"""공수 판정(services/round_side.py)과 round_start 라운드 소속 고정값."""
import os
import sqlite3

import pytest

from parsers.log_parser import parse_overwatch_log
from services.round_side import SIDE_MODES, attacker_at, load_round_starts, side_label
from services.stats import calculate_pure_stats

FIXTURE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures")
RS = [(6.0, "A"), (300.0, "B"), (600.0, "A")]


def test_load_round_starts_sorted_and_stripped():
    con = sqlite3.connect(":memory:")
    cur = con.cursor()
    cur.execute("CREATE TABLE events (match_id TEXT, event_type TEXT, timestamp REAL, attacker TEXT)")
    cur.executemany("INSERT INTO events VALUES (?,?,?,?)", [
        ("m1", "round_start", 300.0, " B "), ("m1", "round_start", 6.0, "A"), ("m1", "kill", 10.0, None),
        ("m2", "round_start", 1.0, "Z"), ("m1", "round_start", 600.0, None),
    ])
    assert load_round_starts(cur, "m1") == [(6.0, "A"), (300.0, "B"), (600.0, "")]


@pytest.mark.parametrize("ts, expected", [
    (0.0, ""),       # 첫 round_start 이전
    (6.0, "A"),      # 경계 시각 포함(이하)
    (299.9, "A"),
    (300.0, "B"),
    (10_000.0, "A"),
])
def test_attacker_at(ts, expected):
    assert attacker_at(RS, ts) == expected


@pytest.mark.parametrize("mode, team, expected", [
    ("혼합", "B", "공"), ("Hybrid", "A", "수"), ("화물", "B", "공"), ("호위", "B", "공"),
    ("Escort", "B", "공"), ("격돌", "A", "수"), ("Clash", "B", "공"),
    ("쟁탈", "B", "무"), ("플래시포인트", "B", "무"), ("밀기", "B", "무"), ("", "B", "무"),
])
def test_side_label_modes(mode, team, expected):
    assert side_label(mode, team, "A", "B", RS, 400.0) == expected


def test_side_label_unknown_attacker_is_draw():
    assert side_label("혼합", "A", "A", "B", [(0.0, "0")], 10.0) == "무"
    assert {"혼합", "화물", "격돌"} <= SIDE_MODES


@pytest.mark.parametrize("name", ["control_simple.txt", "hybrid_progress.txt", "hybrid_score.txt", "escort_draw.txt", "push.txt"])
def test_round_start_belongs_to_round_it_starts(name):
    # 경계 시각의 round_start 는 시작하는 라운드 소속(services/stats.py 라운드 배정)
    with open(os.path.join(FIXTURE_DIR, name), encoding="utf-8") as f:
        parsed = parse_overwatch_log(f.read())
    target = {}
    calculate_pure_stats(parsed, target, match_label=name)
    placed = [(r["round_number"], e["round_number"]) for r in target["rounds"]
              for e in r["events"] if e["event_type"] == "round_start"]
    assert placed and all(db_r == log_r for db_r, log_r in placed), placed
    n_log = sum(1 for e in parsed["events"] if e["event_type"] == "round_start")
    assert len(placed) == n_log
