# -*- coding: utf-8 -*-
"""골든 파일 생성·정규화 헬퍼(test_golden.py 전용).

sample_data 로그를 parse_overwatch_log → calculate_pure_stats → compute_fights →
format_fights_for_api 에 통과시킨 결과를 결정적 JSON 바이트로 만든다.
  · dict 키: 튜플은 "a|b|c", 숫자는 str 로 변환 후 정렬
  · float: 소수 6자리 반올림(-0.0 → 0.0)
파서·계산 본문이 바뀌지 않았음을 바이트 비교로 증명하는 용도. 정답 보증이 아니라 현재 동작 고정.
"""
import copy
import json
import os

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO_DIR = os.path.dirname(BACKEND_DIR)
SAMPLE_LOG = os.path.join(REPO_DIR, "sample_data", "sample_match_map1.txt")
GOLDEN_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "golden")
GOLDEN_SAMPLE = os.path.join(GOLDEN_DIR, "sample_control.json")

# sample_data/README.md 의 등록 예시와 동일(1팀=Team B, 2팀=Team A)
SAMPLE_T1 = "Team B"
SAMPLE_T2 = "Team A"


def _key(k):
    if isinstance(k, tuple):
        return "|".join(str(x) for x in k)
    return str(k)


def canonical(obj):
    if isinstance(obj, dict):
        return {_key(k): canonical(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [canonical(v) for v in obj]
    if isinstance(obj, float):
        r = round(obj, 6)
        return 0.0 if r == 0 else r
    return obj


def build_sample_golden() -> bytes:
    from parsers.log_parser import parse_overwatch_log
    from services.stats import calculate_pure_stats
    from services.fight_analysis import compute_fights, format_fights_for_api

    with open(SAMPLE_LOG, "r", encoding="utf-8") as f:
        text = f.read()
    parsed = parse_overwatch_log(text, custom_t1=SAMPLE_T1, custom_t2=SAMPLE_T2)
    parsed_snapshot = copy.deepcopy(parsed)
    target = {}
    calculate_pure_stats(parsed, target, match_label="golden")
    t1, t2 = parsed["team_1_name"], parsed["team_2_name"]
    fights = compute_fights(parsed["events"], t1, t2)
    payload = {
        "parsed": parsed_snapshot,
        "match": target,
        "fights_api": format_fights_for_api(fights, t1, t2),
    }
    text_out = json.dumps(canonical(payload), ensure_ascii=False, sort_keys=True, indent=1)
    return (text_out + "\n").encode("utf-8")
