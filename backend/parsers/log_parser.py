# -*- coding: utf-8 -*-
"""parsers/log_parser.py — 오버워치 로그 파서 및 맵/팀/시간 헬퍼(리팩토링 2단계 분리).

main.py 에서 본문·주석 무변경으로 이동. main.py 는 하위호환을 위해 이 이름들을 re-export.
역할 점수 헬퍼(get_role_score/get_player_role_score)는 parse_overwatch_log 전용 의존이라 함께 이동
(계획의 1-4 services/stats 배치에서 조정 — 순환 import 방지).
의존: config(게임데이터/맵 상수). sys.path 삽입은 main.py 한 곳에만 유지.
"""
import re
from typing import Any, Optional
from config import (
    KOREAN_HERO_MAP, TANKS, SUPPORTS, PLAYER_ROLE_OVERRIDES,
    CONTROL_MAP_KEYWORDS, MAP_TYPE_DATA, _MAP_TYPE_DATA_NOSPACE, _MATCH_LEVEL_MAP_TYPES,
)

def normalize_team_name(name: str) -> str:
    try:
        return (name or "").strip().lower()
    except:
        return ""

def is_control_map(map_name: str) -> bool:
    mn = (map_name or "").lower()
    for kw in CONTROL_MAP_KEYWORDS:
        if kw.lower() in mn:
            return True
    return False


def resolve_map_type(map_name: str) -> str:
    """map_name -> map_type(쟁탈/화물/혼합/밀기/플래시포인트/격돌/...). 응답 전용 lookup.
    공백 무시 매칭 → is_control_map 폴백 → 그래도 없으면 'Unknown'(안전 기본값)."""
    if not map_name:
        return "Unknown"
    mt = MAP_TYPE_DATA.get(map_name) or _MAP_TYPE_DATA_NOSPACE.get(map_name.replace(" ", ""))
    if mt:
        return mt
    if is_control_map(map_name):
        return "쟁탈"
    return "Unknown"

def is_match_level_map(map_type: str) -> bool:
    """플래시포인트/밀기는 매치 전체에서 첫 한타 1개만. 그 외(Unknown 포함)는 라운드 단위(안전 기본값)."""
    return map_type in _MATCH_LEVEL_MAP_TYPES

def safe_float(x: Any, default: float = 0.0) -> float:
    try:
        return float(x)
    except:
        return default

def time_str_to_seconds(t_str):
    try:
        if not t_str: return 0
        t_str = str(t_str).strip()
        t_str = re.sub(r'[.\-\s]', ':', t_str)
        parts = t_str.split(':')
        if len(parts) == 1:
            return int(parts[0])
        elif len(parts) == 2:
            m = int(parts[0])
            s = int(parts[1])
            return m * 60 + s
        elif len(parts) == 3:
            h = int(parts[0])
            m = int(parts[1])
            s = int(parts[2])
            return h * 3600 + m * 60 + s
        return 0
    except:
        return 0

def parse_log_timestamp(line: str) -> float:
    try:
        if not line.startswith("["):
            return 0.0
        time_part = line.split("]")[0].strip("[")
        return time_str_to_seconds(time_part)
    except:
        return 0.0

def get_role_score(hero_name: str) -> int:
    if hero_name in TANKS: return 0
    if hero_name in SUPPORTS: return 2
    return 1

def get_player_role_score(player_name: str, hero_name: str) -> int:
    if player_name in PLAYER_ROLE_OVERRIDES: return PLAYER_ROLE_OVERRIDES[player_name]
    return get_role_score(hero_name)

