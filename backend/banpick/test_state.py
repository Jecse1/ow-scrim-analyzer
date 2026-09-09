# 상태 머신 동치성/정합 테스트 (원본 JS 규칙 재현). pytest 없이도 단독 실행 가능.
import random
from banpick import state as sm
from banpick.data import HERO_BY_ID, MAPS


def _heroes_by_role(role, exclude=()):
    return [h["id"] for h in HERO_BY_ID.values() if h["role"] == role and h["id"] not in exclude]


def _first_pickable_map(st):
    for m in MAPS:
        if sm._map_pickable(st, m["id"]):
            return m["id"]
    return None


def test_full_draft():
    rng = random.Random(42)
    st = sm.new_state({"mode": 3, "sets": 3, "teamNameA": "레드", "teamNameB": "블루"}, rng=rng)
    sm.set_ready(st, "A", True)
    sm.set_ready(st, "B", True)
    sm.start(st, rng=rng)
    assert st["started"] and st["phase"] == "MAP_PICK"
    picker = st["mapPicker"]
    other = "B" if picker == "A" else "A"

    # 턴 강제: 비-선택자가 맵 픽 시도 → 거부
    try:
        sm.apply_map_pick(st, other, _first_pickable_map(st), "PICKER")
        assert False, "should reject non-picker"
    except sm.BanpickError as e:
        assert e.code == "NOT_YOUR_TURN"

    map_id = _first_pickable_map(st)
    sm.apply_map_pick(st, picker, map_id, "PICKER")  # 선밴=선택자
    assert st["phase"] == "HERO_BAN" and st["turn"] == picker

    # 밴: 선밴 팀 탱커 밴 → roleLock, 턴 전환
    banner = st["turn"]
    tank = _heroes_by_role("Tank")[0]
    # 상대가 먼저 밴 시도 → 거부
    try:
        sm.apply_ban(st, ("B" if banner == "A" else "A"), tank)
        assert False
    except sm.BanpickError as e:
        assert e.code == "NOT_YOUR_TURN"
    sm.apply_ban(st, banner, tank)
    assert st["roleLock"]["Tank"] == banner and st["turn"] != banner
    # 상대는 같은 역할(탱커) 밴 불가 → 딜러 밴
    banner2 = st["turn"]
    dmg = _heroes_by_role("Damage")[0]
    sm.apply_ban(st, banner2, dmg)
    assert st["phase"] == "HERO_PICK"
    assert len(st["bans"]["A"]) + len(st["bans"]["B"]) == 2

    banned = set(st["bans"]["A"]) | set(st["bans"]["B"])
    # 픽: 두 팀 각자 5슬롯(1v1 동시). 역할 순서 [Tank,Damage,Damage,Support,Support]
    for team in ("A", "B"):
        used = set(banned)
        for role in sm.SLOT_ROLES:
            hid = next(h for h in _heroes_by_role(role, exclude=used))
            used.add(hid)
            sm.apply_pick_toggle(st, team, hid)
        assert all(v is not None for v in st["pickSlots"][team]), st["pickSlots"][team]
        sm.apply_pick_lock(st, team)
    assert st["pickLocked"] and st["awaitingResult"]

    # 세트 결과 → A 승. BO3라 1승은 시리즈 미종료 → 다음 세트 초기화(패자 B가 선택권)
    sm.apply_set_result(st, "A")
    assert len(st["completedSets"]) == 1
    assert st["completedSets"][0]["winner"] == "A"
    assert not st["seriesDone"]
    assert st["mapPicker"] == "B"  # 직전 패자가 다음 선택권
    assert map_id in st["usedMaps"]
    print("test_full_draft OK — bans:", st["completedSets"][0]["bans"],
          "picks sizes:", {k: len(v) for k, v in st["completedSets"][0]["picks"].items()})


def test_series_end():
    rng = random.Random(1)
    st = sm.new_state({"mode": 1, "sets": 3}, rng=rng)  # 밴만 모드(빠른 세트)
    sm.set_ready(st, "A", True); sm.set_ready(st, "B", True)
    sm.start(st, rng=rng)
    # 밴만: BAN_ORDER → HERO_BAN → 2밴 → awaitingResult
    def play_ban_set(winner):
        chooser = st["orderChooser"]
        sm.apply_ban_order(st, chooser, "PICKER")
        b1 = st["turn"]
        sm.apply_ban(st, b1, _heroes_by_role("Tank")[0])
        b2 = st["turn"]
        sm.apply_ban(st, b2, _heroes_by_role("Damage")[0])
        assert st["awaitingResult"]
        sm.apply_set_result(st, winner)
    play_ban_set("A")
    play_ban_set("A")
    assert st["seriesDone"] is True  # 2승(BO3) → 종료
    print("test_series_end OK — winsA reached targetWins")


