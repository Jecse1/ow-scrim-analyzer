# 밴픽 실시간 대결 — 서버 권위 상태 머신 (순수 함수).
# 원본 프론트(BanpickApp.tsx)의 상태 머신을 그대로 포팅. 서버가 유일한 진실 원본이며
# 클라는 액션 전송 + 상태 수신/렌더만 한다. 모든 전이는 여기서 검증(턴/소유권/적법성).
# ⚠️ 원본과 동작 동치(default 프리셋). 규칙 요약:
#   - 밴: 규칙 프리셋(ruleset.py)이 정한다. default = 팀당 1개(총 2)·선밴→후밴·역할당 1(=roleLock)·과거 전 세트 자기 팀 밴 재밴 금지.
#   - 픽: 팀당 5슬롯 [Tank,Damage,Damage,Support,Support], 1v1은 두 팀 동시 블라인드 후 각자 락. (프리셋과 무관 — 불변)
#   - 타이머: 서버 카운트다운, 만료 시 자동처리 없음(overtime 표시만, 입력 계속 허용).
# [2026-10-16 프리셋 일반화] 밴 순서/수(banSeq)·역할 상한(roleBanCount)·재밴 금지(repeatBlocked)·세트 시작 맵풀(mapChoices)
#   을 state 에 두고 프론트에 그대로 브로드캐스트한다(서버 권위). state["ruleset"] 이 규칙 원본.
import random
from .data import HERO_BY_ID, MAP_BY_ID, MAPS, hero_role, map_exists
from .ruleset import RULESET, TYPE_TO_MODE

MODE = {"HERO_BAN_ONLY": 1, "HERO_BAN_WITH_MAP": 2, "FULL": 3}
SLOT_ROLES = ["Tank", "Damage", "Damage", "Support", "Support"]
TIMER = {"NORMAL": 30, "PICK": 60}


class BanpickError(Exception):
    """액션 거부. code는 프로토콜 error 코드(NOT_YOUR_TURN 등)."""
    def __init__(self, code, message=""):
        self.code = code
        self.message = message or code
        super().__init__(self.message)


def _other(team):
    return "B" if team == "A" else "A"


def _target_wins(sets):
    return 2 if sets == 3 else 3 if sets == 5 else 4


def _series_done(state):
    if state["scrimMode"]:
        return False
    tw = _target_wins(state["sets"])
    wins_a = sum(1 for s in state["completedSets"] if s.get("winner") == "A")
    wins_b = sum(1 for s in state["completedSets"] if s.get("winner") == "B")
    return wins_a >= tw or wins_b >= tw


def _rules(state):
    return state.get("ruleset") or RULESET


def _repeat_blocked(state, team):
    """재밴 금지 집합(프리셋 banRepeat). scope: none | previousSet | allSets, perTeam: 자기 팀 밴만 / 양 팀 밴.
    default(allSets, perTeam) = 기존 _team_ban_history 와 동일."""
    br = _rules(state)["banRepeat"]
    scope = br["scope"]
    if scope == "none":
        return set()
    sets = state["completedSets"]
    if scope == "previousSet":
        sets = sets[-1:]
    teams = [team] if br["perTeam"] else ["A", "B"]
    blocked = set()
    for s in sets:
        for tm in teams:
            blocked.update(s.get("bans", {}).get(tm, []))
    return blocked


def _team_ban_history(state, team):
    # 하위호환 이름(테스트 사용). 프리셋 규칙에 따른 재밴 금지 집합.
    return _repeat_blocked(state, team)


def _set_mode_label(state):
    """fixed 맵풀에서 이번 세트의 모드 라벨(없으면 None — free 모드 또는 시퀀스 범위 밖)."""
    mp = _rules(state)["mapPool"]
    if mp["mode"] != "fixed":
        return None
    seq = mp["sequence"].get(f"bo{state['sets']}") or []
    idx = len(state["completedSets"])
    return seq[idx] if idx < len(seq) else None


def _all_banned_this_set(state):
    return list(state["bans"]["A"]) + list(state["bans"]["B"])


