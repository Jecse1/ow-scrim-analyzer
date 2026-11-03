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


# 쟁탈·플래시포인트: 마지막 라운드 round_end 또는 match_end 가 없으면(크래시로 로그 끊김) 미완 로그 경고
R1 = ["[00:00:01] ,round_start,0,1,0,0,0,0", "[00:05:00] ,round_end,300,1,0,1,0,0,0,0,0"]
R2_START = "[00:05:20] ,round_start,300,2,0,0,0,0"
R2_END = "[00:11:40] ,round_end,700,2,0,2,0,0,0,0,0"


def _incomplete(r):
    return [w for w in r["warnings"] if w["code"] == "incomplete_log"]


def test_incomplete_log_last_round_end_missing():
    # round_end·match_end 둘 다 없이 끊김
    r = precheck_log_text("\n".join([START.format(map="리장 타워", mode="쟁탈")] + R1 + [R2_START]))
    assert _codes(r) == {"no_match_end": 1, "incomplete_log": 1}
    w = _incomplete(r)[0]
    assert r["warnings"][0] is w and w["event"] == "round_end" and w["line"] is None
    assert "2라운드" in w["message"]


def test_incomplete_log_match_end_missing_only():
    r = precheck_log_text("\n".join([START.format(map="리장 타워", mode="쟁탈")] + R1 + [R2_START, R2_END]))
    assert _codes(r) == {"no_match_end": 1, "incomplete_log": 1}
    assert _incomplete(r)[0]["event"] == "match_end"


def test_incomplete_log_flashpoint():
    r = precheck_log_text("\n".join([START.format(map="뉴 정크 시티", mode="플래시포인트")] + R1 + [R2_START, END]))
    # (라운드 팀 필드 '0' 은 기존 zero_team_noncontrol 규칙이 따로 잡음 — 여기선 미완 여부만)
    assert _codes(r)["incomplete_log"] == 1 and "no_match_end" not in _codes(r)
    assert _incomplete(r)[0]["event"] == "round_end"


def test_incomplete_log_not_for_complete_or_other_modes():
    complete = precheck_log_text("\n".join([START.format(map="리장 타워", mode="쟁탈")] + R1 + [R2_START, R2_END, END]))
    assert _codes(complete) == {}
    # 쟁탈·플래시포인트가 아니면 기존 no_match_end 만
    hybrid = precheck_log_text("\n".join([START.format(map="눔바니", mode="혼합"), R2_START]))
    assert "incomplete_log" not in _codes(hybrid)


def test_incomplete_log_survives_warning_cap():
    lines = [START.format(map="리장 타워", mode="쟁탈")] + ["bad line"] * (MAX_WARNINGS + 5) + R1 + [R2_START]
    r = precheck_log_text("\n".join(lines))
    assert len(r["warnings"]) == MAX_WARNINGS
    assert r["warnings"][0]["code"] == "incomplete_log"
    assert r["warning_count"] == MAX_WARNINGS + 7 and r["overflow"] == 7


def test_incomplete_log_parser_result_unchanged(fixture_text):
    # 경고만 추가 — 같은 텍스트의 파싱 결과(승패 판정 포함)는 precheck 와 무관
    from parsers.log_parser import parse_overwatch_log
    text = "\n".join(l for l in fixture_text("control_simple.txt").splitlines() if ",match_end," not in l)
    before = parse_overwatch_log(text)
    assert _codes(precheck_log_text(text)).get("incomplete_log") == 1
    assert parse_overwatch_log(text) == before