def test_interleaved_picks():
    """④ 회귀: 양 팀 픽을 '번갈아(인터리브)' 입력해도 서버가 팀별 슬롯을 독립 유지하고,
    미러픽을 허용하며, 한 팀의 픽이 상대 슬롯/선택지를 제한하지 않는다.
    (기존 test_full_draft는 A 5픽 → B 5픽 '순차'만 검증해 이 결함을 놓쳤다.)"""
    rng = random.Random(7)
    st = sm.new_state({"mode": 3, "sets": 3}, rng=rng)
    sm.set_ready(st, "A", True)
    sm.set_ready(st, "B", True)
    sm.start(st, rng=rng)
    picker = st["mapPicker"]
    sm.apply_map_pick(st, picker, _first_pickable_map(st), "PICKER")
    b1 = st["turn"]
    sm.apply_ban(st, b1, _heroes_by_role("Tank")[0])
    b2 = st["turn"]
    sm.apply_ban(st, b2, _heroes_by_role("Damage")[0])
    assert st["phase"] == "HERO_PICK"

    banned = set(st["bans"]["A"]) | set(st["bans"]["B"])
    tanks = _heroes_by_role("Tank", exclude=banned)
    a_tank, b_tank = tanks[0], tanks[1]

    # pickSlots가 팀별 '진짜 독립' 객체인지 (JS→Python 포팅 aliasing 방지)
    assert st["pickSlots"]["A"] is not st["pickSlots"]["B"]

    # A가 탱커 픽 → B 슬롯은 그대로 비어 있어야 (누수 금지)
    sm.apply_pick_toggle(st, "A", a_tank)
    assert st["pickSlots"]["A"][0] == a_tank
    assert st["pickSlots"]["B"][0] is None, "A의 픽이 B 슬롯으로 새면 안 됨(#4)"

    # B가 '다른' 탱커 픽 가능 (A 픽이 B 선택지를 제한하지 않음)
    sm.apply_pick_toggle(st, "B", b_tank)
    assert st["pickSlots"]["B"][0] == b_tank
    assert st["pickSlots"]["A"][0] == a_tank  # A는 불변

    # 미러픽 허용: B가 A와 같은 탱커도 픽 가능
    sm.apply_pick_toggle(st, "B", b_tank)   # 해제
    assert st["pickSlots"]["B"][0] is None
    sm.apply_pick_toggle(st, "B", a_tank)   # 미러
    assert st["pickSlots"]["B"][0] == a_tank, "동시 픽이므로 미러픽은 허용이어야 함"
    assert st["pickSlots"]["A"][0] == a_tank

    # 되돌려 b_tank로 두고 나머지 슬롯을 인터리브로 채움
    sm.apply_pick_toggle(st, "B", a_tank)   # 해제
    sm.apply_pick_toggle(st, "B", b_tank)   # 다시 b_tank
    used = set(banned) | {a_tank, b_tank}
    for i in range(1, len(sm.SLOT_ROLES)):
        role = sm.SLOT_ROLES[i]
        ha = next(h for h in _heroes_by_role(role, exclude=used)); used.add(ha)
        hb = next(h for h in _heroes_by_role(role, exclude=used)); used.add(hb)
        sm.apply_pick_toggle(st, "A", ha)   # A 먼저
        sm.apply_pick_toggle(st, "B", hb)   # 그 다음 B — 번갈아
        assert st["pickSlots"]["A"][i] == ha
        assert st["pickSlots"]["B"][i] == hb

    assert all(st["pickSlots"]["A"]) and all(st["pickSlots"]["B"])
    sm.apply_pick_lock(st, "A")
    sm.apply_pick_lock(st, "B")
    assert st["pickLocked"] and st["awaitingResult"]
    print("test_interleaved_picks OK — 팀별 슬롯 독립 유지, 미러 허용, 상대 무제한")


