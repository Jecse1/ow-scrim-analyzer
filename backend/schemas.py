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

class WinnerOverrideInput(BaseModel):
    # 사후 승패 보정(PATCH /api/matches/{id}/winner-override).
    # 값 = 해당 매치의 team1_name/team2_name 중 하나(보정) 또는 None/빈값(해제).
    # 원본 winner 컬럼은 무변경 — 이 필드만 갱신한다.
    winner_override: Optional[str] = Field(default=None, alias="winnerOverride")

    class Config:
        populate_by_name = True
        allow_population_by_field_name = True
        extra = "ignore"
