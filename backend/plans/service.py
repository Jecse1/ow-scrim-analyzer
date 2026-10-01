# -*- coding: utf-8 -*-
"""plans/service.py — 드래프트 플랜 비즈니스 로직(순수 async, FastAPI 비의존).

router.py 가 AsyncSessionLocal() 세션을 만들어 이 함수들을 호출하고, 테스트는
자체 인메모리 세션으로 직접 호출한다(banpick/state.py 의 로직-분리 패턴을 DB 버전으로).
도메인 오류는 PlanError(code) 로 올리고 router 가 HTTP 로 매핑한다.
"""
import json
import uuid

from sqlalchemy import select, func
from sqlalchemy.orm import selectinload

from db.models import PlanBoard, PlanMap

CANVAS_VERSION = 1
# 신규 맵 캔버스 기본 문서(version:1, 빈 노드/엣지/그룹).
DEFAULT_CANVAS = {"version": CANVAS_VERSION, "nodes": [], "edges": [], "groups": []}


class PlanError(Exception):
    def __init__(self, code: str, message: str = ""):
        super().__init__(message or code)
        self.code = code
        self.message = message or code


def _new_id() -> str:
    return uuid.uuid4().hex


def _iso(dt):
    return dt.isoformat() if dt is not None else None


def _parse_canvas(canvas_json):
    if not canvas_json:
        return dict(DEFAULT_CANVAS)
    try:
        doc = json.loads(canvas_json)
    except (ValueError, TypeError):
        return dict(DEFAULT_CANVAS)
    if not isinstance(doc, dict):
        return dict(DEFAULT_CANVAS)
    return doc


def _node_count(canvas_json) -> int:
    doc = _parse_canvas(canvas_json)
    nodes = doc.get("nodes")
    return len(nodes) if isinstance(nodes, list) else 0


def _map_dict(m: PlanMap) -> dict:
    return {
        "id": m.id,
        "board_id": m.board_id,
        "map_id": m.map_id,
        "sort_order": m.sort_order,
        "node_count": _node_count(m.canvas_json),
        "updated_at": _iso(m.updated_at),
    }


def _board_dict(b: PlanBoard, with_maps: bool = True) -> dict:
    d = {
        "id": b.id,
        "name": b.name,
        "sort_order": b.sort_order,
        "created_at": _iso(b.created_at),
        "updated_at": _iso(b.updated_at),
    }
    if with_maps:
        d["maps"] = [_map_dict(m) for m in sorted(b.maps, key=lambda x: (x.sort_order, x.id))]
    return d


# commit 후 재직렬화용 전체 재로딩. server_default/onupdate 컬럼은 flush 시 expire 되는데,
# async 세션에서 expire 속성에 접근하면 동기 지연로드(MissingGreenlet)가 난다. populate_existing
# 으로 한 번의 awaited SELECT 에서 모든 컬럼(+maps)을 다시 채운 뒤 동기 직렬화한다.
async def _load_board(db, board_id: str) -> PlanBoard:
    res = await db.execute(
        select(PlanBoard).where(PlanBoard.id == board_id)
        .options(selectinload(PlanBoard.maps)).execution_options(populate_existing=True)
    )
    return res.scalars().first()


async def _load_map(db, map_id: str) -> PlanMap:
    res = await db.execute(
        select(PlanMap).where(PlanMap.id == map_id).execution_options(populate_existing=True)
    )
    return res.scalars().first()


# ── 보드 ──────────────────────────────────────────────────────────────────────
async def list_boards(db) -> list:
    result = await db.execute(
        select(PlanBoard).options(selectinload(PlanBoard.maps)).order_by(PlanBoard.sort_order, PlanBoard.id)
    )
    return [_board_dict(b) for b in result.scalars().all()]


async def _get_board(db, board_id: str) -> PlanBoard:
    b = await db.get(PlanBoard, board_id, options=[selectinload(PlanBoard.maps)])
    if b is None:
        raise PlanError("NOT_FOUND", f"board {board_id} not found")
    return b


async def create_board(db, name: str) -> dict:
    if not isinstance(name, str) or not name.strip():
        raise PlanError("INVALID", "name required")
    max_order = (await db.execute(select(func.max(PlanBoard.sort_order)))).scalar()
    b = PlanBoard(id=_new_id(), name=name.strip()[:200], sort_order=(max_order or 0) + 1)
    db.add(b)
    await db.commit()
    return _board_dict(await _load_board(db, b.id))


