# -*- coding: utf-8 -*-
"""세션 생명주기(routers/scrims.py) 가정 고정 — 등록 → 업로드 → complete → 편집 → 삭제 → rebuild.

rebuild 는 DB 전체를 지우고 meta.json·원문 로그로 다시 만든다. 다른 모듈과 함께 쓰는 임시 DB(conftest)를
건드리지 않도록, 이 모듈은 routers.scrims 의 세션 팩토리·ROW_DATA_DIR·DB 경로를 전용 임시 DB 로 바꿔 끼운다
(하위 프로세스보다 빠르고, 이 모듈이 부르는 엔드포인트는 전부 routers.scrims 안에 있다).

xfail(strict) = STEP 0 에서 찾은 결함 후보(D1~D8). 현재 동작이 틀렸음을 보이고, 고치면 xfail 을 푼다.
"""
import asyncio
import json
import os
import shutil
import tempfile
import threading

import pytest
from fastapi.testclient import TestClient

import golden_util

BASE = "Team A"
OPP = "Team Z"


# ── 전용 DB·rowdata ───────────────────────────────────────────────────────────
@pytest.fixture(scope="module")
def iso():
    from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
    from sqlalchemy.orm import sessionmaker
    from db import database
    from db import models  # noqa: F401
    import routers.scrims as scrims
    import main

    tmp = tempfile.mkdtemp(prefix="scrim_lifecycle_")
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
    mp.setattr(database, "_DB_PATH", db_path)            # rebuild 백업 원본
    mp.setattr(scrims, "start_backfill", lambda force=False: None)   # 스킬 백필은 공유 DB 를 읽으므로 끈다
    with TestClient(main.app) as c:
        yield c, rows, scrims
        c.portal.call(engine.dispose)
    mp.undo()
    shutil.rmtree(tmp, ignore_errors=True)


def _sample() -> bytes:
    with open(golden_util.SAMPLE_LOG, "rb") as f:
        return f.read()


def _seg(t1=OPP, t2=BASE, map_name="리장 타워", **kw):
    return {"map_name": map_name, "team1Name": t1, "team2Name": t2, "start_time": "00:00",
            "end_time": "00:00", "result": "Unknown", **kw}


def _register(c, name, segs, date="2026-11-05", hours=("10", "12")):
    r = c.post("/api/scrim/manual-register", json={"scrimName": name, "date": date, "startHour": hours[0],
                                                   "endHour": hours[1], "matches": segs})
    assert r.status_code == 200, r.text
    sid = r.json()["scrim_id"]
    return sid, {m["match_index"]: m["id"] for m in c.get(f"/api/scrims/{sid}").json()["matches"]}


def _upload(c, sid, idx, body=None, **data):
    return c.post("/api/matches/upload", data={"scrim_id": sid, "match_index": str(idx), **data},
                  files={"file": ("log.txt", body if body is not None else _sample(), "text/plain")})


def _read(path):
    with open(path, encoding="utf-8") as f:   # 실패 traceback 이 파일 객체를 붙잡지 않게(Windows 임시 폴더 삭제)
        return f.read()


def _meta(rows, sid):
    with open(f"{rows}/{sid}_meta.json", encoding="utf-8") as f:
        return json.load(f)


def _meta_match(rows, sid, mid):
    return next(m for m in _meta(rows, sid)["matches"] if m["id"] == mid)


def _snap(c, mid):
    """live ≡ rebuild 비교용 매치 스냅샷(점수·승자·선수 소속·VOD 보정)."""
    m = c.get(f"/api/matches/{mid}").json()
    return {
        k: m.get(k) for k in ("map_name", "team1_name", "team2_name", "score_t1", "score_t2", "winner",
                              "winner_override", "winner_source", "match_index", "video_offset", "source")
    } | {
        "pauses": [(p["start_sec"], p["end_sec"]) for p in m.get("pauses") or []],
        "rounds": [(r.get("round_number"), r.get("winner"), r.get("final_blows_t1"), r.get("final_blows_t2"),
                    r.get("video_delta_sec"),
                    sorted((s.get("team_name"), s.get("player_name"), s.get("hero_name")) for s in r.get("stats") or []))
                   for r in m.get("rounds") or []],
    }


def _rebuild(c):
    r = c.post("/api/admin/rebuild-db")
    assert r.status_code == 200, r.text
    assert r.json()["parse_errors"] == []
    return r.json()


