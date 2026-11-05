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

BASE, OPP = "Team A", "Team Z"
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
