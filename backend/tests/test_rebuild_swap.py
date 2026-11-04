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