def test_blind_pick_redaction():
    """redact_view 순수함수 검증. ⚠️ 현재 블라인드는 OFF(상대 픽 실시간 공개)라
    이 함수는 broadcast 경로에서 바이패스되어 있고, 향후 '블라인드 모드' 옵션용으로 보존한다.
    삭제하지 않고 함수 자체의 계약(은닉/공개/개수/자기슬롯 유지)만 계속 검증한다.
    라이브 전송이 '무가공(전체 공개)'인지는 test_broadcast_passthrough에서 확인.
    ③ redact_view: 픽 진행 중 상대 픽 은닉 / 한 팀만 락 시 여전히 은닉 /
    양 팀 락 후 전체 공개 / 픽 개수는 항상 공개 / 자기 슬롯은 항상 유지(재접속 복원 포함)."""
    rng = random.Random(11)
    st = sm.new_state({"mode": 3, "sets": 3}, rng=rng)
    sm.set_ready(st, "A", True)
    sm.set_ready(st, "B", True)
    sm.start(st, rng=rng)
    picker = st["mapPicker"]
    sm.apply_map_pick(st, picker, _first_pickable_map(st), "PICKER")
    b1 = st["turn"]
    sm.apply_ban(st, b1, _heroes_by_role("Tank")[0])
    b2 = st["turn"]
    sm.apply_ban(st, b2, _heroes_by_role("Damage")[0])
    assert st["phase"] == "HERO_PICK"

    banned = set(st["bans"]["A"]) | set(st["bans"]["B"])
    a_tank = next(h for h in _heroes_by_role("Tank", exclude=banned))
    sm.apply_pick_toggle(st, "A", a_tank)

    # B의 뷰: 상대(A) 픽은 숨기고 개수만 공개 / 자기(B) 슬롯은 그대로
    vb = sm.redact_view(st, "B")
    assert vb["pickSlots"]["A"] == [None] * 5, "픽 진행 중 상대(A) 슬롯은 은닉"
    assert vb["pickCount"]["A"] == 1, "픽 개수는 공개"
    assert vb["pickSlots"]["B"] == st["pickSlots"]["B"], "자기 슬롯은 유지(재접속 복원)"
    # A의 뷰: 자기 픽 보이고 B(아직 0개) 은닉
    va = sm.redact_view(st, "A")
    assert va["pickSlots"]["A"][0] == a_tank
    assert va["pickSlots"]["B"] == [None] * 5
    # 원본 state는 redact로 변형되지 않아야
    assert st["pickSlots"]["A"][0] == a_tank

    # 양 팀 5픽 채움
    used = set(banned) | {a_tank}
    for i in range(1, 5):
        h = next(x for x in _heroes_by_role(sm.SLOT_ROLES[i], exclude=used)); used.add(h)
        sm.apply_pick_toggle(st, "A", h)
    for i in range(0, 5):
        h = next(x for x in _heroes_by_role(sm.SLOT_ROLES[i], exclude=used)); used.add(h)
        sm.apply_pick_toggle(st, "B", h)

    sm.apply_pick_lock(st, "A")
    assert not st["pickLocked"], "한 팀만 락된 상태"
    assert sm.redact_view(st, "B")["pickSlots"]["A"] == [None] * 5, "한 팀만 락 시엔 아직 은닉"

    sm.apply_pick_lock(st, "B")
    assert st["pickLocked"], "양 팀 락"
    vb3 = sm.redact_view(st, "B")
    assert vb3["pickSlots"]["A"] == st["pickSlots"]["A"], "양 팀 락 후 전체 공개"
    assert all(vb3["pickSlots"]["A"]) and all(vb3["pickSlots"]["B"])
    print("test_blind_pick_redaction OK — 은닉/공개/개수/자기슬롯 유지")


def test_broadcast_passthrough():
    """라이브 전송 계약: 블라인드 OFF라 broadcast_state는 픽 페이즈에서도 전체 상태를
    '무가공'으로 양쪽에 전송한다(상대 픽 실시간 공개). redact_view는 호출되지 않는다."""
    import asyncio
    from banpick import rooms

    room = rooms.Room("test01", {"mode": 3, "sets": 3})
    st = room.state
    sm.set_ready(st, "A", True)
    sm.set_ready(st, "B", True)
    sm.start(st)
    picker = st["mapPicker"]
    sm.apply_map_pick(st, picker, _first_pickable_map(st), "PICKER")
    b1 = st["turn"]
    sm.apply_ban(st, b1, _heroes_by_role("Tank")[0])
    b2 = st["turn"]
    sm.apply_ban(st, b2, _heroes_by_role("Damage")[0])
    banned = set(st["bans"]["A"]) | set(st["bans"]["B"])
    a_tank = next(h for h in _heroes_by_role("Tank", exclude=banned))
    sm.apply_pick_toggle(st, "A", a_tank)

    captured = {}

    class FakeWS:
        def __init__(self, role):
            self.role = role

        async def send_json(self, msg):
            captured[self.role] = msg

    room.conns = {"A": FakeWS("A"), "B": FakeWS("B")}
    asyncio.run(room.broadcast_state())
    # B가 받은 상태에 A의 실제 픽이 그대로 보여야(무가공 = 실시간 공개)
    assert captured["B"]["state"]["pickSlots"]["A"][0] == a_tank, "블라인드 OFF: 상대 픽 실시간 공개여야"
    assert captured["A"]["state"]["pickSlots"]["A"][0] == a_tank
    print("test_broadcast_passthrough OK — 무가공 전송(상대 픽 실시간 공개)")


if __name__ == "__main__":
    test_full_draft()
    test_series_end()
    test_interleaved_picks()
    test_blind_pick_redaction()
    test_broadcast_passthrough()
    print("ALL PASS")
