# -*- coding: utf-8 -*-
"""스킬 사용 줄(ability_1/2_used) 추출·저장 — parsers/ability_log.py, db/ability_store.py, 업로드·삭제 경로.

픽스처 abilities_basic.txt(합성): 1라운드 준비 시간 사용(시계 0), 완전 중복 1줄, 교체 직후 같은 시각(겐지→에코),
에코 복제 중(마지막 열 D.Va), 2라운드 준비 시간 사용(시계가 경계 300 에 멈춘 줄), 2라운드 사용.
스킬 줄이 없는 로그는 sample_data(공개 샘플) — has_log=False.
기존 파서·통계 출력이 바뀌지 않는다는 것은 test_golden 이 그대로 고정한다(이 모듈은 원문을 따로 읽는다).
"""
import pytest
from fastapi.testclient import TestClient

import golden_util
from db import ability_store
from parsers.ability_log import extract_ability_data, assign_round, _round_rules
from parsers.log_parser import parse_overwatch_log
from services.stats import calculate_pure_stats

FIXTURE = "abilities_basic.txt"


def _extract(text):
    return extract_ability_data(text, parse_overwatch_log(text))


def _sample_text():
    with open(golden_util.SAMPLE_LOG, "r", encoding="utf-8") as f:
        return f.read()


def _key(u):
    return (u["player_name"], u["hero_name"], u["slot"], u["game_time"])


def test_extract_fields(fixture_text):
    d = _extract(fixture_text(FIXTURE))
    assert d["has_log"] is True
    assert d["raw_lines"] == 9 and d["dup_skipped"] == 1          # 완전 중복 1줄은 한 번만
    by = {_key(u): u for u in d["uses"]}
    assert len(by) == len(d["uses"]) == 8

    # 1라운드 준비 시간(시계 0, setup_complete 전) — 저장·표시 대상, is_setup 표시
    u = by[("A2", "트레이서", 1, 0.0)]
    assert u["is_setup"] is True and u["round_no"] == 1 and u["team_slot"] == 1
    assert u["timestamp"] == 28                                   # 로그 시각 30초 − 2초(events.timestamp 와 같은 규칙)
    u = by[("A2", "트레이서", 1, 10.5)]
    assert u["is_setup"] is False and u["round_no"] == 1 and u["timestamp"] == 68
    assert by[("B3", "캐서디", 2, 11.25)]["team_slot"] == 2

    # 교체 직후 같은 시각: 교체 전 영웅 줄과 교체 후 영웅 줄이 각각 1개(이중 기록·뒤섞임 없음)
    assert by[("A3", "겐지", 1, 20.0)]["copy_hero"] is None
    assert by[("A3", "에코", 1, 20.0)]["copy_hero"] is None
    # 에코 복제 중: 저장하되 copy_hero 로 표시
    assert by[("A3", "에코", 2, 30.0)]["copy_hero"] == "D.Va"

    # 2라운드 준비 시간: 시계가 경계(300)에 멈춘 줄 → 시작하는 2라운드(일반 규칙이면 1라운드로 갔을 값)
    u = by[("B3", "캐서디", 2, 300.0)]
    assert u["is_setup"] is True and u["round_no"] == 2
    assert by[("A2", "트레이서", 1, 400.0)]["round_no"] == 2


def test_hero_time_per_hero(fixture_text):
    d = _extract(fixture_text(FIXTURE))
    ht = {(h["team_slot"], h["player_name"], h["hero_name"]): h["seconds"] for h in d["hero_time"]}
    assert ht[(1, "A3", "겐지")] == 20 and ht[(1, "A3", "에코")] == 680   # 영웅별 누적 최댓값(주 영웅 귀속 아님)
    assert ht[(1, "A2", "트레이서")] == 700 and ht[(2, "B3", "캐서디")] == 700


def test_no_ability_lines():
    d = _extract(_sample_text())
    assert d == {"has_log": False, "raw_lines": 0, "dup_skipped": 0, "uses": [], "hero_time": []}


