# -*- coding: utf-8 -*-
"""serializers.py — DB ORM → dict 직렬화(리팩토링 2단계 분리). 본문 무변경(이동만).

main.py 에서 이동. main.py 는 하위호환을 위해 이 이름들을 re-export 한다.
의존: config.NUMERIC_FIELDS, services.fight_analysis(compute_fights/format_fights_for_api/compute_fight_metrics).
DB 모델은 문자열 애노테이션("DBEvent" 등)이라 런타임 import 불필요.
"""
from config import NUMERIC_FIELDS
from services.fight_analysis import (
    compute_fights,
    format_fights_for_api,
    compute_fight_metrics as fa_compute_fight_metrics,
)

def _db_event_to_dict(ev: "DBEvent") -> dict:
    d: dict = {
        "event_type": ev.event_type,
        "timestamp": ev.timestamp,
        "game_timestamp": ev.game_timestamp if ev.game_timestamp is not None else 0,
    }
    et = ev.event_type
    if et in ("kill", "ultimate_start"):
        d.update({
            "player_name": ev.player_name or "",
            "player_team": ev.player_team or "",
            "player_hero": ev.player_hero or "",
            "player_hero_img": ev.player_hero_img or "",
            "ability": ev.ability or "",
        })
        if et == "kill":
            d.update({
                "target_name": ev.target_name or "",
                "target_team": ev.target_team or "",
                "target_hero": ev.target_hero or "",
                "target_hero_img": ev.target_hero_img or "",
            })
    elif et == "round_start":
        d.update({"round_number": ev.round_number, "attacker": ev.attacker or ""})
    elif et == "round_end":
        d.update({"round_number": ev.round_number, "winner": ev.winner or ""})
    elif et == "match_start":
        d["desc"] = ev.description or ""  # frontend expects "desc" key
    elif et == "match_end":
        d.update({"winner": ev.winner or "", "score_t1": ev.score_t1, "score_t2": ev.score_t2})
    elif et == "objective_captured":
        d["capturing_team"] = ev.capturing_team or ""
    elif et == "objective_updated":
        d.update({"new_index": ev.new_index, "old_index": ev.old_index})
    elif et in ("payload_progress", "point_progress"):
        d["team"] = ev.team or ""
    return d


def _db_player_stat_to_dict(ps: "DBPlayerStat") -> dict:
    return {
        "team_name": ps.team_name,
        "player_name": ps.player_name,
        "hero_name": ps.hero_name,
        "hero_image": ps.hero_image or "",
        "slot_index": ps.slot_index if ps.slot_index is not None else -1,
        **{f: getattr(ps, f) or 0 for f in NUMERIC_FIELDS},
    }


def _db_round_to_dict(r: "DBRound", t1_name: str = "", t2_name: str = "") -> dict:
    events = [_db_event_to_dict(ev) for ev in (r.events or [])]
    round_fights = format_fights_for_api(compute_fights(events, t1_name, t2_name), t1_name, t2_name)
    return {
        "round_number": r.round_number,
        "winner": r.winner or "",
        "duration_sec": r.duration_sec or 0,
        "final_blows_t1": r.final_blows_t1 or 0,
        "final_blows_t2": r.final_blows_t2 or 0,
        "stats": [_db_player_stat_to_dict(ps) for ps in (r.player_stats or [])],
        "events": events,
        "fights": round_fights,
    }


