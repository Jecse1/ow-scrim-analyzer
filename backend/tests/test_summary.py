# -*- coding: utf-8 -*-
"""집계 API(/api/summary/*)·세션 완료(/api/sessions/{id}/complete) 회귀 테스트.

임시 DB(backend/conftest.py 의 SCRIM_DB_PATH)에 샘플 로그 + 합성 픽스처로 세션 2개를 등록하고
(수기 매치·winner_override·밀기·한글 상대팀명·로그 미업로드 매치 포함) 응답을 골든과 바이트 비교한다.
의도된 정의 변경이면 `python -m pytest tests/test_summary.py --update-golden` 으로만 갱신한다.
"""
import json
import os
import time

import pytest
from fastapi.testclient import TestClient

import golden_util

GOLDEN_SUMMARY = os.path.join(os.path.dirname(os.path.abspath(__file__)), "golden", "summary_sample.json")
FIXTURE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures")
BASE = "Team A"
ALL = {"from": "2000-01-01", "to": "2099-12-31", "base_team": BASE}


def _m(map_name, t1, t2, **kw):
    d = {"map_name": map_name, "team1Name": t1, "team2Name": t2,
         "start_time": "00:00", "end_time": "00:00", "result": "Unknown"}
    d.update(kw)
    return d


def _register(c, name, day, start, end, matches):
    r = c.post("/api/scrim/manual-register",
               json={"scrimName": name, "date": day, "startHour": start, "endHour": end, "matches": matches})
    assert r.status_code == 200, r.text
    return r.json()["scrim_id"]


def _upload(c, sid, idx, path):
    with open(path, "rb") as f:
        r = c.post("/api/matches/upload", data={"scrim_id": sid, "match_index": str(idx)},
                   files={"file": ("log.txt", f.read(), "text/plain")})
    assert r.status_code == 200, r.text


def _seed(c):
    s1 = _register(c, "261001-Team B", "2026-10-01", "19", "21", [
        _m("남극 반도", BASE, "Team B"),
        _m("뉴 퀸 스트리트", BASE, "Team B"),
        _m("네팔", BASE, "Team B", source="manual", winner=BASE, score_t1=2, score_t2=1),
    ])
    _upload(c, s1, 1, golden_util.SAMPLE_LOG)
    _upload(c, s1, 2, os.path.join(FIXTURE_DIR, "push.txt"))
    s2 = _register(c, "261008-팀C", "2026-10-08", "20", "22", [
        _m("리장 타워", BASE, "팀C"),
        _m("도라도", "팀C", BASE),
        _m("눔바니", BASE, "팀C"),
        _m("왕의 길", "팀C", BASE),
        _m("부산", BASE, "팀C"),                    # 로그 미업로드 → 승자 빈값·한타 0
        _m("일리오스", BASE, "팀C", source="manual", winner="Draw", score_t1=1, score_t2=1),
        _m("하나오카", BASE, "팀C", source="manual"),  # 수기 + 승자 미정(빈값) → D7
    ])
    for i, f in ((1, "control_simple.txt"), (2, "escort_draw.txt"), (3, "hybrid_progress.txt"), (4, "hybrid_score.txt")):
        _upload(c, s2, i, os.path.join(FIXTURE_DIR, f))
    push = [m for s in c.get("/api/scrims").json() for m in s["matches"] if m["map_name"] == "뉴 퀸 스트리트"][0]
    r = c.patch(f"/api/matches/{push['id']}/winner-override", json={"winner_override": BASE})
    assert r.status_code == 200, r.text
    return s1, s2


@pytest.fixture(scope="module")
def seeded():
    import main
    with TestClient(main.app) as c:
        s1, s2 = _seed(c)
        yield c, s1, s2


def _no_meta_time(body):
    body = dict(body)
    meta = dict(body.pop("meta"))
    meta.pop("generated_at")
    return {"meta": meta, **body}


