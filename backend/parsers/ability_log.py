# -*- coding: utf-8 -*-
"""parsers/ability_log.py — 원문 로그의 스킬 사용 줄(ability_1_used / ability_2_used)을 별도 구조로 읽는다.

parse_overwatch_log 는 이 줄을 버리고, 그 출력·골든도 그대로 둔다(이 모듈은 원문을 따로 한 번 더 읽는다).
줄 형식: [시각] ,ability_N_used,게임시간,팀라벨,선수,영웅,X
  X = 평소 "0", 에코가 복제 중이면 복제한 영웅 이름(그때 스킬은 복제한 영웅의 스킬) → copy_hero 로 남긴다.

라운드 번호는 calculate_pure_stats 와 같은 규칙으로 정한다(같은 이벤트가 같은 라운드에 들도록 —
tests/test_ability_log.py 가 kill·round_start 배정이 calculate_pure_stats 결과와 같은지 대조한다):
  경계 = 라운드 스냅샷의 hero_time_played 최댓값, 일반 줄은 (이전 경계 < t ≤ 경계)(1라운드는 t ≤ 경계),
  마지막 라운드 상한 = max(경계, match_end 시각)(match_end 없으면 상한 없음), 15초 미만 라운드(첫 라운드 제외)는
  버리고 번호를 당긴다. 버려진 라운드·어느 라운드에도 들지 않는 줄은 round_no=None 으로 저장(건수는 원문과 같게).
  준비 시간(round_start → setup_complete 사이이고 게임시간 = round_start 시각, 시계 정지) 줄은 round_start 처럼 시작하는 라운드로 넣는다
  (반열린 구간 prev ≤ t < cur, 그런 라운드가 없으면 일반 규칙).
timestamp 는 events.timestamp 와 같은 값(로그 시각 − 2초, log_parser 의 play_timestamp) — VOD 링크가 이벤트와 같은 기준을 쓴다.
"""
from parsers.log_parser import normalize_player_name, parse_log_timestamp

ABILITY_EVENT_SLOTS = {"ability_1_used": 1, "ability_2_used": 2}


def _round_rules(parsed: dict):
    """calculate_pure_stats 의 라운드 경계·마지막 라운드 상한·15초 미만 라운드 제거를 재현한다."""
    total = parsed.get("total_rounds", 0) or 0
    rounds_map = parsed.get("rounds_stats", {}) or {}
    ends = {}
    for r in range(1, total + 1):
        max_t = 0
        for stat in rounds_map.get(r, {}).values():
            if stat["hero_time_played"] > max_t:
                max_t = stat["hero_time_played"]
        ends[r] = max_t
    me = [ev.get("game_timestamp", 0) for ev in parsed.get("events", []) if ev.get("event_type") == "match_end"]
    cap = max(me) if me else float("inf")
    renumber = {}
    kept = 0
    for r in range(1, total + 1):
        if max(0, ends[r] - ends.get(r - 1, 0)) < 15.0 and kept >= 1:
            continue
        kept += 1
        renumber[r] = kept
    return total, ends, cap, renumber


def assign_round(game_time: float, is_setup: bool, rules) -> "int | None":
    """game_time 의 라운드 번호(저장되는 rounds.round_number 기준). 없으면 None."""
    total, ends, cap, renumber = rules
    if is_setup:
        for r in range(1, total + 1):
            if (r == 1 or ends.get(r - 1, 0) <= game_time) and game_time < ends.get(r, 0):
                return renumber.get(r)
    for r in range(1, total + 1):
        prev, cur = ends.get(r - 1, 0), ends.get(r, 0)
        upper = max(cur, cap) if r == total else cur
        if (game_time <= upper) if r == 1 else (prev < game_time <= upper):
            return renumber.get(r)
    return None


def extract_ability_data(log_text: str, parsed: dict) -> dict:
    """스킬 사용 줄과 영웅별 플레이 시간(10분당 분모)을 돌려준다.

    반환: {"has_log": 스킬 줄이 1개라도 있는지, "raw_lines": 스킬 줄 수, "dup_skipped": 완전 중복으로 뺀 줄 수,
           "uses": [{player_name, hero_name, slot, game_time, round_no, timestamp, team_slot, is_setup, copy_hero}],
           "hero_time": [{team_slot, player_name, hero_name, seconds}]}  — 스킬 줄이 없으면 hero_time 은 빈 목록.
    team_slot = 로그 match_start 의 팀 라벨 순서(1/2, 알 수 없으면 0). 화면의 팀명은 player_stats 의 team_name 으로 붙인다.
    완전 중복(같은 선수·영웅·슬롯·게임시간)은 한 번만 남긴다(파서의 kill/ultimate 중복 제거와 같은 방침).
    """
    label1 = label2 = None
    phase_setup = False
    setup_clock = None   # 준비 시간 동안 멈춰 있는 게임 시계 값(= round_start 시각)
    uses: list = []
    seen: set = set()
    raw_lines = dup = 0
    hero_time: dict = {}
    for line in log_text.splitlines():
        clean = line.strip()
        parts = clean.split(",")
        if len(parts) < 2:
            continue
        et = parts[1].strip()
        if et == "match_start":
            if label1 is None:
                try:
                    base = parts.index("match_start")
                    label1, label2 = parts[base + 4].strip(), parts[base + 5].strip()
                except (ValueError, IndexError):
                    pass
        elif et == "round_start":
            phase_setup = True
            try:
                setup_clock = float(parts[2])
            except ValueError:
                setup_clock = None
        elif et in ("setup_complete", "round_end", "match_end"):
            phase_setup = False
        elif et == "player_stat":
            try:
                key = (parts[4].strip(), normalize_player_name(parts[5].strip()), parts[6].strip())
                sec = float(parts[39])
            except (IndexError, ValueError):
                continue
            if sec > hero_time.get(key, 0.0):
                hero_time[key] = sec
        elif et in ABILITY_EVENT_SLOTS:
            if len(parts) < 6:
                continue
            try:
                game_time = float(parts[2])
            except ValueError:
                continue
            raw_lines += 1
            player = normalize_player_name(parts[4].strip())
            hero = parts[5].strip()
            slot = ABILITY_EVENT_SLOTS[et]
            key = (player, hero, slot, game_time)
            if key in seen:
                dup += 1
                continue
            seen.add(key)
            team = parts[3].strip()
            copy = parts[6].strip() if len(parts) > 6 else ""
            uses.append({
                "player_name": player, "hero_name": hero, "slot": slot, "game_time": game_time,
                "timestamp": max(0, parse_log_timestamp(clean) - 2),
                "team_slot": 1 if team == label1 else 2 if team == label2 else 0,
                # setup_complete 가 빠진 로그에서도 시계가 움직인 줄은 준비 시간으로 보지 않는다
                "is_setup": phase_setup and game_time == setup_clock,
                "copy_hero": copy if copy not in ("", "0") else None,
            })

    rules = _round_rules(parsed)
    for u in uses:
        u["round_no"] = assign_round(u["game_time"], u["is_setup"], rules)

    slot_of = {label1: 1, label2: 2}
    ht = [{"team_slot": slot_of.get(t, 0), "player_name": p, "hero_name": h, "seconds": s}
          for (t, p, h), s in hero_time.items()] if uses else []
    return {"has_log": bool(raw_lines), "raw_lines": raw_lines, "dup_skipped": dup, "uses": uses, "hero_time": ht}
