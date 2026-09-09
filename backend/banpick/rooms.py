# 밴픽 실시간 대결 — 방 관리자 + WebSocket 엔드포인트.
# 서버 권위: 모든 액션을 여기서 검증·적용하고 전체 state를 브로드캐스트한다.
# 기존 분석기 API/DB와 완전 분리(격리). 방 상태는 메모리(dict)만 — scrim.db 미사용.
import asyncio
import random
import string
import time
import uuid

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from . import state as sm

router = APIRouter()

ROOM_TTL_SEC = 30 * 60      # 빈/유휴 방 타임아웃 30분
CODE_LEN = 6


def _gen_code():
    return "".join(random.choices(string.ascii_lowercase + string.digits, k=CODE_LEN))


class Room:
    def __init__(self, code, config):
        self.code = code
        self.state = sm.new_state(config)
        self.conns = {}          # role("A"/"B") -> WebSocket
        self.tokens = {}         # token -> role
        self.role_token = {}     # role -> token
        self.lock = asyncio.Lock()
        self.last_activity = time.time()
        self.timer_task = None

    def touch(self):
        self.last_activity = time.time()

    def issue_token(self, role):
        tok = uuid.uuid4().hex
        self.tokens[tok] = role
        self.role_token[role] = tok
        return tok

    async def broadcast(self, message):
        dead = []
        for role, ws in list(self.conns.items()):
            try:
                await ws.send_json(message)
            except Exception:
                dead.append(role)
        for role in dead:
            self.conns.pop(role, None)

    async def broadcast_state(self):
        # 블라인드 OFF(기본): 픽 페이즈에서도 전체 상태를 그대로 양쪽에 전송(상대 픽 실시간 공개).
        # 상대 픽 은닉이 필요하면 아래를 뷰어별 sm.redact_view(self.state, role) 전송으로 교체(함수 보존됨).
        await self.broadcast({"type": "state", "state": self.state})

    async def ensure_timer(self, manager):
        if self.timer_task is None or self.timer_task.done():
            self.timer_task = asyncio.create_task(self._timer_loop(manager))

    async def _timer_loop(self, manager):
        # 서버 권위 타이머: 초당 1 감소, 0 도달 시 overtime(자동처리 없음). 클라는 표시만.
        try:
            while True:
                await asyncio.sleep(1)
                if self.code not in manager.rooms:
                    return
                async with self.lock:
                    changed = sm.tick(self.state)
                if changed:
                    st = self.state
                    await self.broadcast({
                        "type": "timer",
                        "timer": st["timer"],
                        "timerRunning": st["timerRunning"],
                        "overtime": st["overtime"],
                    })
        except asyncio.CancelledError:
            return


class RoomManager:
    def __init__(self):
        self.rooms = {}          # code -> Room
        self.cleanup_task = None

    def start_cleanup(self):
        if self.cleanup_task is None or self.cleanup_task.done():
            self.cleanup_task = asyncio.create_task(self._cleanup_loop())

    async def _cleanup_loop(self):
        while True:
            await asyncio.sleep(60)
            now = time.time()
            for code, room in list(self.rooms.items()):
                # 연결이 하나도 없고 유휴시간이 TTL을 넘으면 소멸
                if not room.conns and (now - room.last_activity) > ROOM_TTL_SEC:
                    if room.timer_task:
                        room.timer_task.cancel()
                    self.rooms.pop(code, None)

    def create(self, config):
        for _ in range(10):
            code = _gen_code()
            if code not in self.rooms:
                room = Room(code, config)
                self.rooms[code] = room
                return room
        raise RuntimeError("code generation failed")

    def get(self, code):
        return self.rooms.get((code or "").strip().lower())


manager = RoomManager()


@router.websocket("/ws/banpick")
async def banpick_ws(websocket: WebSocket):
    await websocket.accept()
    manager.start_cleanup()
    room = None
    my_role = None

    async def send(msg):
        await websocket.send_json(msg)

    async def err(code, message=""):
        await send({"type": "error", "code": code, "message": message or code})

    try:
        while True:
            msg = await websocket.receive_json()
            mtype = msg.get("type")

            # ── 입장/생성/재접속 ──
            if mtype == "create_room":
                room = manager.create(msg.get("config") or {})
                my_role = "A"  # 방장 = A(HOST)
                room.conns["A"] = websocket
                token = room.issue_token("A")
                room.touch()
                await send({"type": "room_created", "code": room.code, "role": "A",
                            "token": token, "state": room.state})
                continue

            if mtype == "join_room":
                room = manager.get(msg.get("code"))
                if not room:
                    await err("ROOM_NOT_FOUND")
                    room = None
                    continue
                if "B" in room.conns:
                    await err("ROLE_TAKEN", "상대 자리(B)가 이미 찼습니다.")
                    room = None
                    continue
                my_role = "B"
                room.conns["B"] = websocket
                token = room.role_token.get("B") or room.issue_token("B")
                room.touch()
                await send({"type": "joined", "code": room.code, "role": "B", "token": token, "state": room.state})
                await room.broadcast({"type": "opponent_status", "connected": True})
                await room.broadcast_state()
                continue

            if mtype == "reconnect":
                room = manager.get(msg.get("code"))
                token = msg.get("token")
                if not room or token not in room.tokens:
                    await err("ROOM_NOT_FOUND", "방을 찾을 수 없거나 토큰이 유효하지 않습니다.")
                    room = None
                    continue
                my_role = room.tokens[token]
                room.conns[my_role] = websocket
                room.touch()
                await send({"type": "reconnected", "code": room.code, "role": my_role, "state": room.state})
                await room.broadcast({"type": "opponent_status", "connected": True})
                continue

            # 이후 액션은 방/역할이 있어야 함
            if room is None or my_role is None:
                await err("NO_ROOM", "먼저 방을 생성/입장하세요.")
                continue

            # ── 액션(서버 권위) — 방 락으로 직렬화(동시 입력 안전) ──
            async with room.lock:
                try:
                    if mtype == "ready":
                        sm.set_ready(room.state, my_role, msg.get("value", True))
                    elif mtype == "start":
                        sm.start(room.state)
                        await room.ensure_timer(manager)
                    elif mtype == "map_pick":
                        sm.apply_map_pick(room.state, my_role, msg.get("map_id"),
                                          msg.get("ban_order"), msg.get("side"))
                    elif mtype == "ban_order":
                        sm.apply_ban_order(room.state, my_role, msg.get("ban_order"))
                    elif mtype == "ban":
                        sm.apply_ban(room.state, my_role, msg.get("hero_id"))
                    elif mtype == "pick_toggle":
                        sm.apply_pick_toggle(room.state, my_role, msg.get("hero_id"))
                    elif mtype == "pick_lock":
                        sm.apply_pick_lock(room.state, my_role)
                    elif mtype == "set_result":
                        sm.apply_set_result(room.state, msg.get("result"),
                                            msg.get("scoreA"), msg.get("scoreB"))
                    else:
                        await err("UNKNOWN_TYPE", f"unknown message: {mtype}")
                        continue
                    room.touch()
                except sm.BanpickError as e:
                    await err(e.code, e.message)
                    continue
            # 성공 시 전체 상태 브로드캐스트
            await room.broadcast_state()

    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        if room is not None and my_role is not None:
            if room.conns.get(my_role) is websocket:
                room.conns.pop(my_role, None)
                room.touch()
                try:
                    await room.broadcast({"type": "opponent_status", "connected": False})
                except Exception:
                    pass
