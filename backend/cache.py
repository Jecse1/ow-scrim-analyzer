# -*- coding: utf-8 -*-
"""cache.py — 응답 레벨 메모리 캐시 + 단일 비행 + 세대 번호 + 지연 선채우기.

_RESPONSE_CACHE 는 이 모듈에 단 하나만 정의(재대입 금지) — 모든 라우터/무효화가 동일 객체를 본다.
"""
import asyncio
import gzip
import json
import os
import time

from fastapi import Response
from fastapi.concurrency import run_in_threadpool

# ─────────────────────────────────────────────────────────────────────────────
# 응답 레벨 메모리 캐시 — 조회 엔드포인트(scrims / full-events / fight-records / player-fight-stats)의
# "최종 응답"을 JSON bytes 로 통째로 저장. compute_fights 등 내부 로직은 무수정, 엔드포인트 바깥에서만 감싼다.
# DB 변경 API 성공 시 전체 무효화(_invalidate_response_cache).
#
# 단일 비행: 같은 키의 동시 미스는 진행 중 계산 1개를 기다렸다 결과를 공유한다(cache_get_or_compute).
# 세대 번호: 무효화마다 +1. 계산 시작 때의 세대와 끝날 때의 세대가 다르면 그 결과는 저장하지 않는다
#   (그 계산을 기다리던 요청에는 돌려준다 — 무효화 전에 들어온 요청이라 이전 동작과 같다).
#   무효화는 진행 중 계산 목록도 비우므로, 무효화 뒤에 들어온 요청은 새 계산을 시작한다.
# 지연 선채우기: 무효화 뒤 WARM_DELAY_SEC 동안 추가 무효화가 없으면(연속 무효화 흡수) 등록된 키를
#   등록 순서대로 하나씩(동시 금지) 계산해 둔다. 기동 직후에도 1회. 무효화로 버려진 계산이 아직 돌고 있으면
#   그것이 끝난 뒤 시작한다(메모리 겹침 방지). 키별 완료는 "[CACHE] warm <key> <ms>" 로 남긴다.
# 압축 저장: 계산 끝에 JSON 을 한 번 gzip(GZipMiddleware 와 같은 레벨 6)해 그 바이트만 저장한다(상주 메모리 ~1/10).
#   gzip 을 받는 요청에는 Content-Encoding: gzip 으로 그대로 보낸다 — GZipMiddleware 는 content-encoding 이 이미
#   있으면 건드리지 않으므로 이중 압축이 없고, 요청마다 하던 압축(이벤트 루프에서 실행)도 없어진다.
#   gzip 을 받지 않는 요청에는 스레드풀에서 풀어 원래 바이트를 보낸다.
# ETag: W/"<기동 ID>-<세대>" — 같은 세대 안에서는 내용이 바뀌지 않으므로 세대가 곧 버전이다. 기동 ID 는 재시작 뒤
#   세대 번호가 다시 0 부터 시작해도 이전 프로세스의 ETag 와 겹치지 않게 한다. If-None-Match 가 맞으면 계산·전송 없이 304.
#   Cache-Control: no-cache — 브라우저는 저장하되 매번 재검증(프론트 무변경으로 새로고침이 304 가 된다).
# ─────────────────────────────────────────────────────────────────────────────
_RESPONSE_CACHE: dict = {}  # key -> gzip 압축된 JSON bytes(현재 세대의 결과만 들어 있다)
_BOOT_ID = f"{time.time_ns():x}"
_GZIP_LEVEL = 6

_GEN = 0                    # 무효화 세대
_INFLIGHT: dict = {}        # key -> asyncio.Task(bytes), 현재 세대에서 진행 중인 계산
_STALE: set = set()         # 무효화로 버려졌지만 아직 끝나지 않은 계산(선채우기가 끝나길 기다림)
_WARMERS: list = []         # [(key, async () -> bytes)] — 등록 순서 = 선채우기 순서
_WARM_TASK = None

WARM_ENABLED = os.getenv("CACHE_WARM", "1") != "0"           # 테스트는 0(backend/conftest.py)
WARM_DELAY_SEC = float(os.getenv("CACHE_WARM_DELAY_SEC", "5"))  # 마지막 무효화 후 대기(업로드 연속 무효화 흡수)


def _json_bytes(payload) -> bytes:
    """캐시·응답용 JSON 직렬화. 옵션은 FastAPI(Starlette) JSONResponse.render와 동일 — 응답 바이트 불변.
    순수 함수라 스레드풀에서 호출해도 된다(빌더와 함께 이벤트 루프 밖에서 실행)."""
    return json.dumps(
        payload, ensure_ascii=False, allow_nan=False, indent=None, separators=(",", ":")
    ).encode("utf-8")


def _json_bytes_list(items: list, encode_item) -> bytes:
    """리스트 응답을 원소별로 직렬화해 이어 붙인다 — _json_bytes(list) 와 바이트가 같다(구분자 ','·'[]').
    큰 목록(full-events 27MB)을 한 번의 json.dumps(C 호출 동안 GIL 을 놓지 않음)로 만들지 않아,
    스레드풀에서 돌 때 이벤트 루프가 원소 하나 직렬화 시간 이상 멈추지 않게 한다."""
    return b"[" + b",".join(_json_bytes(encode_item(x)) for x in items) + b"]"