def new_state(config, rng=random, ruleset=None):
    mode = int(config.get("mode", MODE["FULL"]))
    sets = int(config.get("sets", 3))
    st = {
        "ruleset": ruleset or RULESET,   # 규칙 프리셋(서버 권위) — 프론트는 이 값을 표시·비활성 판단에 쓴다
        "mode": mode,
        "sets": sets,
        "scrimMode": bool(config.get("scrimMode", False)),
        # 향후 "초과 시 자동처리" 옵션 자리만 열어둠 (이번엔 미사용 — 항상 False 동작).
        "autoOnTimeout": bool(config.get("autoOnTimeout", False)),
        "teamName": {
            "A": config.get("teamNameA", "Team A") or "Team A",
            "B": config.get("teamNameB", "Team B") or "Team B",
        },
        "firstSetPicker": config.get("firstSetPicker", "AUTO"),  # AUTO|A|B
        "ready": {"A": False, "B": False},
        "started": False,
        # per-set (start_next_set에서 채움)
        "phase": None,
        "orderChooser": "A", "mapPicker": "A", "turn": "A",
        "selectedMap": None, "banStarterChoice": None, "attackOrDefense": None,
        "roleLock": {}, "bans": {"A": [], "B": []}, "pendingBan": {"A": None, "B": None},
        # 프리셋 파생(세트마다 갱신): 밴 순서(팀 배열)·현재 인덱스·역할별 밴 수·팀별 재밴 금지 영웅·이번 세트 맵 후보/모드
        "banSeq": [], "banIdx": 0, "roleBanCount": {}, "repeatBlocked": {"A": [], "B": []},
        "mapChoices": None, "setMode": None, "mapAutoAssigned": False,
        "pickSlots": {"A": [None] * 5, "B": [None] * 5}, "activeSlot": {"A": 0, "B": 0},
        "pickLockedTeam": {"A": False, "B": False}, "pickLocked": False,
        # series
        "completedSets": [], "winnerThisSet": None,
        "usedMaps": [], "usedModesCycle": [],
        # timer / status
        "timer": TIMER["NORMAL"], "timerRunning": False, "overtime": False,
        "logs": [], "seriesDone": False,
        "awaitingResult": False,  # 픽 완료 후 세트 결과 입력 대기
    }
    return st


def start(state, rng=random):
    """양측 준비 완료 시 대전 시작(1v1). 첫 세트 초기화."""
    if state["started"]:
        return state
    if not (state["ready"]["A"] and state["ready"]["B"]):
        raise BanpickError("NOT_READY", "양 팀 모두 READY가 되어야 시작할 수 있습니다.")
    state["started"] = True
    _start_next_set(state, rng=rng, first=True)
    return state


def set_ready(state, team, value):
    if state["started"]:
        raise BanpickError("ALREADY_STARTED")
    state["ready"][team] = bool(value)
    return state


def set_team_name(state, team, name, actor=None):
    """팀명 변경(서버 저장 → 전원 broadcast 대상). 편집 권한: 본인 팀만(A명=역할A, B명=역할B).
    actor(요청자 역할)가 주어지면 team과 일치해야 하며, 불일치 시 FORBIDDEN 으로 거부한다."""
    if team not in ("A", "B"):
        raise BanpickError("INVALID_ACTION", "team must be A|B")
    if actor is not None and actor != team:
        raise BanpickError("FORBIDDEN", "본인 팀 이름만 변경할 수 있습니다.")
    nm = ("" if name is None else str(name)).strip()[:24]
    if not nm:
        raise BanpickError("INVALID_ACTION", "empty name")
    state["teamName"][team] = nm
    return state


