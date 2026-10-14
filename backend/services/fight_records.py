# -*- coding: utf-8 -*-
"""services/fight_records.py — /api/fight-records 응답 본문(records·match_summaries·meta) 생성.

routers/stats.py get_fight_records 본문의 루프·payload 조립을 이동만 한 것(로직·순서·필드 무변경,
응답 바이트 동일 — scripts/api_snapshot.py 로 증명). 라우터는 DB 조회·캐시만 담당하고,
같은 정의를 쓰는 서비스(services/summary.py)는 라우터를 거치지 않고 이 함수를 호출한다.
의존: config, parsers.log_parser, serializers, services.fight_analysis, services.fight_metrics
(services/stats.py 의 serializers import 선례와 동일 방향. main·routers import 금지.)
"""
from config import TRADE_WINDOW_SEC, effective_video_delta
from parsers.log_parser import resolve_map_type
from serializers import _db_event_to_dict
from services.fight_analysis import compute_fights
from services.fight_metrics import _fight_to_record


def _build_fight_records_payload(sessions, base_team: str) -> dict:
    """sessions: rounds.events·pauses 를 selectinload 한 DBSession 목록(date DESC, id DESC).
    반환: /api/fight-records 응답 dict {meta, records, match_summaries}."""
    records: list = []
    match_summaries: list = []  # 매치 단위 요약(수기 포함) — 맵별 승패·상대별 전적·표본 N/M 표기용
    skipped_matches = 0
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
                skipped_matches += 1
                continue
            map_type = resolve_map_type(m.map_name)
            eff_winner = (m.winner_override or m.winner) or ""
            match_summaries.append({
                "match_id": m.id,
                "session_id": s.id,
                "session_date": s.date,
                "map_name": m.map_name,
                "map_type": map_type,
                "opponent": t2 if our_side == 1 else t1,
                "our_score": (m.score_t1 if our_side == 1 else m.score_t2) or 0,
                "enemy_score": (m.score_t2 if our_side == 1 else m.score_t1) or 0,
                # "Draw"(원본 무승부·수기 무승부 보정 공통)는 무승부 — _fight_to_record와 동일 규칙
                "match_result": ("win" if eff_winner == base_team
                                  else ("draw" if (not eff_winner or eff_winner == "Draw") else "loss")),
                "source": (getattr(m, 'source', None) or 'log'),
            })
            if (getattr(m, 'source', None) or 'log') != 'log':
                continue  # 수기 매치 — 한타 레코드 없음
            for r in (m.rounds or []):
                ev_dicts = [_db_event_to_dict(ev) for ev in (r.events or [])]
                r_delta = effective_video_delta(
                    getattr(r, "video_delta_sec", None), map_type, r.round_number)
                for f in compute_fights(ev_dicts, t1, t2):
                    records.append(_fight_to_record(f, our_side, t1, t2, s, m, map_type,
                                                    r.round_number, effective_delta=r_delta))

    total = len(records)
    unknown = sum(1 for rec in records if rec["fight_winner"] == "unknown")
    payload = {
        "meta": {
            "base_team": base_team,
            "trade_window_sec": TRADE_WINDOW_SEC,
            "total_fights": total,
            "winner_unknown_count": unknown,
            "winner_unknown_rate": (unknown / total) if total > 0 else 0,
            "skipped_matches_without_base_team": skipped_matches,
        },
        "records": records,
        "match_summaries": match_summaries,
    }
    return payload
