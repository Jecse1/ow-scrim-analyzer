# -*- coding: utf-8 -*-
"""rebuild-db 임시 파일 재구축 → 원자 교체(db/database.swap_db_file 등).

교체 헬퍼는 운영과 같은 파일 DB·기본 풀(AsyncAdaptedQueuePool) 엔진으로 검증한다 — 엔진 객체를 바꾸지 않고
dispose 만으로 같은 세션 팩토리가 새 파일을 읽는지, 진행 중 읽기가 옛 파일로 끝나는지, 실패 시 운영 파일이 그대로인지.
"""
import asyncio
import os
import sqlite3

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker

from db import database


def _make_db(path, value):
    con = sqlite3.connect(path)
    con.execute("CREATE TABLE t (v TEXT)")
    con.execute("INSERT INTO t VALUES (?)", (value,))
    con.commit()
    con.close()


def _value(path):
    con = sqlite3.connect(path)
    try:
        return con.execute("SELECT v FROM t").fetchone()[0]
    finally:
        con.close()


@pytest.fixture
async def live(tmp_path):
    db_path = str(tmp_path / "scrim.db")
    _make_db(db_path, "old")
    engine = create_async_engine(f"sqlite+aiosqlite:///{db_path}", connect_args={"check_same_thread": False})
    factory = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    yield db_path, factory, engine
    await engine.dispose()


async def _read(factory):
    async with factory() as s:
        return (await s.execute(text("SELECT v FROM t"))).scalar()


async def test_swap_first_read_sees_new_file_same_engine(live):
    db_path, factory, engine = live
    assert await _read(factory) == "old"            # 풀에 옛 파일 연결이 남은 상태
    tmp = database.rebuild_tmp_path(db_path, "j1")
    _make_db(tmp, "new")
    backup = db_path + ".before_rebuild_x"
    method = await database.swap_db_file(factory, db_path, tmp, backup)
    assert method == "link"
    assert factory.kw["bind"] is engine              # 엔진 재생성 없음
    assert await _read(factory) == "new"             # 교체 직후 첫 조회 = 새 파일
    assert _value(backup) == "old"
    assert not os.path.exists(tmp)


async def test_inflight_read_finishes_on_old_file(live):
    # 교체 전에 시작한 세션은 끝까지 옛 파일을 본다(Linux: 옛 inode, Windows: 세션이 닫힐 때까지 교체 대기)
    db_path, factory, _ = live
    tmp = database.rebuild_tmp_path(db_path, "j2")
    _make_db(tmp, "new")
    async with factory() as s:
        assert (await s.execute(text("SELECT v FROM t"))).scalar() == "old"
        swap = asyncio.create_task(database.swap_db_file(factory, db_path, tmp, db_path + ".bak"))
        await asyncio.sleep(0.2)
        assert (await s.execute(text("SELECT v FROM t"))).scalar() == "old"
    await asyncio.wait_for(swap, 5)
    assert await _read(factory) == "new"


async def test_replace_timeout_leaves_live_db(live, monkeypatch):
    db_path, factory, _ = live
    tmp = database.rebuild_tmp_path(db_path, "j3")
    _make_db(tmp, "new")
    backup = db_path + ".bak"

    def locked(src, dst):
        raise PermissionError("in use")
    monkeypatch.setattr(database.os, "replace", locked)
    with pytest.raises(PermissionError):
        await database.swap_db_file(factory, db_path, tmp, backup, timeout=0.2)
    monkeypatch.undo()
    assert await _read(factory) == "old"
    assert not os.path.exists(backup)                # 실패 시 백업 링크 정리
    assert os.path.exists(tmp)                       # 임시 파일 정리는 호출자 몫


async def test_hardlink_unavailable_falls_back_to_copy(live, monkeypatch, capsys):
    db_path, factory, _ = live
    tmp = database.rebuild_tmp_path(db_path, "j4")
    _make_db(tmp, "new")
    backup = db_path + ".bak"

    def no_link(src, dst):
        raise OSError("not supported")
    monkeypatch.setattr(database.os, "link", no_link)
    assert await database.swap_db_file(factory, db_path, tmp, backup) == "copy"
    assert "backup hardlink unavailable (OSError) — copying instead" in capsys.readouterr().out
    assert _value(backup) == "old" and await _read(factory) == "new"


def test_cleanup_stale_rebuild_files(tmp_path):
    db_path = str(tmp_path / "scrim.db")
    keep = [db_path, db_path + ".before_rebuild_20261105_000000"]
    stale = [database.rebuild_tmp_path(db_path, "a"), database.rebuild_tmp_path(db_path, "b") + "-journal"]
    for p in keep + stale:
        open(p, "w").close()
    assert sorted(database.cleanup_stale_rebuild_files(db_path)) == sorted(os.path.basename(p) for p in stale)
    assert all(os.path.exists(p) for p in keep) and not any(os.path.exists(p) for p in stale)


# ── rebuild-db 엔드포인트: 사본 위 재구축 → 교체 ────────────────────────────
import glob
import hashlib
import json
import shutil
import tempfile
import threading

from fastapi.testclient import TestClient

import golden_util

BASE, OPP = "Team A", "Team Z"


