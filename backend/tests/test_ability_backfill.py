# -*- coding: utf-8 -*-
"""스킬 저장소 백필(services/abilities.py) — 멱등·삭제 매치 제외·기록 없음·force(rebuild 경로)·선채우기 뒤 자동 예약.

임시 DB(backend/conftest.py)는 모듈 간 공유 — 만든 세션은 끝에 지운다(test_summary 골든 보호).
rebuild-db 엔드포인트는 백업 경로가 작업 폴더 기준(data/scrim.db)이라 테스트에서 부르지 않고,
그 뒤에 붙인 호출(start_backfill(force=True))의 동작을 직접 확인한다.
"""
import asyncio
import time

import pytest
from fastapi.testclient import TestClient

import golden_util
from db import ability_store
from services import abilities as svc

FIXTURE = "abilities_basic.txt"


@pytest.fixture(scope="module")
def client():
    import main
    with TestClient(main.app) as c:
        yield c


def _sample_text():
    with open(golden_util.SAMPLE_LOG, "r", encoding="utf-8") as f:
        return f.read()


def _register(c, name, n, hours):
    r = c.post("/api/scrim/manual-register", json={
        "scrimName": name, "date": "2026-10-30", "startHour": hours[0], "endHour": hours[1],
        "matches": [{"map_name": "리장 타워", "team1Name": "Team Z", "team2Name": "Team A",
                     "start_time": "00:00", "end_time": "00:00", "result": "Unknown"} for _ in range(n)]})
    assert r.status_code == 200, r.text
    sid = r.json()["scrim_id"]
    return sid, {m["match_index"]: m["id"] for m in c.get(f"/api/scrims/{sid}").json()["matches"]}


def _upload(c, sid, idx, text):
    r = c.post("/api/matches/upload", data={"scrim_id": sid, "match_index": str(idx)},
               files={"file": ("log.txt", text.encode("utf-8"), "text/plain")})
    assert r.status_code == 200, r.text


def _wait_done(c, after=None, timeout=20.0):
    """백필이 끝날 때까지 기다린다. after(이전 started_at)를 주면 그 뒤에 시작한 실행만 본다."""
    end = time.time() + timeout
    while time.time() < end:
        st = c.get("/api/admin/backfill-abilities").json()
        fresh = after is None or (st.get("started_at") or 0) > after
        if fresh and not st["running"] and st.get("state") in ("done", "error", "cancelled"):
            return st
        time.sleep(0.05)
    raise AssertionError("backfill did not finish")


def _all_status(mids):
    return {m: ability_store.match_status(m) for m in mids}


def test_backfill_idempotent_and_skips_deleted(client, fixture_text):
    c = client
    sid = None
    try:
        sid, m = _register(c, "261030-백필", 4, ("10", "12"))
        _upload(c, sid, 1, fixture_text(FIXTURE))
        _upload(c, sid, 2, fixture_text(FIXTURE))
        _upload(c, sid, 3, _sample_text())
        _upload(c, sid, 4, fixture_text(FIXTURE))
        assert c.delete(f"/api/matches/{m[4]}").status_code == 200           # 삭제된 매치는 대상 아님
        ability_store.forget_matches([m[1], m[3]])                           # 저장소에서 빠진 상태(백필 대상)
        assert ability_store.match_status(m[1]) is None

        prev = c.get("/api/admin/backfill-abilities").json().get("started_at") or 0
        r = c.post("/api/admin/backfill-abilities")
        assert r.status_code == 200 and r.json()["status"] in ("started", "running")
        st = _wait_done(c, after=prev)
        assert st["state"] == "done" and st["failed"] == 0
        assert ability_store.match_status(m[1]) == {"has_log": True, "n1": 5, "n2": 3, "stored": 8}
        assert ability_store.match_status(m[3]) == {"has_log": False, "n1": 0, "n2": 0, "stored": 0}   # 기록 없음
        assert ability_store.match_status(m[2])["stored"] == 8               # 원래 있던 매치는 그대로
        assert ability_store.match_status(m[4]) is None                      # 삭제 매치는 다시 만들지 않음
        before = _all_status(m.values())

        prev = st["started_at"]
        assert c.post("/api/admin/backfill-abilities").status_code == 200   # 2회째: 처리할 매치 0
        st2 = _wait_done(c, after=prev)
        assert st2["total"] == 0 and st2["stored_matches"] == 0
        assert _all_status(m.values()) == before
    finally:
        if sid:
            c.post("/api/sessions/delete-batch", json={"ids": [sid]})


def test_force_replaces_all_and_prunes(client, fixture_text):
    """rebuild-db 뒤에 붙는 force: 처리한 매치도 다시 교체, 살아 있는 대상이 아닌 행은 지움."""
    c = client
    sid = None
    try:
        sid, m = _register(c, "261030-force", 1, ("13", "15"))
        _upload(c, sid, 1, fixture_text(FIXTURE))
        ability_store.replace_match(m[1], {"has_log": True, "uses": [], "hero_time": []})   # 낡은 값(0건)
        ability_store.replace_match("ghost-match", {"has_log": True, "uses": [], "hero_time": []})
        prev = c.get("/api/admin/backfill-abilities").json().get("started_at") or 0
        c.portal.call(svc.start_backfill, True)
        st = _wait_done(c, after=prev)
        assert st["force"] is True and st["pruned"] >= 1
        assert ability_store.match_status(m[1])["stored"] == 8               # 원문으로 다시 채움
        assert ability_store.match_status("ghost-match") is None
    finally:
        if sid:
            c.post("/api/sessions/delete-batch", json={"ids": [sid]})


def test_auto_backfill_waits_for_cache_warm(client, monkeypatch):
    """기동 시 비어 있던 저장소: 선채우기 작업이 끝난 뒤에 백필이 시작된다."""
    import cache
    c = client
    monkeypatch.setattr(svc, "AUTO_BACKFILL", True)
    monkeypatch.setattr(svc, "_STORE_EMPTY", True)
    marks = {}

    async def fake_warm():
        await asyncio.sleep(0.3)
        marks["warm_end"] = time.time()

    async def arm():
        cache._WARM_TASK = asyncio.get_running_loop().create_task(fake_warm())
        svc.schedule_auto_backfill()

    prev = c.get("/api/admin/backfill-abilities").json().get("started_at") or 0
    try:
        c.portal.call(arm)
        st = _wait_done(c, after=prev)
        assert "warm_end" in marks and st["started_at"] >= marks["warm_end"]
    finally:
        cache._WARM_TASK = None
