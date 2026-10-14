# -*- coding: utf-8 -*-
"""parsers/log_precheck.py — 로그 사전 검사(경고 수집 전용 레이어).

parse_overwatch_log 는 형식이 어긋난 줄을 조용히 건너뛰거나 기본값으로 대체한다(본문 무수정 원칙).
이 모듈은 파싱과 별개로 같은 텍스트를 한 번 더 훑어 "파서가 조용히 버릴 줄"을 경고로 모은다.
업로드를 거부하지 않는다 — 결과는 업로드 응답·meta.json·서버 로그에 기록만 한다.

규칙 근거(log_parser.py 의 인덱스 접근):
  · 이벤트 판별: 타임스탬프 다음 필드(parts[1]). '****' 는 파서와 같이 'kill' 로 본다.
  · 필요 컬럼: base_idx(이벤트명 위치) + 코드가 읽는 최대 오프셋.
  · 숫자 필드: 파서가 float()/int() 로 읽어 실패 시 줄을 버리는 오프셋.
"""
import re

from parsers.log_parser import resolve_map_type

MAX_WARNINGS = 50

# 이벤트명 → 파서가 반드시 읽는 최대 오프셋(base_idx 기준). 부족하면 파서가 그 줄을 버린다.
REQUIRED_OFFSET = {
    "match_start": 5,
    "match_end": 3,          # tail[0]=경기 시간 + 마지막 숫자 2개(스코어)
    "round_start": 3,
    "round_end": 5,
    "objective_captured": 3,
    "point_captured": 3,
    "payload_progress": 3,
    "point_progress": 3,
    "objective_updated": 4,
    "player_stat": 38,
    "kill": 8,
    "ultimate_start": 4,
}

# 진행도 이벤트의 선택 필드(+4 거점 인덱스, +5 %). 없으면 파서는 None 으로 두고 진행 —
# 혼합·호위 동점 타이브레이크(진행도 비교)가 이 값을 쓰므로 경고 대상.
PROGRESS_FULL_OFFSET = 5
PROGRESS_EVENTS = ("payload_progress", "point_progress")

# 파서가 float()/int() 로 읽는 오프셋. 변환 실패 시 파서는 줄 전체를 버린다.
# (player_stat 수치는 get_val 이 0.0 으로 대체 → 줄은 살지만 값이 0 이 되므로 함께 검사)
NUMERIC_OFFSETS = {
    "match_end": (1,),
    "round_start": (1, 2),
    "round_end": (1, 2, 4, 5),
    "objective_captured": (1,),
    "point_captured": (1,),
    "payload_progress": (1, 2),
    "point_progress": (1, 2),
    "objective_updated": (1, 2, 3, 4),
    "player_stat": (1,) + tuple(range(6, 21)) + (38,),
    "kill": (1,),
    "ultimate_start": (1,),
}

# 파서가 의도적으로 처리하지 않는 이벤트(워크숍이 기록하지만 분석에 안 쓰는 것). info 로만 집계.
INTENTIONALLY_IGNORED = frozenset({
    "hero_spawn", "hero_swap", "defensive_assist", "offensive_assist",
    "ultimate_charged", "ultimate_end", "dva_remech", "remech_charged",
    "ability_1_used", "ability_2_used",
    "setup_complete",  # 파서 대신 라우터가 직접 읽음(game_setup_sec)
    "damage", "healing", "mercy_rez", "echo_duplicate_start", "echo_duplicate_end",
})

CONTROL_MODES = ("쟁탈", "Control")

# 경고 코드 → 기본 메시지
CODES = {
    "bad_timestamp": "타임스탬프 형식 불일치 — 파서가 0초로 대체",
    "columns_short": "컬럼 수 부족 — 파서가 이 줄을 버림",
    "bad_number": "숫자 필드 형식 불일치 — 파서가 이 줄을 버리거나 0으로 대체",
    "progress_partial": "진행도 거점·% 필드 누락 — 동점 진행도 판정에 반영 안 됨",
    "unknown_event": "알 수 없는 이벤트 타입 — 파서가 모두 무시",
    "no_match_start": "match_start 없음 — 맵·모드·팀명이 기본값(Unknown/1팀/2팀)",
    "no_match_end": "match_end 없음 — 최종 스코어 이벤트 부재",
    "zero_team_noncontrol": "쟁탈이 아닌 맵에서 공격팀/라운드 승자가 '0' — 팀명 기반 집계가 어긋남",
    "encoding_fallback": "UTF-8 디코드 실패 — cp949(errors=ignore)로 대체, 깨진 바이트 삭제됨",
}

_TS_SEP = re.compile(r"[.\-\s]")


def _timestamp_ok(line: str) -> bool:
    """parse_log_timestamp(:78-85)·time_str_to_seconds(:57-76) 가 0 으로 대체하지 않는 형식인지."""
    if not line.startswith("[") or "]" not in line:
        return False
    t = _TS_SEP.sub(":", line.split("]")[0].strip("[").strip())
    parts = t.split(":")
    return 1 <= len(parts) <= 3 and all(p.isdigit() for p in parts)


def _is_number(s: str) -> bool:
    try:
        float(s)
        return True
    except (TypeError, ValueError):
        return False


