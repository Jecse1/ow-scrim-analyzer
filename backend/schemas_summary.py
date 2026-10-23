# -*- coding: utf-8 -*-
"""schemas_summary.py — /api/summary/* 응답 Pydantic 모델(봇·외부 조회 계약).

필드 의미·정의는 services/summary.py docstring(D1~D8)이 정본. 승률은 0~1 실수(표본 0이면 null)이고
분자·분모 필드를 항상 함께 둔다. 반올림하지 않는다. 기존 schemas.py(요청 모델)와 분리.
"""
from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field


class SummaryMeta(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    base_team: str
    from_: str = Field(alias="from", description="기간 시작(YYYY-MM-DD, 포함)")
    to: str = Field(description="기간 끝(YYYY-MM-DD, 포함)")
    generated_at: str = Field(description="생성 시각(Asia/Seoul, ISO 8601)")
    definitions_version: str
    population: str = Field(description="all_matches | fight_matches_plus_manual | log_fights")


class SummaryExcluded(BaseModel):
    """제외 수(상호 배타, 우선순위 no_fight_matches → null_result_matches)."""
    no_fight_matches: int
    null_result_matches: int
    manual_matches_in_first_fight: int


# ── maps ─────────────────────────────────────────────────────────────────────
class MapSummaryRow(BaseModel):
    map: str = Field(description="정본 ko 맵명. 합계 행은 '__total__'")
    map_type: Optional[str] = None
    matches: int = Field(description="맵 승률 분모 = wins + losses + draws")
    wins: int
    losses: int
    draws: int
    map_winrate: Optional[float] = None
    first_fights: int = Field(description="첫 한타 승률 분모(us/them 판정 가능)")
    first_fight_wins: int
    first_fight_winrate: Optional[float] = None
    first_fights_unknown: int
    fights: int = Field(description="한타 레코드 수(판정 불가 포함)")


class MapSummaryResponse(BaseModel):
    meta: SummaryMeta
    maps: List[MapSummaryRow]
    total: MapSummaryRow
    excluded: SummaryExcluded


# ── opponents ────────────────────────────────────────────────────────────────
class OpponentSummaryRow(BaseModel):
    opponent: str = Field(description="상대 팀명. 합계 행은 '__total__'")
    sessions: int
    matches: int
    wins: int
    losses: int
    draws: int
    map_winrate: Optional[float] = None
    first_fights: int
    first_fight_wins: int
    first_fight_winrate: Optional[float] = None
    first_fights_unknown: int


class OpponentSummaryResponse(BaseModel):
    meta: SummaryMeta
    opponents: List[OpponentSummaryRow]
    total: OpponentSummaryRow
    excluded: SummaryExcluded


# ── period ───────────────────────────────────────────────────────────────────
class SessionSummaryRow(BaseModel):
    session_id: str
    date: str
    scrim_name: str
    opponents: List[str]
    matches: int = Field(description="base_team 참가 매치 수(결과 없음 포함)")
    wins: int
    losses: int
    draws: int
    no_result: int
    undetermined: int = Field(0, description="draws 중 로그로 승자를 못 가린 매치(winner_source=undetermined) — 승률 정의는 무변경")
    maps: List[str]


class PeriodTotal(BaseModel):
    sessions: int
    matches: int
    wins: int
    losses: int
    draws: int
    no_result: int
    undetermined: int = Field(0, description="draws 중 로그로 승자를 못 가린 매치(winner_source=undetermined) — 승률 정의는 무변경")
    map_winrate: Optional[float] = None
    decided_matches: int = Field(description="map_winrate 분모 = wins + losses + draws")
    skipped_matches_without_base_team: int


class PeriodExcluded(BaseModel):
    sessions_without_base_team: int = Field(description="기간 내이지만 base_team 참가 매치가 0인 세션(행에서 제외)")


class PeriodSummaryResponse(BaseModel):
    meta: SummaryMeta
    sessions: List[SessionSummaryRow]
    total: PeriodTotal
    excluded: PeriodExcluded


# ── POST /api/sessions/{session_id}/complete ─────────────────────────────────
class CompletedSession(BaseModel):
    id: str
    date: str
    scrim_name: str
    opponents: List[str]
    matches: int = Field(description="BASE_TEAM 참가 매치 수(결과 없음 포함)")
    wins: int
    losses: int
    draws: int
    no_result: int
    undetermined: int = Field(0, description="draws 중 로그로 승자를 못 가린 매치(winner_source=undetermined) — 승률 정의는 무변경")
    maps: List[str]


class SessionCompleteResponse(BaseModel):
    status: str = Field(description="항상 'ok'")
    session: CompletedSession
    webhook: str = Field(description="'queued'(발송 작업 분리됨) | 'disabled'(DISCORD_WEBHOOK_URL 미설정)")


# ── ults ─────────────────────────────────────────────────────────────────────
class FirstUltStat(BaseModel):
    n: int = Field(description="승률 분모(판정 가능 한타)")
    wins: int
    winrate: Optional[float] = None
    fights: int = Field(description="판정 불가 포함 전체 한타 수")


class FirstUltSummary(BaseModel):
    us: FirstUltStat
    them: FirstUltStat
    none: FirstUltStat


class CounterRow(BaseModel):
    enemy_hero: str
    our_hero: str
    n: int
    wins: int
    winrate: Optional[float] = None
    avg_react_sec: float
    enemy_hero_n: int
    enemy_hero_wins: int
    enemy_hero_winrate: Optional[float] = None
    no_response_n: int
    no_response_wins: int
    no_response_winrate: Optional[float] = None


class UltParams(BaseModel):
    response_window: float
    min_sample: int
    limit: Optional[int] = None


class UltSummaryResponse(BaseModel):
    meta: SummaryMeta
    first_ult: FirstUltSummary
    counters: List[CounterRow]
    counters_total: int
    fights: int
    fights_known: int
    params: UltParams
