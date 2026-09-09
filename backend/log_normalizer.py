# -*- coding: utf-8 -*-
"""
log_normalizer.py — 영어 클라이언트 워크숍 로그를 한국어 로그 형식으로 정규화.

목적:
    파서(parse_overwatch_log)와 main.py를 전혀 건드리지 않고, 입력 로그를 기존 한국어
    로그와 구분 불가능한 형태로 표준화한다. 이벤트 타입/타임스탬프/구조/줄 순서는 보존하고,
    각 이벤트의 team / hero / map / mode 컬럼 값만 위치 기반으로 치환한다.

설계 원칙:
    - 이벤트 타입별로 치환 대상 컬럼 인덱스를 명시 지정한다(블라인드 치환 금지 → 선수명 오염 방지).
    - 매핑에 없는 값은 원문 그대로 두고 warnings 로 수집한다.
    - 멱등성: 이미 한국어인 값은 매핑 키에 없으므로 그대로 통과 → 무변경.
    - kill 이벤트 타입(****/kill)은 건드리지 않는다(파서가 ****→kill 치환하므로 무해).

CLI:
    python log_normalizer.py <입력_폴더_또는_파일> <출력_폴더> [--glob PATTERN]
"""
from __future__ import annotations
import os
import sys
import glob
import argparse
from collections import Counter

# ── main.py 의 KOREAN_HERO_MAP 을 그대로 재사용(역방향 생성) ──────────────────
# 파서 상수를 단일 출처로 삼아 이 모듈이 파서와 어긋나지 않게 한다.
_THIS_DIR = os.path.dirname(os.path.abspath(__file__))
if _THIS_DIR not in sys.path:
    sys.path.insert(0, _THIS_DIR)
from game_data import KOREAN_HERO_MAP  # noqa: E402  (한국어→영어; STEP1: main→game_data 직접 참조)

# EN→KR 영웅 역매핑. KOREAN_HERO_MAP 값(영문)이 중복되면 먼저 등장한 한국어를 정본으로 둔다.
_HERO_EN2KO: dict[str, str] = {}
for _ko, _en in KOREAN_HERO_MAP.items():
    _HERO_EN2KO.setdefault(_en, _ko)

# 자동 역매핑으로 얻지 못하는 값의 명시 보강(STEP0 조사에서 DB로 KR 문자열 실재 확인).
#   Lúcio : 역맵엔 액센트 없는 'Lucio'만 존재 → 영어 로그 실제 표기(ú)를 별칭으로 추가
#   Freja / Vendetta / Wuyang : KOREAN_HERO_MAP 미수록, DB에 프레야/벤데타/우양 실재
#   D.Va : 한국어 클라이언트/로그도 영문 'D.Va'로 기록(DB hero_name/​image 모두 'D.Va').
#          역매핑은 D.Va→디바를 주지만, 그대로 두면 기존 KR 데이터(D.Va)와 쪼개지므로 항등 고정.
#          (KR 로그 전수 스캔 결과 hero 컬럼에 영문으로 남는 영웅은 D.Va 단 하나)
#   D.Mon : D.Va와 동일 패턴(한국 클라이언트도 영문 'D.Mon'으로 기록될 것으로 확정).
#          KOREAN_HERO_MAP('디몬':'D.Mon')이 역파생 D.Mon→디몬을 주지만, 실로그 'D.Mon'을
#          '디몬'으로 바꾸면 데이터가 쪼개지므로 항등 고정. (첫 실로그 입고 시 표기 최종 확인)
# _HERO_EN2KO_EXPLICIT 는 game_data(SSOT: heroes.json)에서 파생. 값·주석 근거 동일.
from game_data import HERO_EN2KO_EXPLICIT as _HERO_EN2KO_EXPLICIT  # noqa: E402
HERO_EN2KO: dict[str, str] = {**_HERO_EN2KO, **_HERO_EN2KO_EXPLICIT}

