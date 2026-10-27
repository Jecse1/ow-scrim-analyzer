# -*- coding: utf-8 -*-
"""삭제된 세션과 같은 ID 로 다시 등록하는 경로 회귀 테스트(임시 DB, backend/conftest.py).

세션 ID 는 날짜·시작·종료 시각으로 정해진다. 세션을 지우면 meta.json 도 지워지므로, 같은 시각으로
다시 등록하면 같은 ID 가 나온다. 예전에는 삭제 표시(deleted_at)가 남은 세션 아래에 매치만 붙어
목록에서 빠지고 complete 가 404 였다(FLC 2610271416).
"""
import pytest
from fastapi.testclient import TestClient

import golden_util


@pytest.fixture(scope="module")
def client():
    import main
    with TestClient(main.app) as c:
        yield c


def _sample() -> bytes:
    with open(golden_util.SAMPLE_LOG, "rb") as f:
        return f.read()


def _register(c, name: str) -> str:
    r = c.post("/api/scrim/manual-register", json={
        "scrimName": name, "date": "2026-10-27", "startHour": "14", "endHour": "16",
        "matches": [{"map_name": "남극 반도", "team1Name": "Team Z", "team2Name": "Team A",
                     "start_time": "00:00", "end_time": "00:00", "result": "Unknown"}]})
    assert r.status_code == 200, r.text
    return r.json()["scrim_id"]


def _upload(c, sid: str):
    return c.post("/api/matches/upload", data={"scrim_id": sid, "match_index": "1"},
                  files={"file": ("log.txt", _sample(), "text/plain")})


def test_reregister_after_delete_reuses_id_and_is_listed(client):
    c = client
    sid = None
    try:
        # 1차: 등록만 하고 업로드 없이 세션 삭제
        sid = _register(c, "261027-첫등록")
        assert c.post("/api/sessions/delete-batch", json={"ids": [sid]}).status_code == 200
        assert sid not in {s["id"] for s in c.get("/api/scrims").json()}

        # 2차: 같은 시각으로 다시 등록 → 같은 ID 재사용, 업로드
        sid2 = _register(c, "261027-재등록")
        assert sid2 == sid
        r = _upload(c, sid)
        assert r.status_code == 200, r.text

        sessions = {s["id"]: s for s in c.get("/api/scrims").json()}
        assert sid in sessions
        sess = sessions[sid]
        assert sess["scrim_name"] == "261027-재등록"
        assert len(sess["matches"]) == 1                      # 1차 매치는 삭제 상태 그대로
        assert sess["matches"][0]["winner_source"] is not None  # 업로드로 판정까지 끝난 매치
        assert c.get(f"/api/scrims/{sid}").status_code == 200
        assert c.post(f"/api/sessions/{sid}/complete").status_code == 200

        # 다시 삭제하면 업로드·complete 는 409(화면에 오류가 보이도록)
        assert c.post("/api/sessions/delete-batch", json={"ids": [sid]}).status_code == 200
        assert _upload(c, sid).status_code == 409
        assert c.post(f"/api/sessions/{sid}/complete").status_code == 409

        # 살아 있는 같은 ID 가 있으면 기존 규칙대로 _1 접미사
        sid3 = _register(c, "261027-세번째")
        assert sid3 == sid
        sid4 = _register(c, "261027-네번째")
        assert sid4 == f"{sid}_1"
    finally:
        # 임시 DB 는 테스트 모듈 간 공유 — test_summary 골든(전 기간 집계)에 섞이지 않게 정리
        live = {s["id"] for s in c.get("/api/scrims").json()}
        left = [x for x in (sid, f"{sid}_1") if x in live]
        if left:
            assert c.post("/api/sessions/delete-batch", json={"ids": left}).status_code == 200
