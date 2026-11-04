# -*- coding: utf-8 -*-
"""video_url 스킴 검증: 매치 PATCH·수동 등록은 빈 값 또는 http/https 만(그 외 422, 저장·파일 무변화)."""
import os

import pytest
from fastapi.testclient import TestClient

from config import ROW_DATA_DIR

BAD = ["javascript:alert(1)", " JavaScript:alert(1)", "java\tscript:alert(1)", "data:text/html,<b>x</b>",
       "vbscript:x", "//youtu.be/abc", "youtu.be/abc", "http:/x"]
GOOD = ["https://youtu.be/abc123?t=10", "https://www.youtube.com/watch?v=abc123&t=5s", "http://example.com/v", "", "  "]


@pytest.fixture(scope="module")
def client():
    import main
    with TestClient(main.app) as c:
        yield c


def _seg(video_url=""):
    return {"map_name": "리장 타워", "team1Name": "Team Z", "team2Name": "Team A", "start_time": "00:00",
            "end_time": "00:00", "result": "Unknown", "videoUrl": video_url}


def _register(c, video_url=""):
    return c.post("/api/scrim/manual-register", json={
        "scrimName": "vod-url", "date": "2026-11-06", "startHour": "01", "endHour": "03", "matches": [_seg(video_url)]})


def _cleanup(c, sid):
    if sid:
        assert c.post("/api/sessions/delete-batch", json={"ids": [sid]}).status_code == 200


@pytest.mark.parametrize("bad", BAD)
def test_register_rejects_non_http_video_url(client, bad):
    before = set(os.listdir(ROW_DATA_DIR))
    r = _register(client, bad)
    assert r.status_code == 422, r.text
    assert "videoUrl" in r.json()["detail"]
    assert set(os.listdir(ROW_DATA_DIR)) == before


def test_patch_match_video_url(client):
    c = client
    sid = None
    try:
        r = _register(c, "https://youtu.be/start1")
        assert r.status_code == 200, r.text
        sid = r.json()["scrim_id"]
        mid = c.get(f"/api/scrims/{sid}").json()["matches"][0]["id"]
        for bad in BAD:
            assert c.patch(f"/api/matches/{mid}", json={"video_url": bad}).status_code == 422, bad
        assert c.get(f"/api/matches/{mid}").json()["video_url"] == "https://youtu.be/start1"   # 거부 시 무변경
        for good in GOOD:
            assert c.patch(f"/api/matches/{mid}", json={"video_url": good}).status_code == 200, good
            assert c.get(f"/api/matches/{mid}").json()["video_url"] == good.strip()
    finally:
        _cleanup(c, sid)