@pytest.fixture(scope="module")
def api():
    """전용 임시 DB·rowdata 로 routers.scrims 를 돌린다(test_session_lifecycle.iso 와 같은 방식)."""
    import main
    import routers.scrims as scrims
    from db import models  # noqa: F401

    tmp = tempfile.mkdtemp(prefix="scrim_rebuild_swap_")
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
        reg = c.post("/api/scrim/manual-register", json={
            "scrimName": "swap-src", "date": "2026-11-05", "startHour": "10", "endHour": "12",
            "matches": [{"map_name": "리장 타워", "team1Name": OPP, "team2Name": BASE, "start_time": "00:00",
                         "end_time": "00:00", "result": "Unknown"}]})
        assert reg.status_code == 200, reg.text
        sid = reg.json()["scrim_id"]
        with open(golden_util.SAMPLE_LOG, "rb") as f:
            c.post("/api/matches/upload", data={"scrim_id": sid, "match_index": "1"},
                   files={"file": ("log.txt", f.read(), "text/plain")}).raise_for_status()
        assert c.post("/api/admin/rebuild-db").status_code == 200   # 기준 상태 = rebuild 결과
        yield c, scrims, db_path, rows, sid
        c.portal.call(engine.dispose)
    mp.undo()
    shutil.rmtree(tmp, ignore_errors=True)


def _sha(path):
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def _set_meta_name(rows, sid, name):
    p = f"{rows}/{sid}_meta.json"
    with open(p, encoding="utf-8") as f:
        meta = json.load(f)
    meta["scrim_name"] = name
    with open(p, "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False)


def _leftovers(db_path):
    return glob.glob(glob.escape(db_path) + ".rebuild-*")


def _backups(db_path):
    return set(glob.glob(glob.escape(db_path) + ".before_rebuild_*"))


def _post_rebuild_in_thread(c):
    out = {}
    t = threading.Thread(target=lambda: out.setdefault("r", c.post("/api/admin/rebuild-db")))
    t.start()
    return t, out


def test_reads_served_from_live_db_while_rebuilding(api, monkeypatch):
    # 재구축(임시 사본에 커밋까지 끝난 뒤 교체 직전)에서 멈춘 동안: 조회 200·옛 데이터, 운영 DB 에 잠금 없음.
    # 교체 직후 첫 조회 = 새 데이터.
    c, scrims, db_path, rows, sid = api
    _set_meta_name(rows, sid, "rebuilt-name")
    started, release = threading.Event(), threading.Event()
    real_into = scrims._rebuild_into

    async def paused_into(factory, new_scrims):
        res = await real_into(factory, new_scrims)
        started.set()
        while not release.is_set():
            await asyncio.sleep(0.01)
        return res
    monkeypatch.setattr(scrims, "_rebuild_into", paused_into)
    t, out = _post_rebuild_in_thread(c)
    try:
        assert started.wait(10)
        r = c.get(f"/api/scrims/{sid}")
        assert r.status_code == 200 and r.json()["scrim_name"] == "swap-src"
        assert c.get("/api/scrims").status_code == 200
        con = sqlite3.connect(db_path, timeout=0)       # 예전 구현은 이 시점에 쓰기 트랜잭션이 운영 DB 를 쥐고 있었다
        try:
            con.execute("BEGIN IMMEDIATE")
            con.rollback()
        finally:
            con.close()
    finally:
        release.set()
        t.join(20)
    assert out["r"].status_code == 200, out["r"].text
    assert c.get(f"/api/scrims/{sid}").json()["scrim_name"] == "rebuilt-name"
    assert not _leftovers(db_path)
    _set_meta_name(rows, sid, "swap-src")


@pytest.mark.parametrize("where", ["build", "swap"])
def test_failure_leaves_live_db_unchanged(api, monkeypatch, where):
    c, scrims, db_path, rows, sid = api
    name_before = c.get(f"/api/scrims/{sid}").json()["scrim_name"]
    _set_meta_name(rows, sid, "never-visible")
    c.portal.call(scrims.AsyncSessionLocal.kw["bind"].dispose)   # 파일 바이트 비교 전에 풀 정리
    before, backups = _sha(db_path), _backups(db_path)

    async def boom(*a, **k):
        raise RuntimeError("injected")
    if where == "build":
        real_into = scrims._rebuild_into

        async def into_then_boom(factory, new_scrims):
            await real_into(factory, new_scrims)       # 임시 사본은 새 데이터로 커밋된 뒤 실패
            raise RuntimeError("injected")
        monkeypatch.setattr(scrims, "_rebuild_into", into_then_boom)
    else:
        monkeypatch.setattr(database, "swap_db_file", boom)
    r = c.post("/api/admin/rebuild-db")
    assert r.status_code == 500 and r.json() == {"detail": "DB rebuild failed"}
    assert _sha(db_path) == before
    assert _backups(db_path) == backups
    assert not _leftovers(db_path)
    assert c.get(f"/api/scrims/{sid}").json()["scrim_name"] == name_before
    _set_meta_name(rows, sid, "swap-src")


def test_disk_shortfall_returns_507(api, monkeypatch, capsys):
    c, scrims, db_path, *_ = api
    real = shutil.disk_usage
    monkeypatch.setattr(shutil, "disk_usage", lambda p: real(p)._replace(free=1024))
    r = c.post("/api/admin/rebuild-db")
    assert r.status_code == 507 and r.json() == {"detail": "Insufficient disk space"}
    assert "디스크 여유 부족 — 시작 안 함: free 0MB < need 64MB" in capsys.readouterr().out
    assert not _leftovers(db_path)
