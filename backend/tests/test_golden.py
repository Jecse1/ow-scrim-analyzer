# -*- coding: utf-8 -*-
"""골든 회귀: sample_data 로그의 파싱·통계·한타 결과가 바이트 단위로 고정값과 같은지.

파서·calculate_pure_stats·compute_fights·format_fights_for_api 본문이 그대로라는 증명.
의도된 동작 변경이면 `python -m pytest tests/test_golden.py --update-golden` 으로만 갱신한다.
"""
import golden_util


def test_sample_control_golden(update_golden):
    actual = golden_util.build_sample_golden()
    if update_golden:
        with open(golden_util.GOLDEN_SAMPLE, "wb") as f:
            f.write(actual)
    with open(golden_util.GOLDEN_SAMPLE, "rb") as f:
        expected = f.read()
    assert actual == expected, "골든 불일치 — 파서/계산 출력이 바뀌었다(의도된 변경이면 --update-golden)"