# ── 등록 ────────────────────────────────────────────────────────────────────
def test_register_writes_meta_matching_db(iso):
    c, rows, _ = iso
    sid, mids = _register(c, "reg-meta", [_seg(), _seg(map_name="부산", source="manual", winner=BASE,
                                                       score_t1=1, score_t2=2)])
    meta = _meta(rows, sid)
    assert {k: meta[k] for k in ("id", "scrim_name", "date", "start_time", "end_time")} == \
        {"id": sid, "scrim_name": "reg-meta", "date": "2026-11-05", "start_time": "10", "end_time": "12"}
    assert [m["id"] for m in meta["matches"]] == [mids[1], mids[2]]
    m1, m2 = meta["matches"]
    assert set(m1) >= {"id", "match_index", "map_name", "team1_name", "team2_name", "result", "winner_override",
                       "source", "winner", "score_t1", "score_t2", "video_url", "video_offset", "video_start_sec",
                       "video_end_sec", "pauses", "winner_source"}
    assert (m1["source"], m1["winner"], m2["source"], m2["winner"], m2["score_t2"]) == ("log", "", "manual", BASE, 2)


# ── 세션 편집 ──────────────────────────────────────────────────────────────────
def test_patch_session_name_date_and_rename_sync_meta(iso):
    c, rows, _ = iso
    sid, mids = _register(c, "ps", [_seg(), _seg()], hours=("13", "15"))
    assert _upload(c, sid, 1).status_code == 200
    r = c.patch(f"/api/sessions/{sid}", json={"scrimName": "ps-2", "date": "2026-11-06",
                                               "teamRenameFrom": OPP, "teamRenameTo": "Team Y"})
    assert r.status_code == 200 and r.json()["renamed"] == {"from": OPP, "to": "Team Y"}
    d = c.get(f"/api/scrims/{sid}").json()
    assert (d["scrim_name"], d["date"]) == ("ps-2", "2026-11-06")
    assert {m["team1_name"] for m in d["matches"]} == {"Team Y"}
    meta = _meta(rows, sid)
    assert (meta["scrim_name"], meta["date"]) == ("ps-2", "2026-11-06")
    assert {m["team1_name"] for m in meta["matches"]} == {"Team Y"}
    stats_teams = {s["team_name"] for rnd in c.get(f"/api/matches/{mids[1]}").json()["rounds"] for s in rnd["stats"]}
    assert stats_teams == {"Team Y", BASE}                                      # player_stats 도 치환
    assert c.patch(f"/api/sessions/{sid}", json={"teamRenameFrom": BASE, "teamRenameTo": "X"}).status_code == 422
    assert c.patch(f"/api/sessions/{sid}", json={"teamRenameFrom": "Team Y", "teamRenameTo": BASE}).status_code == 422
    assert c.patch(f"/api/sessions/{sid}", json={"teamRenameFrom": "Team Y"}).status_code == 422


def test_patch_session_meta_rename_ignores_legacy_keys(iso):
    # D9(수정 안 함, 고정): 세션 팀명 치환의 meta 갱신은 team1_name/team2_name/winner/winner_override/result 만 본다
    # — 옛 키(team_1_name)는 그대로. 운영 meta 에 옛 키 0건.
    c, rows, scrims = iso
    sid, mids = _register(c, "ps-legacy", [_seg()], hours=("16", "18"))
    def add_legacy(meta):
        meta["matches"][0]["team_1_name"] = OPP
        return True
    scrims._update_meta_json(sid, add_legacy)
    assert c.patch(f"/api/sessions/{sid}", json={"teamRenameFrom": OPP, "teamRenameTo": "Team Y"}).status_code == 200
    m = _meta_match(rows, sid, mids[1])
    assert (m["team1_name"], m["team_1_name"]) == ("Team Y", OPP)


