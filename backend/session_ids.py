# -*- coding: utf-8 -*-
"""session_ids.py — 세션 ID 허용 규칙과 로그 파일명 해석(경로 진입점 공용).

세션 ID 는 수동 등록(routers/scrims.py register_scrim_manual)만 만든다:
YYMMDD + 시작시 2자리 + 종료시 2자리(날짜 파싱 실패 시 현재 시각 YYMMDDHHMM), 겹치면 _1, _2 … 접미사.
ID 는 파일명({id}_meta.json, {id}_{match_index}.txt)에 그대로 들어가므로, 클라이언트가 보내는
ID 는 이 규칙으로 거른 뒤에만 경로에 쓴다. 형식 자체는 바꾸지 않는다(검증만).
"""
import os
import re

from fastapi import HTTPException

# [0-9] 로 쓴다 — \d 는 유니코드 숫자(전각 등)까지 받는다.
_SESSION_ID_RE = re.compile(r"[0-9]{10}(?:_[1-9][0-9]*)?")
_HOUR_RE = re.compile(r"(?:[01][0-9]|2[0-3])")


def is_valid_session_id(value) -> bool:
    return isinstance(value, str) and _SESSION_ID_RE.fullmatch(value) is not None


def require_session_id(value) -> str:
    """형식에 맞지 않으면 422. 맞으면 그대로 돌려준다."""
    if not is_valid_session_id(value):
        raise HTTPException(status_code=422, detail="Invalid session id")
    return value


def is_valid_hour(value) -> bool:
    """등록 시각(startHour/endHour): 두 자리 00~23."""
    return isinstance(value, str) and _HOUR_RE.fullmatch(value) is not None


def log_match_index(session_id: str, file_name: str):
    """'{session_id}_{n}.txt' 와 정확히 일치하면 n(int), 아니면 None.
    접두 일치(glob '{id}_*.txt')는 형제 세션 '{id}_1' 의 로그 '{id}_1_2.txt' 까지 잡으므로 쓰지 않는다."""
    m = re.fullmatch(re.escape(session_id) + r"_([0-9]+)\.txt", file_name)
    return int(m.group(1)) if m else None


def list_log_files(row_dir: str, session_id: str) -> list:
    """세션의 로그 파일 [(match_index, path)] — 경로 문자열 정렬(기존 sorted(glob) 순서와 같음)."""
    try:
        names = os.listdir(row_dir)
    except FileNotFoundError:
        return []
    found = []
    for name in names:
        idx = log_match_index(session_id, name)
        if idx is not None:
            found.append((idx, f"{row_dir}/{name}"))
    found.sort(key=lambda x: x[1])
    return found