# ── 팀 / 맵 / 모드 매핑 ──────────────────────────────────────────────────────
TEAM_EN2KO: dict[str, str] = {
    "Team 1": "1팀",
    "Team 2": "2팀",
    # "All Teams" 는 한국어 로그에서도 그대로 사용되므로 매핑하지 않는다(유지).
}

# MAP_EN2KO / MODE_EN2KO 는 game_data(SSOT: maps.json)에서 파생. 값 동일.
# (모드는 한국어 로그 실제 표기 기준: Escort=호위, MAP_TYPE_DATA 맵타입 '화물'과 다름.)
from game_data import MAP_EN2KO, MODE_EN2KO  # noqa: E402

# ── 이벤트 타입별 치환 대상 컬럼 스펙 ────────────────────────────────────────
# 인덱스는 event_type 필드(P) 기준 상대 오프셋. line.split(",") 후
#   base = parts.index(event_type_token);  치환 대상 = base + offset
# kind: 'team' | 'hero' | 'map' | 'mode'
# 파서가 읽지 않는 이벤트(hero_spawn 등)도 외형 동일성을 위해 포함한다.
EVENT_FIELD_SPEC: dict[str, list[tuple[int, str]]] = {
    "match_start":       [(2, "map"), (3, "mode"), (4, "team"), (5, "team")],
    "round_start":       [(3, "team")],                      # attacker
    "round_end":         [(3, "team")],                      # winner
    # match_end: 전부 숫자 → 치환 없음
    "hero_spawn":        [(2, "team"), (4, "hero")],
    "hero_swap":         [(2, "team"), (4, "hero"), (5, "hero")],  # hero_to, hero_from
    "kill":              [(2, "team"), (4, "hero"), (5, "team"), (7, "hero")],
    "ultimate_start":    [(2, "team"), (4, "hero")],
    "ultimate_end":      [(2, "team"), (4, "hero")],
    "ultimate_charged":  [(2, "team"), (4, "hero")],
    "player_stat":       [(3, "team"), (5, "hero")],
    "objective_captured":[(3, "team")],
    "point_captured":    [(3, "team")],
    "point_progress":    [(3, "team")],
    "payload_progress":  [(3, "team")],
    # objective_updated / setup_complete: 숫자만 → 치환 없음
    "ability_1_used":    [(2, "team"), (4, "hero")],
    "ability_2_used":    [(2, "team"), (4, "hero")],
    "defensive_assist":  [(2, "team"), (4, "hero")],
    "offensive_assist":  [(2, "team"), (4, "hero")],
}

_KIND_MAP = {
    "team": TEAM_EN2KO,
    "hero": HERO_EN2KO,
    "map": MAP_EN2KO,
    "mode": MODE_EN2KO,
}

# 미치환 경고 시 값이 실제로 영어(번역 필요 후보)인지 걸러내는 데 쓰는 힌트.
# "All Teams", 숫자, 좌표 등은 원래 치환 대상이 아니므로 경고에서 제외한다.
_NON_WARN_VALUES = {"All Teams", ""}


def _looks_ascii_wordish(v: str) -> bool:
    """값이 ASCII 알파벳을 포함하면(=영어 잔존 후보) True. 순수 숫자/기호는 False."""
    return any(("a" <= c.lower() <= "z") for c in v)


class NormalizeResult:
    def __init__(self):
        self.subs: Counter = Counter()          # (kind, en, ko) -> count
        self.warnings: Counter = Counter()      # (event_type, kind, value) -> count
        self.line_count = 0
        self.changed_line_count = 0


