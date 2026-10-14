# -*- coding: utf-8 -*-
"""analysis_constants.py — 분석 정의 상수의 단일 출처(백엔드).

프론트엔드 frontend/src/utils/analysisConstants.js 와 같은 값을 유지한다(자동 동기화 없음 —
한쪽을 바꾸면 다른 쪽도 함께 바꾼다). 값을 바꾸면 분석 결과가 바뀌므로 골든 테스트 갱신이 필요하다.
config.py / services/summary.py 는 하위호환을 위해 이 이름들을 re-export 한다.
"""

# ── 한타 정의 ────────────────────────────────────────────────────────────────
# compute_fights(services/fight_analysis.py ↔ utils/fightAnalysis.js): 첫 이벤트 후 초기 창, 킬마다 연장.
INITIAL_WINDOW = 20
KILL_EXTENSION = 10
# build_fight_summaries(services/fight_metrics.py): 킬 사이 간격이 이 값(초) 이하면 같은 한타.
# 프론트 UltimateStats.jsx 의 한타 묶음도 같은 값을 쓴다.
FIGHT_QUIET_GAP_SEC = 20

# 첫 킬 후 이 시간(초) 내 반대편 킬 발생 = "트레이드됨"
TRADE_WINDOW_SEC = 5

# 응수/시퀀스 후속 인정 창(초) — 프론트 FightLabStats RESPONSE_WINDOW_SEC 와 같은 값
RESPONSE_WINDOW_SEC = 3

# ── 최소 표본 ────────────────────────────────────────────────────────────────
# 백분위 풀 포함 최소 표본(프론트 안내용 상수 — 응답 meta로 내려줌)
MIN_SAMPLE_FOR_PERCENTILE_FIGHTS = 20   # 한타 지표: 최소 20한타
MIN_SAMPLE_FOR_PERCENTILE_ROUNDS = 10   # 라운드 지표: 최소 10라운드
PERCENTILE_MIN_POOL = 8                 # 풀 최소 인원
# 집계 API 카운터/스코프 최소 표본 기본값(프론트 FightLab minSample 기본 5)
DEFAULT_MIN_SAMPLE = 5
DEFAULT_COUNTER_LIMIT = 10

# ── 기간 ─────────────────────────────────────────────────────────────────────
# 기본 기간(일) — 프론트 A_PRESET_DAYS['2w'] = 14, 기본 프리셋 '2w'
DEFAULT_PERIOD_DAYS = 14
