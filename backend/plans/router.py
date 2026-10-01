# -*- coding: utf-8 -*-
"""plans/router.py — 드래프트 플랜 REST 라우터(/api/plans/*).

APIRouter() 를 prefix 없이 만들고 데코레이터에 전체 경로 기재(기존 라우터 관례).
DB 접근은 routers/stats.py 관례(자체 _DB_AVAILABLE 가드 + AsyncSessionLocal),
로직은 plans/service.py, 캐시는 plans/cache.py(스크림과 독립).
main import 금지 — 필요한 것은 하위 모듈에서 직접 import.
"""
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

_DB_IMPORT_ERROR = None
try:
    from db.database import AsyncSessionLocal
    _DB_AVAILABLE = True
except Exception as _e:
    _DB_AVAILABLE = False
    _DB_IMPORT_ERROR = f"{type(_e).__name__}: {_e}"

from plans import service
from plans.cache import plans_cache_get, plans_cache_store, plans_cache_invalidate

router = APIRouter()

_BOARDS_CACHE_KEY = "plans:boards"


def _require_db():
    if not _DB_AVAILABLE:
        raise HTTPException(status_code=503, detail="Database not available")


def _map_error(e: "service.PlanError") -> HTTPException:
    status = 404 if e.code == "NOT_FOUND" else 422 if e.code == "INVALID" else 400
    return HTTPException(status_code=status, detail={"code": e.code, "message": e.message})


# ── 요청 바디 모델 ────────────────────────────────────────────────────────────
class BoardCreate(BaseModel):
    name: str


class BoardUpdate(BaseModel):
    name: Optional[str] = None
    sort_order: Optional[int] = None


class MapCreate(BaseModel):
    board_id: str
    map_id: str


class MapUpdate(BaseModel):
    board_id: Optional[str] = None
    sort_order: Optional[int] = None


# ── 보드 ──────────────────────────────────────────────────────────────────────
@router.get("/api/plans/boards")
async def get_boards():
    _require_db()
    cached = plans_cache_get(_BOARDS_CACHE_KEY)
    if cached is not None:
        return cached
    try:
        async with AsyncSessionLocal() as db:
            data = await service.list_boards(db)
        return plans_cache_store(_BOARDS_CACHE_KEY, data)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"DB error: {e}")


@router.post("/api/plans/boards")
async def post_board(body: BoardCreate):
    _require_db()
    try:
        async with AsyncSessionLocal() as db:
            out = await service.create_board(db, body.name)
        plans_cache_invalidate()
        return out
    except service.PlanError as e:
        raise _map_error(e)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"DB error: {e}")


@router.patch("/api/plans/boards/{board_id}")
async def patch_board(board_id: str, body: BoardUpdate):
    _require_db()
    try:
        async with AsyncSessionLocal() as db:
            out = await service.update_board(db, board_id, name=body.name, sort_order=body.sort_order)
        plans_cache_invalidate()
        return out
    except service.PlanError as e:
        raise _map_error(e)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"DB error: {e}")


@router.delete("/api/plans/boards/{board_id}")
async def delete_board(board_id: str):
    _require_db()
    try:
        async with AsyncSessionLocal() as db:
            await service.delete_board(db, board_id)
        plans_cache_invalidate()
        return {"ok": True}
    except service.PlanError as e:
        raise _map_error(e)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"DB error: {e}")


# ── 맵 카드 ───────────────────────────────────────────────────────────────────
@router.post("/api/plans/maps")
async def post_map(body: MapCreate):
    _require_db()
    try:
        async with AsyncSessionLocal() as db:
            out = await service.create_map(db, body.board_id, body.map_id)
        plans_cache_invalidate()
        return out
    except service.PlanError as e:
        raise _map_error(e)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"DB error: {e}")


@router.patch("/api/plans/maps/{map_id}")
async def patch_map(map_id: str, body: MapUpdate):
    _require_db()
    try:
        async with AsyncSessionLocal() as db:
            out = await service.update_map(db, map_id, board_id=body.board_id, sort_order=body.sort_order)
        plans_cache_invalidate()
        return out
    except service.PlanError as e:
        raise _map_error(e)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"DB error: {e}")


@router.delete("/api/plans/maps/{map_id}")
async def delete_map(map_id: str):
    _require_db()
    try:
        async with AsyncSessionLocal() as db:
            await service.delete_map(db, map_id)
        plans_cache_invalidate()
        return {"ok": True}
    except service.PlanError as e:
        raise _map_error(e)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"DB error: {e}")


@router.post("/api/plans/maps/{map_id}/duplicate")
async def duplicate_map(map_id: str):
    _require_db()
    try:
        async with AsyncSessionLocal() as db:
            out = await service.duplicate_map(db, map_id)
        plans_cache_invalidate()
        return out
    except service.PlanError as e:
        raise _map_error(e)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"DB error: {e}")


# ── 캔버스(전체 치환) ─────────────────────────────────────────────────────────
@router.get("/api/plans/maps/{map_id}/canvas")
async def get_canvas(map_id: str):
    _require_db()
    try:
        async with AsyncSessionLocal() as db:
            return await service.get_canvas(db, map_id)
    except service.PlanError as e:
        raise _map_error(e)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"DB error: {e}")


@router.put("/api/plans/maps/{map_id}/canvas")
async def put_canvas(map_id: str, request: Request):
    _require_db()
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=422, detail="invalid JSON body")
    # 바디는 캔버스 문서 자체({version,nodes,edges,groups}) 또는 {canvas:{...}} 허용.
    canvas = body.get("canvas") if isinstance(body, dict) and "canvas" in body else body
    try:
        async with AsyncSessionLocal() as db:
            out = await service.put_canvas(db, map_id, canvas)
        plans_cache_invalidate()  # node_count/목록 갱신
        return out
    except service.PlanError as e:
        raise _map_error(e)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"DB error: {e}")
