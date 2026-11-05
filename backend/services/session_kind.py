# -*- coding: utf-8 -*-
"""services/session_kind.py — 세션 종류(sessions.kind) 정본.

NULL = 스크림(기존 세션 전부), 'tournament' = 대회 공식 경기(로그 없이 맵·맵 승패·출처 URL 만 — 수기 매치).
"""
KIND_TOURNAMENT = "tournament"
STORED_KINDS = (KIND_TOURNAMENT,)   # NULL 외에 DB 에 저장되는 값


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
