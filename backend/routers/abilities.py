# -*- coding: utf-8 -*-
"""routers/abilities.py — 스킬 사용(ability_1/2_used) 관련 엔드포인트.

POST /api/admin/backfill-abilities : 원문 → 스킬 데이터 백필을 백그라운드로 시작하고 바로 응답(멱등 — 처리한 매치는 건너뜀).
GET  /api/admin/backfill-abilities : 진행 상태(done/total, 저장 수, 매치당 쓰기 잠금, 소요).
GET  /api/abilities/options        : 선수 → 플레이한 영웅(사용 수·원문 시간) → 스킬1·2 이름. 응답 캐시(단일 비행·gzip·ETag)에 얹고
                                     키와 ETag 에 스킬 저장소 세대를 붙인다(백필은 응답 캐시를 무효화하지 않으므로).
GET  /api/abilities/scenes         : 필터 조회(100행 페이지). 저장하지 않고 ETag(응답 캐시 세대 + 스킬 저장소 세대)·304 만.
GET  /api/abilities/search         : 하이라이트 검색(선수 부분 일치·영웅·스킬명/별칭, 최신순 상한 300). ETag·304 같은 규칙.
진행 로그는 서버 로그 "[ABILITY] backfill n/N". 구현은 services/abilities.py · services/ability_query.py.
"""
from typing import Optional

from fastapi import APIRouter, HTTPException, Query, Request, Response
from fastapi.concurrency import run_in_threadpool

import cache
from cache import cached_json_response, _json_bytes
from config import BASE_TEAM
from db import ability_store
from services import ability_query as aq
from services.abilities import start_backfill, backfill_state

router = APIRouter()


@router.post("/api/admin/backfill-abilities")
async def backfill_abilities():
    return start_backfill(force=False)


@router.get("/api/admin/backfill-abilities")
async def backfill_abilities_status():
    return backfill_state()


def _ability_etag_extra() -> str:
    return f"-a{ability_store.GEN}"


@router.get("/api/abilities/options")
async def ability_options(request: Request, base_team: str = BASE_TEAM):
    extra = _ability_etag_extra()
    key = f"ability-options:{base_team}{extra}"
    # 같은 접두의 낡은 세대 키는 비운다(백필 중 세대가 자주 바뀌어도 쌓이지 않게)
    for k in [k for k in cache._RESPONSE_CACHE if k.startswith(f"ability-options:{base_team}-a") and k != key]:
        cache._RESPONSE_CACHE.pop(k, None)

    async def _compute() -> bytes:
        meta = await aq.load_meta(cache._GEN)
        return await run_in_threadpool(lambda: _json_bytes(aq.options(meta, base_team)))

    return await cached_json_response(request, key, _compute, etag_extra=extra)


async def _etag_response(request: Request, build) -> Response:
    """응답 저장 없이 ETag(응답 캐시 세대 + 스킬 저장소 세대)만 — 같으면 304, 아니면 계산."""
    gen, extra = cache._GEN, _ability_etag_extra()
    etag = cache._etag(gen, extra)
    headers = {"Cache-Control": "no-cache", "ETag": etag}
    inm = request.headers.get("if-none-match")
    if inm and etag in [t.strip() for t in inm.split(",")]:
        return Response(status_code=304, headers=headers)
    meta = await aq.load_meta(gen)
    body = await run_in_threadpool(lambda: _json_bytes(build(meta)))
    if cache._GEN != gen or _ability_etag_extra() != extra:   # 계산 중에 바뀌었으면 ETag 를 붙이지 않는다
        headers.pop("ETag")
    return Response(content=body, media_type="application/json", headers=headers)


@router.get("/api/abilities/scenes")
async def ability_scenes(request: Request,
                         player: Optional[str] = None, hero: Optional[str] = None,
                         slot: Optional[int] = Query(None, ge=1, le=2),
                         date_from: Optional[str] = None, date_to: Optional[str] = None,
                         opponent: Optional[str] = None, map: Optional[str] = None,
                         side: str = Query("all", pattern="^(all|us|them)$"),
                         group: bool = False, sort: str = Query("date_desc", pattern="^(date_desc|date_asc)$"),
                         page: int = Query(1, ge=1), base_team: str = BASE_TEAM):
    p = {"player": player, "hero": (aq.resolve_hero(hero) or hero) if hero else None, "slot": slot,
         "date_from": date_from, "date_to": date_to, "opponent": opponent, "map": map, "side": side,
         "group": group, "sort": sort, "page": page, "base_team": base_team}
    return await _etag_response(request, lambda meta: aq.scenes(meta, p))


@router.get("/api/abilities/search")
async def ability_search(request: Request, q: Optional[str] = None,
                         player: Optional[str] = None, hero: Optional[str] = None, skill: Optional[str] = None,
                         date_from: Optional[str] = None, date_to: Optional[str] = None, map: Optional[str] = None,
                         video_only: bool = False, limit: int = Query(aq.SEARCH_LIMIT, ge=1, le=aq.SEARCH_LIMIT)):
    if not (q or player or hero or skill):
        raise HTTPException(status_code=400, detail="q, player, hero, skill 중 하나는 필요합니다")
    p = {"q": q, "player": player, "hero": hero, "skill": skill, "date_from": date_from, "date_to": date_to,
         "map": map, "video_only": video_only, "limit": limit, "side": "all"}
    return await _etag_response(request, lambda meta: aq.search(meta, p))
