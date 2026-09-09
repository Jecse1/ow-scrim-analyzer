"""
1:1 Python port of frontend/src/utils/fightAnalysis.js computeFights().
DO NOT diverge from the JS logic — both must produce identical fight groupings.
"""

INITIAL_WINDOW = 20
KILL_EXTENSION = 10


def _check_is_team1(team_name: str, t1_name: str) -> bool:
    if not team_name:
        return False
    if team_name == t1_name:
        return True
    return team_name in ("1팀", "Team 1")


def _check_is_team2(team_name: str, t2_name: str) -> bool:
    if not team_name:
        return False
    if team_name == t2_name:
        return True
    return team_name in ("2팀", "Team 2")


def compute_fights(events: list, t1_name: str, t2_name: str) -> list:
    """
    Port of fightAnalysis.js computeFights().

    events: list of event dicts (event_type, timestamp, player_team, target_team,
            target_name, target_hero, ability, game_timestamp, ...)
    Returns internal fight dicts (not yet formatted for API).
    """
    fights = []
    cur_f = None

    for ev in sorted(events, key=lambda e: e.get("timestamp", 0)):
        et = ev.get("event_type")
        if et not in ("kill", "ultimate_start"):
            continue

        ts = ev.get("timestamp", 0)

        if cur_f is None or ts > cur_f["fixedEndTime"]:
            if cur_f is not None:
                evs = cur_f["events"]
                cur_f["duration_sec"] = evs[-1]["timestamp"] - evs[0]["timestamp"]
                fights.append(cur_f)
            cur_f = {
                "startTime": ts,
                "fixedEndTime": ts + INITIAL_WINDOW,
                "events": [ev],
                "t1Kills": 0,
                "t2Kills": 0,
                "team1_deaths": 0,
                "team2_deaths": 0,
                "first_pick_team": None,
                "first_pick_player": None,
                "first_pick_hero": None,
                "first_pick_event": None,
            }
        else:
            cur_f["events"].append(ev)

        if et == "kill":
            if cur_f["first_pick_team"] is None:
                cur_f["first_pick_team"] = ev.get("target_team")
                cur_f["first_pick_player"] = ev.get("target_name")
                cur_f["first_pick_hero"] = ev.get("target_hero")
                cur_f["first_pick_event"] = ev

            if _check_is_team1(ev.get("player_team", ""), t1_name):
                cur_f["t1Kills"] += 1
            elif _check_is_team2(ev.get("player_team", ""), t2_name):
                cur_f["t2Kills"] += 1

            if _check_is_team1(ev.get("target_team", ""), t1_name):
                cur_f["team1_deaths"] += 1
            elif _check_is_team2(ev.get("target_team", ""), t2_name):
                cur_f["team2_deaths"] += 1

            cur_f["fixedEndTime"] = max(cur_f["fixedEndTime"], ts + KILL_EXTENSION)

    if cur_f is not None:
        evs = cur_f["events"]
        cur_f["duration_sec"] = evs[-1]["timestamp"] - evs[0]["timestamp"]
        fights.append(cur_f)

    for f in fights:
        t1_survivors = max(0, 5 - f["team1_deaths"])
        t2_survivors = max(0, 5 - f["team2_deaths"])
        if t1_survivors > t2_survivors:
            f["winner"] = t1_name
        elif t2_survivors > t1_survivors:
            f["winner"] = t2_name
        else:
            f["winner"] = "Draw"

    return fights


def format_fights_for_api(fights: list, t1_name: str, t2_name: str) -> list:
    """Convert internal fight dicts (from compute_fights) to API response format."""
    result = []
    for idx, f in enumerate(fights):
        all_evs = f.get("events", [])
        kills = [e for e in all_evs if e.get("event_type") == "kill"]
        last_kill = kills[-1] if kills else None
        start_ts = f["startTime"]
        end_ts = all_evs[-1].get("timestamp", start_ts) if all_evs else start_ts
        start_gt = all_evs[0].get("game_timestamp", 0) if all_evs else 0
        end_gt = all_evs[-1].get("game_timestamp", 0) if all_evs else 0

        result.append({
            "fight_index": idx + 1,
            "start_timestamp": start_ts,
            "end_timestamp": end_ts,
            "start_game_timestamp": start_gt,
            "end_game_timestamp": end_gt,
            "duration_sec": f.get("duration_sec", 0),
            "team1": t1_name,
            "team2": t2_name,
            "team1_deaths": f["team1_deaths"],
            "team2_deaths": f["team2_deaths"],
            "total_kills": len(kills),
            "first_pick_team": f.get("first_pick_team"),
            "last_pick_team": last_kill.get("target_team") if last_kill else None,
            "winner": f.get("winner", "Draw"),
            "kills": [
                {
                    "t": float(e.get("timestamp", 0)),
                    "gt": float(e.get("game_timestamp", 0)),
                    "killer": e.get("player_name", ""),
                    "killer_team": e.get("player_team", ""),
                    "target": e.get("target_name", ""),
                    "target_team": e.get("target_team", ""),
                    "ability": e.get("ability", ""),
                }
                for e in kills
            ],
        })
    return result


def compute_fight_metrics(fights: list, t1_name: str, t2_name: str) -> dict:
    """Compute aggregate fight_metrics from a list of formatted fight dicts."""
    if not fights:
        return {
            "fights": 0,
            "avg_fight_duration_sec": 0,
            "avg_team1_deaths": 0,
            "avg_team2_deaths": 0,
            "avg_total_deaths": 0,
            "first_pick_advantage_rate": None,
        }

    n = len(fights)
    sum_dur = sum_t1 = sum_t2 = 0.0
    fp_cnt = fp_adv = 0

    for f in fights:
        sum_dur += f.get("duration_sec", 0)
        t1d = f.get("team1_deaths", 0)
        t2d = f.get("team2_deaths", 0)
        sum_t1 += t1d
        sum_t2 += t2d

        fp_team = f.get("first_pick_team") or ""
        is_t1_fp = _check_is_team1(fp_team, t1_name)
        is_t2_fp = _check_is_team2(fp_team, t2_name)
        if is_t1_fp or is_t2_fp:
            fp_cnt += 1
            fp_deaths = t1d if is_t1_fp else t2d
            op_deaths = t2d if is_t1_fp else t1d
            if fp_deaths < op_deaths:
                fp_adv += 1

    return {
        "fights": n,
        "avg_fight_duration_sec": sum_dur / n,
        "avg_team1_deaths": sum_t1 / n,
        "avg_team2_deaths": sum_t2 / n,
        "avg_total_deaths": (sum_t1 + sum_t2) / n,
        "first_pick_advantage_rate": (fp_adv / fp_cnt) if fp_cnt > 0 else None,
    }
