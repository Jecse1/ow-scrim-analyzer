# -*- coding: utf-8 -*-
"""POST /api/logs/roster(등록 전 명단 추출) + manual-register → upload 기본 경로 회귀 테스트.

임시 DB(backend/conftest.py 의 SCRIM_DB_PATH). 샘플 로그 원시 라벨: 1팀 = Player1-5, 2팀 = Player6-10.
"""
import os

import pytest
from fastapi.testclient import TestClient

import golden_util
from parsers import log_parser


def _read_sample() -> bytes:
    with open(golden_util.SAMPLE_LOG, "rb") as f:
        return f.read()


def _roster(c, content: bytes):
    return c.post("/api/logs/roster", files={"file": ("log.txt", content, "text/plain")})


@pytest.fixture(scope="module")
def client():
    import main
    with TestClient(main.app) as c:
        yield c


def test_roster_sample_teams_players_heroes(client, monkeypatch):
    # 별칭 주입: players.json 대신 파서가 조회하는 사전에 직접(테스트 후 원복). Player3 → AliasCanon
    monkeypatch.setitem(log_parser.PLAYER_NAME_LOOKUP, "player3", "AliasCanon")
    r = _roster(client, _read_sample())
    assert r.status_code == 200, r.text
    body = r.json()
    assert [t["slot"] for t in body["teams"]] == [1, 2]
    assert [t["label"] for t in body["teams"]] == ["1팀", "2팀"]
    names1 = {p["name"] for p in body["teams"][0]["players"]}
    names2 = {p["name"] for p in body["teams"][1]["players"]}
    assert names1 == {"Player1", "Player2", "AliasCanon", "Player4", "Player5"}
    assert names2 == {"Player6", "Player7", "Player8", "Player9", "Player10"}
    by_name = {p["name"]: p["heroes"] for t in body["teams"] for p in t["players"]}
    assert all(by_name[n] for n in by_name)  # 모든 선수에 영웅 1개 이상
    assert by_name["AliasCanon"][0] == "키리코"   # 최대 플레이 시간 영웅이 맨 앞
    assert by_name["Player9"][0] == "D.Va"
    # 임시 팀명이 응답에 새지 않는다
    assert "__roster" not in r.text
    assert body["warning_count"] == len(body["warnings"]) == 2  # 샘플 bad_number×2(precheck)


def test_roster_has_no_side_effects(client):
    from config import ROW_DATA_DIR
    before_files = sorted(os.listdir(ROW_DATA_DIR))
    before_scrims = client.get("/api/scrims").content
    assert _roster(client, _read_sample()).status_code == 200
    assert sorted(os.listdir(ROW_DATA_DIR)) == before_files
    assert client.get("/api/scrims").content == before_scrims


@pytest.mark.parametrize("content", [b"", "그냥 텍스트\n로그 아님,123\n".encode("utf-8")])
def test_roster_rejects_non_log(client, content):
    r = _roster(client, content)
    assert r.status_code == 422
    assert "로그 아님" not in r.text  # 파일 내용을 에코하지 않는다


def test_manual_register_then_upload_assigns_teams(client):
    r = client.post("/api/scrim/manual-register", json={
        "scrimName": "roster-basic", "date": "2026-10-14", "startHour": "10", "endHour": "11",
        "matches": [{"map_name": "남극 반도", "team1Name": " Team Z ", "team2Name": "Team A",
                     "start_time": "00:00", "end_time": "00:00", "result": "Unknown"}]})
    assert r.status_code == 200, r.text
    sid = r.json()["scrim_id"]
    try:
        r = client.post("/api/matches/upload", data={"scrim_id": sid, "match_index": "1"},
                        files={"file": ("log.txt", _read_sample(), "text/plain")})
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "success"

        session = [s for s in client.get("/api/scrims").json() if s["id"] == sid][0]
        assert len(session["matches"]) == 1
        m = session["matches"][0]
        assert (m["team1_name"], m["team2_name"]) == ("Team Z", "Team A")  # 서버 strip
        detail = client.get(f"/api/matches/{m['id']}").json()
        team_of = {s["player_name"]: s["team_name"] for s in detail["stats"]}
        # 로그 첫 match_start 첫 팀(1팀 = Player1-5) → team1_name 입력칸
        assert {p for p, t in team_of.items() if t == "Team Z"} == {f"Player{i}" for i in range(1, 6)}
        assert {p for p, t in team_of.items() if t == "Team A"} == {f"Player{i}" for i in range(6, 11)}
    finally:
        # 임시 DB 는 테스트 모듈 간 공유 — test_summary 골든(전 기간 집계)에 섞이지 않게 정리
        assert client.delete(f"/api/sessions/{sid}").status_code == 200
