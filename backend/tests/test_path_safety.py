# -*- coding: utf-8 -*-
"""세션 ID·경로 검증 회귀 테스트(임시 DB·임시 rowdata, backend/conftest.py).

- 세션 ID 는 session_ids 규칙(10자리 + 선택 _n)만 경로에 쓴다. 형식 밖은 422, 파일 생성·삭제 없음.
- 업로드는 매치 존재 확인 뒤에만 원문 파일을 쓴다.
- 로그 파일명은 '{id}_{n}.txt' 정확 일치 — 형제 세션 '{id}_1' 의 로그를 건드리지 않는다.
- 삭제 중 DB 예외는 오류 응답, 파일은 그대로.
"""
import os

import pytest
from fastapi.testclient import TestClient

import golden_util
from config import ROW_DATA_DIR
from session_ids import is_valid_session_id, is_valid_hour, list_log_files, log_match_index

DATE = "2026-11-04"


@pytest.fixture(scope="module")
def client():
    import main
    with TestClient(main.app) as c:
        yield c


def _sample() -> bytes:
    with open(golden_util.SAMPLE_LOG, "rb") as f:
        return f.read()


def _register(c, name, n_matches=1, hours=("03", "05")):
    r = c.post("/api/scrim/manual-register", json={
        "scrimName": name, "date": DATE, "startHour": hours[0], "endHour": hours[1],
        "matches": [{"map_name": "리장 타워", "team1Name": "Team Z", "team2Name": "Team A",
                     "start_time": "00:00", "end_time": "00:00", "result": "Unknown"} for _ in range(n_matches)]})
    assert r.status_code == 200, r.text
    sid = r.json()["scrim_id"]
    matches = {m["match_index"]: m["id"] for m in c.get(f"/api/scrims/{sid}").json()["matches"]}
    return sid, matches


def _upload(c, sid, idx):
    return c.post("/api/matches/upload", data={"scrim_id": sid, "match_index": str(idx)},
                  files={"file": ("log.txt", _sample(), "text/plain")})


def _snapshot():
    """rowdata 와 그 상위 디렉터리의 파일 목록(경로 탈출로 생긴 파일도 잡는다)."""
    parent = os.path.dirname(os.path.abspath(ROW_DATA_DIR))
    return set(os.listdir(ROW_DATA_DIR)), set(os.listdir(parent))


def _cleanup(c, *sids):
    live = {s["id"] for s in c.get("/api/scrims").json()}
    left = [x for x in sids if x and x in live]
    if left:
        assert c.post("/api/sessions/delete-batch", json={"ids": left}).status_code == 200


BAD_IDS = ["../evil", "..\\evil", "*", "", " ", "2611040305/../x", "2611040305 ", "2611040305_0",
           "2611040305_*", "２６１１０４０３０５"]


# ── 규칙 자체 ────────────────────────────────────────────────────────────────

def test_session_id_rule():
    for ok in ("2611040305", "2609091618_1", "2609091618_12"):
        assert is_valid_session_id(ok)
    for bad in BAD_IDS + [None, 2611040305, "261104030", "26110403051"]:
        assert not is_valid_session_id(bad), bad


def test_hour_rule():
    assert all(is_valid_hour(f"{h:02d}") for h in range(24))
    for bad in ("24", "1", "ab", "0a", "１２", "", " 1", None, 12):
        assert not is_valid_hour(bad), bad


def test_log_file_name_exact_match(tmp_path):
    # 세션 X 와 형제 X_1 공존: X 의 패턴이 X_1 의 로그를 잡지 않고, X_1_2 는 X_1 매치 2
    x = "2611040305"
    for name in (f"{x}_1.txt", f"{x}_1_1.txt", f"{x}_1_2.txt", f"{x}_meta.json", f"{x}_1_meta.json", f"{x}_x.txt"):
        (tmp_path / name).write_text("", encoding="utf-8")
    d = str(tmp_path)
    assert [i for i, _ in list_log_files(d, x)] == [1]
    assert [(i, os.path.basename(p)) for i, p in list_log_files(d, f"{x}_1")] == [(1, f"{x}_1_1.txt"), (2, f"{x}_1_2.txt")]
    assert log_match_index(x, f"{x}_1_2.txt") is None       # 예전 glob+int 는 int('1_2') = 12
    assert log_match_index(f"{x}_1", f"{x}_1_2.txt") == 2
    assert list_log_files(str(tmp_path / "none"), x) == []


