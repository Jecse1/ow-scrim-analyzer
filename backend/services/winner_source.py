# -*- coding: utf-8 -*-
"""services/winner_source.py — 매치 승자 출처(winner_source) 파생. 순수 함수(I/O 없음).

"왜 그 승자인가"를 matches.winner_source 에 기록하기 위한 단일 규칙.
승패 계산(calculate_pure_stats) 결과를 바꾸지 않고, 최종 저장 상태(winner/override/source/score)만 보고 분류한다.

  'override' — winner_override(사후 수기 보정)가 있음
  'manual'   — 로그 없는 수기 매치(source='manual'), 사용자가 입력한 승자
  'draw'     — 로그 판정 무승부(winner='Draw')
  'score'    — 로그 판정, 스코어 차로 승자 결정
  'progress' — 로그 판정, 동점이지만 진행도 타이브레이크로 승자 결정
  None       — 승자 미정(빈 winner)
"""

WINNER_SOURCES = ("override", "manual", "draw", "score", "progress")


def _get(match, key):
    if isinstance(match, dict):
        return match.get(key)
    return getattr(match, key, None)


def derive_winner_source(match):
    """match: ORM Match 또는 meta.json 매치 dict."""
    if (_get(match, "winner_override") or "").strip():
        return "override"
    winner = (_get(match, "winner") or "").strip()
    if not winner:
        return None
    if (_get(match, "source") or "log") == "manual":
        return "manual"
    if winner == "Draw":
        return "draw"
    if (_get(match, "score_t1") or 0) != (_get(match, "score_t2") or 0):
        return "score"
    return "progress"
