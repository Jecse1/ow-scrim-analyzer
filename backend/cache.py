# -*- coding: utf-8 -*-
"""cache.py — 응답 레벨 메모리 캐시(리팩토링 2단계 분리). 본문 무변경(이동만).

main.py 에서 이동. main.py 는 하위호환을 위해 이 이름들을 re-export 한다.
_RESPONSE_CACHE 는 이 모듈에 단 하나만 정의(재대입 금지) — 모든 라우터/무효화가 동일 객체를 본다.
"""
import json
from fastapi import Response

# ─────────────────────────────────────────────────────────────────────────────
# 응답 레벨 메모리 캐시 — 무거운 조회 엔드포인트(full-events / fight-records /
# player-fight-stats)의 "최종 응답"을 통째로 저장. compute_fights 등 내부 로직은
# 무수정, 엔드포인트 바깥에서만 감싼다. DB 변경 API 성공 시 전체 무효화.
# 서버 재시작 후 첫 요청이 느린 것은 허용(스펙).
# ─────────────────────────────────────────────────────────────────────────────
_RESPONSE_CACHE: dict = {}  # key -> 직렬화된 JSON bytes


def _response_cache_get(key: str):
    """캐시 HIT면 재직렬화 없이 바로 보낼 수 있는 Response, MISS면 None."""
    body = _RESPONSE_CACHE.get(key)
    if body is None:
        return None
    return Response(content=body, media_type="application/json")


def _json_bytes(payload) -> bytes:
    """캐시·응답용 JSON 직렬화. 옵션은 FastAPI(Starlette) JSONResponse.render와 동일 — 응답 바이트 불변.
    순수 함수라 스레드풀에서 호출해도 된다(빌더와 함께 이벤트 루프 밖에서 실행)."""
    return json.dumps(
        payload, ensure_ascii=False, allow_nan=False, indent=None, separators=(",", ":")
    ).encode("utf-8")


def _response_cache_put(key: str, body: bytes) -> Response:
    """이미 직렬화된 bytes 를 캐시하고 그 bytes 로 응답을 만든다(이벤트 루프에서 호출)."""
    _RESPONSE_CACHE[key] = body
    return Response(content=body, media_type="application/json")


def _invalidate_response_cache():
    if _RESPONSE_CACHE:
        print(f"[CACHE] invalidate: {list(_RESPONSE_CACHE.keys())}")
    _RESPONSE_CACHE.clear()