# ── 매치 편집 ──────────────────────────────────────────────────────────────────
def test_patch_match_swap_rename_exchange_sync_meta(iso):
    c, rows, _ = iso
    sid, mids = _register(c, "pm-teams", [_seg(), _seg(), _seg()], hours=("19", "21"))
    for i in (1, 2, 3):
        assert _upload(c, sid, i).status_code == 200
    m1, m2, m3 = mids[1], mids[2], mids[3]
    before = c.get(f"/api/matches/{m1}").json()

    # ① 자리 바꾸기: DB 슬롯·점수 교환, meta 는 원본 순서 + teams_swapped 토글
    r = c.patch(f"/api/matches/{m1}", json={"swapTeams": True})
    assert r.status_code == 200 and r.json()["teams_swapped"] is True
    after = c.get(f"/api/matches/{m1}").json()
    assert (after["team1_name"], after["team2_name"]) == (before["team2_name"], before["team1_name"])
    assert (after["score_t1"], after["score_t2"]) == (before["score_t2"], before["score_t1"])
    mm = _meta_match(rows, sid, m1)
    assert (mm["team1_name"], mm["team2_name"], mm["teams_swapped"]) == (OPP, BASE, True)

    # ② 1팀명 치환(값 기반): DB·meta 모두
    assert c.patch(f"/api/matches/{m2}", json={"team1Name": "Team Q"}).status_code == 200
    assert c.get(f"/api/matches/{m2}").json()["team1_name"] == "Team Q"
    assert _meta_match(rows, sid, m2)["team1_name"] == "Team Q"

    # ③ 교차 입력 = 이름 교환(슬롯·점수 불변, 이름값만 A↔B), teams_swapped 는 그대로
    b3 = c.get(f"/api/matches/{m3}").json()
    r = c.patch(f"/api/matches/{m3}", json={"team1Name": BASE, "team2Name": OPP})
    assert r.status_code == 200 and r.json()["exchanged_teams"] is True
    a3 = c.get(f"/api/matches/{m3}").json()
    assert (a3["team1_name"], a3["team2_name"], a3["score_t1"]) == (BASE, OPP, b3["score_t1"])
    mm3 = _meta_match(rows, sid, m3)
    assert (mm3["team1_name"], mm3["team2_name"], mm3.get("teams_swapped", False)) == (BASE, OPP, False)

    # ④ 한쪽만 교차 → 422, 같은 이름·빈 이름 → 422
    assert c.patch(f"/api/matches/{m2}", json={"team1Name": BASE}).status_code == 422
    assert c.patch(f"/api/matches/{m2}", json={"team1Name": " "}).status_code == 422


def test_patch_match_fields_pauses_rounds_delta_index_sync_meta(iso):
    c, rows, _ = iso
    sid, mids = _register(c, "pm-fields", [_seg(), _seg(map_name="부산")], hours=("22", "23"))
    assert _upload(c, sid, 1).status_code == 200
    m1, m2 = mids[1], mids[2]
    r = c.patch(f"/api/matches/{m1}", json={"map_name": "일리오스", "video_offset": 30,
                                             "pauses": [{"start_sec": 100, "end_sec": 130}],
                                             "roundsDelta": [{"round_number": 1, "video_delta_sec": 4}]})
    assert r.status_code == 200, r.text
    mm = _meta_match(rows, sid, m1)
    assert (mm["map_name"], mm["video_offset"]) == ("일리오스", 30)
    assert mm["pauses"] == [{"start_sec": 100, "end_sec": 130, "duration": 30}]
    assert {"round_number": 1, "video_delta_sec": 4} in mm["rounds_delta"]
    assert c.patch(f"/api/matches/{m1}", json={"pauses": [{"start_sec": 5, "end_sec": 5}]}).status_code == 422
    assert c.patch(f"/api/matches/{m1}", json={"roundsDelta": [{"round_number": 99, "video_delta_sec": 1}]}).status_code == 422
    # 순번 교환: 두 매치 모두 DB·meta
    assert c.patch(f"/api/matches/{m1}", json={"match_index": 2}).json()["swapped_with"] == m2
    assert (_meta_match(rows, sid, m1)["match_index"], _meta_match(rows, sid, m2)["match_index"]) == (2, 1)
    assert c.get(f"/api/matches/{m2}").json()["match_index"] == 1
    # 로그 매치 승패 직접 수정은 422
    assert c.patch(f"/api/matches/{m1}", json={"winner": BASE}).status_code == 422


