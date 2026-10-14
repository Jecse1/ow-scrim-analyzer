# -*- coding: utf-8 -*-
"""로그 사전 검사(parsers/log_precheck.py) 경고 분류."""
import golden_util
from parsers.log_precheck import precheck_log_text, MAX_WARNINGS

START = "[00:00:00] ,match_start,0,{map},{mode},1팀,2팀"
END = "[00:10:00] ,match_end,600,2,1,0"


def _codes(r):
    return r["counts"]["by_code"]


def test_sample_log_only_masked_numbers():
    # 실제 샘플: 숫자가 '****' 로 가려진 player_stat 2줄만 경고(파서는 그 값을 0 으로 대체)
    with open(golden_util.SAMPLE_LOG, encoding="utf-8") as f:
        r = precheck_log_text(f.read())
    assert _codes(r) == {"bad_number": 2}
    assert r["counts"]["ignored_events"]["hero_swap"] == 38


def test_columns_short():
    text = "\n".join([START.format(map="리장 타워", mode="쟁탈"),
                      "[00:01:00] ,round_end,60,1,0,1",          # 7열 필요, 6열
                      END])
    r = precheck_log_text(text)
    assert _codes(r) == {"columns_short": 1}
    w = r["warnings"][0]
    assert (w["code"], w["line"], w["event"]) == ("columns_short", 2, "round_end")


def test_unknown_event_counted_per_type():
    text = "\n".join([START.format(map="리장 타워", mode="쟁탈"),
                      "[00:01:00] ,mystery_event,60,1",
                      "[00:01:01] ,mystery_event,61,1",
                      "[00:01:02] ,hero_swap,62,1팀,P,A,B,0",   # 의도적 미처리 → info
                      END])
    r = precheck_log_text(text)
    assert _codes(r) == {"unknown_event": 1}
    assert "2건" in r["warnings"][0]["message"] and r["warnings"][0]["line"] == 2
    assert r["counts"]["ignored_events"] == {"hero_swap": 1}


def test_missing_match_start():
    r = precheck_log_text("[00:01:00] ,round_start,0,1,1팀,0,0,0\n" + END)
    assert _codes(r) == {"no_match_start": 1}


def test_zero_team_only_outside_control():
    body = ["[00:00:01] ,round_start,0,1,0,0,0,0", "[00:05:00] ,round_end,300,1,0,1,0,0,0,0,0", END]
    control = precheck_log_text("\n".join([START.format(map="리장 타워", mode="쟁탈")] + body))
    assert _codes(control) == {}
    hybrid = precheck_log_text("\n".join([START.format(map="눔바니", mode="혼합")] + body))
    assert _codes(hybrid) == {"zero_team_noncontrol": 2}


def test_encoding_flag_and_cap():
    lines = [START.format(map="리장 타워", mode="쟁탈")] + ["bad line"] * (MAX_WARNINGS + 5) + [END]
    r = precheck_log_text("\n".join(lines), encoding_fallback=True)
    assert r["warning_count"] == MAX_WARNINGS + 6
    assert len(r["warnings"]) == MAX_WARNINGS and r["overflow"] == 6
    assert r["warnings"][0]["code"] == "encoding_fallback"