def _build_golden(c, s2, monkeypatch) -> bytes:
    import routers.scrims as rs
    captured = []
    monkeypatch.setattr(rs, "BASE_TEAM", BASE)
    monkeypatch.setattr(rs._config, "DISCORD_WEBHOOK_URL", "http://example.invalid/hook")
    monkeypatch.setattr(rs, "schedule_webhook", lambda url, build: captured.append(build()))
    out = {
        "maps": _no_meta_time(c.get("/api/summary/maps", params=ALL).json()),
        "maps_opponent_팀C": _no_meta_time(c.get("/api/summary/maps", params={**ALL, "opponent": "팀C"}).json()),
        "maps_2026-10-01": _no_meta_time(c.get("/api/summary/maps", params={**ALL, "from": "2026-10-01", "to": "2026-10-01"}).json()),
        "opponents": _no_meta_time(c.get("/api/summary/opponents", params=ALL).json()),
        "period": _no_meta_time(c.get("/api/summary/period", params=ALL).json()),
        "period_team_b": _no_meta_time(c.get("/api/summary/period", params={**ALL, "base_team": "Team B"}).json()),
        "ults_min1": _no_meta_time(c.get("/api/summary/ults", params={**ALL, "min_sample": 1, "limit": 100}).json()),
        "ults_default": _no_meta_time(c.get("/api/summary/ults", params=ALL).json()),
        "complete": c.post(f"/api/sessions/{s2}/complete").json(),
        "webhook_content": captured,
    }
    text = json.dumps(out, ensure_ascii=False, sort_keys=True, indent=1)
    return (text + "\n").encode("utf-8")


def test_summary_golden(seeded, update_golden, monkeypatch):
    c, _s1, s2 = seeded
    actual = _build_golden(c, s2, monkeypatch)
    if update_golden:
        with open(GOLDEN_SUMMARY, "wb") as f:
            f.write(actual)
    with open(GOLDEN_SUMMARY, "rb") as f:
        expected = f.read()
    assert actual == expected, "summary 골든 불일치 — 집계 정의/출력이 바뀌었다(의도된 변경이면 --update-golden)"


def test_summary_endpoints_validate_models(seeded):
    from schemas_summary import (MapSummaryResponse, OpponentSummaryResponse,
                                 PeriodSummaryResponse, UltSummaryResponse)
    c, _s1, _s2 = seeded
    cases = [
        ("maps", MapSummaryResponse, "fight_matches_plus_manual"),
        ("opponents", OpponentSummaryResponse, "fight_matches_plus_manual"),
        ("period", PeriodSummaryResponse, "all_matches"),
        ("ults", UltSummaryResponse, "log_fights"),
    ]
    for name, model, population in cases:
        r = c.get(f"/api/summary/{name}", params=ALL)
        assert r.status_code == 200, (name, r.text)
        body = model.model_validate(r.json())
        assert body.meta.definitions_version == "1"
        assert body.meta.population == population
        assert (body.meta.from_, body.meta.to, body.meta.base_team) == ("2000-01-01", "2099-12-31", BASE)


def test_summary_default_period_and_422(seeded):
    c, _s1, _s2 = seeded
    meta = c.get("/api/summary/period", params={"base_team": BASE}).json()["meta"]
    from datetime import date
    f, t = date.fromisoformat(meta["from"]), date.fromisoformat(meta["to"])
    assert (t - f).days == 13
    for q in ({"from": "2026-1-01"}, {"to": "2026-W40-1"}, {"to": "2026-02-30"},
              {"from": "2026-10-10", "to": "2026-10-01"}):
        assert c.get("/api/summary/maps", params=q).status_code == 422, q
    assert c.get("/api/summary/ults", params={"response_window": 0}).status_code == 422
    assert c.get("/api/summary/ults", params={"limit": 0}).status_code == 422


def test_complete_404_missing_and_deleted(seeded):
    c, _s1, _s2 = seeded
    assert c.post("/api/sessions/no-such-session/complete").status_code == 404
    sid = _register(c, "261009-삭제용", "2026-10-09", "10", "11", [_m("네팔", BASE, "X", source="manual", winner=BASE)])
    assert c.post(f"/api/sessions/{sid}/complete").status_code == 200
    assert c.delete(f"/api/sessions/{sid}").status_code == 200
    assert c.post(f"/api/sessions/{sid}/complete").status_code == 404