def _start_next_set(state, rng=random, first=False):
    # 세트 초기화 (원본 세트초기화 useEffect 대응). 선택권: 첫 세트=firstSetPicker, 이후=직전 패자.
    rules = _rules(state)
    if first or not state["completedSets"]:
        fsp = state["firstSetPicker"]
        if rules["setStart"]["firstSet"] == "host" and fsp == "AUTO":
            fsp = "A"  # 1세트는 합의 — 방장(A)이 지정. 미지정이면 방장 자신.
        chooser = (("A" if rng.random() < 0.5 else "B") if fsp == "AUTO" else fsp)
    else:
        last_winner = state["completedSets"][-1].get("winner")
        chooser = (_other(last_winner) if last_winner else "A")
    state["orderChooser"] = chooser
    state["mapPicker"] = chooser
    state["turn"] = chooser
    state["selectedMap"] = None
    state["banStarterChoice"] = None
    state["attackOrDefense"] = None
    state["roleLock"] = {}
    state["pendingBan"] = {"A": None, "B": None}
    state["pickSlots"] = {"A": [None] * 5, "B": [None] * 5}
    state["activeSlot"] = {"A": 0, "B": 0}
    state["pickLockedTeam"] = {"A": False, "B": False}
    state["pickLocked"] = False
    state["bans"] = {"A": [], "B": []}
    state["winnerThisSet"] = None
    state["awaitingResult"] = False
    state["banSeq"] = []
    state["banIdx"] = 0
    state["roleBanCount"] = {}
    state["repeatBlocked"] = {"A": sorted(_repeat_blocked(state, "A")), "B": sorted(_repeat_blocked(state, "B"))}
    state["mapChoices"] = None
    state["setMode"] = None
    state["mapAutoAssigned"] = False
    state["phase"] = "BAN_ORDER" if state["mode"] == MODE["HERO_BAN_ONLY"] else "MAP_PICK"
    # fixed 맵풀: 이번 세트 모드의 맵 중 안 쓴 것만 후보. 같은 모드가 다시 나오거나(안 쓴 맵 자동 배정)
    #   패자 선택권에 map 이 없으면 자동 배정 → 선/후밴만 고르는 BAN_ORDER 로 간다.
    label = _set_mode_label(state)
    if label and state["mode"] != MODE["HERO_BAN_ONLY"]:
        pool = rules["mapPool"]["modes"][label]
        choices = [m for m in pool if m not in state["usedMaps"]]
        state["setMode"] = label
        state["mapChoices"] = choices
        seen = any(TYPE_TO_MODE.get(MAP_BY_ID.get(s.get("map"), {}).get("type")) == label
                   for s in state["completedSets"])
        auto = bool(choices) and (seen or "map" not in rules["setStart"]["loserChooses"] or len(choices) == 1)
        if auto:
            state["selectedMap"] = choices[0]
            state["mapAutoAssigned"] = True
            state["phase"] = "BAN_ORDER"
            _log(state, f"[세트 {len(state['completedSets']) + 1}] 맵 자동 배정: {MAP_BY_ID[choices[0]]['name']}")
    _reset_timer(state)
    return state


def _begin_bans(state, starter):
    """선밴 팀이 정해진 뒤 밴 순서(banSeq)를 프리셋 banOrder 로 전개하고 HERO_BAN 으로 간다. 밴 0개면 바로 다음 단계."""
    order = _rules(state)["banOrder"]
    state["banSeq"] = [starter if x == "first" else _other(starter) for x in order]
    state["banIdx"] = 0
    if not state["banSeq"]:
        state["turn"] = starter
        _after_bans(state)
        return
    state["turn"] = state["banSeq"][0]
    state["phase"] = "HERO_BAN"
    _reset_timer(state)


def _after_bans(state):
    if state["mode"] == MODE["FULL"]:
        state["phase"] = "HERO_PICK"
        _reset_timer(state)
    else:
        # 밴만/맵+밴: 밴 종료 → 결과 대기
        state["awaitingResult"] = True
        state["timerRunning"] = False


def _reset_timer(state):
    state["timer"] = TIMER["PICK"] if state["phase"] == "HERO_PICK" else TIMER["NORMAL"]
    state["timerRunning"] = state["phase"] is not None and not state["awaitingResult"] and not state["seriesDone"]
    state["overtime"] = False


def _log(state, msg):
    state["logs"].append(msg)