def test_patch_manual_match_winner_auto_from_score(iso):
    c, rows, _ = iso
    sid, mids = _register(c, "pm-manual", [_seg(source="manual")], date="2026-11-07", hours=("01", "02"))
    mid = mids[1]
    r = c.patch(f"/api/matches/{mid}", json={"winner": "", "score_t1": 1, "score_t2": 3})
    assert r.status_code == 200
    assert c.get(f"/api/matches/{mid}").json()["winner"] == BASE                # 큰 쪽 자동 판정
    assert _meta_match(rows, sid, mid)["winner"] == BASE
    c.patch(f"/api/matches/{mid}", json={"winner": "", "score_t1": 2, "score_t2": 2})
    assert c.get(f"/api/matches/{mid}").json()["winner"] == "Draw"
    assert c.patch(f"/api/matches/{mid}", json={"winner": "Nobody"}).status_code == 422
    assert c.patch(f"/api/matches/{mid}", json={"pauses": []}).status_code == 422


def test_exchange_meta_is_three_writes(iso, monkeypatch):
    # D10(수정 안 함, 고정): 이름 교환의 meta 갱신은 3단계 치환을 파일 쓰기 3회로 한다 —
    # 2번째 쓰기가 실패하면 meta 에 임시 토큰이 남는다.
    c, rows, scrims = iso
    sid, mids = _register(c, "ex-meta", [_seg()], date="2026-11-07", hours=("03", "04"))
    real = scrims._update_meta_json
    calls = {"n": 0}

    def flaky(sid_, mutate):
        calls["n"] += 1
        if calls["n"] == 2:
            raise OSError("disk full")
        return real(sid_, mutate)
    monkeypatch.setattr(scrims, "_update_meta_json", flaky)
    with pytest.raises(OSError):
        scrims._exchange_team_names_in_meta_match(sid, mids[1], OPP, BASE)
    assert _meta_match(rows, sid, mids[1])["team1_name"] == "\u0000swap\u0000"


# ── 승자 보정 ──────────────────────────────────────────────────────────────────
def test_winner_override_set_and_clear_sync_meta(iso):
    c, rows, _ = iso
    sid, mids = _register(c, "wo", [_seg()], date="2026-11-07", hours=("05", "06"))
    assert _upload(c, sid, 1).status_code == 200
    mid = mids[1]
    assert c.patch(f"/api/matches/{mid}/winner-override", json={"winner_override": "Nobody"}).status_code == 422
    assert c.patch(f"/api/matches/{mid}/winner-override", json={"winner_override": "Draw"}).status_code == 200
    mm = _meta_match(rows, sid, mid)
    assert (mm["winner_override"], mm["winner_source"]) == ("Draw", "override")
    assert c.patch(f"/api/matches/{mid}/winner-override", json={"winner_override": None}).status_code == 200
    mm = _meta_match(rows, sid, mid)
    assert mm["winner_override"] == "" and mm["winner_source"] != "override"
    assert c.get(f"/api/matches/{mid}").json()["winner_override"] in (None, "")


# ── 업로드 ──────────────────────────────────────────────────────────────────
def test_upload_dry_run_changes_nothing(iso):
    c, rows, _ = iso
    sid, mids = _register(c, "dry", [_seg(source="manual", winner=OPP, score_t1=2, score_t2=0)],
                          date="2026-11-07", hours=("07", "08"))
    before = (_meta(rows, sid), c.get(f"/api/matches/{mids[1]}").json())
    r = _upload(c, sid, 1, dry_run="1")
    assert r.status_code == 200 and r.json()["status"] == "dry_run" and r.json()["source"] == "manual"
    assert set(r.json()["diff"]) >= {"winner", "score"}
    assert not os.path.exists(f"{rows}/{sid}_1.txt")
    assert (_meta(rows, sid), c.get(f"/api/matches/{mids[1]}").json()) == before


def test_upload_adopt_keep_and_parsed_on_manual(iso):
    c, rows, _ = iso
    sid, mids = _register(c, "adopt", [_seg(map_name="부산", source="manual", winner=OPP, score_t1=2, score_t2=0),
                                       _seg(map_name="부산", source="manual", winner=OPP, score_t1=2, score_t2=0)],
                          date="2026-11-07", hours=("09", "10"))
    assert _upload(c, sid, 1, adopt="keep").status_code == 200
    assert _upload(c, sid, 2, adopt="parsed").status_code == 200
    keep, parsed = (c.get(f"/api/matches/{mids[i]}").json() for i in (1, 2))
    assert keep["source"] == parsed["source"] == "log"
    assert keep["map_name"] == "부산" and parsed["map_name"] != "부산"           # keep = 수기 맵 유지
    assert keep["winner_override"] == OPP and not parsed["winner_override"]      # keep = 수기 승자 → override
    mk = _meta_match(rows, sid, mids[1])
    assert (mk["source"], mk["map_name"], mk["winner_override"]) == ("log", "부산", OPP)
    assert "precheck" in mk and "warning_count" in mk["precheck"]


