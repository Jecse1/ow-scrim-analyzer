# 밴픽 규칙 프리셋 테스트(2026-10-16).
#   1) default 프리셋 = 현행 규칙 동치(roleLock → roleCapPerSet=1 합산 치환 포함).
#   2) 합성 프리셋(RL5 와 같은 값 — 공개판에는 ruleset.json 을 두지 않으므로 여기서 dict 로 구성):
#      밴 순서 1/2,3/4 · 역할 상한 2 초과 거부 · 직전 세트 자기 팀 밴 재사용 거부/상대 밴 허용/두 세트 전 허용 ·
#      패자가 맵+선후밴 선택 · bo7 반복 모드는 남은 맵 자동 배정.
import copy
import random

import pytest

from banpick import state as sm
from banpick.data import HERO_BY_ID, MAP_BY_ID
from banpick.ruleset import DEFAULT, RulesetError, validate


# 인스턴스 저장소에 ruleset.json 이 있어도(RL5 등) 이 파일의 테스트는 default 프리셋 기준으로 돈다.
@pytest.fixture(autouse=True)
def _force_default_ruleset(monkeypatch):
    monkeypatch.setattr(sm, "RULESET", DEFAULT)

SYNTH = {
    "name": "synthetic-4ban",
    "bansPerSet": 4,
    "banOrder": ["first", "second", "second", "first"],
    "roleCapPerSet": 2,
    "banRepeat": {"scope": "previousSet", "perTeam": True},
    "setStart": {"loserChooses": ["map", "banOrder"], "firstSet": "host"},
    "mapPool": {
        "mode": "fixed",
        "modes": {
            "쟁탈": ["busan", "samoa"],
            "혼합": ["neoncross", "paraiso"],
            "밀기": ["lunasafi", "colosseo"],
            "화물": ["rialto", "grimsvotn"],
            "플래시포인트": ["suravasa", "atliss"],
        },
        "sequence": {
            "bo3": ["쟁탈", "혼합", "플래시포인트"],
            "bo5": ["쟁탈", "혼합", "플래시포인트", "화물", "밀기"],
            "bo7": ["쟁탈", "혼합", "플래시포인트", "화물", "밀기", "혼합", "쟁탈"],
        },
        "reuse": "remaining-auto",
    },
}


def _heroes(role, exclude=()):
    return [h["id"] for h in HERO_BY_ID.values() if h["role"] == role and h["id"] not in exclude]


def _new(sets=3, ruleset=None, fsp="A"):
    st = sm.new_state({"mode": 3, "sets": sets, "firstSetPicker": fsp}, ruleset=ruleset)
    sm.set_ready(st, "A", True)
    sm.set_ready(st, "B", True)
    sm.start(st, rng=random.Random(1))
    return st


def _ban_any(st, team, role=None, exclude=()):
    """해당 팀 턴에 허용되는 영웅 하나를 밴. role 지정 시 그 역할."""
    roles = [role] if role else ["Tank", "Damage", "Support"]
    banned = set(sm._all_banned_this_set(st)) | set(exclude)
    for r in roles:
        for h in _heroes(r, exclude=banned):
            try:
                sm.apply_ban(st, team, h)
                return h
            except sm.BanpickError:
                continue
    raise AssertionError("no bannable hero")


def _pick_all(st):
    for team in ("A", "B"):
        banned = set(sm._all_banned_this_set(st))
        for role in ["Tank", "Damage", "Damage", "Support", "Support"]:
            taken = set(h for h in st["pickSlots"][team] if h)
            hero = next(h for h in _heroes(role, exclude=banned | taken))
            sm.apply_pick_toggle(st, team, hero)
        sm.apply_pick_lock(st, team)


# ── 1) default 동치 ──────────────────────────────────────────────────────────
def test_default_preset_values_match_legacy_rules():
    assert DEFAULT["bansPerSet"] == 2 and DEFAULT["banOrder"] == ["first", "second"]
    assert DEFAULT["roleCapPerSet"] == 1
    assert DEFAULT["banRepeat"] == {"scope": "allSets", "perTeam": True}
    assert DEFAULT["setStart"] == {"loserChooses": ["map", "banOrder"], "firstSet": "config"}
    assert DEFAULT["mapPool"] == {"mode": "free", "noRepeatModeWithin": 5}
    validate(DEFAULT)