def _etag(gen: int) -> str:
    return f'W/"{_BOOT_ID}-{gen}"'


def _accepts_gzip(request) -> bool:
    return "gzip" in (request.headers.get("accept-encoding") or "")  # GZipMiddleware 와 같은 판정


async def cache_get_or_compute(key: str, compute) -> tuple:
    """(gzip bytes, 그 결과의 세대). 히트면 저장된 bytes(DB·계산 0). 미스면 같은 키의 진행 중 계산을 기다리거나
    새로 시작한다. compute: 인자 없는 async 함수 → JSON bytes(압축 전). 예외는 기다리던 모든 호출자에게 전달된다."""
    gz = _RESPONSE_CACHE.get(key)
    if gz is not None:
        return gz, _GEN
    task = _INFLIGHT.get(key)
    if task is None:
        task = asyncio.ensure_future(_compute_and_store(key, compute, _GEN))
        _INFLIGHT[key] = task
    # shield: 기다리던 요청 하나가 취소돼도(클라이언트 이탈 등) 공유 계산은 계속된다
    return await asyncio.shield(task)


async def cached_json_response(request, key: str, compute) -> Response:
    """캐시 키의 응답. If-None-Match 가 현재 세대 ETag 와 같으면 304(계산 없음), 아니면 캐시(또는 단일 비행 계산)
    결과를 gzip 그대로/풀어서 보낸다. 무효화로 버려진(낡은 세대) 결과에는 ETag 를 붙이지 않는다."""
    headers = {"Vary": "Accept-Encoding", "Cache-Control": "no-cache"}
    etag = _etag(_GEN)
    inm = request.headers.get("if-none-match")
    if inm and etag in [t.strip() for t in inm.split(",")]:
        return Response(status_code=304, headers={**headers, "ETag": etag})
    gz, gen = await cache_get_or_compute(key, compute)
    if gen == _GEN:
        headers["ETag"] = _etag(gen)
    if _accepts_gzip(request):
        return Response(content=gz, media_type="application/json", headers={**headers, "Content-Encoding": "gzip"})
    return Response(content=await run_in_threadpool(gzip.decompress, gz), media_type="application/json", headers=headers)


async def cache_get_json_bytes(key: str, compute) -> bytes:
    """캐시 키의 압축 전 JSON bytes(서버 내부 사용 — summary 가 fight-records 본문을 읽을 때)."""
    gz, _ = await cache_get_or_compute(key, compute)
    return await run_in_threadpool(gzip.decompress, gz)


async def _compute_and_store(key: str, compute, gen: int) -> tuple:
    me = asyncio.current_task()
    try:
        body = await compute()
        # 압축은 1회, 스레드풀에서(zlib 는 압축 중 GIL 을 놓아 이벤트 루프를 막지 않는다). mtime=0 — 같은 본문이면 같은 바이트
        gz = await run_in_threadpool(gzip.compress, body, _GZIP_LEVEL, mtime=0)
        del body
        if gen == _GEN:
            _RESPONSE_CACHE[key] = gz
        else:
            print(f"[CACHE] discard {key} (gen {gen} -> {_GEN})", flush=True)
        return gz, gen
    finally:
        if _INFLIGHT.get(key) is me:
            del _INFLIGHT[key]
        _STALE.discard(me)


def register_warmer(key: str, compute) -> None:
    """선채우기 대상 등록(같은 키는 한 번만). 등록 순서대로 계산한다."""
    if all(k != key for k, _ in _WARMERS):
        _WARMERS.append((key, compute))


def schedule_warm(delay: float = None) -> None:
    """선채우기 예약(기존 예약은 취소). 실행 중인 이벤트 루프가 없거나 비활성이면 아무것도 하지 않는다."""
    global _WARM_TASK
    if not WARM_ENABLED or not _WARMERS:
        return
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return
    if _WARM_TASK is not None and not _WARM_TASK.done():
        _WARM_TASK.cancel()
    _WARM_TASK = loop.create_task(_warm(_GEN, WARM_DELAY_SEC if delay is None else delay))


def cancel_warm() -> None:
    if _WARM_TASK is not None and not _WARM_TASK.done():
        _WARM_TASK.cancel()


async def _warm(gen: int, delay: float) -> None:
    await asyncio.sleep(delay)
    if _STALE:  # 버려진 계산이 아직 메모리를 쥐고 있으면 끝나길 기다린다(결과는 쓰지 않음)
        await asyncio.wait(list(_STALE))
    for key, compute in list(_WARMERS):
        if gen != _GEN:
            return
        if key in _RESPONSE_CACHE:
            continue
        t = time.perf_counter()
        try:
            await cache_get_or_compute(key, compute)
        except asyncio.CancelledError:
            raise
        except Exception as e:
            print(f"[CACHE] warm {key} failed: {type(e).__name__}: {e}", flush=True)
            continue
        if gen == _GEN:
            print(f"[CACHE] warm {key} {(time.perf_counter() - t) * 1000:.0f}", flush=True)


def _invalidate_response_cache():
    global _GEN
    _GEN += 1
    if _RESPONSE_CACHE:
        print(f"[CACHE] invalidate: {list(_RESPONSE_CACHE.keys())}")
    _RESPONSE_CACHE.clear()
    _STALE.update(_INFLIGHT.values())
    _INFLIGHT.clear()
    schedule_warm()
