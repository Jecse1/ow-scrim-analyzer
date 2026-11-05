# -*- coding: utf-8 -*-
"""대회(공식 경기) 세션 — sessions.kind·source_url 저장·meta·rebuild 복원(전용 임시 DB·rowdata).

대회 결과는 로그 없이 맵·맵 승패·출처 URL 만 수기 매치로 등록한다. kind 를 생략하면 예전과 같은 스크림 세션.
"""
import asyncio
import json
import os
import shutil
import sqlite3
import tempfile
import time

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker

from db import database

# 기준 팀 = config.BASE_TEAM — 조회 API 의 기본 base_team 과 같아야 기본 응답 비교가 의미 있다(포크마다 기본값이 다름)
from config import BASE_TEAM as BASE  # noqa: E402
OPP = "Team Z"
SRC = "https://example.org/wiki/League/Stage_1#Week_1"


@pytest.fixture(scope="module")
def api():
    import main
    import routers.scrims as scrims
    from db import models  # noqa: F401

    tmp = tempfile.mkdtemp(prefix="scrim_tournament_kind_")
    db_path = os.path.join(tmp, "scrim.db")
    rows = os.path.join(tmp, "rows")
    os.makedirs(rows)
    engine = create_async_engine(f"sqlite+aiosqlite:///{db_path}", connect_args={"check_same_thread": False})

    async def _init():
        async with engine.begin() as conn:
            await conn.run_sync(database.Base.metadata.create_all)
            await conn.run_sync(database._apply_column_patches)
        await engine.dispose()
    asyncio.run(_init())

    mp = pytest.MonkeyPatch()
    mp.setattr(scrims, "AsyncSessionLocal", sessionmaker(engine, class_=AsyncSession, expire_on_commit=False))
    mp.setattr(scrims, "ROW_DATA_DIR", rows)
    mp.setattr(database, "_DB_PATH", db_path)
    mp.setattr(scrims, "start_backfill", lambda force=False: None)
    mp.setattr(scrims, "BASE_TEAM", BASE)
    with TestClient(main.app) as c:
        yield c, db_path, rows
        c.portal.call(engine.dispose)
    mp.undo()
    shutil.rmtree(tmp, ignore_errors=True)


def _tournament_body(**extra):
    # BO5 3:1 — 밀기 맵은 점수 0:0 + 승자 명시 + result 에 거리 원문
    maps = [("부산", 2, 0, BASE, "2:0"), ("뉴 정크 시티", 1, 3, OPP, "1:3"),
            ("이스페란사", 0, 0, BASE, "141.97:34.44"), ("아이헨발데", 2, 1, BASE, "2:1")]
    return {
        "scrimName": "League S1 W1 vs Team Z", "date": "2026-03-21", "startHour": "16", "endHour": "19",
        "kind": "tournament", "sourceUrl": SRC,
        "matches": [{"map_name": m, "team1Name": BASE, "team2Name": OPP, "start_time": "00:00", "end_time": "00:00",
                     "result": r, "source": "manual", "winner": w, "score_t1": s1, "score_t2": s2}
                    for m, s1, s2, w, r in maps],
        **extra,
    }


def _scrim_body(date="2026-03-22"):
    return {"scrimName": "plain scrim", "date": date, "startHour": "14", "endHour": "16",
            "matches": [{"map_name": "리장 타워", "team1Name": BASE, "team2Name": OPP, "start_time": "00:00",
                         "end_time": "00:00", "result": "Unknown"}]}


def _db(db_path, sql, *args):
    con = sqlite3.connect(db_path)
    try:
        return con.execute(sql, args).fetchall()
    finally:
        con.close()


def _meta(rows, sid):
    with open(f"{rows}/{sid}_meta.json", encoding="utf-8") as f:
        return json.load(f)


def _wait_rebuild(c, timeout=30):
    end = time.monotonic() + timeout
    while True:
        st = c.get("/api/admin/rebuild-db/status").json()
        if st["state"] != "running":
            return st
        assert time.monotonic() < end, st
        time.sleep(0.05)