# ── 맵 풀(서버 검증용): usedMaps 제외 + 같은 맵타입 5개 사이클 반복 금지 ──
def _map_pickable(state, map_id):
    if not map_exists(map_id):
        return False
    if map_id in state["usedMaps"]:
        return False
    if state.get("mapChoices") is not None:
        # fixed 맵풀: 이번 세트 모드의 후보만
        return map_id in state["mapChoices"]
    mtype = MAP_BY_ID[map_id]["type"]
    cycle = state["usedModesCycle"]
    window = _rules(state)["mapPool"].get("noRepeatModeWithin", 5)
    if len(cycle) < window and mtype in cycle:
        return False
    return True


def apply_map_pick(state, team, map_id, ban_order, side=None):
    if state["phase"] != "MAP_PICK":
        raise BanpickError("WRONG_PHASE")
    if team != state["mapPicker"]:
        raise BanpickError("NOT_YOUR_TURN")
    if ban_order not in ("PICKER", "OPPONENT"):
        raise BanpickError("INVALID_ACTION", "ban_order must be PICKER|OPPONENT")
    if not _map_pickable(state, map_id):
        raise BanpickError("INVALID_ACTION", "map not pickable")
    if side is not None and side not in ("ATTACK", "DEFENSE"):
        raise BanpickError("INVALID_ACTION", "invalid side")
    state["selectedMap"] = map_id
    state["banStarterChoice"] = ban_order
    state["attackOrDefense"] = side
    starter = _other(state["mapPicker"]) if ban_order == "OPPONENT" else state["mapPicker"]
    _log(state, f"[세트 {len(state['completedSets']) + 1}] 맵 확정: {MAP_BY_ID[map_id]['name']}")
    _begin_bans(state, starter)
    return state


def apply_ban_order(state, team, ban_order):
    # 모드1(밴만): BAN_ORDER 페이즈에서 순서 확정 → HERO_BAN
    if state["phase"] != "BAN_ORDER":
        raise BanpickError("WRONG_PHASE")
    if team != state["orderChooser"]:
        raise BanpickError("NOT_YOUR_TURN")
    if ban_order not in ("PICKER", "OPPONENT"):
        raise BanpickError("INVALID_ACTION")
    state["banStarterChoice"] = ban_order
    starter = _other(state["orderChooser"]) if ban_order == "OPPONENT" else state["orderChooser"]
    _begin_bans(state, starter)
    return state


def apply_ban(state, team, hero_id):
    if state["phase"] != "HERO_BAN":
        raise BanpickError("WRONG_PHASE")
    if team != state["turn"]:
        raise BanpickError("NOT_YOUR_TURN")
    hero = HERO_BY_ID.get(hero_id)
    if not hero:
        raise BanpickError("INVALID_ACTION", "unknown hero")
    rules = _rules(state)
    seq = state["banSeq"]
    if len(state["bans"][team]) >= seq.count(team):
        raise BanpickError("INVALID_ACTION", "already banned this set")
    if hero_id in _repeat_blocked(state, team):
        raise BanpickError("INVALID_ACTION", "banned in a previous set")
    role = hero["role"]
    if state["roleBanCount"].get(role, 0) >= rules["roleCapPerSet"]:
        # default(상한 1)에서는 기존 roleLock("role locked by opponent")과 같은 거부
        raise BanpickError("INVALID_ACTION", "role ban cap reached")
    if hero_id in _all_banned_this_set(state):
        raise BanpickError("INVALID_ACTION", "already banned")

    state["bans"][team].append(hero_id)
    state["roleBanCount"][role] = state["roleBanCount"].get(role, 0) + 1
    if role not in state["roleLock"]:
        state["roleLock"][role] = team  # 하위호환 표시용(먼저 밴한 팀). 판정은 roleBanCount/roleCapPerSet.
    state["pendingBan"][team] = None
    _log(state, f"{state['teamName'][team]} 밴 확정: {hero['name']}")

    state["banIdx"] += 1
    if state["banIdx"] >= len(seq):
        _after_bans(state)
    else:
        state["turn"] = seq[state["banIdx"]]
        _reset_timer(state)
    return state


def _slot_can_take(state, team, hero_id):
    if state["phase"] != "HERO_PICK" or state["pickLocked"] or state["pickLockedTeam"][team]:
        return False
    if hero_id in _all_banned_this_set(state):
        return False
    if hero_id in [h for h in state["pickSlots"][team] if h]:
        return True
    idx = state["activeSlot"][team]
    need = SLOT_ROLES[idx]
    return hero_role(hero_id) == need


