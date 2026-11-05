# -*- coding: utf-8 -*-
"""services/session_kind.py — 세션 종류(sessions.kind) 정본.

NULL = 스크림(기존 세션 전부), 'tournament' = 대회 공식 경기(로그 없이 맵·맵 승패·출처 URL 만 — 수기 매치).
조회 API 의 ?kind= 는 scrim(기본) | tournament | all. 기본이 스크림이라 대회 세션은 기존 집계·응답에 섞이지 않는다.
"""
from typing import Literal

KIND_SCRIM = "scrim"
KIND_TOURNAMENT = "tournament"
KIND_ALL = "all"
STORED_KINDS = (KIND_TOURNAMENT,)   # NULL 외에 DB 에 저장되는 값
QueryKind = Literal["scrim", "tournament", "all"]   # FastAPI Query 타입 — 그 외 값은 422


def kind_condition(kind_col, kind: str):
    """sessions.kind 컬럼 조건. all 이면 None(조건 없음)."""
    if kind == KIND_ALL:
        return None
    if kind == KIND_TOURNAMENT:
        return kind_col == KIND_TOURNAMENT
    return kind_col.is_(None)


def kind_cache_key(key: str, kind: str) -> str:
    """응답 캐시 키 — 스크림(기본)은 기존 키 그대로, 그 외만 접미사로 분리."""
    return key if kind == KIND_SCRIM else f"{key}:kind={kind}"


def check_stored_kind(value):
    """등록 입력 kind: 빈 값(또는 None) → None(스크림), 'tournament' 그대로, 그 외 ValueError → 422."""
    if value is None:
        return None
    s = value.strip()
    if not s:
        return None
    if s not in STORED_KINDS:
        raise ValueError("kind must be 'tournament'")
    return s