async def update_board(db, board_id: str, name=None, sort_order=None) -> dict:
    b = await _get_board(db, board_id)
    if name is not None:
        if not isinstance(name, str) or not name.strip():
            raise PlanError("INVALID", "name must be non-empty")
        b.name = name.strip()[:200]
    if sort_order is not None:
        if not isinstance(sort_order, int):
            raise PlanError("INVALID", "sort_order must be int")
        b.sort_order = sort_order
    await db.commit()
    return _board_dict(await _load_board(db, b.id))


async def delete_board(db, board_id: str) -> None:
    b = await _get_board(db, board_id)
    await db.delete(b)  # relationship cascade(all, delete-orphan) → plan_maps 함께 삭제
    await db.commit()


# ── 맵 카드 ───────────────────────────────────────────────────────────────────
async def _get_map(db, map_id: str) -> PlanMap:
    m = await db.get(PlanMap, map_id)
    if m is None:
        raise PlanError("NOT_FOUND", f"map {map_id} not found")
    return m


async def _max_map_order(db, board_id: str):
    return (await db.execute(
        select(func.max(PlanMap.sort_order)).where(PlanMap.board_id == board_id)
    )).scalar()


async def create_map(db, board_id: str, map_id: str) -> dict:
    if not isinstance(map_id, str) or not map_id.strip():
        raise PlanError("INVALID", "map_id required")
    await _get_board(db, board_id)  # 보드 존재 확인(NOT_FOUND)
    max_order = await _max_map_order(db, board_id)
    m = PlanMap(
        id=_new_id(), board_id=board_id, map_id=map_id.strip(),
        sort_order=(max_order or 0) + 1,
        canvas_json=json.dumps(DEFAULT_CANVAS, ensure_ascii=False),
    )
    db.add(m)
    await db.commit()
    return _map_dict(await _load_map(db, m.id))


async def update_map(db, map_id: str, board_id=None, sort_order=None) -> dict:
    m = await _get_map(db, map_id)
    if board_id is not None and board_id != m.board_id:
        await _get_board(db, board_id)  # 이동 대상 보드 확인
        # 재배정 전에 대상 보드의 max 를 구한다(autoflush 로 이 맵이 대상 보드에 포함돼
        # 카운트가 부풀려지는 것을 방지 — 이 시점 m.board_id 는 아직 기존 보드).
        new_order = None
        if sort_order is None:
            new_order = (await _max_map_order(db, board_id) or 0) + 1
        m.board_id = board_id
        if new_order is not None:
            m.sort_order = new_order
    if sort_order is not None:
        if not isinstance(sort_order, int):
            raise PlanError("INVALID", "sort_order must be int")
        m.sort_order = sort_order
    await db.commit()
    return _map_dict(await _load_map(db, m.id))


async def delete_map(db, map_id: str) -> None:
    m = await _get_map(db, map_id)
    await db.delete(m)
    await db.commit()


async def duplicate_map(db, map_id: str) -> dict:
    src = await _get_map(db, map_id)
    dup = PlanMap(
        id=_new_id(), board_id=src.board_id, map_id=src.map_id,
        sort_order=(await _max_map_order(db, src.board_id) or 0) + 1,
        canvas_json=src.canvas_json,
    )
    db.add(dup)
    await db.commit()
    return _map_dict(await _load_map(db, dup.id))


# ── 캔버스 ────────────────────────────────────────────────────────────────────
async def get_canvas(db, map_id: str) -> dict:
    m = await _get_map(db, map_id)
    doc = _parse_canvas(m.canvas_json)
    doc.setdefault("version", CANVAS_VERSION)
    return {"map_id": m.map_id, "board_id": m.board_id, "canvas": doc, "updated_at": _iso(m.updated_at)}


async def put_canvas(db, map_id: str, canvas) -> dict:
    m = await _get_map(db, map_id)
    if not isinstance(canvas, dict):
        raise PlanError("INVALID", "canvas must be an object")
    canvas = dict(canvas)
    canvas["version"] = CANVAS_VERSION  # 버전 필드 강제(1)
    m.canvas_json = json.dumps(canvas, ensure_ascii=False)
    await db.commit()
    m = await _load_map(db, m.id)
    return {"updated_at": _iso(m.updated_at), "version": CANVAS_VERSION, "node_count": _node_count(m.canvas_json)}