def test_complete_disabled_is_noop_and_idempotent(seeded, monkeypatch):
    import routers.scrims as rs
    c, _s1, s2 = seeded
    monkeypatch.setattr(rs, "BASE_TEAM", BASE)
    monkeypatch.setattr(rs._config, "DISCORD_WEBHOOK_URL", "")
    called = []
    monkeypatch.setattr(rs, "schedule_webhook", lambda *a: called.append(a))
    before = c.get("/api/scrims").json()
    r1, r2 = c.post(f"/api/sessions/{s2}/complete"), c.post(f"/api/sessions/{s2}/complete")
    assert r1.status_code == r2.status_code == 200
    assert r1.json() == r2.json()
    assert r1.json()["webhook"] == "disabled" and r1.json()["status"] == "ok"
    assert called == []
    assert c.get("/api/scrims").json() == before   # DB 무변경


def test_complete_dummy_url_failure_is_isolated(seeded, monkeypatch, caplog):
    import routers.scrims as rs
    from services import discord_webhook as dw
    c, _s1, s2 = seeded
    dummy = "http://127.0.0.1:9/"   # discard 포트 — 연결 거부가 즉시 발생
    monkeypatch.setattr(rs, "BASE_TEAM", BASE)
    monkeypatch.setattr(rs._config, "DISCORD_WEBHOOK_URL", dummy)
    caplog.set_level("WARNING", logger="scrim.webhook")
    r = c.post(f"/api/sessions/{s2}/complete")
    assert r.status_code == 200
    assert r.json()["webhook"] == "queued"
    deadline = time.time() + 10
    while dw._PENDING and time.time() < deadline:
        time.sleep(0.05)
    assert not dw._PENDING, "webhook task did not finish"
    recs = [x for x in caplog.records if x.name == "scrim.webhook"]
    assert len(recs) == 1 and recs[0].levelname == "WARNING"
    assert "discord webhook failed" in recs[0].getMessage()
    assert dummy not in caplog.text and "127.0.0.1:9" not in caplog.text   # URL 미기록


def test_session_message_truncation_and_id():
    from services.summary import format_session_message
    scrim = {"id": "2610081234", "date": "2026-10-08", "scrim_name": "261008-팀C",
             "matches": [{"map_name": "리장 타워", "team1_name": BASE, "team2_name": "팀C",
                          "winner": BASE, "score_t1": 2, "score_t2": 0}] * 300}
    msg = format_session_message(scrim, BASE)
    lines = msg.split("\n")
    assert len(msg) <= 2000
    assert lines[0] == "```" and lines[-1] == "```"
    assert lines[1] == "2026-10-08 vs 팀C (261008-팀C) [id:2610081234]"
    assert lines[-3].startswith("…외 ") and lines[-3].endswith("매치")
    assert lines[-2] == "합계 300-0-0"
    shown = len(lines) - 5   # ``` · 헤더 · …외 · 합계 · ```
    assert int(lines[-3][len("…외 "):-len("매치")]) == 300 - shown


def test_canonical_map_name_and_manual_null_winner():
    from game_data import canonical_map_name
    from services.summary import summarize_maps
    assert canonical_map_name("리장타워") == canonical_map_name(" Lijiang Tower ") == "리장 타워"
    assert canonical_map_name("﻿네팔") == "네팔"
    assert canonical_map_name("없는맵") == "없는맵" and canonical_map_name(None) is None
    ms = [{"match_id": "m", "session_id": "s", "session_date": "2026-10-05", "map_name": "네팔",
           "map_type": "쟁탈", "opponent": "X", "match_result": "draw", "source": "manual"}]
    with_scrims = summarize_maps([], ms, scrims=[{"id": "s", "matches": [{"id": "m", "winner": ""}]}])
    assert with_scrims["total"]["matches"] == 0 and with_scrims["excluded"]["null_result_matches"] == 1
