# -*- coding: utf-8 -*-
"""services/fight_metrics.py — 한타 요약/지표·fightlab 레코드 변환(리팩토링 2단계 분리).

main.py 에서 본문·주석 무변경으로 이동. main.py 는 하위호환을 위해 이 이름들을 re-export.
기존 services/fight_analysis.py(compute_fights/format_fights_for_api)는 무수정, 여기서 import 만.
_build_match_pauses 는 _fight_to_record 의존이라 함께 이동(다른 사용처는 main re-export 로 유지).
의존: config, parsers.log_parser, services.fight_analysis. (main import 금지 — 순환 방지)
"""
from typing import List, Dict, Any
from config import FIGHT_QUIET_GAP_SEC, HERO_ROLE_DATA, TRADE_WINDOW_SEC
from parsers.log_parser import normalize_team_name
from services.fight_analysis import compute_fights

def build_fight_summaries(kill_events: List[Dict[str, Any]], team1: str, team2: str, quiet_gap_sec: int = FIGHT_QUIET_GAP_SEC):
    kills = []
    for ev in kill_events:
        gt = ev.get("game_timestamp", 0)
        kills.append((gt, ev))
    kills.sort(key=lambda x: x[0])

    if not kills: return []

    n_team1 = normalize_team_name(team1)
    n_team2 = normalize_team_name(team2)

    fights = []
    cur = [kills[0][1]]
    last_t = kills[0][0]

    for i in range(1, len(kills)):
        t, ev = kills[i]
        if (t - last_t) <= quiet_gap_sec:
            cur.append(ev)
            last_t = t
        else:
            fights.append(cur)
            cur = [ev]
            last_t = t
    fights.append(cur)

    out = []
    for idx, group in enumerate(fights):
        first = group[0]
        last = group[-1]

        start_game = float(first.get("game_timestamp", 0))
        end_game = float(last.get("game_timestamp", 0))
        start_play = float(first.get("timestamp", start_game))
        end_play = float(last.get("timestamp", end_game))

        t1_deaths = 0
        t2_deaths = 0
        for k in group:
            tgt = normalize_team_name(k.get("target_team", ""))
            if tgt == n_team1:
                t1_deaths += 1
            elif tgt == n_team2:
                t2_deaths += 1

        first_pick_team_raw = first.get("target_team", "")
        last_pick_team_raw = last.get("target_team", "")

        out.append({
            "fight_index": idx + 1,
            "start_game_timestamp": start_game,
            "end_game_timestamp": end_game,
            "start_timestamp": start_play,
            "end_timestamp": end_play,
            "duration_sec": max(0.0, end_game - start_game),
            "team1": team1,
            "team2": team2,
            "team1_deaths": t1_deaths,
            "team2_deaths": t2_deaths,
            "first_pick_team": first_pick_team_raw,
            "last_pick_team": last_pick_team_raw,
            "total_kills": len(group),
            "kills": [{
                "t": float(x.get("timestamp", 0)),
                "gt": float(x.get("game_timestamp", 0)),
                "killer": x.get("player_name", ""),
                "killer_team": x.get("player_team", ""),
                "target": x.get("target_name", ""),
                "target_team": x.get("target_team", ""),
                "ability": x.get("ability", ""),
            } for x in group]
        })
    return out

def compute_fight_metrics(fights: List[Dict[str, Any]], team1: str, team2: str):
    if not fights:
        return {
            "fights": 0, "avg_fight_duration_sec": 0,
            "avg_team1_deaths": 0, "avg_team2_deaths": 0, "avg_total_deaths": 0,
            "first_pick_advantage_rate": None
        }
    n = len(fights)
    sum_dur = 0.0; sum_t1 = 0.0; sum_t2 = 0.0
    fp_cnt = 0; fp_adv = 0
    n_team1 = normalize_team_name(team1)
    n_team2 = normalize_team_name(team2)

    for f in fights:
        sum_dur += float(f.get("duration_sec", 0))
        sum_t1 += float(f.get("team1_deaths", 0))
        sum_t2 += float(f.get("team2_deaths", 0))

        fp_raw = f.get("first_pick_team", "")
        fp = normalize_team_name(fp_raw)
        if fp == n_team1 or fp == n_team2:
            fp_cnt += 1
            fp_deaths = f.get("team1_deaths", 0) if fp == n_team1 else f.get("team2_deaths", 0)
            op_deaths = f.get("team2_deaths", 0) if fp == n_team1 else f.get("team1_deaths", 0)
            if fp_deaths < op_deaths:
                fp_adv += 1

    return {
        "fights": n,
        "avg_fight_duration_sec": sum_dur / n,
        "avg_team1_deaths": sum_t1 / n,
        "avg_team2_deaths": sum_t2 / n,
        "avg_total_deaths": (sum_t1 + sum_t2) / n,
        "first_pick_advantage_rate": (fp_adv / fp_cnt) if fp_cnt > 0 else None
    }

def _build_match_pauses(m: "DBMatch") -> list:
    return [{"start_sec": p.start_sec, "end_sec": p.end_sec, "duration": p.duration}
            for p in (m.pauses or [])]

def _fightlab_hero_role(hero: str) -> str:
    """영웅명 → tank/damage/support/other. 미등록 영웅은 'other'(에러 금지)."""
    if not hero:
        return "other"
    return HERO_ROLE_DATA.get(hero) or HERO_ROLE_DATA.get(hero.strip()) or "other"