def test_default_role_cap_equals_legacy_role_lock():
    """현행: 먼저 밴한 팀이 역할 선점 → 상대는 같은 역할 밴 불가(팀당 1밴이라 자기 팀 중복은 애초 불가).
    roleCapPerSet=1(합산)로 같은 결과가 나와야 한다. 거부 코드는 INVALID_ACTION 으로 동일."""
    st = _new()
    picker = st["mapPicker"]
    sm.apply_map_pick(st, picker, "busan", "PICKER")
    first, second = st["turn"], sm._other(st["turn"])
    assert st["banSeq"] == [first, second]
    tank = _heroes("Tank")[0]
    sm.apply_ban(st, first, tank)
    assert st["roleLock"] == {"Tank": first}            # 하위호환 표시 필드 유지
    assert st["roleBanCount"] == {"Tank": 1}
    with pytest.raises(sm.BanpickError) as e:
        sm.apply_ban(st, second, _heroes("Tank")[1])     # 상대: 같은 역할 → 거부(기존 role locked 와 동일)
    assert e.value.code == "INVALID_ACTION"
    sm.apply_ban(st, second, _heroes("Damage")[0])
    assert st["phase"] == "HERO_PICK" and st["banIdx"] == 2


def test_default_repeat_ban_blocked_across_all_sets():
    st = _new(sets=5)
    # 세트 1
    sm.apply_map_pick(st, st["mapPicker"], "busan", "PICKER")
    first = st["turn"]
    h1 = sm.apply_ban(st, first, _heroes("Tank")[0]) and _heroes("Tank")[0]
    _ban_any(st, sm._other(first), "Damage")
    _pick_all(st); sm.apply_set_result(st, "A")
    # 세트 2: 세트 1 의 first 팀은 h1 재밴 불가, 상대는 가능(perTeam)
    sm.apply_map_pick(st, st["mapPicker"], "kingsrow", "PICKER")
    assert h1 in st["repeatBlocked"][first] and h1 not in st["repeatBlocked"][sm._other(first)]
    turn = st["turn"]
    if turn == first:
        with pytest.raises(sm.BanpickError):
            sm.apply_ban(st, first, h1)
    else:
        sm.apply_ban(st, turn, h1)  # 상대 팀은 허용


# ── 2) 합성 프리셋(RL5 값) ───────────────────────────────────────────────────
def test_synth_validates_and_state_carries_ruleset():
    rs = validate(SYNTH)
    st = _new(ruleset=rs)
    assert st["ruleset"]["name"] == "synthetic-4ban"
    assert st["setMode"] == "쟁탈" and st["mapChoices"] == ["busan", "samoa"] and st["phase"] == "MAP_PICK"


def test_synth_ban_order_1_23_4_and_role_cap_2():
    st = _new(ruleset=validate(SYNTH))
    picker = st["mapPicker"]
    sm.apply_map_pick(st, picker, "busan", "PICKER")
    f = picker; s2 = sm._other(f)
    assert st["banSeq"] == [f, s2, s2, f]
    # 1: f 탱커
    sm.apply_ban(st, f, _heroes("Tank")[0]); assert st["turn"] == s2
    with pytest.raises(sm.BanpickError) as e:
        sm.apply_ban(st, f, _heroes("Tank")[1])          # 순서 아님
    assert e.value.code == "NOT_YOUR_TURN"
    # 2,3: s2 탱커, 탱커 → 역할 상한 2 도달(합산)
    sm.apply_ban(st, s2, _heroes("Tank")[1]); assert st["turn"] == s2
    with pytest.raises(sm.BanpickError) as e:
        sm.apply_ban(st, s2, _heroes("Tank")[2])          # 3번째 탱커 → 거부
    assert "cap" in e.value.message
    sm.apply_ban(st, s2, _heroes("Damage")[0]); assert st["turn"] == f
    # 4: f 딜러 → 밴 종료
    sm.apply_ban(st, f, _heroes("Damage")[1])
    assert st["phase"] == "HERO_PICK"
    assert len(st["bans"][f]) == 2 and len(st["bans"][s2]) == 2
    assert st["roleBanCount"] == {"Tank": 2, "Damage": 2}


def test_synth_repeat_previous_set_only_and_per_team():
    st = _new(sets=5, ruleset=validate(SYNTH), fsp="A")
    # 세트 1(쟁탈): A 선택·선밴. A 밴: tank0, dmg0 / B 밴: tank1, dmg1
    sm.apply_map_pick(st, "A", "busan", "PICKER")
    T, D = _heroes("Tank"), _heroes("Damage")
    sm.apply_ban(st, "A", T[0]); sm.apply_ban(st, "B", T[1]); sm.apply_ban(st, "B", D[1]); sm.apply_ban(st, "A", D[0])
    _pick_all(st); sm.apply_set_result(st, "A")           # A 승 → 세트 2 는 B(패자) 선택
    # 세트 2(혼합)
    assert st["mapPicker"] == "B" and st["setMode"] == "혼합" and st["mapChoices"] == ["neoncross", "paraiso"]
    assert st["repeatBlocked"] == {"A": sorted([T[0], D[0]]), "B": sorted([T[1], D[1]])}
    sm.apply_map_pick(st, "B", "paraiso", "OPPONENT")      # B 가 맵 + 후밴 선택 → A 선밴
    assert st["banSeq"] == ["A", "B", "B", "A"]
    with pytest.raises(sm.BanpickError) as e:
        sm.apply_ban(st, "A", T[0])                        # 자기 팀 직전 세트 밴 → 거부
    assert "previous" in e.value.message
    sm.apply_ban(st, "A", T[1])                            # 상대가 밴했던 영웅 → 허용
    sm.apply_ban(st, "B", D[0]); sm.apply_ban(st, "B", _heroes("Support")[0]); sm.apply_ban(st, "A", _heroes("Support")[1])
    _pick_all(st); sm.apply_set_result(st, "B")           # B 승 → 세트 3 는 A 선택
    # 세트 3(플래시포인트): 두 세트 전(세트 1) 밴은 허용, 직전(세트 2) 밴만 금지
    assert st["mapPicker"] == "A"
    assert T[0] not in st["repeatBlocked"]["A"] and T[1] in st["repeatBlocked"]["A"]
    sm.apply_map_pick(st, "A", "suravasa", "PICKER")
    sm.apply_ban(st, "A", T[0])                            # 두 세트 전 자기 밴 → 허용