def test_register_tournament_stores_kind_source_and_manual_maps(api):
    c, db_path, rows = api
    r = c.post("/api/scrim/manual-register", json=_tournament_body())
    assert r.status_code == 200, r.text
    sid = r.json()["scrim_id"]

    assert _db(db_path, "SELECT kind, source_url FROM sessions WHERE id=?", sid) == [("tournament", SRC)]
    ms = _db(db_path, "SELECT match_index, map_name, source, winner, score_t1, score_t2, result, winner_source "
                      "FROM matches WHERE session_id=? ORDER BY match_index", sid)
    assert ms == [
        (1, "부산", "manual", BASE, 2, 0, "2:0", "manual"),
        (2, "뉴 정크 시티", "manual", OPP, 1, 3, "1:3", "manual"),
        (3, "이스페란사", "manual", BASE, 0, 0, "141.97:34.44", "manual"),
        (4, "아이헨발데", "manual", BASE, 2, 1, "2:1", "manual"),
    ]
    meta = _meta(rows, sid)
    assert meta["kind"] == "tournament" and meta["source_url"] == SRC


def test_register_without_kind_is_scrim_and_meta_shape_unchanged(api):
    c, db_path, rows = api
    r = c.post("/api/scrim/manual-register", json=_scrim_body())
    assert r.status_code == 200, r.text
    sid = r.json()["scrim_id"]
    assert _db(db_path, "SELECT kind, source_url FROM sessions WHERE id=?", sid) == [(None, None)]
    assert set(_meta(rows, sid)) == {"id", "scrim_name", "date", "start_time", "end_time", "matches"}


@pytest.mark.parametrize("extra, field", [
    ({"kind": "scrim"}, "kind"),
    ({"kind": "TOURNAMENT"}, "kind"),
    ({"sourceUrl": "javascript:alert(1)"}, "sourceUrl"),
    ({"sourceUrl": "ftp://example.org/x"}, "sourceUrl"),
])
def test_invalid_kind_or_source_url_is_422(api, extra, field):
    c, db_path, _ = api
    before = _db(db_path, "SELECT COUNT(*) FROM sessions")
    r = c.post("/api/scrim/manual-register", json=_tournament_body(**extra))
    assert r.status_code == 422
    assert field in r.json()["detail"]
    assert _db(db_path, "SELECT COUNT(*) FROM sessions") == before


def test_blank_kind_and_source_url_mean_scrim(api):
    c, db_path, rows = api
    body = _scrim_body(date="2026-03-23")
    body.update({"kind": " ", "sourceUrl": ""})
    sid = c.post("/api/scrim/manual-register", json=body).json()["scrim_id"]
    assert _db(db_path, "SELECT kind, source_url FROM sessions WHERE id=?", sid) == [(None, None)]
    assert "kind" not in _meta(rows, sid) and "source_url" not in _meta(rows, sid)


def test_session_patch_keeps_kind_in_meta(api):
    c, db_path, rows = api
    sid = c.post("/api/scrim/manual-register", json=_tournament_body(date="2026-03-24")).json()["scrim_id"]
    r = c.patch(f"/api/sessions/{sid}", json={"scrimName": "renamed"})
    assert r.status_code == 200, r.text
    meta = _meta(rows, sid)
    assert meta["scrim_name"] == "renamed" and meta["kind"] == "tournament" and meta["source_url"] == SRC


def test_reused_deleted_id_takes_new_kind(api):
    c, db_path, _ = api
    sid = c.post("/api/scrim/manual-register", json=_tournament_body(date="2026-03-25")).json()["scrim_id"]
    assert c.post("/api/sessions/delete-batch", json={"ids": [sid]}).status_code == 200
    body = _scrim_body(date="2026-03-25")
    body.update({"startHour": "16", "endHour": "19"})   # 같은 시각 → 삭제된 ID 재사용
    sid2 = c.post("/api/scrim/manual-register", json=body).json()["scrim_id"]
    assert sid2 == sid
    assert _db(db_path, "SELECT kind, source_url, deleted_at FROM sessions WHERE id=?", sid) == [(None, None, None)]


def test_rebuild_restores_kind_and_source_url(api):
    c, db_path, _ = api
    before = dict((r[0], r[1:]) for r in _db(
        db_path, "SELECT id, kind, source_url FROM sessions WHERE deleted_at IS NULL"))
    assert ("tournament", SRC) in before.values() and (None, None) in before.values()
    assert c.post("/api/admin/rebuild-db").status_code == 202
    assert _wait_rebuild(c)["state"] == "done"
    after = dict((r[0], r[1:]) for r in _db(db_path, "SELECT id, kind, source_url FROM sessions"))
    assert after == before