# ── 등록 ────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("hours", [("24", "05"), ("03", "1"), ("ab", "05"), ("../", "05"), ("03", "*")])
def test_register_rejects_bad_hours(client, hours):
    before = _snapshot()
    r = client.post("/api/scrim/manual-register", json={
        "scrimName": "bad-hours", "date": DATE, "startHour": hours[0], "endHour": hours[1], "matches": []})
    assert r.status_code == 422, r.text
    assert _snapshot() == before


def test_register_hour_bounds_ok(client):
    sid = None
    try:
        sid, _ = _register(client, "hour-bounds", hours=("00", "23"))
        assert sid == "2611040023"
    finally:
        _cleanup(client, sid)


# ── 업로드 ──────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("bad", BAD_IDS)
def test_upload_rejects_bad_session_id(client, bad):
    before = _snapshot()
    r = _upload(client, bad, 1)
    assert r.status_code == 422, r.text
    assert _snapshot() == before


def test_upload_missing_or_deleted_match_writes_no_file(client):
    c = client
    sid = None
    try:
        sid, mids = _register(c, "upload-order", 2)
        assert c.delete(f"/api/matches/{mids[2]}").status_code == 200
        before = _snapshot()
        assert _upload(c, sid, 2).status_code == 404            # 삭제된 매치
        assert _upload(c, sid, 3).status_code == 404            # 없는 매치
        assert _upload(c, "2611040910", 1).status_code == 404   # 없는 세션(형식은 맞음)
        assert _snapshot() == before
        assert _upload(c, sid, 1).status_code == 200            # 정상 경로 불변
        assert os.path.exists(f"{ROW_DATA_DIR}/{sid}_1.txt")
    finally:
        _cleanup(c, sid)


# ── 삭제 ────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("bad", ["*", "a b", "..%5Cevil", "2611040305_*"])
def test_delete_session_rejects_bad_id(client, bad):
    before = _snapshot()
    assert client.delete(f"/api/sessions/{bad}").status_code == 422
    assert _snapshot() == before


def test_delete_batch_rejects_bad_ids_without_partial_delete(client):
    c = client
    sid = None
    try:
        sid, _ = _register(c, "batch-bad")
        assert _upload(c, sid, 1).status_code == 200
        before = _snapshot()
        for ids in (["*"], [sid, "../evil"], [sid, ""]):
            assert c.post("/api/sessions/delete-batch", json={"ids": ids}).status_code == 422
        assert _snapshot() == before
        assert sid in {s["id"] for s in c.get("/api/scrims").json()}
    finally:
        _cleanup(c, sid)


def test_delete_keeps_sibling_session_logs(client):
    c = client
    x = x1 = None
    try:
        x, _ = _register(c, "sibling-X", 1, hours=("06", "08"))
        x1, _ = _register(c, "sibling-X_1", 2, hours=("06", "08"))
        assert x1 == f"{x}_1"
        for sid, idx in ((x, 1), (x1, 1), (x1, 2)):
            assert _upload(c, sid, idx).status_code == 200
        assert c.post("/api/sessions/delete-batch", json={"ids": [x]}).status_code == 200
        names = set(os.listdir(ROW_DATA_DIR))
        assert f"{x}_1.txt" not in names and f"{x}_meta.json" not in names
        assert {f"{x1}_1.txt", f"{x1}_2.txt", f"{x1}_meta.json"} <= names   # 형제 로그 잔존
        assert [i for i, _ in list_log_files(ROW_DATA_DIR, x1)] == [1, 2]
    finally:
        _cleanup(c, x, x1)


class _BoomSession:
    def __call__(self):
        raise RuntimeError("injected DB failure")