def precheck_log_text(text: str, *, encoding_fallback: bool = False) -> dict:
    """로그 텍스트를 줄 단위로 검사해 경고를 모은다. 파싱 결과에는 영향 없음.

    반환: {"warnings": [{"code","line","event","message"}, ...]  (최대 MAX_WARNINGS),
           "warning_count": 전체 경고 수, "overflow": 상한 초과로 생략된 수,
           "counts": {"lines", "events", "ignored_events", "by_code", "match_end_winner_unmatched"}}
    line 은 1부터 시작하는 줄 번호(파일 전체 집계 경고는 None).
    """
    warnings: list = []
    by_code: dict = {}
    overflow = 0

    def warn(code, line_no, event, detail=""):
        nonlocal overflow
        by_code[code] = by_code.get(code, 0) + 1
        if len(warnings) >= MAX_WARNINGS:
            overflow += 1
            return
        msg = CODES[code] + (f" ({detail})" if detail else "")
        warnings.append({"code": code, "line": line_no, "event": event, "message": msg})

    if encoding_fallback:
        warn("encoding_fallback", None, None)

    events: dict = {}
    ignored: dict = {}
    unknown: dict = {}          # 이벤트명 → [건수, 첫 줄 번호]
    has_start = has_end = False
    is_control = None           # match_start 를 본 뒤 결정
    zero_lines: list = []       # (줄 번호, 이벤트) — match_start 이전에 나온 경우를 위해 지연 판정
    end_winner_unmatched = 0
    n_lines = 0

    for i, raw in enumerate(text.splitlines(), start=1):
        line = raw.strip()
        if not line:
            continue
        n_lines += 1
        if not _timestamp_ok(line):
            warn("bad_timestamp", i, None, line[:40])
        parts = [p.strip() for p in line.split(",")]
        if len(parts) < 2:
            continue
        ev = parts[1]
        if ev == "****":
            ev = "kill"
        events[ev] = events.get(ev, 0) + 1

        if ev not in REQUIRED_OFFSET:
            if ev in INTENTIONALLY_IGNORED:
                ignored[ev] = ignored.get(ev, 0) + 1
            else:
                u = unknown.setdefault(ev, [0, i])
                u[0] += 1
            continue

        base = 1
        avail = len(parts) - 1 - base   # 이벤트명 뒤에 있는 필드 수 = 접근 가능한 최대 오프셋
        need = REQUIRED_OFFSET[ev]
        if avail < need:
            warn("columns_short", i, ev, f"{len(parts)}열, 필요 {base + need + 1}열")
            continue

        bad = [o for o in NUMERIC_OFFSETS.get(ev, ()) if not _is_number(parts[base + o])]
        if bad:
            warn("bad_number", i, ev, "오프셋 " + ",".join(f"+{o}" for o in bad))

        if ev in PROGRESS_EVENTS:
            opt = parts[base + 4: base + PROGRESS_FULL_OFFSET + 1]
            if len(opt) < 2 or not all(_is_number(x) for x in opt):
                warn("progress_partial", i, ev)

        if ev == "match_start":
            if not has_start:
                mode = parts[base + 3]
                is_control = (mode in CONTROL_MODES
                              or resolve_map_type(parts[base + 2]) == "쟁탈")
            has_start = True
        elif ev == "match_end":
            has_end = True
            # 실제 워크숍 로그의 match_end 는 팀명을 담지 않는다(시간·라운드·스코어 숫자만) →
            # 파서의 match_end_winner 는 항상 None 이고 승패 판정에도 쓰이지 않는다. 경고 아닌 info.
            if all(_is_number(x) for x in parts[base + 1:] if x):
                end_winner_unmatched += 1
        elif ev == "round_start" and parts[base + 3] == "0":
            zero_lines.append((i, ev))
        elif ev == "round_end" and parts[base + 3] == "0":
            zero_lines.append((i, ev))

    if not has_start:
        warn("no_match_start", None, "match_start")
    if not has_end:
        warn("no_match_end", None, "match_end")
    # 쟁탈은 공격/수비 개념이 없어 '0' 이 정상. match_start 가 없으면 맵 타입을 몰라 판정 생략.
    if is_control is False:
        for i, ev in zero_lines:
            warn("zero_team_noncontrol", i, ev)
    for ev, (cnt, first) in sorted(unknown.items()):
        warn("unknown_event", first, ev, f"'{ev}' {cnt}건")

    return {
        "warnings": warnings,
        "warning_count": sum(by_code.values()),
        "overflow": overflow,
        "counts": {
            "lines": n_lines,
            "events": events,
            "ignored_events": ignored,
            "by_code": by_code,
            "match_end_winner_unmatched": end_winner_unmatched,
        },
    }


def precheck_summary(result: dict) -> str:
    """서버 로그·meta 용 한 줄 요약: 'N건 code1×a code2×b' 또는 '0건'."""
    bc = result.get("counts", {}).get("by_code", {})
    if not bc:
        return "0건"
    return f"{result.get('warning_count', 0)}건 " + " ".join(f"{k}×{v}" for k, v in sorted(bc.items()))
