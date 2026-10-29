# -*- coding: utf-8 -*-
"""스킬 장면 조회 API(STEP 3) — /api/abilities/{options,scenes,search}.

데이터(임시 DB, 끝에 정리):
  S1 2026-10-31 리장 타워  Team Z(1팀) vs Team A — abilities_basic.txt + A2 트레이서 스킬1 401·402.5(400 과 묶임)
                                                  + 동명 "구르기": B1 레킹볼 450, B3 캐서디 451
  S2 2026-11-01 일리오스   Team Z(1팀) vs Team B — abilities_basic.txt + A2 트레이서 스킬1 401.0~460.5(0.5초 간격 120개)
  S3 2026-11-01 일리오스   Team Z vs Team B      — sample_data(스킬 줄 없음 → 기록 없음)
A2 트레이서 스킬1: S1 5(0 준비 시간·10.5·400·401·402.5) + S2 123(0·10.5·400 + 120) = 128.
"""
import os

import pytest
from fastapi.testclient import TestClient

import golden_util
from db import ability_store
from services import ability_query as aq

FIXTURE = "abilities_basic.txt"
A2T = {"player": "A2", "hero": "트레이서", "slot": 1}


def _insert_before_r2_end(text, lines):
    marker = "[00:11:40] ,round_end,700,2"
    assert marker in text
    return text.replace(marker, "\n".join(lines) + "\n" + marker, 1)


@pytest.fixture(scope="module")
def data():
    import main
    with open(os.path.join(os.path.dirname(__file__), "fixtures", FIXTURE), "r", encoding="utf-8") as f:
        base = f.read()
    s1_text = _insert_before_r2_end(base, [
        "[00:06:41] ,ability_1_used,401,1팀,A2,트레이서,0",
        "[00:06:43] ,ability_1_used,402.5,1팀,A2,트레이서,0",
        "[00:07:30] ,ability_1_used,450,2팀,B1,레킹볼,0",
        "[00:07:31] ,ability_1_used,451,2팀,B3,캐서디,0"])
    s2_text = _insert_before_r2_end(base.replace("리장 타워", "일리오스"), [
        f"[00:{6 + (41 + i // 2) // 60:02d}:{(41 + i // 2) % 60:02d}] ,ability_1_used,{401 + i * 0.5},1팀,A2,트레이서,0"
        for i in range(120)])
    with open(golden_util.SAMPLE_LOG, "r", encoding="utf-8") as f:
        sample = f.read()
    with TestClient(main.app) as c:
        sids = []

        def reg(date, hours, mp, t2, text):
            r = c.post("/api/scrim/manual-register", json={
                "scrimName": f"q-{date}-{hours[0]}", "date": date, "startHour": hours[0], "endHour": hours[1],
                "matches": [{"map_name": mp, "team1Name": "Team Z", "team2Name": t2,
                             "start_time": "00:00", "end_time": "00:00", "result": "Unknown"}]})
            assert r.status_code == 200, r.text
            sid = r.json()["scrim_id"]
            sids.append(sid)
            mid = c.get(f"/api/scrims/{sid}").json()["matches"][0]["id"]
            r = c.post("/api/matches/upload", data={"scrim_id": sid, "match_index": "1"},
                       files={"file": ("log.txt", text.encode("utf-8"), "text/plain")})
            assert r.status_code == 200, r.text
            return mid

        m1 = reg("2026-10-31", ("10", "12"), "리장 타워", "Team A", s1_text)
        m2 = reg("2026-11-01", ("10", "12"), "일리오스", "Team B", s2_text)
        m3 = reg("2026-11-01", ("13", "15"), "일리오스", "Team B", sample)
        try:
            yield c, {"m1": m1, "m2": m2, "m3": m3}
        finally:
            c.post("/api/sessions/delete-batch", json={"ids": sids})


def _scenes(c, **params):
    r = c.get("/api/abilities/scenes", params=params)
    assert r.status_code == 200, r.text
    return r.json()