def _aggregate_match_stats(m: "DBMatch") -> list:
    """(player_name, team_name) 기준으로 매치 전체 PlayerStat 합산.
    한 선수가 여러 영웅을 플레이해도 한 행. 대표 영웅은 가장 오래 플레이한 영웅."""
    grouped: dict = {}
    for rnd in (m.rounds or []):
        for ps in (rnd.player_stats or []):
            key = (ps.player_name, ps.team_name)
            if key not in grouped:
                grouped[key] = {
                    "player_name": ps.player_name,
                    "team_name": ps.team_name,
                    "slot_index": ps.slot_index if ps.slot_index is not None else -1,
                    "hero_name": ps.hero_name,
                    "hero_image": ps.hero_image or "",
                    "heroes_played": [],
                    **{f: 0.0 for f in NUMERIC_FIELDS},
                }
            for f in NUMERIC_FIELDS:
                grouped[key][f] += getattr(ps, f) or 0
            heroes = grouped[key]["heroes_played"]
            existing = next((h for h in heroes if h["hero_name"] == ps.hero_name), None)
            if existing:
                existing["hero_time_played"] += ps.hero_time_played or 0
            else:
                heroes.append({
                    "hero_name": ps.hero_name,
                    "hero_image": ps.hero_image or "",
                    "hero_time_played": ps.hero_time_played or 0,
                })

    for v in grouped.values():
        if v["heroes_played"]:
            top = max(v["heroes_played"], key=lambda h: h["hero_time_played"])
            v["hero_name"] = top["hero_name"]
            v["hero_image"] = top["hero_image"]
            v["heroes_played"].sort(key=lambda h: -h["hero_time_played"])

    return list(grouped.values())


def _db_match_to_dict(m: "DBMatch", *, full: bool = False) -> dict:
    """full=False → 경량 (no rounds/stats), /api/scrims list 용.
    full=True  → 완전 (rounds+stats+events 포함), /api/scrims와 /api/matches/{id} 용."""
    dur = m.duration_sec or 0
    base = {
        "id": m.id,
        "match_index": m.match_index,
        "map_name": m.map_name,
        "team1_name": m.team1_name,
        "team2_name": m.team2_name,
        "team_1_name": m.team1_name,
        "team_2_name": m.team2_name,
        # winner = 유효 승자(수기 보정 우선). 원본/보정은 별도 필드로 구분 노출.
        "winner": (m.winner_override or m.winner) or "",
        "winner_original": m.winner or "",
        "winner_override": m.winner_override or "",
        "score_t1": m.score_t1 or 0,
        "score_t2": m.score_t2 or 0,
        # result도 유효 승자 기준: 보정이 있으면 "{팀} 승 (a : b)" (calculate_pure_stats와 동일 형식).
        # 스코어는 원본 그대로 유지(밀기 미기록이면 0 : 0) — DB의 result 원본 문자열은 무변경.
        "result": (f"{m.winner_override} 승 ({m.score_t1 or 0} : {m.score_t2 or 0})"
                   if m.winner_override else (m.result or "")),
        "video_url": m.video_url or "",
        "video_offset": m.video_offset or 0,
        "game_setup_sec": m.game_setup_sec,  # None = 기존 매치 (옛날 방식)
        "duration_sec": dur,
        "total_final_blows_t1": m.total_final_blows_t1 or 0,
        "total_final_blows_t2": m.total_final_blows_t2 or 0,
        "pauses": [{"start_sec": p.start_sec, "end_sec": p.end_sec, "duration": p.duration} for p in (m.pauses or [])],
        "rounds": [], "stats": [], "fights": [], "fight_metrics": {},
        "timeline": {"duration_sec": dur},
    }
    if full:
        t1, t2 = m.team1_name, m.team2_name
        base["rounds"] = [_db_round_to_dict(r, t1, t2) for r in (m.rounds or [])]
        base["stats"] = _aggregate_match_stats(m)
        # Compute duration from rounds (DB column may be 0 due to import bug)
        round_dur = sum(r.duration_sec or 0 for r in (m.rounds or []))
        if round_dur > 0:
            base["duration_sec"] = round_dur
            base["timeline"] = {"duration_sec": round_dur}
        # Compute match-level fights from all events across rounds
        all_events = [ev for rnd in (m.rounds or []) for ev in (rnd.events or [])]
        all_events_dicts = [_db_event_to_dict(ev) for ev in all_events]
        match_fights_raw = compute_fights(all_events_dicts, t1, t2)
        base["fights"] = format_fights_for_api(match_fights_raw, t1, t2)
        base["fight_metrics"] = fa_compute_fight_metrics(base["fights"], t1, t2)
    return base


def _db_session_to_dict(s: "DBSession", *, full: bool = False) -> dict:
    return {
        "id": s.id,
        "scrim_name": s.scrim_name,
        "date": s.date,
        "start_time": s.start_time or "",
        "end_time": s.end_time or "",
        "matches": [_db_match_to_dict(m, full=full) for m in (s.matches or [])],
    }
