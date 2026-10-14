// utils/analysisConstants.js — 분석 정의 상수의 단일 출처(프론트엔드).
//
// 백엔드 backend/analysis_constants.py 와 같은 값을 유지한다(자동 동기화 없음 — 한쪽을 바꾸면
// 다른 쪽도 함께 바꾼다). 프론트 전용 상수(백엔드에 없는 것)는 아래에 [프론트 전용]으로 표시.

// ── 한타 정의 ────────────────────────────────────────────────────────────────
// computeFights(utils/fightAnalysis.js ↔ services/fight_analysis.py): 첫 이벤트 후 초기 창, 킬마다 연장.
export const INITIAL_WINDOW = 20;
export const KILL_EXTENSION = 10;
// 이벤트 사이 간격이 이 값(초) 이하면 같은 한타(UltimateStats 한타 묶음 ↔ 백엔드 fight_metrics).
export const FIGHT_QUIET_GAP_SEC = 20;

// 응수/시퀀스 후속 인정 창(초) — 콤보 창(COMBO_WINDOW_SEC)과 값이 같아도 별개 상수(개별 조정 가능)
export const RESPONSE_WINDOW_SEC = 3;
// [프론트 전용] 콤보 판정 시간 창(초): 직전 우리 궁으로부터 이 간격 이내면 같은 콤보 체인
export const COMBO_WINDOW_SEC = 3;
// [프론트 전용] 교환 패턴·이니시 첫 궁 판정의 체인 창(초)
export const PATTERN_CHAIN_SEC = 3;
// [프론트 전용] 궁 사용 후 이 시간(초) 내의 결정타를 '궁극기로 만들어낸 결정타'로 간주 (힐러용)
export const ULT_KILL_WINDOW = 10;

// ── 최소 표본 ────────────────────────────────────────────────────────────────
// 화면마다 표본 단위가 달라 값을 통일하지 않는다(각 이름 유지).
// 백분위 풀 최소 표본 — 백엔드가 응답 meta로 내려주며, 아래는 meta 누락 시 폴백.
export const MIN_SAMPLE_FOR_PERCENTILE_FIGHTS = 20;
export const MIN_SAMPLE_FOR_PERCENTILE_ROUNDS = 10;
export const PERCENTILE_MIN_POOL = 8;
// 한타 스코프·응수/시퀀스 표 최소 표본 기본값(백엔드 DEFAULT_MIN_SAMPLE)
export const DEFAULT_MIN_SAMPLE = 5;
// [프론트 전용] 첫킬/첫데스: 참여 한타 수 기준. 이 값 미만은 흐림 + 랭킹 후순위.
export const MIN_FIGHTS = 30;
// [프론트 전용] 궁극기 영웅별 최소 사용 수
export const MIN_ULT_SAMPLE = 5;
// [프론트 전용] 맵 분석 Top 영웅(근사) 영웅별 최소 표본(한타)
export const TOP_HERO_MIN = 3;
// [프론트 전용] 진 한타 캐리 순위 최소 진 한타 수
export const MIN_LOST_FIGHTS = 10;

// ── 기간 ─────────────────────────────────────────────────────────────────────
// 기본 기간(일) — 백엔드 DEFAULT_PERIOD_DAYS. 기본 프리셋 '2w'.
export const DEFAULT_PERIOD_DAYS = 14;
// 기간 A 프리셋(일)
export const A_PRESET_DAYS = { '1w': 7, '2w': 14, '1m': 30 };