def test_column_patches_add_kind_columns_to_old_db_idempotently(tmp_path):
    from sqlalchemy import create_engine
    path = tmp_path / "old.db"
    con = sqlite3.connect(path)
    con.execute("CREATE TABLE sessions (id VARCHAR PRIMARY KEY, scrim_name VARCHAR NOT NULL, date VARCHAR NOT NULL)")
    con.execute("INSERT INTO sessions VALUES ('2603211619', 'old', '2026-03-21')")
    con.commit()
    con.close()
    eng = create_engine(f"sqlite:///{path}")
    for _ in range(2):
        with eng.begin() as conn:
            database._apply_column_patches(conn)
    eng.dispose()
    con = sqlite3.connect(path)
    cols = [r[1] for r in con.execute("PRAGMA table_info(sessions)")]
    row = con.execute("SELECT kind, source_url FROM sessions").fetchall()
    con.close()
    assert cols.count("kind") == 1 and cols.count("source_url") == 1
    assert row == [(None, None)]


# ── 집계 분리: 기본 kind=scrim 응답은 대회 세션 등록 전후 바이트 동일, ?kind=tournament|all 로 선택 ──
FROM_TO = "from=2026-01-01&to=2026-12-31"
DEFAULT_5 = ["/api/scrims", "/api/fight-records", "/api/first-fights", "/api/scrims/full-events",
             "/api/player-fight-stats"]
SUMMARY_4 = [f"/api/summary/{x}?{FROM_TO}" for x in ("maps", "opponents", "period", "ults")]


@pytest.fixture(scope="module")
def agg():
    """전용 임시 DB 를 등록·조회 라우터(scrims·stats·summary) 모두에 물린다. 응답 캐시는 앞뒤로 비운다."""
    import main
    import cache
    import routers.scrims as scrims
    import routers.stats as stats
    import routers.summary as summary
    import golden_util
    from db import models  # noqa: F401

    tmp = tempfile.mkdtemp(prefix="scrim_tournament_agg_")
    db_path = os.path.join(tmp, "scrim.db")
    rows = os.path.join(tmp, "rows")
    os.makedirs(rows)
    engine = create_async_engine(f"sqlite+aiosqlite:///{db_path}", connect_args={"check_same_thread": False})

    async def _init():
        async with engine.begin() as conn:
            await conn.run_sync(database.Base.metadata.create_all)
            await conn.run_sync(database._apply_column_patches)
        await engine.dispose()
    asyncio.run(_init())

    factory = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    mp = pytest.MonkeyPatch()
    for mod in (scrims, stats, summary):
        mp.setattr(mod, "AsyncSessionLocal", factory)
    mp.setattr(scrims, "ROW_DATA_DIR", rows)
    mp.setattr(database, "_DB_PATH", db_path)
    mp.setattr(scrims, "start_backfill", lambda force=False: None)
    mp.setattr(scrims, "BASE_TEAM", BASE)
    cache._invalidate_response_cache()
    with TestClient(main.app) as c:
        # 스크림: 로그 매치 1 + 수기 매치 1(수기 매치도 fight-records match_summaries 에 실리는 경로)
        body = _scrim_body(date="2026-04-01")
        body["matches"].append({"map_name": "부산", "team1Name": BASE, "team2Name": OPP, "start_time": "00:00",
                                "end_time": "00:00", "result": "2:1", "source": "manual", "winner": BASE,
                                "score_t1": 2, "score_t2": 1})
        sid = c.post("/api/scrim/manual-register", json=body).json()["scrim_id"]
        with open(golden_util.SAMPLE_LOG, "rb") as f:
            c.post("/api/matches/upload", data={"scrim_id": sid, "match_index": "1"},
                   files={"file": ("log.txt", f.read(), "text/plain")}).raise_for_status()
        yield c, scrims, sid
        c.portal.call(engine.dispose)
    cache._invalidate_response_cache()
    mp.undo()
    shutil.rmtree(tmp, ignore_errors=True)


