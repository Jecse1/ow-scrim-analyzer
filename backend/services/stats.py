# -*- coding: utf-8 -*-
"""services/stats.py — 순수 통계 계산(리팩토링 2단계 분리). 본문 무변경(이동/추출만).

calculate_pure_stats: main 에서 verbatim 이동.
compute_player_fight_stats: /api/player-fight-stats 라우터의 계산부를 함수로 추출
  (입력=로드된 sessions ORM 리스트 + base_team, 출력=items dict; 라우터는 호출 1줄만 남김).
의존: config, parsers.log_parser, serializers, services.fight_analysis, services.fight_metrics.
  (main import 금지 — 순환 방지)
"""
from config import NUMERIC_FIELDS, KOREAN_HERO_MAP
from parsers.log_parser import normalize_team_name
from serializers import _db_event_to_dict
from services.fight_analysis import compute_fights
from services.fight_metrics import (
    build_fight_summaries, compute_fight_metrics, _fightlab_side, _fightlab_hero_role,
)

def calculate_pure_stats(parsed, target_match, match_label=""):
    rounds_map = parsed["rounds_stats"]
    total_rounds = parsed["total_rounds"]
    round_scores = parsed.get("round_scores", {})
    game_mode = parsed.get("game_mode", "")
    map_name = parsed.get("map_name", "")
    round_attackers = parsed.get("round_attackers", {})

    team1 = parsed["team_1_name"]
    team2 = parsed["team_2_name"]
    n_team1 = normalize_team_name(team1)
    n_team2 = normalize_team_name(team2)

    final_t1_score = 0
    final_t2_score = 0
    
    score_match_end_t1 = parsed.get("match_end_score_t1")
    score_match_end_t2 = parsed.get("match_end_score_t2")
    
    score_round_end_t1 = 0
    score_round_end_t2 = 0
    if round_scores:
        max_r = max(round_scores.keys())
        score_round_end_t1 = round_scores[max_r].get("t1", 0)
        score_round_end_t2 = round_scores[max_r].get("t2", 0)
        
    score_round_wins_t1 = 0
    score_round_wins_t2 = 0
    for r_data in round_scores.values():
        r_w = normalize_team_name(r_data.get("winner", ""))
        if r_w == n_team1: score_round_wins_t1 += 1
        elif r_w == n_team2: score_round_wins_t2 += 1
        
    score_obj_t1 = 0
    score_obj_t2 = 0
    for r_num in range(1, total_rounds + 1):
        attacker = normalize_team_name(round_attackers.get(r_num, ""))
        max_idx = 0
        for ev in parsed["events"]:
            if ev.get("event_type") == "objective_updated" and ev.get("round") == r_num:
                idx = ev.get("new_index", 0)
                if idx > max_idx:
                    max_idx = idx
        if attacker == n_team1: score_obj_t1 += max_idx
        elif attacker == n_team2: score_obj_t2 += max_idx

    is_push = any(k in map_name for k in ["밀기", "Push", "에스페란사", "이스페란사", "뉴 퀸", "콜로세오", "룬아사피", "루나사피"])
    has_payload = any(e.get("event_type") == "payload_progress" for e in parsed["events"])
    is_hybrid_escort = has_payload or any(k in game_mode for k in ["Escort", "화물", "Hybrid", "혼합"])

    # [방어] 혼합·호위에서 round_start(공격 시작)는 있으나 대응 round_end(라운드 종료)가 없는
    #   라운드를 경고한다(추가 라운드 로그 일부 유실 등). 판정 로직 무변경 — 로그만 남긴다.
    #   플래시포인트/쟁탈은 라운드 표기 체계가 달라(시작 1 · 종료 6 등) 제외한다.
    if is_hybrid_escort:
        _missing_end = sorted(r for r in round_attackers.keys() if r not in round_scores)
        if _missing_end:
            _lbl = f"{match_label} " if match_label else ""
            print(f"[WARN] 라운드 종료 누락 {_lbl}map={map_name!r} teams={team1}/{team2} "
                  f"round_start_only={_missing_end}")

    if is_push:
        final_t1_score = 0
        final_t2_score = 0
    elif is_hybrid_escort:
        final_t1_score = score_obj_t1
        final_t2_score = score_obj_t2
    else:
        # 💡 [버그 픽스] match_end 점수가 0점일 때 False로 처리되는 현상 방지 (is not None 사용)
        if score_match_end_t1 is not None and score_match_end_t2 is not None:
            final_t1_score = score_match_end_t1
            final_t2_score = score_match_end_t2
        elif score_round_end_t1 > 0 or score_round_end_t2 > 0:
            final_t1_score = score_round_end_t1
            final_t2_score = score_round_end_t2
        else:
            final_t1_score = score_round_wins_t1
            final_t2_score = score_round_wins_t2

    target_match["score_t1"] = final_t1_score
    target_match["score_t2"] = final_t2_score

    # ── 동점 타이브레이커(하이브리드·호위 전용) ──────────────────────────────
    # 이 로그는 스크림(OW 워크숍)이라 팀이 끝까지 못 밀어도 다음 팀의 풀맵 연습을 위해
    # 점수를 강제로 3점 등으로 보정한다 → match_end/round_end 점수가 실제 승부를 안 나타낼 수 있다.
    # 규칙:
    #   · 타이브레이커 라운드까지 치러진 경우(라운드 수 > 2): 게임이 실제로 승부를 냈으므로
    #     match_end 최종 점수로 판정(예: 4:5, 3:4). match_end도 동점이면 진짜 무승부.
    #   · 본공격만 있고(라운드 수 == 2) 부분 밀기로 끝난 경우: match_end는 워크숍 보정으로 가짜이므로
    #     실측 진행도(거점 인덱스 → 거리/점령 %)가 더 큰 팀이 승자. 동일하면 무승부.
    #   · 어느 쪽으로도 못 가리면 무승부 → 밀기맵과 동일하게 winner_override로 수기 보정.
    tiebreak_note = ""
    progress_winner = None
    if final_t1_score == final_t2_score and is_hybrid_escort:
        num_rounds = len(round_attackers)
        if num_rounds > 2:
            # 타이브레이커 라운드가 치러짐 → match_end 최종 점수가 실제 승부 결과
            if (score_match_end_t1 is not None and score_match_end_t2 is not None
                    and score_match_end_t1 != score_match_end_t2):
                final_t1_score = score_match_end_t1
                final_t2_score = score_match_end_t2
                target_match["score_t1"] = final_t1_score
                target_match["score_t2"] = final_t2_score
        else:
            # 본공격만(라운드 2) 부분 밀기 → 실측 진행도로 더 멀리 민 팀이 승자
            def _max_progress(n_team):
                best = (0, 0.0)
                for ev in parsed["events"]:
                    if ev.get("event_type") not in ("payload_progress", "point_progress"):
                        continue
                    if normalize_team_name(ev.get("team", "")) != n_team:
                        continue
                    cur = (ev.get("prog_idx") or 0, ev.get("prog_pct") or 0.0)
                    if cur > best:
                        best = cur
                return best
            prog1 = _max_progress(n_team1)
            prog2 = _max_progress(n_team2)
            if prog1 != prog2:
                progress_winner = team1 if prog1 > prog2 else team2
                wp, lp = (prog1, prog2) if prog1 > prog2 else (prog2, prog1)
                tiebreak_note = f", 진행도 우세: {wp[0]}거점 통과 후 {wp[1]:.0f}% vs {lp[0]}거점 통과 후 {lp[1]:.0f}%"

    if final_t1_score > final_t2_score:
        match_winner = team1
        target_match["result"] = f"{team1} 승 ({final_t1_score} : {final_t2_score})"
    elif final_t2_score > final_t1_score:
        match_winner = team2
        target_match["result"] = f"{team2} 승 ({final_t1_score} : {final_t2_score})"
    elif progress_winner:
        match_winner = progress_winner
        target_match["result"] = f"{progress_winner} 승 ({final_t1_score} : {final_t2_score}{tiebreak_note})"
    else:
        match_winner = "Draw"
        target_match["result"] = f"무승부 ({final_t1_score} : {final_t2_score})"
        
    target_match["winner"] = match_winner

    round_end_times = {}
    for r in range(1, total_rounds + 1):
        max_t = 0
        for stat in rounds_map.get(r, {}).values():
            if stat['hero_time_played'] > max_t:
                max_t = stat['hero_time_played']
        round_end_times[r] = max_t

    player_snapshots = {}
    player_snapshots[0] = {}

    for r in range(1, total_rounds + 1):
        player_snapshots[r] = {}
        for p_key, heroes_map in player_snapshots[r - 1].items():
            player_snapshots[r][p_key] = {h: s.copy() for h, s in heroes_map.items()}

        current_logs = rounds_map.get(r, {})
        for key, log_stat in current_logs.items():
            t_name, p_name, h_name = key
            p_key = (t_name, p_name)
            if p_key not in player_snapshots[r]:
                player_snapshots[r][p_key] = {}
            player_snapshots[r][p_key][h_name] = log_stat.copy()

    actual_rounds_temp = []
    for r in range(1, total_rounds + 1):
        pure_round_stats = []
        r_fb_t1, r_fb_t2 = 0, 0

        prev_time = round_end_times.get(r - 1, 0)
        curr_time = round_end_times.get(r, 0)
        pure_duration = max(0, curr_time - prev_time)

        round_events = []
        for ev in parsed["events"]:
            t = ev.get("game_timestamp", 0)
            if r == 1:
                if t <= curr_time: round_events.append(ev)
            else:
                if prev_time < t <= curr_time: round_events.append(ev)

        r_winner = round_scores.get(r, {}).get("winner", "Unknown")
        round_kills = [e for e in round_events if e.get("event_type") == "kill"]
        round_fights = build_fight_summaries(round_kills, team1, team2)

        for p_key, heroes_map in player_snapshots[r].items():
            team_name, player_name = p_key
            curr_total = {f: 0.0 for f in NUMERIC_FIELDS}
            main_hero = "Unknown"
            max_pure_time = -1
            main_hero_img = ""

            for h_name, stat in heroes_map.items():
                for f in NUMERIC_FIELDS:
                    curr_total[f] += stat.get(f, 0)

            prev_heroes_map = player_snapshots[r - 1].get(p_key, {})
            prev_total = {f: 0.0 for f in NUMERIC_FIELDS}
            for h_name, stat in prev_heroes_map.items():
                for f in NUMERIC_FIELDS:
                    prev_total[f] += stat.get(f, 0)

            pure_stat = {}
            has_data = False
            for f in NUMERIC_FIELDS:
                diff = curr_total[f] - prev_total[f]
                pure_stat[f] = max(0, diff)
                if pure_stat[f] > 0: has_data = True

            for h_name, curr_h_stat in heroes_map.items():
                prev_h_stat = prev_heroes_map.get(h_name, {})
                pure_h_time = max(0, curr_h_stat.get('hero_time_played', 0) - prev_h_stat.get('hero_time_played', 0))
                if pure_h_time > max_pure_time:
                    max_pure_time = pure_h_time
                    main_hero = h_name
                    main_hero_img = curr_h_stat.get('hero_image', '')

            if has_data or pure_stat['hero_time_played'] > 0:
                final_entry = pure_stat
                final_entry['team_name'] = team_name
                final_entry['player_name'] = player_name
                final_entry['hero_name'] = main_hero
                final_entry['hero_image'] = main_hero_img
                any_hero_stat = next(iter(heroes_map.values()))
                final_entry['slot_index'] = any_hero_stat.get('slot_index', -1)

                pure_round_stats.append(final_entry)
                if normalize_team_name(team_name) == n_team1:
                    r_fb_t1 += final_entry["final_blows"]
                else:
                    r_fb_t2 += final_entry["final_blows"]

        actual_rounds_temp.append({
            "round_number": r,
            "stats": pure_round_stats,
            "events": round_events,
            "final_blows_t1": r_fb_t1,
            "final_blows_t2": r_fb_t2,
            "duration_sec": pure_duration,
            "winner": r_winner,
            "fights": round_fights
        })

    actual_rounds = []
    for r_data in actual_rounds_temp:
        if r_data["duration_sec"] < 15.0 and len(actual_rounds) >= 1:
            continue
        r_data["round_number"] = len(actual_rounds) + 1
        actual_rounds.append(r_data)
        
    target_match["rounds"] = actual_rounds

    total_stats_map = {}
    for round_data in actual_rounds:
        for stat in round_data["stats"]:
            key = (stat["team_name"], stat["player_name"])
            if key not in total_stats_map:
                total_stats_map[key] = {"base": stat.copy(), "play_times": {}}
                for f in NUMERIC_FIELDS:
                    total_stats_map[key]["base"][f] = 0

            for f in NUMERIC_FIELDS:
                total_stats_map[key]["base"][f] += stat.get(f, 0)

            h_name = stat["hero_name"]
            if h_name not in total_stats_map[key]["play_times"]:
                total_stats_map[key]["play_times"][h_name] = 0
            total_stats_map[key]["play_times"][h_name] += stat.get("hero_time_played", 0)

    final_total_stats = []
    for agg in total_stats_map.values():
        stat_entry = agg["base"]
        best_h = max(agg["play_times"], key=agg["play_times"].get) if agg["play_times"] else "Unknown"
        stat_entry["hero_name"] = best_h
        stat_entry["hero_image"] = KOREAN_HERO_MAP.get(best_h, best_h)
        final_total_stats.append(stat_entry)

    target_match["stats"] = final_total_stats
    target_match["team_1_name"] = team1
    target_match["team_2_name"] = team2
    target_match["total_final_blows_t1"] = sum(r["final_blows_t1"] for r in actual_rounds)
    target_match["total_final_blows_t2"] = sum(r["final_blows_t2"] for r in actual_rounds)
    target_match["timeline"] = {"duration_sec": round_end_times.get(total_rounds, 0)}

    match_kills = [e for e in parsed["events"] if e.get("event_type") == "kill"]
    fights = build_fight_summaries(match_kills, team1, team2)
    target_match["fights"] = fights
    target_match["fight_metrics"] = compute_fight_metrics(fights, team1, team2)

    return target_match