# ── rebuild ─────────────────────────────────────────────────────────────────
def test_rebuild_reproduces_live_after_edits(iso):
    # 편집(이름 교환·자리 바꾸기·팀명 치환·승자 보정·퍼즈·라운드 보정·순번 교환) 뒤 rebuild 결과 = live
    c, rows, _ = iso
    sid, mids = _register(c, "rb", [_seg(), _seg(), _seg()], date="2026-11-08", hours=("10", "12"))
    for i in (1, 2, 3):
        assert _upload(c, sid, i).status_code == 200
    assert c.patch(f"/api/matches/{mids[1]}", json={"swapTeams": True}).status_code == 200
    assert c.patch(f"/api/matches/{mids[2]}", json={"team1Name": BASE, "team2Name": OPP}).status_code == 200
    assert c.patch(f"/api/sessions/{sid}", json={"teamRenameFrom": OPP, "teamRenameTo": "Team Y"}).status_code == 200
    assert c.patch(f"/api/matches/{mids[3]}/winner-override", json={"winner_override": "Draw"}).status_code == 200
    assert c.patch(f"/api/matches/{mids[3]}", json={"pauses": [{"start_sec": 50, "end_sec": 60}],
                                                     "roundsDelta": [{"round_number": 1, "video_delta_sec": 3}],
                                                     "match_index": 1}).status_code == 200
    live = {k: _snap(c, v) for k, v in mids.items()}
    _rebuild(c)
    assert {k: _snap(c, v) for k, v in mids.items()} == live


def test_d1_deleted_match_stays_deleted_after_rebuild(iso):
    # D1: 매치 삭제(단건·일괄)는 meta 의 매치 항목도 뺀다 — rebuild 가 삭제 매치를 되살리지 않게
    c, rows, _ = iso
    sid, mids = _register(c, "d1", [_seg(), _seg(), _seg()], date="2026-11-08", hours=("13", "15"))
    for i in (1, 2, 3):
        assert _upload(c, sid, i).status_code == 200
    assert c.delete(f"/api/matches/{mids[2]}").status_code == 200
    assert c.post("/api/matches/delete-batch", json={"ids": [mids[3]]}).status_code == 200
    assert [m["id"] for m in _meta(rows, sid)["matches"]] == [mids[1]]
    _rebuild(c)
    assert [m["match_index"] for m in c.get(f"/api/scrims/{sid}").json()["matches"]] == [1]


def test_d5_swap_then_reupload_matches_rebuild(iso):
    # D5: 자리 바꾸기 매치에 로그를 다시 올려도 rebuild 와 같은 경로(원본 순서로 파싱 → 슬롯 재교환)
    c, rows, _ = iso
    sid, mids = _register(c, "d5", [_seg()], date="2026-11-08", hours=("16", "18"))
    assert _upload(c, sid, 1).status_code == 200
    assert c.patch(f"/api/matches/{mids[1]}", json={"swapTeams": True}).status_code == 200
    swapped_once = _snap(c, mids[1])
    assert _upload(c, sid, 1).status_code == 200
    live = _snap(c, mids[1])
    assert live == swapped_once                 # 같은 로그 재업로드 = 교환 직후와 같은 결과
    _rebuild(c)
    assert _snap(c, mids[1]) == live