@pytest.mark.parametrize("source", ["sample", "abilities_basic.txt", "tail_after_boundary.txt"])
def test_round_rule_matches_calculate_pure_stats(source, fixture_text):
    """assign_round 가 calculate_pure_stats 의 이벤트 배정과 같은지 — 일반 이벤트와 round_start(준비 시간 규칙)."""
    text = _sample_text() if source == "sample" else fixture_text(source)
    parsed = parse_overwatch_log(text)
    target = {}
    calculate_pure_stats(parsed, target, match_label=source)
    placed = {}
    for rnd in target["rounds"]:
        for ev in rnd["events"]:
            placed[id(ev)] = rnd["round_number"]
    rules = _round_rules(parsed)
    checked = 0
    for ev in parsed["events"]:
        if ev.get("event_type") == "match_start":
            continue   # game_timestamp 가 로그 시각이라 비교 대상 아님
        got = assign_round(ev.get("game_timestamp", 0), ev.get("event_type") == "round_start", rules)
        assert got == placed.get(id(ev)), (source, ev.get("event_type"), ev.get("game_timestamp"))
        checked += 1
    assert checked > 0


# ── 저장 경로(업로드·로그 교체·삭제) ─────────────────────────────────────────

@pytest.fixture(scope="module")
def client():
    import main
    with TestClient(main.app) as c:
        yield c


def _register(c, name, n_matches, hours=("10", "12")):
    r = c.post("/api/scrim/manual-register", json={
        "scrimName": name, "date": "2026-10-29", "startHour": hours[0], "endHour": hours[1],
        "matches": [{"map_name": "리장 타워", "team1Name": "Team Z", "team2Name": "Team A",
                     "start_time": "00:00", "end_time": "00:00", "result": "Unknown"} for _ in range(n_matches)]})
    assert r.status_code == 200, r.text
    sid = r.json()["scrim_id"]
    matches = {m["match_index"]: m["id"] for m in c.get(f"/api/scrims/{sid}").json()["matches"]}
    return sid, matches


def _upload(c, sid, idx, text, dry=False):
    data = {"scrim_id": sid, "match_index": str(idx)}
    if dry:
        data["dry_run"] = "1"
    r = c.post("/api/matches/upload", data=data, files={"file": ("log.txt", text.encode("utf-8"), "text/plain")})
    assert r.status_code == 200, r.text
    return r


def test_upload_replace_and_delete(client, fixture_text):
    c = client
    sid = None
    try:
        sid, mids = _register(c, "261029-스킬저장", 2)
        m1, m2 = mids[1], mids[2]

        _upload(c, sid, 1, fixture_text(FIXTURE), dry=True)              # dry_run 은 저장하지 않음
        assert ability_store.match_status(m1) is None

        _upload(c, sid, 1, fixture_text(FIXTURE))
        assert ability_store.match_status(m1) == {"has_log": True, "n1": 5, "n2": 3, "stored": 8}

        _upload(c, sid, 1, _sample_text())                                # 로그 교체 → 스킬 줄 없는 원문
        assert ability_store.match_status(m1) == {"has_log": False, "n1": 0, "n2": 0, "stored": 0}
        _upload(c, sid, 1, fixture_text(FIXTURE))                         # 다시 교체 → 중복 없이 8
        assert ability_store.match_status(m1)["stored"] == 8

        _upload(c, sid, 2, fixture_text(FIXTURE))
        assert c.delete(f"/api/matches/{m2}").status_code == 200          # 매치 삭제 → 정리
        assert ability_store.match_status(m2) is None
        assert ability_store.match_status(m1)["stored"] == 8              # 다른 매치는 그대로

        assert c.delete(f"/api/sessions/{sid}").status_code == 200        # 세션 삭제 → 남은 매치도 정리
        assert ability_store.match_status(m1) is None
        sid = None
    finally:
        if sid:
            c.post("/api/sessions/delete-batch", json={"ids": [sid]})


def test_batch_deletes_forget(client, fixture_text):
    c = client
    sids = []
    try:
        sid_a, ma = _register(c, "261029-배치A", 2, hours=("13", "15"))
        sids.append(sid_a)
        for i in (1, 2):
            _upload(c, sid_a, i, fixture_text(FIXTURE))
        assert c.post("/api/matches/delete-batch", json={"ids": [ma[1]]}).status_code == 200
        assert ability_store.match_status(ma[1]) is None and ability_store.match_status(ma[2])["stored"] == 8

        assert c.post("/api/sessions/delete-batch", json={"ids": [sid_a]}).status_code == 200
        sids.remove(sid_a)
        assert ability_store.match_status(ma[2]) is None
    finally:
        if sids:
            c.post("/api/sessions/delete-batch", json={"ids": sids})