def test_basic_page_and_summary(data):
    c, m = data
    d = _scenes(c, **A2T)
    assert d["summary"]["uses"] == 128 and d["meta"]["total_rows"] == 128 and d["meta"]["pages"] == 2
    assert len(d["rows"]) == 100
    # 날짜 내림차순 기본: S2 먼저, 매치 안은 게임시간 오름차순 — 첫 행은 S2 의 준비 시간 사용(게임시간 0)
    first = d["rows"][0]
    assert first["match_id"] == m["m2"] and first["game_time"] == 0 and first["is_setup"] is True
    assert first["team_name"] == "Team Z" and first["timestamp"] == 28 and first["effective_delta"] == 0
    # VOD 입력(buildVideoLink 와 같은 형태)
    assert set(d["matches"][m["m2"]]) >= {"video_url", "video_offset", "game_setup_sec", "pauses", "date", "map_name"}
    # 10분당 = 128 / 원문 트레이서 시간(700 + 700) × 600
    assert d["summary"]["hero_seconds"] == 1400 and d["summary"]["per10"] == round(128 / 1400 * 600, 2)
    assert d["summary"]["no_log_matches"] == 0          # A2 는 S3(sample)에 없음


def test_page_boundaries(data):
    c, m = data
    p2 = _scenes(c, **A2T, page=2)
    assert len(p2["rows"]) == 28 and all(r["match_id"] == m["m1"] for r in p2["rows"][-5:])
    assert _scenes(c, **A2T, page=3)["rows"] == []
    asc = _scenes(c, **A2T, sort="date_asc")
    assert asc["rows"][0]["match_id"] == m["m1"] and asc["rows"][0]["game_time"] == 0


def test_filters(data):
    c, m = data
    assert _scenes(c, **A2T, date_from="2026-11-01")["summary"]["uses"] == 123
    assert _scenes(c, **A2T, date_to="2026-10-31")["summary"]["uses"] == 5
    assert _scenes(c, **A2T, map="일리오스")["summary"]["uses"] == 123
    assert _scenes(c, **A2T, map="Lijiang Tower")["summary"]["uses"] == 5        # 맵 표기 변형도 정본으로
    assert _scenes(c, **A2T, opponent="Team B")["summary"]["uses"] == 123
    assert _scenes(c, **A2T, opponent="Team A")["summary"]["uses"] == 5
    assert _scenes(c, **A2T, side="us", base_team="Team Z")["summary"]["uses"] == 128
    assert _scenes(c, **A2T, side="them", base_team="Team Z")["summary"]["uses"] == 0
    assert _scenes(c, **A2T, side="them", base_team="Team A")["summary"]["uses"] == 5   # Team A 가 뛴 S1 만
    assert _scenes(c, player="A2", hero="Tracer", slot=1)["summary"]["uses"] == 128  # 영웅 영문 표기
    both = _scenes(c, player="A2", hero="트레이서")
    assert both["summary"]["uses"] == 128 + 0                                        # 스킬2 사용 없음


def test_grouping(data):
    c, m = data
    d = _scenes(c, **A2T, group="true")
    assert d["summary"]["uses"] == 128 and d["meta"]["total_rows"] == 6
    s1 = [r for r in d["rows"] if r["match_id"] == m["m1"]]
    assert [(r["game_time"], r["count"], r["last_game_time"]) for r in s1] == [(0, 1, 0), (10.5, 1, 10.5), (400, 3, 402.5)]
    s2 = [r for r in d["rows"] if r["match_id"] == m["m2"]]
    assert s2[-1]["game_time"] == 400 and s2[-1]["count"] == 121 and s2[-1]["last_game_time"] == 460.5


def test_echo_copy_excluded(data):
    c, m = data
    assert _scenes(c, player="A3", hero="에코", slot=2)["summary"]["uses"] == 0       # 복제 중(D.Va) 1줄씩 → 제외
    assert _scenes(c, player="A3", hero="에코", slot=1)["summary"]["uses"] == 2
    opt = c.get("/api/abilities/options").json()
    a3 = next(p for p in opt["players"] if p["name"] == "A3")
    echo = next(h for h in a3["heroes"] if h["hero"] == "에코")
    assert echo["uses1"] == 2 and echo["uses2"] == 0 and echo["seconds"] == 1360