# ── 등록 실패·동시 등록 ────────────────────────────────────────────────────────
def test_d2_register_db_failure_leaves_no_meta(iso, monkeypatch):
    # D2: meta 는 DB 커밋 뒤에만 확정(임시 파일 → os.replace). DB 실패면 meta·임시 파일 없음, 재등록은 같은 ID.
    c, rows, scrims = iso
    real = scrims.AsyncSessionLocal
    calls = {"n": 0}

    def flaky():
        calls["n"] += 1
        if calls["n"] == 2:            # 1번째 = ID 확인, 2번째 = 저장
            raise RuntimeError("injected")
        return real()
    monkeypatch.setattr(scrims, "AsyncSessionLocal", flaky)
    r = c.post("/api/scrim/manual-register", json={"scrimName": "d2", "date": "2026-11-09", "startHour": "01",
                                                   "endHour": "02", "matches": [_seg()]})
    monkeypatch.setattr(scrims, "AsyncSessionLocal", real)
    assert r.status_code == 500
    assert not os.path.exists(f"{rows}/2611090102_meta.json")
    assert not [f for f in os.listdir(rows) if f.endswith(".tmp")]
    sid, _ = _register(c, "d2-retry", [_seg()], date="2026-11-09", hours=("01", "02"))
    assert sid == "2611090102"


def _gather_register(c, bodies):
    import httpx
    import main

    async def run():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url="http://t") as ac:
            return await asyncio.gather(*(ac.post("/api/scrim/manual-register", json=b) for b in bodies))
    return c.portal.call(run)


class _SlowClose:
    """세션 팩토리 래퍼 — 세션을 닫을 때 잠깐 양보한다. 등록의 'ID 확인 세션 종료(await) → meta 쓰기' 사이에
    다른 등록이 같은 ID 확인을 마치게 해 경합을 매번 재현한다(타이밍 의존 제거)."""
    def __init__(self, factory):
        self.factory = factory

    def __call__(self):
        real = self.factory()

        class _Ctx:
            async def __aenter__(_s):
                return await real.__aenter__()

            async def __aexit__(_s, *exc):
                await asyncio.sleep(0.05)
                return await real.__aexit__(*exc)
        return _Ctx()


def test_d3_concurrent_register_gets_distinct_ids(iso, monkeypatch):
    # D3: 등록은 프로세스 내 잠금으로 직렬화 — 동시 등록도 서로 다른 ID(두 번째는 _1), 세션마다 meta = DB
    c, rows, scrims = iso
    monkeypatch.setattr(scrims, "AsyncSessionLocal", _SlowClose(scrims.AsyncSessionLocal))
    body = lambda n, d: {"scrimName": n, "date": d, "startHour": "03", "endHour": "04", "matches": [_seg()]}
    # 새 ID 동시 등록
    rs = _gather_register(c, [body("n1", "2026-11-09"), body("n2", "2026-11-09")])
    assert [r.status_code for r in rs] == [200, 200]
    ids = sorted(r.json()["scrim_id"] for r in rs)
    assert ids == ["2611090304", "2611090304_1"]
    # 삭제된 ID 재사용 동시 등록
    sid, _ = _register(c, "z0", [_seg()], date="2026-11-10", hours=("03", "04"))
    assert c.post("/api/sessions/delete-batch", json={"ids": [sid]}).status_code == 200
    rs = _gather_register(c, [body("z1", "2026-11-10"), body("z2", "2026-11-10")])
    assert [r.status_code for r in rs] == [200, 200]
    ids = sorted(r.json()["scrim_id"] for r in rs)
    assert ids == ["2611100304", "2611100304_1"]
    for i in ids:     # 세션마다 매치 1개, meta 와 DB 같은 내용
        d = c.get(f"/api/scrims/{i}").json()
        assert len(d["matches"]) == 1
        assert _meta(rows, i)["scrim_name"] == d["scrim_name"]
        assert [m["id"] for m in _meta(rows, i)["matches"]] == [d["matches"][0]["id"]]


# ── 업로드 실패 ─────────────────────────────────────────────────────────────
def test_d4_upload_failure_keeps_previous_log(iso, monkeypatch):
    # D4: 원문 로그는 DB 커밋 뒤에만 교체(임시 파일 → os.replace). 실패하면 기존 로그 그대로, 임시 파일 없음.
    c, rows, scrims = iso
    sid, mids = _register(c, "d4", [_seg()], date="2026-11-09", hours=("05", "06"))
    assert _upload(c, sid, 1).status_code == 200
    original = _read(f"{rows}/{sid}_1.txt")

    def boom(*a, **k):
        raise RuntimeError("parse boom")
    monkeypatch.setattr(scrims, "_parse_upload_log", boom)
    assert _upload(c, sid, 1, body=b"[00:00:00] ,garbage\n").status_code == 500
    assert _read(f"{rows}/{sid}_1.txt") == original
    assert not [f for f in os.listdir(rows) if f.endswith(".tmp")]