def normalize_text(text: str, result: NormalizeResult | None = None) -> tuple[str, NormalizeResult]:
    """로그 텍스트를 한국어 형식으로 정규화. (변환문자열, 결과통계) 반환. 멱등."""
    if result is None:
        result = NormalizeResult()

    # splitlines(keepends=True) 로 개행 문자(및 CRLF)를 원형 그대로 보존한다.
    out_lines: list[str] = []
    for raw in text.splitlines(keepends=True):
        # 개행 분리
        nl = ""
        body = raw
        for end in ("\r\n", "\n", "\r"):
            if body.endswith(end):
                nl = end
                body = body[: -len(end)]
                break

        if not body.strip():
            out_lines.append(raw)
            continue

        result.line_count += 1
        parts = body.split(",")

        # event_type 은 통상 parts[1] (parts[0]은 "[HH:MM:SS] ")
        et = parts[1].strip() if len(parts) > 1 else ""
        # kill 은 KR 에서 **** 로 올 수 있으나 여기 입력은 영어 로그(kill). 스펙 키로 조회.
        spec = EVENT_FIELD_SPEC.get(et)

        line_changed = False
        if spec:
            base = 1  # parts[1] == event_type
            for offset, kind in spec:
                idx = base + offset
                if idx >= len(parts):
                    continue
                token = parts[idx]
                stripped = token.strip()
                table = _KIND_MAP[kind]
                if stripped in table:
                    ko = table[stripped]
                    if ko != stripped:
                        # 원 토큰의 앞뒤 공백을 보존하며 값만 교체
                        lead = token[: len(token) - len(token.lstrip())]
                        trail = token[len(token.rstrip()):]
                        parts[idx] = f"{lead}{ko}{trail}"
                        result.subs[(kind, stripped, ko)] += 1
                        line_changed = True
                else:
                    # 매핑에 없음: 원문 유지 + 경고(단, All Teams/숫자/좌표 등은 제외)
                    if stripped not in _NON_WARN_VALUES and _looks_ascii_wordish(stripped):
                        result.warnings[(et, kind, stripped)] += 1

        new_body = ",".join(parts) if line_changed else body
        if line_changed:
            result.changed_line_count += 1
        out_lines.append(new_body + nl)

    return "".join(out_lines), result


def normalize_file(in_path: str, out_path: str, result: NormalizeResult | None = None) -> NormalizeResult:
    with open(in_path, "r", encoding="utf-8", errors="strict") as f:
        text = f.read()
    out_text, result = normalize_text(text, result)
    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    with open(out_path, "w", encoding="utf-8", newline="") as f:
        f.write(out_text)
    return result


def main_cli(argv=None):
    ap = argparse.ArgumentParser(description="영어 워크숍 로그 → 한국어 로그 정규화")
    ap.add_argument("input", help="입력 파일 또는 폴더")
    ap.add_argument("output", help="출력 폴더")
    ap.add_argument("--glob", default="Log-*.txt", help="폴더 입력 시 매칭 패턴(기본 Log-*.txt)")
    args = ap.parse_args(argv)

    if os.path.isdir(args.input):
        files = sorted(glob.glob(os.path.join(args.input, args.glob)))
    else:
        files = [args.input]

    if not files:
        print("입력 파일 없음:", args.input)
        return 1

    os.makedirs(args.output, exist_ok=True)
    print(f"변환 대상 {len(files)}개 → {args.output}\n")
    grand = NormalizeResult()
    for f in files:
        name = os.path.basename(f)
        out = os.path.join(args.output, name)
        per = NormalizeResult()
        normalize_file(f, out, per)
        # 누적
        grand.subs.update(per.subs)
        grand.warnings.update(per.warnings)
        grand.line_count += per.line_count
        grand.changed_line_count += per.changed_line_count
        print(f"  {name}: {per.changed_line_count}줄 변경 / 치환 {sum(per.subs.values())}건"
              + (f" / 경고 {sum(per.warnings.values())}건" if per.warnings else ""))

    print("\n=== 치환 합계(kind: EN→KO ×건수) ===")
    for (kind, en, ko), n in sorted(grand.subs.items(), key=lambda x: (-x[1], x[0][0])):
        print(f"  [{kind}] {en} → {ko}  ×{n}")
    if grand.warnings:
        print("\n=== 미치환 경고(원문 유지) ===")
        for (et, kind, val), n in sorted(grand.warnings.items(), key=lambda x: -x[1]):
            print(f"  ({et}/{kind}) {val!r}  ×{n}")
    else:
        print("\n미치환 경고 없음.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main_cli())
