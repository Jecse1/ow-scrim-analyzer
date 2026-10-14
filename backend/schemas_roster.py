# -*- coding: utf-8 -*-
"""schemas_roster.py — POST /api/logs/roster 응답 Pydantic 모델(등록 모달 "우리 팀" 선택용).

schemas.py 는 요청 모델 전용이고 응답 모델은 schemas_summary.py 처럼 별도 파일에 둔다.
"""
from typing import List, Optional

from pydantic import BaseModel, Field


class RosterPlayer(BaseModel):
    name: str = Field(description="선수명(players.json 별칭 적용 후 정본명)")
    heroes: List[str] = Field(description="플레이한 영웅(ko), 라운드 중 최대 플레이 시간 내림차순")


class RosterTeam(BaseModel):
    slot: int = Field(description="1 = 로그 첫 match_start 의 첫 팀(등록 시 team1_name 자리), 2 = 둘째 팀")
    label: str = Field(description="로그 원시 팀 라벨(예: '1팀'/'2팀' 또는 'Team 1'/'Team 2')")
    players: List[RosterPlayer] = Field(description="파서 slot_index 순(탱→딜→힐)")


class RosterWarning(BaseModel):
    code: str
    line: Optional[int] = None
    event: Optional[str] = None
    message: str


class RosterResponse(BaseModel):
    teams: List[RosterTeam] = Field(description="항상 2개, slot 1 → 2 순")
    warnings: List[RosterWarning] = Field(description="precheck_log_text 경고(+ roster_extra_team)")
    warning_count: int