def compute_player_fight_stats(sessions, base_team):
    """[split] /api/player-fight-stats 계산부 이동. 입력: sessions(ORM), base_team. 출력: items dict."""
    items: dict = {}  # (match_id, player, hero, side_num) -> acc dict

    def get_acc(m, s, our_side, pn, hn, side_num):
        key = (m.id, pn, hn, side_num)
        if key not in items:
            items[key] = {
                "session_id": s.id, "session_date": s.date, "match_id": m.id,
                "map_name": m.map_name,
                "our_team": m.team1_name if our_side == 1 else m.team2_name,
                "enemy_team": m.team2_name if our_side == 1 else m.team1_name,
                "side": "us" if side_num == our_side else "them",
                "player_name": pn, "hero": hn,
                "role": _fightlab_hero_role(hn),
                # 한타 지표(이벤트 기반)
                "fights": 0, "kp_sum": 0.0, "kp_fights": 0,
                "first_kills": 0, "first_deaths": 0,
                "ult_uses": 0, "ult_fights": 0, "ult_fight_wins": 0, "ult_fight_known": 0,
                # 라운드 지표(player_stats 기반)
                "rounds": 0, "duration_sec": 0.0, "hero_time": 0.0,
                "final_blows": 0.0, "deaths": 0.0,
                "hero_damage": 0.0, "healing": 0.0, "ults_used": 0.0,
            }
        return items[key]

    for s in sessions:
        for m in (s.matches or []):
            if m.deleted_at is not None:
                continue
            t1, t2 = m.team1_name, m.team2_name
            if t1 == base_team:
                our_side = 1
            elif t2 == base_team:
                our_side = 2
            else:
                continue
            for r in (m.rounds or []):
                ev_dicts = [_db_event_to_dict(ev) for ev in (r.events or [])]
                fights = compute_fights(ev_dicts, t1, t2)

                # 한타별 사전 계산: 킬 이벤트 / (선수,영웅)별 킬 수 / 승자 측 / 궁 사용자
                fight_pre = []
                for f in fights:
                    kills = [e for e in f.get("events", []) if e.get("event_type") == "kill"]
                    per_kills: dict = {}
                    for k in kills:
                        pk = (k.get("player_name", ""), k.get("player_hero", ""),
                              _fightlab_side(k.get("player_team", ""), t1, t2))
                        per_kills[pk] = per_kills.get(pk, 0) + 1
                    winner_name = f.get("winner", "Draw")
                    win_side = 1 if winner_name == t1 else 2 if winner_name == t2 else 0
                    ult_events = [e for e in f.get("events", []) if e.get("event_type") == "ultimate_start"]
                    fight_pre.append({
                        "kills": kills, "per_kills": per_kills,
                        "t1_kills": f.get("t1Kills", 0), "t2_kills": f.get("t2Kills", 0),
                        "win_side": win_side, "ults": ult_events,
                    })

                # (1) 출전(=player_stats 엔트리) 기반: 한타 수·킬 관여율·라운드 지표
                dur = r.duration_sec if (r.duration_sec is not None and r.duration_sec > 0) else None
                for ps in (r.player_stats or []):
                    pn, hn = ps.player_name or "", ps.hero_name or ""
                    if not pn or pn == "Unknown":
                        continue
                    side_num = _fightlab_side(ps.team_name or "", t1, t2)
                    if side_num == 0:
                        continue
                    acc = get_acc(m, s, our_side, pn, hn, side_num)
                    # 라운드 지표 (duration 없는 라운드는 표본 제외)
                    if dur is not None:
                        acc["rounds"] += 1
                        acc["duration_sec"] += dur
                        acc["final_blows"] += ps.final_blows or 0
                        acc["deaths"] += ps.deaths or 0
                        acc["hero_damage"] += ps.hero_damage_dealt or 0
                        acc["healing"] += ps.healing_dealt or 0
                        acc["ults_used"] += ps.ultimates_used or 0
                    acc["hero_time"] += ps.hero_time_played or 0
                    # 한타 수 + 킬 관여율
                    acc["fights"] += len(fight_pre)
                    for fp in fight_pre:
                        team_kills = fp["t1_kills"] if side_num == 1 else fp["t2_kills"]
                        if team_kills > 0:
                            acc["kp_fights"] += 1
                            acc["kp_sum"] += fp["per_kills"].get((pn, hn, side_num), 0) / team_kills

                # (2) 이벤트 기반: 첫 킬/첫데스/궁
                for fp in fight_pre:
                    if fp["kills"]:
                        fk = fp["kills"][0]
                        k_side = _fightlab_side(fk.get("player_team", ""), t1, t2)
                        if k_side and fk.get("player_name"):
                            get_acc(m, s, our_side, fk["player_name"], fk.get("player_hero", ""), k_side)["first_kills"] += 1
                        v_side = _fightlab_side(fk.get("target_team", ""), t1, t2)
                        if v_side and fk.get("target_name"):
                            get_acc(m, s, our_side, fk["target_name"], fk.get("target_hero", ""), v_side)["first_deaths"] += 1
                    ult_users = set()
                    for u in fp["ults"]:
                        u_side = _fightlab_side(u.get("player_team", ""), t1, t2)
                        if u_side == 0 or not u.get("player_name"):
                            continue
                        acc = get_acc(m, s, our_side, u["player_name"], u.get("player_hero", ""), u_side)
                        acc["ult_uses"] += 1
                        ult_users.add((u["player_name"], u.get("player_hero", ""), u_side))
                    for (pn, hn, u_side) in ult_users:
                        acc = get_acc(m, s, our_side, pn, hn, u_side)
                        acc["ult_fights"] += 1
                        if fp["win_side"] != 0:
                            acc["ult_fight_known"] += 1
                            if fp["win_side"] == u_side:
                                acc["ult_fight_wins"] += 1
    return items