def apply_pick_toggle(state, team, hero_id):
    if state["phase"] != "HERO_PICK" or state["pickLocked"] or state["pickLockedTeam"][team]:
        raise BanpickError("WRONG_PHASE")
    if hero_id not in HERO_BY_ID:
        raise BanpickError("INVALID_ACTION", "unknown hero")
    slots = state["pickSlots"][team]
    if hero_id in slots:
        # 이미 있는 영웅 → 제거
        exist = slots.index(hero_id)
        slots[exist] = None
        state["activeSlot"][team] = exist
    else:
        idx = state["activeSlot"][team]
        if not _slot_can_take(state, team, hero_id):
            raise BanpickError("INVALID_ACTION", "role/slot mismatch or banned")
        slots[idx] = hero_id
        # 다음 빈 슬롯
        nxt = -1
        for i, v in enumerate(slots):
            if i != idx and v is None:
                nxt = i
                break
        state["activeSlot"][team] = idx if nxt == -1 else nxt
    return state


def apply_pick_lock(state, team):
    if state["phase"] != "HERO_PICK":
        raise BanpickError("WRONG_PHASE")
    if any(v is None for v in state["pickSlots"][team]):
        raise BanpickError("INVALID_ACTION", "fill all 5 slots first")
    state["pickLockedTeam"][team] = True
    names = [HERO_BY_ID.get(h, {}).get("name", h) for h in state["pickSlots"][team]]
    _log(state, f"{state['teamName'][team]} 픽 확정: {' / '.join(names)}")
    if state["pickLockedTeam"]["A"] and state["pickLockedTeam"]["B"]:
        state["pickLocked"] = True
        state["awaitingResult"] = True
        state["timerRunning"] = False
    return state


def apply_pick_unlock(state, team):
    """픽 확정(레디) 해제 — 본인 팀만. 상대가 아직 락 전(= 세트 미확정)일 때만 허용.
    양 팀 락 → pickLocked/awaitingResult 전이 이후에는 거부(WRONG_PHASE). 타이머 영향 없음."""
    if state["phase"] != "HERO_PICK":
        raise BanpickError("WRONG_PHASE")
    # 양 팀 락(세트 확정) 이후엔 거부. (self·opp 둘 다 락이면 pickLocked=True 이므로 여기서 막힘)
    if state["pickLocked"] or state["awaitingResult"]:
        raise BanpickError("WRONG_PHASE", "세트가 확정되어 해제할 수 없습니다.")
    if not state["pickLockedTeam"][team]:
        raise BanpickError("INVALID_ACTION", "확정 상태가 아닙니다.")
    state["pickLockedTeam"][team] = False
    _log(state, f"{state['teamName'][team]} 픽 해제")
    return state


def apply_set_active_slot(state, team, idx):
    """활성 슬롯(다음 픽이 들어갈 자리) 지정 — 재픽 시 '해당 슬롯만 교체'용.
    픽 페이즈 + 본인 팀 미락일 때만. 범위 밖 인덱스는 거부. 타이머 영향 없음."""
    if state["phase"] != "HERO_PICK" or state["pickLocked"] or state["pickLockedTeam"][team]:
        raise BanpickError("WRONG_PHASE")
    if not isinstance(idx, int) or idx < 0 or idx >= len(SLOT_ROLES):
        raise BanpickError("INVALID_ACTION", "bad slot index")
    state["activeSlot"][team] = idx
    return state