def _summary_bytes(c, url):
    r = c.get(url)
    assert r.status_code == 200, (url, r.text)
    d = r.json()
    d["meta"].pop("generated_at", None)   # 호출 시각 — 그 외 바이트는 그대로 비교
    return json.dumps(d, ensure_ascii=False, sort_keys=True).encode()


def _discord_body(c, scrims, monkeypatch, sid):
    sent = []
    monkeypatch.setattr(scrims._config, "DISCORD_WEBHOOK_URL", "https://example.org/hook")
    monkeypatch.setattr(scrims, "schedule_webhook", lambda url, build, on_result=None: sent.append(build()))
    scrims._WEBHOOK_SENT.pop(sid, None)
    r = c.post(f"/api/sessions/{sid}/complete")
    assert r.status_code == 200 and r.json()["webhook"] == "queued", r.text
    return r.content, sent[0]


def _snapshot(c, scrims, monkeypatch, sid):
    snap = {u: c.get(u).content for u in DEFAULT_5}
    snap.update({u: _summary_bytes(c, u) for u in SUMMARY_4})
    snap["complete"], snap["discord"] = _discord_body(c, scrims, monkeypatch, sid)
    return snap


def test_tournament_session_not_mixed_into_default_responses(agg, monkeypatch):
    c, scrims, sid = agg
    before = _snapshot(c, scrims, monkeypatch, sid)
    assert len(c.get("/api/scrims").json()) == 1
    assert c.get("/api/fight-records").json()["match_summaries"], "기준 데이터에 매치 요약이 있어야 비교 의미가 있다"

    tid = c.post("/api/scrim/manual-register", json=_tournament_body(date="2026-04-02")).json()["scrim_id"]
    after = _snapshot(c, scrims, monkeypatch, sid)
    assert {k: v for k, v in after.items()} == before          # 기본 응답 5종·요약 4종·디스코드 본문 바이트 동일
    assert tid not in {s["id"] for s in c.get("/api/scrims").json()}
    # 명시적 kind=scrim 도 기본과 같은 바이트
    assert c.get("/api/scrims?kind=scrim").content == before["/api/scrims"]
    assert c.get("/api/fight-records?kind=scrim").content == before["/api/fight-records"]


def test_kind_tournament_and_all(agg):
    c, _, sid = agg
    tour = c.get("/api/scrims?kind=tournament").json()
    assert [s.get("kind") for s in tour] == ["tournament"] and tour[0]["source_url"] == SRC
    tid = tour[0]["id"]
    assert len(tour[0]["matches"]) == 4
    every = c.get("/api/scrims?kind=all").json()
    assert {s["id"] for s in every} == {sid, tid}
    scrim_only = c.get("/api/scrims").json()
    assert all("kind" not in s and "source_url" not in s for s in scrim_only)
    detail = c.get(f"/api/scrims/{tid}").json()
    assert detail["kind"] == "tournament" and detail["source_url"] == SRC

    def ms_sessions(kind):
        return sorted(m["session_id"] for m in c.get(f"/api/fight-records?kind={kind}").json()["match_summaries"])
    assert set(ms_sessions("tournament")) == {tid} and len(ms_sessions("tournament")) == 4
    assert set(ms_sessions("scrim")) == {sid}
    assert ms_sessions("all") == sorted(ms_sessions("scrim") + ms_sessions("tournament"))

    def played(kind):
        d = c.get(f"/api/summary/opponents?{FROM_TO}&kind={kind}").json()
        return {o["opponent"]: o for o in d["opponents"]}
    t = played("tournament")[OPP]
    assert (t["wins"], t["losses"]) == (3, 1)                     # 대회 4맵: 3승 1패
    s, a = played("scrim")[OPP], played("all")[OPP]
    assert a["wins"] == s["wins"] + t["wins"] and a["losses"] == s["losses"] + t["losses"]

    def period_ids(kind):
        return {x["session_id"] for x in c.get(f"/api/summary/period?{FROM_TO}&kind={kind}").json()["sessions"]}
    assert period_ids("tournament") == {tid} and period_ids("scrim") == {sid} and period_ids("all") == {sid, tid}
    maps_t = c.get(f"/api/summary/maps?{FROM_TO}&kind=tournament").json()
    assert (maps_t["total"]["wins"], maps_t["total"]["losses"]) == (3, 1) and len(maps_t["maps"]) == 4