def _fightlab_side(team_name: str, t1: str, t2: str) -> int:
    """이벤트의 팀명 → 1/2/0(불명). '1팀'/'Team 1' 별칭 포함(_check_is_* 재사용)."""
    from services.fight_analysis import _check_is_team1, _check_is_team2
    if _check_is_team1(team_name or "", t1):
        return 1
    if _check_is_team2(team_name or "", t2):
        return 2
    return 0


def _fight_to_record(f: dict, our_side: int, t1: str, t2: str,
                     s: "DBSession", m: "DBMatch", map_type: str,
                     round_number=None) -> dict:
    """compute_fights 내부 dict 1개 → /api/fight-records 응답 항목 1개."""
    enemy_side = 2 if our_side == 1 else 1
    our_team = t1 if our_side == 1 else t2
    enemy_team = t2 if our_side == 1 else t1

    # 한타 승자: compute_fights winner(t1/t2/'Draw') → us/them/unknown(무승부=판정 불가)
    winner_name = f.get("winner", "Draw")
    if winner_name == t1:
        fight_winner = "us" if our_side == 1 else "them"
    elif winner_name == t2:
        fight_winner = "us" if our_side == 2 else "them"
    else:
        fight_winner = "unknown"

    kills = [e for e in f.get("events", []) if e.get("event_type") == "kill"]
    ults = [e for e in f.get("events", []) if e.get("event_type") == "ultimate_start"]

    # 첫 킬 (killer 소속이 우리면 첫픽, 상대면 우리 첫데스)
    first_kill = None
    first_kill_traded = False
    first_death_traded = False
    if kills:
        fk = kills[0]
        killer_side = _fightlab_side(fk.get("player_team", ""), t1, t2)
        by = "us" if killer_side == our_side else ("them" if killer_side == enemy_side else "unknown")
        first_kill = {
            "by": by,
            "killer_hero": fk.get("player_hero", ""),
            "killer_name": fk.get("player_name", ""),
            "victim_hero": fk.get("target_hero", ""),
            "victim_name": fk.get("target_name", ""),
            "victim_role": _fightlab_hero_role(fk.get("target_hero", "")),
            "timestamp": fk.get("timestamp", 0),
        }
        fk_ts = fk.get("timestamp", 0)
        for k in kills[1:]:
            if k.get("timestamp", 0) - fk_ts > TRADE_WINDOW_SEC:
                break
            k_side = _fightlab_side(k.get("player_team", ""), t1, t2)
            if by == "us" and k_side == enemy_side:
                first_kill_traded = True   # 우리 첫픽이 5초 내 되갚아짐
            elif by == "them" and k_side == our_side:
                first_death_traded = True  # 우리 첫데스를 5초 내 되갚음
    # 궁극기: 한타 내 ultimate_start 개수/첫 사용 측
    # ults_list: 콤보 분석용 "누가 어떤 궁을 썼는지" 목록(추가 필드 — 기존 필드/집계 무변경).
    #            소속 불명(team 매칭 실패) 이벤트는 기존 개수 집계와 동일하게 제외.
    our_ult_count = 0
    enemy_ult_count = 0
    first_ult_side = "none"
    ults_list = []
    for u in ults:
        u_side = _fightlab_side(u.get("player_team", ""), t1, t2)
        if u_side == our_side:
            our_ult_count += 1
        elif u_side == enemy_side:
            enemy_ult_count += 1
        else:
            continue
        ults_list.append({
            "side": "us" if u_side == our_side else "them",
            "player": u.get("player_name", ""),
            "hero": u.get("player_hero", ""),
            "role": _fightlab_hero_role(u.get("player_hero", "")),
            "timestamp": u.get("timestamp", 0),
        })
        if first_ult_side == "none":
            first_ult_side = "us" if u_side == our_side else "them"

    # 매치(맵) 단위 승패 — 맵 분석 탭용 추가 필드(기존 필드/판정 로직 무수정, 응답 전용 계산).
    # 유효 승자 = winner_override(수기 보정, 팀명) 우선, 없으면 원본 Match.winner.
    # 원본 winner: 승리 팀 "이름" 또는 "Draw". 밀기 등 스코어 이벤트가 없는 로그는 0:0 'Draw'로
    # 저장돼 있어 보정 전까지는 무승부로 집계된다. 미기록(None/빈값)은 null.
    eff_winner = m.winner_override or m.winner
    if not eff_winner:
        match_result = None
    elif eff_winner == "Draw":
        match_result = "draw"
    elif eff_winner == our_team:
        match_result = "win"
    else:
        match_result = "loss"

    return {
        "session_id": s.id,
        "session_date": s.date,
        "match_id": m.id,
        "map_name": m.map_name,
        "map_type": map_type,
        "our_team": our_team,
        "enemy_team": enemy_team,
        "match_result": match_result,
        "match_result_overridden": bool(m.winner_override),
        "our_score": (m.score_t1 if our_side == 1 else m.score_t2) or 0,
        "enemy_score": (m.score_t2 if our_side == 1 else m.score_t1) or 0,
        "fight_winner": fight_winner,
        "first_kill": first_kill,
        "first_kill_traded": first_kill_traded,
        "first_death_traded": first_death_traded,
        "our_ult_count": our_ult_count,
        "enemy_ult_count": enemy_ult_count,
        "first_ult_side": first_ult_side,
        "ults": ults_list,
        "start_timestamp": f.get("startTime", 0),
        # VOD 점프용 필드(추가만 — first-fights의 _first_fight_item과 동일 소스/형식)
        "round_number": round_number,
        "video_url": m.video_url or "",
        "video_offset": m.video_offset or 0,
        "game_setup_sec": m.game_setup_sec,
        "pauses": _build_match_pauses(m),
    }
