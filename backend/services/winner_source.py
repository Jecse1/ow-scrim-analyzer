# -*- coding: utf-8 -*-
"""services/winner_source.py — 매치 승자 출처(winner_source) 파생. 순수 함수(I/O 없음).

"왜 그 승자인가"를 matches.winner_source 에 기록하기 위한 단일 규칙.
승패 계산(calculate_pure_stats) 결과를 바꾸지 않고, 최종 저장 상태(winner/override/source/score/winner_detail)만 보고 분류한다.

  'override'     — winner_override(사후 수기 보정)가 있음
  'draw'         — 실제 무승부: 혼합·화물에서 공격 라운드 3개 이상 + match_end 동점, 또는 수기 매치의 사용자 입력 무승부
  'undetermined' — 로그 판정 Draw 이지만 로그로 승자를 못 가림(밀기 0:0, 쟁탈·플래시포인트 동점,
                   혼합·화물 match_end 없음, 2라운드 진행도 동률)
  'manual'       — 로그 없는 수기 매치(source='manual'), 사용자가 입력한 승자
  'score'        — 로그 판정, 스코어 차로 승자 결정
  'progress'     — 로그 판정, 동점이지만 진행도 타이브레이크로 승자 결정
  None           — 승자 미정(빈 winner)

winner_detail(JSON) — 판정 경로와 근거. calculate_pure_stats 가 업로드·rebuild-db 때 채우고,
기동 백필은 무승부 행만 DB 근거(맵·round_start 수·match_end)로 채운다(진행도는 null).
  {"path": WINNER_PATHS 중 하나, "rounds": 공격 라운드 수, "match_end": {"present", "t1", "t2"},
   "prog_t1": [거점 인덱스, %] | null, "prog_t2": ... }
"""
import json

WINNER_SOURCES = ("override", "manual", "draw", "undetermined", "score", "progress")

# 판정 경로. draw_match_end_tie 만 실제 무승부, undetermined_* 는 로그로 못 가린 무승부.
WINNER_PATHS = (
    "score", "match_end_tiebreak", "progress",
    "draw_match_end_tie",
    "undetermined_push", "undetermined_no_match_end", "undetermined_progress_tie", "undetermined_score_tie",
)

HYBRID_ESCORT_MODES = {"혼합", "화물", "호위", "Hybrid", "Escort"}
PUSH_MODES = {"밀기", "Push"}


def classify_draw_path(mode, attack_rounds, has_match_end, me_t1=None, me_t2=None):
    """로그 판정이 Draw 인 매치의 경로. 입력 = 맵 모드·공격 라운드 수·match_end 유무·점수."""
    mode = (mode or "").strip()
    if mode in PUSH_MODES:
        return "undetermined_push"
    if mode in HYBRID_ESCORT_MODES:
        if (attack_rounds or 0) > 2:
            if has_match_end and me_t1 is not None and me_t1 == me_t2:
                return "draw_match_end_tie"
            return "undetermined_no_match_end"
        return "undetermined_progress_tie"
    return "undetermined_score_tie"


def _get(match, key):
    if isinstance(match, dict):
        return match.get(key)
    return getattr(match, key, None)


def load_winner_detail(match):
    """winner_detail(문자열 JSON 또는 dict) → dict | None."""
    d = _get(match, "winner_detail")
    if isinstance(d, str):
        try:
            d = json.loads(d)
        except ValueError:
            return None
    return d if isinstance(d, dict) else None


def derive_winner_source(match):
    """match: ORM Match 또는 meta.json 매치 dict."""
    if (_get(match, "winner_override") or "").strip():
        return "override"
    winner = (_get(match, "winner") or "").strip()
    if not winner:
        return None
    manual = (_get(match, "source") or "log") == "manual"
    if winner == "Draw":
        if manual:
            return "draw"          # 사용자가 입력한 무승부 = 실제 무승부
        detail = load_winner_detail(match) or {}
        return "draw" if detail.get("path") == "draw_match_end_tie" else "undetermined"
    if manual:
        return "manual"
    if (_get(match, "score_t1") or 0) != (_get(match, "score_t2") or 0):
        return "score"
    return "progress"
