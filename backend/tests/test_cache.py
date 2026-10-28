# -*- coding: utf-8 -*-
"""cache.py 응답 캐시: 단일 비행 · 세대 번호(무효화 중 계산 폐기) · 지연 선채우기 · /api/scrims 히트 시 DB 왕복 0회.

선채우기는 backend/conftest.py 에서 끄고(CACHE_WARM=0), 여기서만 monkeypatch 로 켜고 대상(_WARMERS)을 가짜로 바꾼다.
"""
import asyncio

import pytest

import cache


@pytest.fixture(autouse=True)
def _clean_cache(monkeypatch):
    cache._RESPONSE_CACHE.clear()
    cache._INFLIGHT.clear()
    cache._STALE.clear()
    monkeypatch.setattr(cache, "_WARMERS", [])
    monkeypatch.setattr(cache, "_WARM_TASK", None)
    yield
    cache.cancel_warm()
    cache._RESPONSE_CACHE.clear()
    cache._INFLIGHT.clear()
    cache._STALE.clear()


def _counting(calls, body=b"[]", gate=None):
    async def compute():
        calls.append(1)
        if gate is not None:
            await gate.wait()
        else:
            await asyncio.sleep(0.01)
        return body
    return compute


async def test_concurrent_requests_share_one_computation():
    calls = []
    gate = asyncio.Event()
    a = asyncio.ensure_future(cache.cache_get_or_compute("k", _counting(calls, b"A", gate)))
    b = asyncio.ensure_future(cache.cache_get_or_compute("k", _counting(calls, b"B", gate)))
    await asyncio.sleep(0)
    gate.set()
    assert await a == b"A" and await b == b"A"
    assert len(calls) == 1
    assert cache._RESPONSE_CACHE["k"] == b"A" and "k" not in cache._INFLIGHT
    assert await cache.cache_get_or_compute("k", _counting(calls)) == b"A"  # 이후는 히트
    assert len(calls) == 1


async def test_cancelled_waiter_does_not_cancel_shared_computation():
    calls = []
    gate = asyncio.Event()
    a = asyncio.ensure_future(cache.cache_get_or_compute("k", _counting(calls, b"A", gate)))
    b = asyncio.ensure_future(cache.cache_get_or_compute("k", _counting(calls, b"B", gate)))
    await asyncio.sleep(0)
    a.cancel()  # 요청 하나가 끊겨도
    gate.set()
    assert await b == b"A"  # 공유 계산은 끝까지 돌아 저장된다
    assert cache._RESPONSE_CACHE["k"] == b"A" and len(calls) == 1


async def test_invalidation_during_compute_discards_result():
    calls = []
    gate = asyncio.Event()
    old = asyncio.ensure_future(cache.cache_get_or_compute("k", _counting(calls, b"OLD", gate)))
    await asyncio.sleep(0)
    cache._invalidate_response_cache()          # 계산 도중 DB 변경
    new = asyncio.ensure_future(cache.cache_get_or_compute("k", _counting(calls, b"NEW", gate)))
    for _ in range(3):                           # 바깥 코루틴 → 안쪽 계산 태스크가 시작될 때까지 양보
        await asyncio.sleep(0)
    assert len(calls) == 2                       # 무효화 뒤 요청은 진행 중(낡은) 계산을 공유하지 않는다
    gate.set()
    assert await old == b"OLD"                   # 무효화 전 요청에는 그 결과를 돌려주되
    assert await new == b"NEW"
    assert cache._RESPONSE_CACHE["k"] == b"NEW"  # 낡은 결과는 저장되지 않는다
    assert not cache._STALE


async def test_error_reaches_all_waiters_and_is_not_cached():
    async def boom():
        await asyncio.sleep(0.01)
        raise RuntimeError("db down")
    a = asyncio.ensure_future(cache.cache_get_or_compute("k", boom))
    b = asyncio.ensure_future(cache.cache_get_or_compute("k", boom))
    for t in (a, b):
        with pytest.raises(RuntimeError):
            await t
    assert "k" not in cache._RESPONSE_CACHE and "k" not in cache._INFLIGHT


async def test_consecutive_invalidations_warm_once_in_order(monkeypatch, capsys):
    monkeypatch.setattr(cache, "WARM_ENABLED", True)
    monkeypatch.setattr(cache, "WARM_DELAY_SEC", 0.05)
    order = []

    def warmer(key):
        async def compute():
            order.append(key)
            await asyncio.sleep(0.01)
            return key.encode()
        return compute

    for key in ("scrims", "full-events", "fight-records:X", "player-fight-stats:X"):
        cache.register_warmer(key, warmer(key))
    cache.register_warmer("scrims", warmer("dup"))  # 같은 키 재등록은 무시

    for _ in range(3):                            # 업로드처럼 연속 무효화
        cache._invalidate_response_cache()
        await asyncio.sleep(0.01)
    await asyncio.sleep(0.4)
    assert order == ["scrims", "full-events", "fight-records:X", "player-fight-stats:X"]  # 1회, 순서대로
    assert set(cache._RESPONSE_CACHE) == set(order)
    out = capsys.readouterr().out
    for key in order:
        assert f"[CACHE] warm {key} " in out


async def test_invalidation_during_warm_discards_and_rewarms(monkeypatch):
    monkeypatch.setattr(cache, "WARM_ENABLED", True)
    monkeypatch.setattr(cache, "WARM_DELAY_SEC", 0.02)
    gate = asyncio.Event()
    calls = []

    async def slow():
        calls.append(cache._GEN)
        if len(calls) == 1:
            await gate.wait()                     # 첫 선채우기는 무효화가 올 때까지 붙잡아 둔다
        return b"gen%d" % calls[-1]

    cache.register_warmer("k", slow)
    cache._invalidate_response_cache()
    await asyncio.sleep(0.05)                     # 선채우기 1차 시작(계산 중)
    assert len(calls) == 1
    cache._invalidate_response_cache()            # 선채우기 도중 무효화
    gate.set()
    await asyncio.sleep(0.15)
    assert len(calls) == 2                        # 버려진 계산이 끝난 뒤 새 세대로 1회 더
    assert cache._RESPONSE_CACHE["k"] == b"gen%d" % cache._GEN


def test_scrims_cache_hit_has_zero_db_round_trips():
    from fastapi.testclient import TestClient
    from sqlalchemy import event
    from db.database import engine
    import main

    executed, checkouts = [], []

    def on_exec(*_a, **_k):
        executed.append(1)

    def on_checkout(*_a, **_k):
        checkouts.append(1)

    event.listen(engine.sync_engine, "before_cursor_execute", on_exec)
    event.listen(engine.sync_engine.pool, "checkout", on_checkout)
    try:
        with TestClient(main.app) as c:
            cache._invalidate_response_cache()
            executed.clear(); checkouts.clear()
            first = c.get("/api/scrims")
            assert first.status_code == 200 and executed and checkouts   # 미스: DB 조회
            executed.clear(); checkouts.clear()
            second = c.get("/api/scrims")
            assert second.status_code == 200
            assert executed == [] and checkouts == []                      # 히트: 커넥션도 안 잡는다
            assert second.content == first.content
    finally:
        event.remove(engine.sync_engine, "before_cursor_execute", on_exec)
        event.remove(engine.sync_engine.pool, "checkout", on_checkout)