def test_no_log_matches(data):
    c, m = data
    d = _scenes(c, hero="트레이서", slot=1, date_from="2026-11-01")
    assert d["summary"]["log_matches"] == 1 and d["summary"]["no_log_matches"] == 1   # S3(sample) = 기록 없음
    assert ability_store.match_status(m["m3"]) == {"has_log": False, "n1": 0, "n2": 0, "stored": 0}


def test_options(data):
    c, m = data
    opt = c.get("/api/abilities/options", params={"base_team": "Team Z"}).json()
    a2 = next(p for p in opt["players"] if p["name"] == "A2")
    assert a2["ours"] is True and a2["teams"] == ["Team Z"]
    assert [h["hero"] for h in a2["heroes"]] == ["트레이서"]                          # 플레이한 영웅만
    assert a2["heroes"][0]["uses1"] == 128 and a2["heroes"][0]["seconds"] == 1400
    b3 = next(p for p in opt["players"] if p["name"] == "B3")
    assert b3["ours"] is False
    assert opt["hero_skills"]["트레이서"]["1"] == {"ko": "점멸", "en": "Blink", "zh": "闪现"}
    assert aq.skill_names("없는영웅") == {"1": {"ko": None, "en": None, "zh": None}, "2": {"ko": None, "en": None, "zh": None}}


def test_search_tokens_and_same_name(data):
    c, m = data
    d = c.get("/api/abilities/search", params={"q": "a2 트레이서 점멸"}).json()
    assert d["resolved"]["players"] == ["A2"] and d["resolved"]["skills"] == [{"hero": "트레이서", "ability": "Ability 1"}]
    assert d["total"] == 128 and len(d["rows"]) == 128 and d["truncated"] is False
    assert d["rows"][0]["match_id"] == m["m2"]                                       # 최신순
    d = c.get("/api/abilities/search", params={"q": "구르기"}).json()                 # 동명: 레킹볼·캐서디 모두
    assert {s["hero"] for s in d["resolved"]["skills"]} == {"레킹볼", "캐서디"}
    assert sorted(r["hero_name"] for r in d["rows"]) == ["레킹볼", "캐서디"]
    d = c.get("/api/abilities/search", params={"q": "캐서디 구르기"}).json()          # 영웅 토큰이 있으면 그 영웅만
    assert [r["hero_name"] for r in d["rows"]] == ["캐서디"]
    d = c.get("/api/abilities/search", params={"q": "불사조 부활"}).json()            # skillAliases(궁극기) → 해석만, 사용 장면 없음
    assert d["resolved"]["skills"] == [{"hero": "안란", "ability": "Ultimate"}] and d["rows"] == []
    d = c.get("/api/abilities/search", params={"player": "A2", "hero": "트레이서", "limit": 50}).json()
    assert d["total"] == 128 and len(d["rows"]) == 50 and d["truncated"] is True
    assert c.get("/api/abilities/search").status_code == 400
    assert aq.parse_query("someone 오리사 방어 강화") == {"player": "someone", "hero": "오리사", "skill": "방어 강화", "key": None}
    assert aq.parse_query("Fortify someone") == {"player": "someone", "hero": None, "skill": "Fortify", "key": None}


def test_etag_304(data):
    c, m = data
    r = c.get("/api/abilities/scenes", params=A2T)
    etag = r.headers["etag"]
    assert c.get("/api/abilities/scenes", params=A2T, headers={"If-None-Match": etag}).status_code == 304
    o = c.get("/api/abilities/options")
    oetag = o.headers["etag"]
    assert c.get("/api/abilities/options", headers={"If-None-Match": oetag}).status_code == 304
    # 스킬 저장소만 바뀌어도(백필처럼 응답 캐시 무효화 없음) ETag 가 바뀌어 새 내용을 받는다
    saved = ability_store.match_status(m["m3"])
    ability_store.replace_match(m["m3"], {"has_log": False, "uses": [], "hero_time": []})
    assert saved == ability_store.match_status(m["m3"])
    r2 = c.get("/api/abilities/scenes", params=A2T, headers={"If-None-Match": etag})
    assert r2.status_code == 200 and r2.headers["etag"] != etag
    o2 = c.get("/api/abilities/options", headers={"If-None-Match": oetag})
    assert o2.status_code == 200 and o2.headers["etag"] != oetag