@pytest.mark.parametrize("url", ["/api/scrims?kind=bogus", "/api/fight-records?kind=Tournament",
                                 f"/api/summary/period?{FROM_TO}&kind=x"])
def test_invalid_kind_query_is_422(agg, url):
    c, _, _ = agg
    assert c.get(url).status_code == 422


# ── scripts/register_tournament.py: 검증·본문·dry-run·멱등 ──
def _script():
    import importlib.util
    path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "scripts", "register_tournament.py")
    spec = importlib.util.spec_from_file_location("register_tournament", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _doc():
    return {"base_team": BASE, "matches": [
        {"date": "2026-05-05", "start_hour": "16", "end_hour": "18", "opponent": OPP,
         "source_url": "https://example.org/wiki/League/Stage_1#Day_1", "video_url": "https://youtu.be/abc?t=10",
         "maps": [{"map": "오아시스", "winner": OPP, "score": "0:2"},
                  {"map": "이스페란사", "winner": BASE, "score": "110.47:63.70"},
                  {"map": "부산", "winner": OPP, "score": "1:2"}]},
        {"date": "2026-05-05", "start_hour": "20", "end_hour": "22", "opponent": "Team Y",
         "source_url": "https://example.org/wiki/League/Stage_1#Day_1",
         "maps": [{"map": "리장 타워", "winner": BASE, "score": "2:0"},
                  {"map": "루나사피", "winner": BASE, "score": "1:0"}]},
    ]}


class _ClientApi:
    def __init__(self, c):
        self.c = c

    def get_json(self, path):
        r = self.c.get(path)
        assert r.status_code == 200, r.text
        return r.status_code, r.json()

    def post_json(self, path, body):
        r = self.c.post(path, json=body)
        return r.status_code, r.json()


def test_script_validate_and_body():
    rt = _script()
    assert rt.validate(_doc()) == []
    bad = _doc()
    bad["matches"][0]["maps"][0]["winner"] = "Nobody"
    bad["matches"][1]["source_url"] = "javascript:alert(1)"
    bad["matches"].append(dict(_doc()["matches"][0]))
    errs = rt.validate(bad)
    assert any("winner" in e for e in errs) and any("source_url" in e for e in errs) and any("중복" in e for e in errs)

    body = rt.build_body(BASE, _doc()["matches"][0])
    assert body["scrimName"] == "260505-Team Z" and body["kind"] == "tournament"
    assert body["startHour"] == "16" and body["endHour"] == "18"
    push = body["matches"][1]
    assert (push["score_t1"], push["score_t2"], push["result"], push["winner"]) == (0, 0, "110.47:63.70", BASE)
    assert (body["matches"][2]["score_t1"], body["matches"][2]["score_t2"]) == (1, 2)
    assert all(m["videoUrl"] == "https://youtu.be/abc?t=10" and m["source"] == "manual" for m in body["matches"])


def test_script_dry_run_register_and_rerun_is_idempotent(agg):
    c, _, _ = agg
    rt = _script()
    api, log = _ClientApi(c), []
    before = {s["id"] for s in c.get("/api/scrims?kind=all").json()}

    res = rt.run(_doc(), api, dry_run=True, out=log.append)
    assert res == {"added": 0, "skipped": 0, "failed": 0, "planned": 2}
    assert {s["id"] for s in c.get("/api/scrims?kind=all").json()} == before

    res = rt.run(_doc(), api, out=log.append)
    assert res == {"added": 2, "skipped": 0, "failed": 0, "planned": 0}
    new = [s for s in c.get("/api/scrims?kind=tournament").json() if s["id"] not in before]
    assert sorted(s["scrim_name"] for s in new) == ["260505-Team Y", "260505-Team Z"]
    assert all(s["kind"] == "tournament" and s["source_url"].endswith("#Day_1") for s in new)
    z = next(s for s in new if s["scrim_name"].endswith("Team Z"))
    assert [m["winner"] for m in z["matches"]] == [OPP, BASE, OPP]

    res = rt.run(_doc(), api, out=log.append)          # 같은 JSON 재실행 → 0건 추가
    assert res == {"added": 0, "skipped": 2, "failed": 0, "planned": 0}