def test_synth_map_pool_fixed_only_choices_pickable():
    st = _new(ruleset=validate(SYNTH))
    assert sm._map_pickable(st, "busan") and sm._map_pickable(st, "samoa")
    assert not sm._map_pickable(st, "nepal")               # 쟁탈이지만 풀 밖
    assert not sm._map_pickable(st, "paraiso")             # 다른 모드
    with pytest.raises(sm.BanpickError):
        sm.apply_map_pick(st, st["mapPicker"], "nepal", "PICKER")


def test_synth_bo7_repeated_mode_auto_assigns_remaining_map():
    st = _new(sets=7, ruleset=validate(SYNTH), fsp="A")
    seq = SYNTH["mapPool"]["sequence"]["bo7"]
    picks = {"쟁탈": "busan", "혼합": "neoncross", "플래시포인트": "suravasa", "화물": "rialto", "밀기": "lunasafi"}
    winners = ["A", "B", "A", "B", "A", "B"]              # 3:3 → 7세트까지
    for i in range(6):
        assert st["setMode"] == seq[i]
        if i < 5:
            assert st["phase"] == "MAP_PICK" and not st["mapAutoAssigned"]
            sm.apply_map_pick(st, st["mapPicker"], picks[seq[i]], "PICKER")
        else:
            # 6세트: 혼합 재등장 → 남은 paraiso 자동, 패자는 선/후밴만(BAN_ORDER)
            assert st["phase"] == "BAN_ORDER" and st["mapAutoAssigned"] and st["selectedMap"] == "paraiso"
            assert st["mapChoices"] == ["paraiso"]
            sm.apply_ban_order(st, st["orderChooser"], "PICKER")
        for _ in range(4):
            _ban_any(st, st["turn"])
        _pick_all(st); sm.apply_set_result(st, winners[i])
    # 7세트: 쟁탈 재등장 → samoa 자동
    assert st["setMode"] == "쟁탈" and st["phase"] == "BAN_ORDER" and st["selectedMap"] == "samoa"
    assert st["completedSets"][5]["map"] == "paraiso"


def test_synth_first_set_host_when_auto():
    st = _new(ruleset=validate(SYNTH), fsp="AUTO")
    assert st["mapPicker"] == "A"                          # 1세트는 방장(A) 지정, AUTO 면 A


def test_validate_rejects_bad_presets():
    bad = copy.deepcopy(SYNTH); bad["banOrder"] = ["first"]
    with pytest.raises(RulesetError):
        validate(bad)
    bad = copy.deepcopy(SYNTH); bad["mapPool"]["modes"]["쟁탈"] = ["busan", "paraiso"]   # 쟁탈에 혼합 맵
    with pytest.raises(RulesetError):
        validate(bad)
    bad = copy.deepcopy(SYNTH); bad["mapPool"]["sequence"]["bo7"] = ["쟁탈"] * 7          # 맵 2개뿐인데 7회
    with pytest.raises(RulesetError):
        validate(bad)


# ── GET /api/banpick/ruleset (SOLO 로컬 모드가 받는 프리셋) ──
def _client():
    import main
    from fastapi.testclient import TestClient
    return TestClient(main.app)


def test_ruleset_api_returns_default_without_file():
    r = _client().get("/api/banpick/ruleset")
    assert r.status_code == 200
    assert r.json() == DEFAULT


def test_ruleset_api_returns_server_preset(monkeypatch):
    monkeypatch.setattr(sm, "RULESET", SYNTH)
    r = _client().get("/api/banpick/ruleset")
    assert r.status_code == 200
    body = r.json()
    assert body["name"] == "synthetic-4ban" and body["banOrder"] == ["first", "second", "second", "first"]
    assert body["mapPool"]["modes"]["쟁탈"] == ["busan", "samoa"]
