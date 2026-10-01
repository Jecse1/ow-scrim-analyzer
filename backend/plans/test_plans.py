# -*- coding: utf-8 -*-
"""plans/test_plans.py — 드래프트 플랜 로직 테스트(인메모리 async SQLite).

banpick/test_state.py 관례: def test_*() + bare assert + __main__ 러너.
각 테스트는 StaticPool 인메모리 DB(엔진 1개=연결 1개 공유)에 테이블을 만들고
plans/service 함수를 호출한 뒤 engine.dispose() 로 정리한다(비dispose 시 aiosqlite
스레드가 남아 프로세스가 종료되지 않음). backend/ 에서 실행.
"""
import asyncio

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from db.database import Base
import db.models  # noqa: F401 — PlanBoard/PlanMap 를 Base 에 등록
from db.models import PlanMap
from plans import service as svc


async def _with_db(body):
    """인메모리 DB 를 만들고 body(S) 를 실행 후 반드시 dispose."""
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        S = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
        await body(S)
    finally:
        await engine.dispose()


def run(body):
    asyncio.run(_with_db(body))


# ── 보드 CRUD ─────────────────────────────────────────────────────────────────
async def _board_crud(S):
    async with S() as db:
        b = await svc.create_board(db, "맵 분류 1")
    assert b["name"] == "맵 분류 1" and b["sort_order"] == 1 and b["maps"] == []
    async with S() as db:
        boards = await svc.list_boards(db)
    assert len(boards) == 1 and boards[0]["id"] == b["id"]
    async with S() as db:
        b2 = await svc.update_board(db, b["id"], name="이름변경")
    assert b2["name"] == "이름변경"
    async with S() as db:
        await svc.delete_board(db, b["id"])
        boards = await svc.list_boards(db)
    assert boards == []
    async with S() as db:
        try:
            await svc.create_board(db, "   ")
            assert False, "empty name should raise"
        except svc.PlanError as e:
            assert e.code == "INVALID"


def test_board_crud():
    run(_board_crud)
    print("test_board_crud OK — 생성/목록/수정/삭제/빈이름거부")


# ── 보드 순서 ─────────────────────────────────────────────────────────────────
async def _board_order(S):
    ids = []
    async with S() as db:
        for n in ("A", "B", "C"):
            ids.append((await svc.create_board(db, n))["id"])
    async with S() as db:
        boards = await svc.list_boards(db)
    assert [b["sort_order"] for b in boards] == [1, 2, 3]
    async with S() as db:
        await svc.update_board(db, ids[0], sort_order=10)
        boards = await svc.list_boards(db)
    assert [b["name"] for b in boards] == ["B", "C", "A"]


def test_board_order():
    run(_board_order)
    print("test_board_order OK — sort_order 부여/재정렬")


# ── 맵 생성 + 캔버스 저장/로드 + version ──────────────────────────────────────
async def _map_canvas(S):
    async with S() as db:
        b = await svc.create_board(db, "보드")
        m = await svc.create_map(db, b["id"], "busan")
    assert m["map_id"] == "busan" and m["node_count"] == 0 and m["sort_order"] == 1
    async with S() as db:
        cv = await svc.get_canvas(db, m["id"])
    assert cv["canvas"]["version"] == 1 and cv["canvas"]["nodes"] == []
    async with S() as db:
        out = await svc.put_canvas(db, m["id"], {"nodes": [{"id": "n1"}, {"id": "n2"}], "edges": [], "groups": []})
    assert out["version"] == 1 and out["node_count"] == 2
    async with S() as db:
        cv = await svc.get_canvas(db, m["id"])
        boards = await svc.list_boards(db)
    assert cv["canvas"]["version"] == 1 and len(cv["canvas"]["nodes"]) == 2
    assert boards[0]["maps"][0]["node_count"] == 2


def test_map_canvas():
    run(_map_canvas)
    print("test_map_canvas OK — 맵 생성·캔버스 PUT/GET·node_count·version=1")


# ── 맵 보드 이동 + 순서 ───────────────────────────────────────────────────────
async def _map_move(S):
    async with S() as db:
        b1 = await svc.create_board(db, "B1")
        b2 = await svc.create_board(db, "B2")
        m = await svc.create_map(db, b1["id"], "nepal")
    async with S() as db:
        moved = await svc.update_map(db, m["id"], board_id=b2["id"])
    assert moved["board_id"] == b2["id"] and moved["sort_order"] == 1, moved
    async with S() as db:
        boards = {bd["id"]: bd for bd in await svc.list_boards(db)}
    assert len(boards[b1["id"]]["maps"]) == 0 and len(boards[b2["id"]]["maps"]) == 1


def test_map_move():
    run(_map_move)
    print("test_map_move OK — 맵 다른 보드로 이동(순서 말미)")


# ── 맵 복제(캔버스 포함) ──────────────────────────────────────────────────────
async def _map_duplicate(S):
    async with S() as db:
        b = await svc.create_board(db, "보드")
        m = await svc.create_map(db, b["id"], "samoa")
        await svc.put_canvas(db, m["id"], {"nodes": [{"id": "x"}], "edges": [], "groups": []})
    async with S() as db:
        dup = await svc.duplicate_map(db, m["id"])
    assert dup["id"] != m["id"] and dup["map_id"] == "samoa"
    assert dup["node_count"] == 1 and dup["sort_order"] == 2
    async with S() as db:
        boards = await svc.list_boards(db)
    assert len(boards[0]["maps"]) == 2


def test_map_duplicate():
    run(_map_duplicate)
    print("test_map_duplicate OK — 캔버스 복사·순서 말미")


# ── 보드 삭제 cascade ─────────────────────────────────────────────────────────
async def _delete_cascade(S):
    async with S() as db:
        b = await svc.create_board(db, "보드")
        await svc.create_map(db, b["id"], "nepal")
        await svc.create_map(db, b["id"], "busan")
    async with S() as db:
        cnt = (await db.execute(select(func.count()).select_from(PlanMap))).scalar()
    assert cnt == 2
    async with S() as db:
        await svc.delete_board(db, b["id"])
    async with S() as db:
        cnt = (await db.execute(select(func.count()).select_from(PlanMap))).scalar()
    assert cnt == 0, f"cascade 실패: plan_maps {cnt} rows 잔존"


def test_delete_cascade():
    run(_delete_cascade)
    print("test_delete_cascade OK — 보드 삭제 시 plan_maps 함께 삭제")


# ── NOT_FOUND 경로 ────────────────────────────────────────────────────────────
async def _errors(S):
    async with S() as db:
        async def expect_nf(coro):
            try:
                await coro
                assert False, "should raise NOT_FOUND"
            except svc.PlanError as e:
                assert e.code == "NOT_FOUND"
        await expect_nf(svc.get_canvas(db, "nope"))
        await expect_nf(svc.update_map(db, "nope", sort_order=1))
        await expect_nf(svc.delete_map(db, "nope"))
        await expect_nf(svc.duplicate_map(db, "nope"))
        await expect_nf(svc.create_map(db, "nope_board", "busan"))


def test_errors():
    run(_errors)
    print("test_errors OK — 없는 id NOT_FOUND")


if __name__ == "__main__":
    test_board_crud()
    test_board_order()
    test_map_canvas()
    test_map_move()
    test_map_duplicate()
    test_delete_cascade()
    test_errors()
    print("ALL PASS")
