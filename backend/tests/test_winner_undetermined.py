# -*- coding: utf-8 -*-
"""무승부 재분류(실제 무승부 draw / 미확정 undetermined)와 winner_detail·기동 백필 고정값."""
import json
import os
import tempfile

import pytest
from sqlalchemy import create_engine, text

from db.database import Base, _backfill_draw_detail, _backfill_winner_source
from parsers.log_parser import parse_overwatch_log
from services.stats import calculate_pure_stats
from services.winner_source import WINNER_PATHS, classify_draw_path


@pytest.mark.parametrize("mode, rounds, has_me, t1, t2, expected", [
    ("밀기", 1, True, 0, 0, "undetermined_push"),
    ("Push", 1, False, None, None, "undetermined_push"),
    ("혼합", 3, True, 3, 3, "draw_match_end_tie"),        # 연장 라운드까지 + match_end 동점 = 실제 무승부
    ("화물", 4, True, 2, 2, "draw_match_end_tie"),
    ("Escort", 3, True, 2, 2, "draw_match_end_tie"),
    ("혼합", 3, False, None, None, "undetermined_no_match_end"),
    ("혼합", 2, True, 3, 3, "undetermined_progress_tie"),  # 2라운드 동점 — 진행도 10% 단위로 못 가림
    ("화물", 2, False, None, None, "undetermined_progress_tie"),
    ("쟁탈", 2, False, None, None, "undetermined_score_tie"),
    ("플래시포인트", 1, False, None, None, "undetermined_score_tie"),
    ("", 0, False, None, None, "undetermined_score_tie"),
])
def test_classify_draw_path(mode, rounds, has_me, t1, t2, expected):
    assert classify_draw_path(mode, rounds, has_me, t1, t2) == expected


@pytest.mark.parametrize("name, path", [
    ("hybrid_score.txt", "score"),
    ("hybrid_progress.txt", "progress"),
    ("escort_draw.txt", "undetermined_progress_tie"),
    ("push.txt", "undetermined_push"),
    ("control_simple.txt", "score"),
])
def test_winner_detail_from_parse(fixture_text, name, path):
    parsed = parse_overwatch_log(fixture_text(name), custom_t1="Team B", custom_t2="Team A")
    m = {}
    calculate_pure_stats(parsed, m, match_label=name)
    d = m["winner_detail"]
    assert d["path"] == path and d["path"] in WINNER_PATHS
    assert set(d) == {"path", "rounds", "match_end", "prog_t1", "prog_t2"}
    assert set(d["match_end"]) == {"present", "t1", "t2"}


def _engine():
    path = os.path.join(tempfile.mkdtemp(prefix="wu_"), "b.db")
    eng = create_engine(f"sqlite:///{path}")
    from db import models  # noqa: F401
    Base.metadata.create_all(eng)
    return eng


_MATCHES = [
    # id, map, winner, override, source, s1, s2, winner_source(기존), winner_detail(기존)
    ("push", "콜로세오", "Draw", None, "log", 0, 0, "draw", None),
    ("hyb3tie", "왕의 길", "Draw", None, "log", 3, 3, "draw", None),
    ("hyb3nome", "왕의 길", "Draw", None, "log", 3, 3, "draw", None),
    ("ctrl", "리장 타워", "Draw", None, "log", 1, 1, "draw", None),
    ("manual_draw", "리장 타워", "Draw", None, "manual", 1, 1, "manual", None),
    ("ov", "콜로세오", "Draw", "A", "log", 0, 0, "override", None),
    ("score", "리장 타워", "A", None, "log", 2, 0, "score", None),
    ("hasdetail", "도라도", "Draw", None, "log", 3, 3, "draw", json.dumps({"path": "draw_match_end_tie"})),
    ("nullws", "콜로세오", "Draw", None, "log", 0, 0, None, None),
]


def _seed(eng):
    with eng.begin() as c:
        for mid, mp, w, ov, src, s1, s2, ws, wd in _MATCHES:
            c.execute(text("INSERT INTO matches (id, session_id, match_index, map_name, team1_name, team2_name, winner, "
                           "winner_override, source, score_t1, score_t2, winner_source, winner_detail) VALUES "
                           "(:id, 's', 1, :mp, 'A', 'B', :w, :ov, :src, :s1, :s2, :ws, :wd)"),
                      dict(id=mid, mp=mp, w=w, ov=ov, src=src, s1=s1, s2=s2, ws=ws, wd=wd))
        def ev(mid, et, ts, rnum=None, s1=None, s2=None):
            c.execute(text("INSERT INTO events (round_id, match_id, event_type, timestamp, game_timestamp, round_number, "
                           "score_t1, score_t2) VALUES (0, :m, :et, :ts, :ts, :r, :s1, :s2)"),
                      dict(m=mid, et=et, ts=ts, r=rnum, s1=s1, s2=s2))
        for r in (1, 2, 3):
            ev("hyb3tie", "round_start", r * 100.0, r)
            ev("hyb3nome", "round_start", r * 100.0, r)
        ev("hyb3tie", "match_end", 900.0, None, 3, 3)
        ev("ctrl", "round_start", 0.0, 1); ev("ctrl", "round_start", 300.0, 2)


def _snapshot(eng):
    with eng.connect() as c:
        return [tuple(r) for r in c.execute(text("SELECT id, winner_source, winner_detail FROM matches ORDER BY id"))]


def test_backfill_reclassifies_draws_and_is_idempotent():
    eng = _engine()
    _seed(eng)
    for _ in range(2):
        with eng.begin() as c:
            _backfill_winner_source(c)
            _backfill_draw_detail(c)
        if _ == 0:
            first = _snapshot(eng)
    assert _snapshot(eng) == first                      # 두 번째 실행은 변화 없음(멱등)
    got = {mid: (ws, json.loads(wd) if wd else None) for mid, ws, wd in first}
    assert got["push"][0] == "undetermined" and got["push"][1]["path"] == "undetermined_push"
    assert got["hyb3tie"][0] == "draw" and got["hyb3tie"][1]["match_end"] == {"present": True, "t1": 3, "t2": 3}
    assert got["hyb3tie"][1]["rounds"] == 3 and got["hyb3tie"][1]["prog_t1"] is None   # 진행도는 백필 안 함
    assert got["hyb3nome"][0] == "undetermined" and got["hyb3nome"][1]["path"] == "undetermined_no_match_end"
    assert got["ctrl"][0] == "undetermined" and got["ctrl"][1]["path"] == "undetermined_score_tie"
    assert got["manual_draw"] == ("draw", None)         # 사용자 입력 무승부 = 실제 무승부(근거 기록 없음)
    assert got["ov"] == ("override", None)              # 보정된 매치는 대상 아님
    assert got["score"] == ("score", None)
    assert got["hasdetail"] == ("draw", {"path": "draw_match_end_tie"})   # 기존 근거는 덮지 않음
    assert got["nullws"][0] == "undetermined"
