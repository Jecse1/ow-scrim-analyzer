# 밴픽 실시간 대결 — 서버 권위 상태 머신 (순수 함수).
# 원본 프론트(BanpickApp.tsx)의 상태 머신을 그대로 포팅. 서버가 유일한 진실 원본이며
# 클라는 액션 전송 + 상태 수신/렌더만 한다. 모든 전이는 여기서 검증(턴/소유권/적법성).
# ⚠️ 원본과 동작 동치. 규칙 요약:
#   - 밴: 팀당 1개(총 2), roleLock으로 서로 다른 역할, 과거 세트에 밴한 영웅 재밴 금지.
#   - 픽: 팀당 5슬롯 [Tank,Damage,Damage,Support,Support], 1v1은 두 팀 동시 블라인드 후 각자 락.
#   - 타이머: 서버 카운트다운, 만료 시 자동처리 없음(overtime 표시만, 입력 계속 허용).
import random
from .data import HERO_BY_ID, MAP_BY_ID, MAPS, hero_role, map_exists

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


def _team_ban_history(state, team):
    # 과거 완료 세트에서 이 팀이 밴한 영웅 집합
    hist = set()
    for s in state["completedSets"]:
        for h in s.get("bans", {}).get(team, []):
            hist.add(h)
    return hist


def _all_banned_this_set(state):
    return list(state["bans"]["A"]) + list(state["bans"]["B"])


def new_state(config, rng=random):
    mode = int(config.get("mode", MODE["FULL"]))
    sets = int(config.get("sets", 3))
    st = {
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


def _start_next_set(state, rng=random, first=False):
    # 세트 초기화 (원본 세트초기화 useEffect 대응). 선택권: 첫 세트=firstSetPicker, 이후=직전 패자.
    if first or not state["completedSets"]:
        fsp = state["firstSetPicker"]
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
    state["phase"] = "BAN_ORDER" if state["mode"] == MODE["HERO_BAN_ONLY"] else "MAP_PICK"
    _reset_timer(state)
    return state


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
    mtype = MAP_BY_ID[map_id]["type"]
    cycle = state["usedModesCycle"]
    if len(cycle) < 5 and mtype in cycle:
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
    state["turn"] = starter
    state["phase"] = "HERO_BAN"
    _reset_timer(state)
    _log(state, f"[세트 {len(state['completedSets']) + 1}] 맵 확정: {MAP_BY_ID[map_id]['name']}")
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
    state["turn"] = starter
    state["phase"] = "HERO_BAN"
    _reset_timer(state)
    return state


def apply_ban(state, team, hero_id):
    if state["phase"] != "HERO_BAN":
        raise BanpickError("WRONG_PHASE")
    if team != state["turn"]:
        raise BanpickError("NOT_YOUR_TURN")
    hero = HERO_BY_ID.get(hero_id)
    if not hero:
        raise BanpickError("INVALID_ACTION", "unknown hero")
    if len(state["bans"][team]) >= 1:
        raise BanpickError("INVALID_ACTION", "already banned this set")
    if hero_id in _team_ban_history(state, team):
        raise BanpickError("INVALID_ACTION", "banned in a previous set")
    role = hero["role"]
    lock = state["roleLock"].get(role)
    if lock and lock != team:
        raise BanpickError("INVALID_ACTION", "role locked by opponent")
    if hero_id in _all_banned_this_set(state):
        raise BanpickError("INVALID_ACTION", "already banned")

    state["bans"][team].append(hero_id)
    if role not in state["roleLock"]:
        state["roleLock"][role] = team
    state["pendingBan"][team] = None
    _log(state, f"{state['teamName'][team]} 밴 확정: {hero['name']}")

    total = len(state["bans"]["A"]) + len(state["bans"]["B"])
    if total >= 2:
        if state["mode"] == MODE["FULL"]:
            state["phase"] = "HERO_PICK"
            _reset_timer(state)
        else:
            # 밴만/맵+밴: 밴 종료 → 결과 대기
            state["awaitingResult"] = True
            state["timerRunning"] = False
    else:
        state["turn"] = _other(team)
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
            state["usedModesCycle"] = [] if len(cyc) >= 5 else list(cyc)
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