def parse_overwatch_log(log_text: str, custom_t1: str = None, custom_t2: str = None):
    log_t1 = "1팀"
    log_t2 = "2팀"
    
    for line in log_text.splitlines():
        if ",match_start," in line:
            parts = line.strip().split(',')
            try:
                base_idx = parts.index("match_start")
                log_t1 = parts[base_idx + 4].strip()
                log_t2 = parts[base_idx + 5].strip()
            except: pass
            break

    def map_team(t_raw):
        t = t_raw.strip()
        if custom_t1 and t == log_t1: return custom_t1
        if custom_t2 and t == log_t2: return custom_t2
        if custom_t1 and t in ["Team 1", "1팀"]: return custom_t1
        if custom_t2 and t in ["Team 2", "2팀"]: return custom_t2
        return t

    raw_rounds_map = {}
    stat_clumps = [] 
    
    events = []
    team_names = set()
    processed_events = set()
    round_scores = {}
    round_attackers = {}

    first_team_name = None
    second_team_name = None
    game_mode = "Unknown"
    map_name = "Unknown"

    match_end_score_t1: Optional[int] = None
    match_end_score_t2: Optional[int] = None
    match_end_winner: Optional[str] = None
    match_end_game_time: Optional[float] = None

    lines = log_text.splitlines()
    for line in lines:
        line = line.replace("****", "kill")
        
        clean_line = line.strip()
        real_timestamp = parse_log_timestamp(clean_line)
        play_timestamp = max(0, real_timestamp - 8)
        parts = clean_line.split(',')
        
        if ",match_start," in clean_line:
            try:
                base_idx = parts.index("match_start")
                # 💡 [버그 픽스] 시간 문자열([00:00:00]) 때문에 발생하는 에러 해결
                game_time = parse_log_timestamp(clean_line)
                map_name = parts[base_idx + 2].strip()
                game_mode = parts[base_idx + 3].strip()
                first_team_name = map_team(parts[base_idx + 4])
                second_team_name = map_team(parts[base_idx + 5])

                events.append({
                    "event_type": "match_start",
                    "timestamp": real_timestamp,
                    "game_timestamp": game_time,
                    "desc": "경기 시작"
                })
            except: pass

        elif ",match_end," in clean_line:
            try:
                base_idx = parts.index("match_end")
                tail = [p.strip() for p in parts[base_idx + 1:]]
                nums = []
                for t in tail:
                    try: nums.append(int(float(t)))
                    except: continue
                if len(nums) >= 2:
                    match_end_score_t1 = nums[-2]
                    match_end_score_t2 = nums[-1]

                if first_team_name and second_team_name:
                    n1 = normalize_team_name(first_team_name)
                    n2 = normalize_team_name(second_team_name)
                    for t in tail:
                        nt = normalize_team_name(map_team(t))
                        if nt == n1: match_end_winner = first_team_name; break
                        if nt == n2: match_end_winner = second_team_name; break
                
                if len(tail) > 0: match_end_game_time = safe_float(tail[0], None)

                events.append({
                    "event_type": "match_end",
                    "timestamp": play_timestamp,
                    "game_timestamp": match_end_game_time if match_end_game_time else 0.0,
                    "winner": match_end_winner,
                    "score_t1": match_end_score_t1,
                    "score_t2": match_end_score_t2
                })
            except: pass

        elif ",round_start," in clean_line:
            try:
                base_idx = parts.index("round_start")
                game_time = float(parts[base_idx + 1])
                r_num = int(float(parts[base_idx + 2]))
                attacker_name = map_team(parts[base_idx + 3])
                round_attackers[r_num] = attacker_name

                events.append({
                    "event_type": "round_start",
                    "timestamp": play_timestamp,
                    "game_timestamp": game_time,
                    "round_number": r_num,
                    "attacker": attacker_name
                })
            except: continue

        elif ",round_end," in clean_line:
            try:
                base_idx = parts.index("round_end")
                game_time = float(parts[base_idx + 1])
                r_num = int(float(parts[base_idx + 2]))
                winner = map_team(parts[base_idx + 3])
                s1 = int(float(parts[base_idx + 4]))
                s2 = int(float(parts[base_idx + 5]))
                round_scores[r_num] = {"t1": s1, "t2": s2, "winner": winner}

                events.append({
                    "event_type": "round_end",
                    "timestamp": play_timestamp,
                    "game_timestamp": game_time,
                    "round_number": r_num,
                    "winner": winner
                })
            except: continue

        elif ",objective_captured," in clean_line or ",point_captured," in clean_line:
            try:
                try: base_idx = parts.index("objective_captured")
                except ValueError: base_idx = parts.index("point_captured")
                
                game_time = float(parts[base_idx + 1])
                capturing_team = map_team(parts[base_idx + 3])

                events.append({
                    "event_type": "objective_captured",
                    "timestamp": play_timestamp,
                    "game_timestamp": game_time,
                    "capturing_team": capturing_team
                })
            except: continue

        elif ",payload_progress," in clean_line:
            try:
                base_idx = parts.index("payload_progress")
                game_time = float(parts[base_idx + 1])
                round_num = int(float(parts[base_idx + 2]))
                team_name = map_team(parts[base_idx + 3])
                # parts[+4]=현재 거점 인덱스, parts[+5]=다음 거점까지 밀어낸 %
                obj_idx = None; obj_pct = None
                try:
                    obj_idx = int(float(parts[base_idx + 4]))
                    obj_pct = float(parts[base_idx + 5])
                except (ValueError, IndexError): pass

                events.append({
                    "event_type": "payload_progress",
                    "timestamp": play_timestamp,
                    "game_timestamp": game_time,
                    "round": round_num,
                    "team": team_name,
                    "prog_idx": obj_idx,
                    "prog_pct": obj_pct
                })
            except: continue

        elif ",point_progress," in clean_line:
            try:
                base_idx = parts.index("point_progress")
                game_time = float(parts[base_idx + 1])
                round_num = int(float(parts[base_idx + 2]))
                team_name = map_team(parts[base_idx + 3])
                # 하이브리드 거점 점령 단계: parts[+4]=거점 인덱스(0), parts[+5]=점령 %
                obj_idx = None; obj_pct = None
                try:
                    obj_idx = int(float(parts[base_idx + 4]))
                    obj_pct = float(parts[base_idx + 5])
                except (ValueError, IndexError): pass

                events.append({
                    "event_type": "point_progress",
                    "timestamp": play_timestamp,
                    "game_timestamp": game_time,
                    "round": round_num,
                    "team": team_name,
                    "prog_idx": obj_idx,
                    "prog_pct": obj_pct
                })
            except: continue

        elif ",objective_updated," in clean_line:
            try:
                base_idx = parts.index("objective_updated")
                game_time = float(parts[base_idx + 1])
                round_num = int(float(parts[base_idx + 2]))
                old_idx = int(float(parts[base_idx + 3]))
                new_idx = int(float(parts[base_idx + 4]))
                events.append({
                    "event_type": "objective_updated",
                    "timestamp": play_timestamp,
                    "game_timestamp": game_time,
                    "round": round_num,
                    "old_index": old_idx,
                    "new_index": new_idx
                })
            except: continue

        elif ",player_stat," in clean_line:
            try:
                base_idx = parts.index("player_stat")
                game_time = float(parts[base_idx + 1])

                p_team = map_team(parts[base_idx + 3])
                p_name = parts[base_idx + 4].strip()
                p_hero_kr = parts[base_idx + 5].strip()
                p_hero_en = KOREAN_HERO_MAP.get(p_hero_kr, p_hero_kr)
                team_names.add(p_team)

                def get_val(idx):
                    try: return float(parts[base_idx + idx])
                    except: return 0.0

                stat_entry = {
                    "team_name": p_team, "player_name": p_name, "hero_name": p_hero_kr, "hero_image": p_hero_en,
                    "slot_index": -1,
                    "eliminations": get_val(6), "final_blows": get_val(7), "deaths": get_val(8),
                    "all_damage_dealt": get_val(9), "barrier_damage_dealt": get_val(10), "hero_damage_dealt": get_val(11),
                    "healing_dealt": get_val(12), "healing_received": get_val(13), "self_healing": get_val(14),
                    "damage_taken": get_val(15), "damage_blocked": get_val(16), "defensive_assists": get_val(17),
                    "offensive_assists": get_val(18), "ultimates_earned": get_val(19), "ultimates_used": get_val(20),
                    "hero_time_played": get_val(38)
                }

                key = (p_team, p_name, p_hero_kr)

                matched_clump = None
                for c in stat_clumps:
                    if abs(c["time"] - game_time) < 45.0:
                        matched_clump = c
                        break
                
                if not matched_clump:
                    matched_clump = {"time": game_time, "stats": {}}
                    stat_clumps.append(matched_clump)
                
                if key in matched_clump["stats"]:
                    existing = matched_clump["stats"][key]
                    if stat_entry["hero_time_played"] >= existing["hero_time_played"]:
                        matched_clump["stats"][key] = stat_entry
                else:
                    matched_clump["stats"][key] = stat_entry

            except: continue

        elif ",kill," in clean_line:
            try:
                base_idx = parts.index("kill")
                game_time = float(parts[base_idx + 1])
                p_name = parts[base_idx + 3].strip()
                p_hero = parts[base_idx + 4].strip()
                t_name = parts[base_idx + 6].strip()
                t_hero = parts[base_idx + 7].strip()
                ability = parts[base_idx + 8].strip()

                event_key = (game_time, "kill", p_name, t_name)
                if event_key in processed_events: continue
                processed_events.add(event_key)

                events.append({
                    "event_type": "kill",
                    "timestamp": play_timestamp,
                    "game_timestamp": game_time,
                    "player_team": map_team(parts[base_idx + 2]),
                    "player_name": p_name, "player_hero": p_hero,
                    "player_hero_img": KOREAN_HERO_MAP.get(p_hero, p_hero),
                    "target_team": map_team(parts[base_idx + 5]),
                    "target_name": t_name, "target_hero": t_hero,
                    "target_hero_img": KOREAN_HERO_MAP.get(t_hero, t_hero),
                    "ability": ability
                })
            except: continue

        elif ",ultimate_start," in clean_line:
            try:
                base_idx = parts.index("ultimate_start")
                game_time = float(parts[base_idx + 1])
                p_name = parts[base_idx + 3].strip()
                p_hero = parts[base_idx + 4].strip()

                event_key = (game_time, "ultimate_start", p_name)
                if event_key in processed_events: continue
                processed_events.add(event_key)

                events.append({
                    "event_type": "ultimate_start",
                    "timestamp": play_timestamp,
                    "game_timestamp": game_time,
                    "player_team": map_team(parts[base_idx + 2]),
                    "player_name": p_name, "player_hero": p_hero,
                    "player_hero_img": KOREAN_HERO_MAP.get(p_hero, p_hero),
                    "ability": "Ultimate"
                })
            except: continue

    valid_clumps = [c for c in stat_clumps if c["time"] > 5.0]
    valid_clumps.sort(key=lambda x: x["time"])
    
    for idx, c in enumerate(valid_clumps):
        raw_rounds_map[idx + 1] = c["stats"]

    if (game_mode == "Unknown" or game_mode == "") and map_name != "Unknown":
        game_mode = MAP_TYPE_DATA.get(map_name, "Unknown")
    if (game_mode == "Unknown" or game_mode == "") and is_control_map(map_name):
        game_mode = "Control"

    # 💡 [버그 픽스] 팀 이름을 알파벳 순서(O2->PF)로 정렬하던 위험한 로직 제거!
    if first_team_name and second_team_name:
        t1, t2 = first_team_name, second_team_name
    else:
        t1 = custom_t1 if custom_t1 else "Team 1"
        t2 = custom_t2 if custom_t2 else "Team 2"

    valid_round_nums = sorted(list(raw_rounds_map.keys()))
    total_rounds_count = len(valid_round_nums) 

    clean_rounds_map = assign_persistent_slots(raw_rounds_map, valid_round_nums)

    return {
        "rounds_stats": clean_rounds_map,
        "events": events,
        "team_1_name": t1,
        "team_2_name": t2,
        "total_rounds": total_rounds_count,
        "round_scores": round_scores,
        "game_mode": game_mode,
        "map_name": map_name,
        "round_attackers": round_attackers,
        "match_end_score_t1": match_end_score_t1,
        "match_end_score_t2": match_end_score_t2,
        "match_end_winner": match_end_winner,
    }

