# -*- coding: utf-8 -*-
"""plans/cache.py — 드래프트 플랜 전용 응답 캐시.

스크림(cache.py의 _RESPONSE_CACHE)과 완전 독립: 플랜 쓰기는 이 캐시만 비우고,
스크림 쓰기는 이 캐시를 건드리지 않는다(요구: 플랜 캐시 독립).
현재는 GET /api/plans/boards 목록 응답만 캐시 대상.
"""
import json
from fastapi import Response

_PLANS_CACHE: dict = {}  # key -> 직렬화된 JSON bytes


def plans_cache_get(key: str):
    body = _PLANS_CACHE.get(key)
    if body is None:
        return None
    return Response(content=body, media_type="application/json")


def plans_cache_store(key: str, payload) -> Response:
    body = json.dumps(
        payload, ensure_ascii=False, allow_nan=False, indent=None, separators=(",", ":")
    ).encode("utf-8")
    _PLANS_CACHE[key] = body
    return Response(content=body, media_type="application/json")


def plans_cache_invalidate():
    if _PLANS_CACHE:
        print(f"[PLANS-CACHE] invalidate: {list(_PLANS_CACHE.keys())}")
    _PLANS_CACHE.clear()
