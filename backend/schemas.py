# -*- coding: utf-8 -*-
"""schemas.py — 요청 Pydantic 모델(리팩토링 2단계 분리). 본문 무변경(이동만).

main.py 에서 이동. main.py 는 하위호환을 위해 이 모듈의 이름을 re-export 한다.
"""
from pydantic import BaseModel, Field
from typing import List, Any, Optional


class PauseInput(BaseModel):
    start: str
    end: str

class MatchSegment(BaseModel):
    map_name: str
    team1Name: str = Field(default="1팀")
    team2Name: str = Field(default="2팀")
    start_time: str = Field(alias="start_time")
    end_time: str = Field(alias="end_time")
    result: str
    video_url: str = Field(default="", alias="videoUrl")
    has_pause: bool = Field(default=False, alias="hasPause")
    pauses: List[PauseInput] = []
    # 밀기맵 수기 승패 보정(팀명, team1Name/team2Name 중 하나). 빈값/None = 미보정.
    winner_override: Optional[str] = Field(default=None, alias="winnerOverride")
    # 수기(로그 없는) 매치: source='manual' + winner/score/VOD 구간 직접 입력. 기본 'log' = 기존 동작.
    source: str = Field(default="log")
    winner: Optional[str] = None
    score_t1: Optional[int] = None
    score_t2: Optional[int] = None
    video_start_sec: Optional[int] = Field(default=None, alias="videoStartSec")
    video_end_sec: Optional[int] = Field(default=None, alias="videoEndSec")

    class Config:
        populate_by_name = True
        allow_population_by_field_name = True
        extra = "ignore"

class ScrimManualInput(BaseModel):
    scrim_name: str = Field(alias="scrimName")
    date: str
    start_time: str = Field(alias="startHour")
    end_time: str = Field(alias="endHour")
    matches: List[MatchSegment]
    files: Optional[List[Any]] = None

    class Config:
        populate_by_name = True
        allow_population_by_field_name = True
        extra = "ignore"

class BatchDeleteRequest(BaseModel):
    ids: List[str]

class SessionPatchInput(BaseModel):
    # 세션 정보 수정(PATCH /api/sessions/{id}). 모두 선택 — 준 필드만 반영.
    scrim_name: Optional[str] = Field(default=None, alias="scrimName")
    date: Optional[str] = None
    # 팀명 정정: old_team → new_team. BASE_TEAM(기준 팀)은 서버에서 변경 거부.
    # 해당 세션의 matches(team1/team2/winner/winner_override)·player_stats·events 팀 컬럼 일괄 치환(트랜잭션).
    team_rename_from: Optional[str] = Field(default=None, alias="teamRenameFrom")
    team_rename_to: Optional[str] = Field(default=None, alias="teamRenameTo")

    class Config:
        populate_by_name = True
        allow_population_by_field_name = True
        extra = "ignore"

class PauseSecInput(BaseModel):
    # 퍼즈 구간(영상 축, 초). 등록 모달의 PauseInput(문자열)과 달리 수정 폼은 초 단위로 보낸다.
    start_sec: int
    end_sec: int


class RoundDeltaInput(BaseModel):
    # 라운드별 VOD 보정 초. video_delta_sec=None → 자동(모드 기본값 × (round_number−1))으로 되돌림.
    round_number: int
    video_delta_sec: Optional[int] = None


class MatchPatchInput(BaseModel):
    # 매치 정보 수정(PATCH /api/matches/{id}). 모두 선택 — 준 필드만 반영.
    # winner/score_t1/score_t2 직접 수정은 source='manual' 매치만 허용(로그 매치는 winner-override 사용).
    map_name: Optional[str] = None
    winner: Optional[str] = None
    score_t1: Optional[int] = None
    score_t2: Optional[int] = None
    video_url: Optional[str] = None
    video_offset: Optional[int] = None
    video_start_sec: Optional[int] = Field(default=None, alias="videoStartSec")
    video_end_sec: Optional[int] = Field(default=None, alias="videoEndSec")
    match_index: Optional[int] = None
    # 라운드별 VOD 보정(로그 매치 전용). 준 라운드만 반영, null = 자동으로 되돌림.
    rounds_delta: Optional[List[RoundDeltaInput]] = Field(default=None, alias="roundsDelta")
    # 퍼즈 구간 전체 치환(로그 매치 전용). [] = 전부 삭제. None = 무변경.
    pauses: Optional[List[PauseSecInput]] = None

    class Config:
        populate_by_name = True
        allow_population_by_field_name = True
        extra = "ignore"

class WinnerOverrideInput(BaseModel):
    # 사후 승패 보정(PATCH /api/matches/{id}/winner-override).
    # 값 = 해당 매치의 team1_name/team2_name 중 하나(보정) 또는 None/빈값(해제).
    # 원본 winner 컬럼은 무변경 — 이 필드만 갱신한다.
    winner_override: Optional[str] = Field(default=None, alias="winnerOverride")

    class Config:
        populate_by_name = True
        allow_population_by_field_name = True
        extra = "ignore"