def apply_set_result(state, result, score_a=None, score_b=None):
    # result: "A"|"B"|"D"(무). 스냅샷 기록 후 다음 세트 or 시리즈 종료.
    if not state["awaitingResult"]:
        raise BanpickError("WRONG_PHASE", "set not finished")
    winner = None if result == "D" else result
    if result not in ("A", "B", "D"):
        raise BanpickError("INVALID_ACTION")
    effective = state["banStarterChoice"] or "PICKER"
    map_picker_this = None if state["mode"] == MODE["HERO_BAN_ONLY"] else state["mapPicker"]
    first_chooser = state["orderChooser"] if state["mode"] == MODE["HERO_BAN_ONLY"] else (map_picker_this or state["orderChooser"])
    ban_first = _other(first_chooser) if effective == "OPPONENT" else first_chooser
    snapshot = {
        "bans": {"A": list(state["bans"]["A"]), "B": list(state["bans"]["B"])},
        "picks": {
            "A": [h for h in state["pickSlots"]["A"] if h],
            "B": [h for h in state["pickSlots"]["B"] if h],
        },
        "map": state["selectedMap"],
        "winner": winner,
        "mapPicker": map_picker_this,
        "banFirst": ban_first,
        "banSecond": _other(ban_first),
        "attackOrDefense": state["attackOrDefense"],
        "scoreA": score_a, "scoreB": score_b,
        "resultA": ("W" if result == "A" else "L" if result == "B" else "D"),
    }
    state["completedSets"].append(snapshot)
    state["winnerThisSet"] = winner
    if state["selectedMap"]:
        if state["selectedMap"] not in state["usedMaps"]:
            state["usedMaps"].append(state["selectedMap"])
        m = MAP_BY_ID.get(state["selectedMap"])
        if m:
            cyc = set(state["usedModesCycle"])
            cyc.add(m["type"])
            window = _rules(state)["mapPool"].get("noRepeatModeWithin", 5)
            state["usedModesCycle"] = [] if len(cyc) >= window else list(cyc)
    _log(state, f"[세트 {len(state['completedSets'])}] 승자: {state['teamName'][winner] if winner else '무승부'}")

    state["seriesDone"] = _series_done(state)
    if state["seriesDone"]:
        state["timerRunning"] = False
        state["awaitingResult"] = False
    else:
        _start_next_set(state)
    return state


def apply_timeout(state):
    # 확정 정책: 자동 처리 없음. "시간 초과"만 표시하고 입력은 계속 허용.
    # (autoOnTimeout 옵션 자리만 열어둠 — 이번엔 동작하지 않음.)
    state["overtime"] = True
    state["timer"] = 0
    state["timerRunning"] = False
    return state


def tick(state):
    """서버 타이머 1초 감소. 0 도달 시 overtime 표시(자동처리 없음). 상태 변경 여부 반환."""
    if not state["timerRunning"] or state["overtime"]:
        return False
    state["timer"] -= 1
    if state["timer"] <= 0:
        apply_timeout(state)
    return True


def redact_view(state, viewer_role):
    """뷰어별 상태 뷰(서버 권위). ⚠️ 현재 브로드캐스트 경로에서 바이패스됨(블라인드 OFF).
    향후 '블라인드 모드' 옵션으로 되살릴 수 있도록 함수는 보존한다(rooms.broadcast_state 참고).
    ③ 블라인드 픽:
    HERO_PICK 중 '양 팀 락(pickLocked) 전'에는 상대 팀의 픽 슬롯을 숨긴다.
    공개 정보(맵/밴/락 여부/픽 개수)는 남기고, 상대가 '무엇을' 골랐는지만 가린다.
    양 팀 모두 락되면(pickLocked) 또는 픽 페이즈가 아니면 전체 공개.
    ※ 원본 state는 변경하지 않는다(얕은 복사 + 슬롯만 교체)."""
    pick_count = {
        "A": sum(1 for h in state["pickSlots"]["A"] if h),
        "B": sum(1 for h in state["pickSlots"]["B"] if h),
    }
    view = dict(state)
    view["pickCount"] = pick_count
    hide = state.get("phase") == "HERO_PICK" and not state.get("pickLocked")
    if not hide or viewer_role not in ("A", "B"):
        return view
    opp = _other(viewer_role)
    view["pickSlots"] = {
        viewer_role: list(state["pickSlots"][viewer_role]),
        opp: [None] * len(state["pickSlots"][opp]),
    }
    active = dict(state["activeSlot"])
    active[opp] = 0  # 상대 진행 위치도 노출하지 않음(개수만 pickCount로)
    view["activeSlot"] = active
    return view
