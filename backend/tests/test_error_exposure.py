# -*- coding: utf-8 -*-
"""오류 응답에 예외 문구(str(e))가 나가지 않는다 — 고정 메시지, 상세는 서버 로그(print).

DB 예외 주입은 각 라우터 모듈의 AsyncSessionLocal(또는 캐시 진입점)을 바꿔 끼운다. 예외 문구에 표식
SECRET 을 넣고 응답 본문에 없는지, 서버 로그(capsys)에는 남는지 본다.
"""
import asyncio
import os

import pytest
from fastapi.testclient import TestClient

from config import ROW_DATA_DIR

SECRET = "SECRET-sqlite-path-C:/srv/data/scrim.db"


@pytest.fixture(scope="module")
def client():
    import main
    with TestClient(main.app) as c:
        yield c


class _Boom:
    def __call__(self, *a, **kw):
        raise RuntimeError(SECRET)


async def _boom_async(*a, **kw):
    raise RuntimeError(SECRET)


def _register(c, name, hours=("07", "09")):
    r = c.post("/api/scrim/manual-register", json={
        "scrimName": name, "date": "2026-11-05", "startHour": hours[0], "endHour": hours[1],
        "matches": [{"map_name": "리장 타워", "team1Name": "Team Z", "team2Name": "Team A",
                     "start_time": "00:00", "end_time": "00:00", "result": "Unknown"}]})
    assert r.status_code == 200, r.text
    return r.json()["scrim_id"]


@pytest.mark.parametrize("module, attr, method, url", [
    ("routers.scrims", "AsyncSessionLocal", "get", "/api/scrims/2611050709"),
    ("routers.scrims", "AsyncSessionLocal", "get", "/api/matches/00000000-0000-0000-0000-000000000000"),
    ("routers.stats", "cached_json_response", "get", "/api/scrims"),
    ("routers.summary", "AsyncSessionLocal", "get", "/api/summary/maps"),
    ("plans.router", "AsyncSessionLocal", "get", "/api/plans/maps/x/canvas"),
])
def test_db_error_detail_is_fixed(client, monkeypatch, capsys, module, attr, method, url):
    import importlib
    mod = importlib.import_module(module)
    fake = _boom_async if attr == "cached_json_response" else _Boom()
    with monkeypatch.context() as mp:
        mp.setattr(mod, attr, fake)
        r = getattr(client, method)(url)
    assert r.status_code == 500
    assert r.json() == {"detail": "DB error"}
    assert SECRET in capsys.readouterr().out          # 상세는 서버 로그에


def test_register_validation_error_lists_fields_only(client):
    r = client.post("/api/scrim/manual-register", json={"scrimName": SECRET, "date": "2026-11-05", "startHour": "07"})
    assert r.status_code == 422
    assert r.json()["detail"] == "Validation Error: endHour, matches"
    assert SECRET not in r.text
    r2 = client.post("/api/scrim/manual-register", content=b"{not json", headers={"Content-Type": "application/json"})
    assert r2.status_code == 422
    assert r2.json()["detail"] == "Validation Error: invalid request body"


def test_file_delete_warning_has_file_name_only(client, monkeypatch, capsys):
    import routers.scrims as scrims
    c = client
    sid = _register(c, "warn-file")
    meta = f"{ROW_DATA_DIR}/{sid}_meta.json"
    real_remove = os.remove

    def _fail(path):
        raise PermissionError(f"[WinError 32] {SECRET}: '{path}'")

    try:
        with monkeypatch.context() as mp:
            mp.setattr(scrims.os, "remove", _fail)
            r = c.post("/api/sessions/delete-batch", json={"ids": [sid]})
        assert r.status_code == 200
        assert r.json()["warnings"] == [f"파일 삭제 실패 ({sid}_meta.json)"]
        assert SECRET not in r.text and ROW_DATA_DIR not in r.text
        assert SECRET in capsys.readouterr().out
    finally:
        if os.path.exists(meta):
            real_remove(meta)


def test_backfill_error_state_is_fixed(monkeypatch, capsys):
    from services import abilities as svc
    monkeypatch.setattr(svc, "_backfill_targets", _boom_async)
    asyncio.run(svc._run_backfill(False))
    assert svc.BACKFILL_STATE["state"] == "error"
    assert svc.BACKFILL_STATE["error"] == "backfill failed"
    assert SECRET in capsys.readouterr().out