# ── 키 토큰(좌클릭·우클릭·shift·e·q·근접) ─────────────────────────────────────

@pytest.mark.parametrize("tok,key", [
    ("좌클릭", "Primary Fire"), ("좌", "Primary Fire"), ("LMB", "Primary Fire"),
    ("우클릭", "Secondary Fire"), ("우", "Secondary Fire"), ("RMB", "Secondary Fire"),
    ("쉬프트", "Ability 1"), ("shift", "Ability 1"), ("Shift", "Ability 1"),
    ("e", "Ability 2"), ("E", "Ability 2"),
    ("q", "Ultimate"), ("Q", "Ultimate"), ("궁", "Ultimate"), ("궁극기", "Ultimate"),
    ("근접", "Melee"), ("v", "Melee"), ("V", "Melee"),
])
def test_key_tokens(tok, key):
    assert aq.parse_query(f"someone {tok}") == {"player": "someone", "hero": None, "skill": None, "key": key}
    assert aq.parse_query(f"{tok} 트레이서")["key"] == key


def test_single_char_not_misread():
    for t in ("e", "q", "v", "좌", "우", "E"):
        assert aq.parse_query(t) == {"player": t, "hero": None, "skill": None, "key": None}   # 홀로 오면 선수명
    assert aq.parse_query("e q") == {"player": "e q", "hero": None, "skill": None, "key": None}
    assert aq.parse_query("someone e")["key"] == "Ability 2"                                  # 선수 토큰이 있으면 키
    assert aq.parse_query("트레이서 e") == {"player": None, "hero": "트레이서", "skill": None, "key": "Ability 2"}
    assert aq.parse_query("우클릭") == {"player": None, "hero": None, "skill": None, "key": "Secondary Fire"}  # 두 글자 이상은 늘 키


def _search(c, q):
    r = c.get("/api/abilities/search", params={"q": q})
    assert r.status_code == 200, r.text
    return r.json()


def test_key_equals_skill_name(data):
    c, m = data
    by_key, by_name = _search(c, "a2 트레이서 shift"), _search(c, "a2 트레이서 점멸")
    assert by_key["total"] == by_name["total"] == 128 and by_key["rows"] == by_name["rows"]
    assert by_key["resolved"]["skills"] == by_name["resolved"]["skills"] == [{"hero": "트레이서", "ability": "Ability 1"}]
    assert by_key["sources"] == by_name["sources"] == {"ability_uses": True, "kills": True, "ultimate_starts": False, "use_records": True}
    # 우클릭 = 그 영웅의 Secondary Fire 이름(오리사 투창): 사용 기록 없음 → 결정타만
    rk, rn = _search(c, "someone 오리사 우클릭"), _search(c, "someone 오리사 투창")
    assert rk["resolved"]["skills"] == rn["resolved"]["skills"] == [{"hero": "오리사", "ability": "Secondary Fire"}]
    assert rk["sources"] == rn["sources"] == {"ability_uses": False, "kills": True, "ultimate_starts": False, "use_records": False}
    assert rk["rows"] == rn["rows"] == []


def test_key_without_hero_and_ultimate(data):
    c, m = data
    d = _search(c, "a2 shift")                       # 영웅 없이 키 → 모든 영웅의 그 슬롯(A2 는 트레이서뿐)
    assert d["total"] == 128 and d["resolved"]["skills"] == [{"hero": None, "ability": "Ability 1"}]
    d = _search(c, "a2 q")                           # 궁극기: 사용 장면은 ultimate_start(프론트 결합), 이 응답 rows 는 없음
    assert d["rows"] == [] and d["sources"] == {"ability_uses": False, "kills": True, "ultimate_starts": True, "use_records": True}
    d = _search(c, "a2 근접")
    assert d["rows"] == [] and d["sources"]["use_records"] is False
    d = c.get("/api/abilities/search", params={"player": "A2", "key": "e"}).json()   # 개별 인자 key
    assert d["resolved"]["skills"] == [{"hero": None, "ability": "Ability 2"}] and d["total"] == 0
    d = c.get("/api/abilities/search", params={"player": "A2", "key": "Ability 1"}).json()
    assert d["total"] == 128