# ── rebuild 중 쓰기 ─────────────────────────────────────────────────────────
def test_d6_writes_rejected_while_rebuild_runs(iso, monkeypatch):
    # D6: rebuild 진행 중({job_id, started_at})엔 쓰기 API 9종·중복 rebuild 가 409, complete(읽기)는 대상 아님
    c, rows, scrims = iso
    sid, mids = _register(c, "d6", [_seg()], date="2026-11-09", hours=("07", "08"))
    started, release = threading.Event(), threading.Event()
    real_copy = shutil.copy

    def slow_copy(src, dst):           # rebuild 백업 단계에서 잠시 멈춘다
        started.set()
        release.wait(3)
        return real_copy(src, dst)
    monkeypatch.setattr(shutil, "copy", slow_copy)
    out = {}
    t = threading.Thread(target=lambda: out.setdefault("rebuild", c.post("/api/admin/rebuild-db")))
    t.start()
    try:
        assert started.wait(3)
        codes = [
            c.post("/api/scrim/manual-register", json={"scrimName": "x", "date": "2026-11-09", "startHour": "09",
                                                       "endHour": "10", "matches": [_seg()]}).status_code,
            _upload(c, sid, 1).status_code,
            c.patch(f"/api/sessions/{sid}", json={"scrimName": "y"}).status_code,
            c.patch(f"/api/matches/{mids[1]}", json={"map_name": "부산"}).status_code,
            c.patch(f"/api/matches/{mids[1]}/winner-override", json={"winner_override": "Draw"}).status_code,
            c.delete(f"/api/matches/{mids[1]}").status_code,
            c.post("/api/matches/delete-batch", json={"ids": [mids[1]]}).status_code,
            c.delete(f"/api/sessions/{sid}").status_code,
            c.post("/api/sessions/delete-batch", json={"ids": [sid]}).status_code,
            c.post("/api/admin/rebuild-db").status_code,
        ]
    finally:
        release.set()
        t.join(10)
    assert codes == [409] * 10
    assert out["rebuild"].status_code == 200
    assert scrims._REBUILD_JOB is None                                          # 끝나면 상태 해제
    assert c.patch(f"/api/sessions/{sid}", json={"scrimName": "d6-after"}).status_code == 200
    assert c.post(f"/api/sessions/{sid}/complete").status_code == 200     # complete 는 대상 아님


# ── 편집 후 meta 갱신 실패 ──────────────────────────────────────────────────
@pytest.mark.xfail(strict=True, reason="D8: 편집 뒤 meta 갱신 실패가 응답·로그에 드러나지 않는다")
def test_d8_meta_sync_failure_is_reported(iso, capsys):
    c, rows, _ = iso
    sid, mids = _register(c, "d8", [_seg()], date="2026-11-09", hours=("11", "12"))
    os.remove(f"{rows}/{sid}_meta.json")                 # meta 가 사라진 상태
    r = c.patch(f"/api/matches/{mids[1]}", json={"map_name": "부산"})
    assert r.status_code == 200
    assert r.json().get("meta_warning") == "meta_sync_failed"
    assert "meta sync failed" in capsys.readouterr().out


# ── complete ────────────────────────────────────────────────────────────────
@pytest.mark.xfail(strict=True, reason="D7: complete 를 같은 본문으로 다시 부르면 웹훅을 또 보낸다")
def test_d7_complete_same_content_sends_webhook_once(iso, monkeypatch):
    import config as _config
    c, rows, scrims = iso
    sent = []
    monkeypatch.setattr(_config, "DISCORD_WEBHOOK_URL", "http://127.0.0.1:9/hook")
    monkeypatch.setattr(scrims, "schedule_webhook", lambda url, build: sent.append(build()))
    sid, mids = _register(c, "d7", [_seg()], date="2026-11-09", hours=("13", "14"))
    for _ in range(3):
        assert c.post(f"/api/sessions/{sid}/complete").status_code == 200
    assert len(sent) == 1
    assert c.patch(f"/api/sessions/{sid}", json={"scrimName": "d7-renamed"}).status_code == 200
    assert c.post(f"/api/sessions/{sid}/complete").status_code == 200     # 본문이 바뀌면 다시 보냄
    assert len(sent) == 2