def assign_persistent_slots(raw_rounds_map, valid_round_nums):
    clean_map = {}
    team_slot_history = {}
    last_known_stats = {}
    current_team_players = {}

    for r in valid_round_nums:
        round_data = raw_rounds_map[r]
        clean_map[r] = {}
        current_team_players[r] = {}

        team_players = {}
        for key, stat in round_data.items():
            t_name = stat['team_name']
            if t_name not in team_players:
                team_players[t_name] = []
            team_players[t_name].append(stat)

        for t_name, entries in team_players.items():
            if t_name not in team_slot_history:
                team_slot_history[t_name] = {}
            if t_name not in last_known_stats:
                last_known_stats[t_name] = {}

            player_groups = {}
            for entry in entries:
                p_name = entry['player_name']
                if p_name not in player_groups:
                    player_groups[p_name] = []
                player_groups[p_name].append(entry)

            current_team_players[r][t_name] = set(player_groups.keys())
            used_slots = set()
            unassigned_players = []

            for p_name, p_entries in player_groups.items():
                last_known_stats[t_name][p_name] = [e.copy() for e in p_entries]
                if p_name in team_slot_history[t_name]:
                    slot = team_slot_history[t_name][p_name]
                    used_slots.add(slot)
                    for entry in p_entries:
                        entry['slot_index'] = slot
                        clean_map[r][(t_name, p_name, entry['hero_name'])] = entry
                else:
                    unassigned_players.append((p_name, p_entries))

            def get_rep_hero(entries):
                return max(entries, key=lambda x: x['hero_time_played'])['hero_name']

            unassigned_players.sort(key=lambda x: (get_player_role_score(x[0], get_rep_hero(x[1])), x[0]))

            for p_name, p_entries in unassigned_players:
                rep_hero = get_rep_hero(p_entries)
                role_score = get_player_role_score(p_name, rep_hero)
                preferred_slots = []
                if role_score == 0: preferred_slots = [0, 1, 2, 3, 4]
                elif role_score == 1: preferred_slots = [1, 2, 0, 3, 4]
                else: preferred_slots = [3, 4, 1, 2, 0]

                assigned_slot = -1
                for s in preferred_slots:
                    if s not in used_slots:
                        assigned_slot = s; break
                if assigned_slot == -1:
                    assigned_slot = 5
                    while assigned_slot in used_slots: assigned_slot += 1

                team_slot_history[t_name][p_name] = assigned_slot
                used_slots.add(assigned_slot)
                last_known_stats[t_name][p_name] = [e.copy() for e in p_entries]
                for entry in p_entries:
                    entry['slot_index'] = assigned_slot
                    clean_map[r][(t_name, p_name, entry['hero_name'])] = entry

        for t_name, history in team_slot_history.items():
            present = set()
            if t_name in current_team_players[r]:
                present = current_team_players[r][t_name]
            for p_name, slot in history.items():
                if p_name not in present:
                    if t_name in last_known_stats and p_name in last_known_stats[t_name]:
                        ghost_entries = last_known_stats[t_name][p_name]
                        for g_entry in ghost_entries:
                            new_ghost = g_entry.copy()
                            new_ghost['slot_index'] = slot
                            clean_map[r][(t_name, p_name, new_ghost['hero_name'])] = new_ghost
    return clean_map