def test_db_error_on_delete_keeps_files(client, monkeypatch):
    import routers.scrims as scrims
    c = client
    sid = None
    try:
        sid, mids = _register(c, "db-error", 1)
        assert _upload(c, sid, 1).status_code == 200
        before = _snapshot()
        with monkeypatch.context() as mp:
            mp.setattr(scrims, "AsyncSessionLocal", _BoomSession())
            r1 = c.post("/api/sessions/delete-batch", json={"ids": [sid]})
            r2 = c.delete(f"/api/sessions/{sid}")
            r3 = c.post("/api/matches/delete-batch", json={"ids": [mids[1]]})
        assert (r1.status_code, r2.status_code, r3.status_code) == (500, 500, 500)
        assert "injected" not in r1.text + r2.text + r3.text   # 예외 문구는 서버 로그에만
        assert _snapshot() == before
        assert sid in {s["id"] for s in c.get("/api/scrims").json()}
    finally:
        _cleanup(c, sid)


def test_forget_failure_on_match_batch_delete_still_deletes(client, monkeypatch):
    # 스킬 저장소 정리(forget_match_abilities) 실패는 로그만 — 응답·파일 삭제는 DB 결과 기준
    import routers.scrims as scrims

    async def _boom(ids):
        raise RuntimeError("injected forget failure")

    c = client
    sid = None
    try:
        sid, mids = _register(c, "forget-fail", 2)
        assert _upload(c, sid, 1).status_code == 200
        with monkeypatch.context() as mp:
            mp.setattr(scrims, "forget_match_abilities", _boom)
            r = c.post("/api/matches/delete-batch", json={"ids": [mids[1]]})
        assert r.status_code == 200, r.text
        assert r.json()["success"] is True and r.json()["deleted_count"] == 1
        left = {m["match_index"] for m in c.get(f"/api/scrims/{sid}").json()["matches"]}
        assert left == {2}
        assert not os.path.exists(f"{ROW_DATA_DIR}/{sid}_1.txt")
    finally:
        _cleanup(c, sid)


def test_forget_failure_on_single_match_delete_still_deletes(client, monkeypatch, capsys):
    # 매치 단건 삭제도 스킬 저장소 정리 실패는 로그만(일괄 삭제와 같은 구조) — 응답·파일 삭제는 DB 결과 기준
    import routers.scrims as scrims

    async def _boom(ids):
        raise RuntimeError("injected forget failure")

    c = client
    sid = None
    try:
        sid, mids = _register(c, "forget-fail-1", 2, hours=("10", "11"))
        assert _upload(c, sid, 1).status_code == 200
        with monkeypatch.context() as mp:
            mp.setattr(scrims, "forget_match_abilities", _boom)
            r = c.delete(f"/api/matches/{mids[1]}")
        assert r.status_code == 200, r.text
        assert {m["match_index"] for m in c.get(f"/api/scrims/{sid}").json()["matches"]} == {2}
        assert not os.path.exists(f"{ROW_DATA_DIR}/{sid}_1.txt")
        out = capsys.readouterr().out
        assert "delete_match forget_match_abilities failed" in out
        assert "[DB] delete_match failed" not in out          # DB 오류로 잘못 기록하지 않는다
    finally:
        _cleanup(c, sid)


def test_rebuild_backup_follows_db_path(client, monkeypatch):
    # rebuild 사본 원본·임시 파일 경로 = 엔진 DB 경로(SCRIM_DB_PATH). 사본을 가로채 실패시켜 재구축은 하지 않는다.
    import glob
    import routers.scrims as scrims
    from db import database
    seen = {}

    def _fake_snapshot(src, dst):
        seen["src"], seen["dst"] = src, dst
        raise OSError("stop before rebuild")

    monkeypatch.setattr(scrims, "_snapshot_db", _fake_snapshot)
    import time
    r = client.post("/api/admin/rebuild-db")
    assert r.status_code == 202
    for _ in range(200):
        st = client.get("/api/admin/rebuild-db/status").json()
        if st["state"] != "running":
            break
        time.sleep(0.05)
    assert st["state"] == "failed" and st["error"] == "Backup failed" and st["phase"] == "copy"
    assert seen["src"] == database._DB_PATH == os.path.abspath(os.environ["SCRIM_DB_PATH"])
    assert seen["dst"].startswith(database._DB_PATH + ".rebuild-") and seen["dst"].endswith(".tmp")
    assert not glob.glob(glob.escape(database._DB_PATH) + ".rebuild-*")
