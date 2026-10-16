# 밴픽 규칙 프리셋(2026-10-16). 서버 권위 상태기계(state.py)가 읽는 유일한 규칙 출처.
#
# backend/banpick/ruleset.json 이 있으면 그 값을(검증 후) DEFAULT 위에 덮어 쓰고, 없으면 DEFAULT = 현행 규칙.
# 공개판은 파일을 두지 않는다(인스턴스 델타 — FLC map_pool.json 과 같은 방식). 스키마·예시: docs/BANPICK_RULESET.md
#
# 프론트는 서버 state["ruleset"] 으로 규칙을 받는다(파일을 직접 읽지 않음 — 서버 권위).
import copy
import json
import os

from .data import MAP_BY_ID

_RULESET_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "ruleset.json")

MODE_LABELS = ("쟁탈", "화물", "혼합", "밀기", "플래시포인트", "격돌")
# maps.json banpick.type(영문) ↔ 모드 라벨(한글)
TYPE_TO_MODE = {"Control": "쟁탈", "Escort": "화물", "Hybrid": "혼합", "Push": "밀기", "Flashpoint": "플래시포인트", "Clash": "격돌"}

# 현행 규칙과 동치인 기본 프리셋(변경 금지 — test_ruleset.py 가 default 동치를 검증한다).
DEFAULT = {
    "name": "default",
    # 세트당 총 밴 수와 순서. "first"=선밴 팀(맵/순서 선택 결과로 정해진 팀), "second"=상대.
    "bansPerSet": 2,
    "banOrder": ["first", "second"],
    # 역할군별 밴 상한(세트 내, 양 팀 합산). 현행 roleLock(먼저 밴한 팀이 역할 선점)은 팀당 1밴이라 상한 1과 동치.
    "roleCapPerSet": 1,
    # 재밴 금지 범위: none | previousSet(직전 세트) | allSets(과거 전 세트). perTeam=True 면 "자기 팀이 밴한 영웅"만.
    "banRepeat": {"scope": "allSets", "perTeam": True},
    # 세트 시작: 직전 패자가 고르는 것(map, banOrder). firstSet: "config"=firstSetPicker(AUTO/A/B) 그대로,
    #   "host"=방장 지정(AUTO 면 A).
    "setStart": {"loserChooses": ["map", "banOrder"], "firstSet": "config"},
    # 맵풀: free=전체 맵, 같은 모드 noRepeatModeWithin 세트 사이클 반복 금지(현행).
    #   fixed=modes{모드: [id,...]} + sequence{bo3/bo5/bo7: [모드,...]}, reuse "remaining-auto"=같은 모드 재등장 시 안 쓴 맵 자동.
    "mapPool": {"mode": "free", "noRepeatModeWithin": 5},
}


class RulesetError(ValueError):
    pass


def _check(cond, msg):
    if not cond:
        raise RulesetError(msg)


def validate(rs):
    """프리셋 dict 검증. 잘못되면 RulesetError. 검증 통과한 dict(깊은 복사)를 돌려준다."""
    rs = copy.deepcopy(rs)
    _check(isinstance(rs.get("name"), str) and rs["name"], "name: non-empty string")
    n = rs.get("bansPerSet")
    _check(isinstance(n, int) and n >= 0, "bansPerSet: int >= 0")
    order = rs.get("banOrder")
    _check(isinstance(order, list) and len(order) == n and all(x in ("first", "second") for x in order),
           "banOrder: list of 'first'|'second' with length == bansPerSet")
    cap = rs.get("roleCapPerSet")
    _check(isinstance(cap, int) and cap >= 1, "roleCapPerSet: int >= 1")
    br = rs.get("banRepeat") or {}
    _check(br.get("scope") in ("none", "previousSet", "allSets"), "banRepeat.scope: none|previousSet|allSets")
    _check(isinstance(br.get("perTeam"), bool), "banRepeat.perTeam: bool")
    ss = rs.get("setStart") or {}
    lc = ss.get("loserChooses")
    _check(isinstance(lc, list) and "banOrder" in lc and all(x in ("map", "banOrder") for x in lc),
           "setStart.loserChooses: list containing 'banOrder' (and optionally 'map')")
    _check(ss.get("firstSet") in ("config", "host"), "setStart.firstSet: config|host")
    mp = rs.get("mapPool") or {}
    _check(mp.get("mode") in ("free", "fixed"), "mapPool.mode: free|fixed")
    if mp["mode"] == "free":
        w = mp.get("noRepeatModeWithin", 5)
        _check(isinstance(w, int) and w >= 0, "mapPool.noRepeatModeWithin: int >= 0")
        mp["noRepeatModeWithin"] = w
    else:
        modes = mp.get("modes")
        _check(isinstance(modes, dict) and modes, "mapPool.modes: {모드: [map_id,...]}")
        for label, ids in modes.items():
            _check(label in MODE_LABELS, f"mapPool.modes: unknown mode label {label!r}")
            _check(isinstance(ids, list) and ids, f"mapPool.modes[{label}]: non-empty list")
            for mid in ids:
                _check(mid in MAP_BY_ID, f"mapPool.modes[{label}]: unknown map id {mid!r}")
                _check(TYPE_TO_MODE.get(MAP_BY_ID[mid]["type"]) == label,
                       f"mapPool.modes[{label}]: map {mid!r} is not a {label} map")
        seq = mp.get("sequence")
        _check(isinstance(seq, dict) and all(k in seq for k in ("bo3", "bo5", "bo7")),
               "mapPool.sequence: {bo3,bo5,bo7}")
        for k, length in (("bo3", 3), ("bo5", 5), ("bo7", 7)):
            s = seq[k]
            _check(isinstance(s, list) and len(s) == length and all(x in modes for x in s),
                   f"mapPool.sequence.{k}: {length} mode labels, each defined in modes")
            # 같은 모드가 그 모드의 맵 수보다 자주 나오면 안 쓴 맵이 모자란다
            for label in set(s):
                _check(s.count(label) <= len(modes[label]),
                       f"mapPool.sequence.{k}: mode {label!r} appears {s.count(label)}x but has {len(modes[label])} maps")
        _check(mp.get("reuse", "remaining-auto") == "remaining-auto", "mapPool.reuse: remaining-auto")
        mp["reuse"] = "remaining-auto"
    return rs


def load_ruleset(path=_RULESET_PATH):
    """ruleset.json 이 있으면 DEFAULT 위에 덮어 검증, 없으면 DEFAULT. 파일이 잘못되면 기동 실패(조용히 default 로 가지 않음)."""
    base = copy.deepcopy(DEFAULT)
    try:
        with open(path, encoding="utf-8") as f:
            doc = json.load(f)
    except FileNotFoundError:
        return base
    _check(isinstance(doc, dict), "ruleset.json: object expected")
    merged = {**base, **doc}
    for k in ("banRepeat", "setStart"):
        if isinstance(doc.get(k), dict):
            merged[k] = {**base[k], **doc[k]}
    rs = validate(merged)
    print(f"[banpick] ruleset loaded: {rs['name']} ({os.path.basename(path)})")
    return rs


RULESET = load_ruleset()
