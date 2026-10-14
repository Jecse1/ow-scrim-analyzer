# -*- coding: utf-8 -*-
"""파서 헬퍼 고정값."""
import pytest

from parsers.log_parser import (
    time_str_to_seconds, parse_log_timestamp, normalize_team_name, get_role_score,
)


@pytest.mark.parametrize("s, expected", [
    ("00:00:00", 0), ("00:05:48", 348), ("01:02:03", 3723), ("5:07", 307), ("42", 42),
    ("00.01.02", 62), ("00-01-02", 62), ("", 0), (None, 0), ("ab:cd", 0), ("1:2:3:4", 0),
])
def test_time_str_to_seconds(s, expected):
    assert time_str_to_seconds(s) == expected


@pytest.mark.parametrize("line, expected", [
    ("[00:05:48] ,player_stat,185.23", 348),
    ("[00:00:00] ,match_start,0", 0),
    ("player_stat,185.23", 0.0),        # '[' 로 시작하지 않으면 0
    ("[xx:yy:zz] ,kill", 0),            # 형식 불일치도 0 (조용한 대체 — precheck 가 경고)
])
def test_parse_log_timestamp(line, expected):
    assert parse_log_timestamp(line) == expected


def test_normalize_team_name():
    assert normalize_team_name("  Team A ") == "team a"
    assert normalize_team_name(None) == ""
    assert normalize_team_name("1팀") == "1팀"


def test_get_role_score():
    assert get_role_score("라인하르트") == 0
    assert get_role_score("아나") == 2
    assert get_role_score("트레이서") == 1
    assert get_role_score("없는영웅") == 1
