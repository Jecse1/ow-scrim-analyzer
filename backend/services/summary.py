# -*- coding: utf-8 -*-
"""services/summary.py — 봇·외부 조회용 서버 집계(맵별·상대별·기간·궁극기). 순수 함수(I/O 없음).

입력은 /api/fight-records 와 같은 records·match_summaries(services/fight_records.py
_build_fight_records_payload 출력)와 /api/scrims 와 같은 세션 dict 목록. 출력은 순수 dict.
집계 정의는 이 파일이 정본이다(definitions_version 1, 정의 D1~D8):

  D1 매치 결과 = (winner_override or winner) — records[].match_result(_fight_to_record) 재사용.
     맵 승률 분모 = win/loss/draw 매치(결과 없음 제외), 무승부는 분모에 포함.
  D2 첫 한타 = /api/first-fights 와 같은 단위: 밀기·플래시포인트(is_match_level_map)는 매치당 1개,
     그 외(Unknown 포함)는 라운드마다 1개. (match_id, round_number)별 start_timestamp 최소 레코드.
     첫 한타 승률 분모 = fight_winner 가 us/them 인 것만. 수기 매치는 한타가 없어 제외(수를 보고).
  D3 상대 = 매치 팀명 중 base_team 이 아닌 쪽(match_summaries.opponent / records.enemy_team). 세션명 파싱 없음.
  D4 기간 = session_date 'YYYY-MM-DD' 문자열 비교(양끝 포함). 기본값은 default_period().
  D5 선궁 = records[].first_ult_side 그대로. 카운터 = 상대 궁 H 최초 사용 이후(초과) response_window 초
     이내의 우리 궁(한타당 같은 영웅 1회, 가장 빠른 것) — 프론트 collectFollowups 와 같은 규칙.
  D6 한타 0개인 로그 매치는 맵 승률·첫 한타에서 제외(수를 보고).
  D7 결과 없음(승자 빈값) 매치는 승패 집계에서 제외(무승부로 바꾸지 않음, 수를 보고).
  D8 맵 키 = 정본 ko 맵명(game_data.canonical_map_name).

제외 분류(excluded)는 상호 배타이며 우선순위는 no_fight_matches → null_result_matches 순이다
(승자가 비고 한타도 0개인 로그 매치는 no_fight_matches 로만 센다). 결과 없음 매치의 한타는
첫 한타·궁 집계에 그대로 포함한다(한타 승패는 매치 승패와 독립 판정 — 프론트 맵 분석과 동일).

모집단(응답 meta.population):
  maps·opponents = POPULATION_FIGHT_MATCHES_PLUS_MANUAL — 한타 있는 로그 매치 + 수기 매치(맵 분석 탭과 동일)
  period         = POPULATION_ALL_MATCHES — base_team 참가 매치 전부(세션 화면과 동일, D6 미적용)
  ults           = POPULATION_LOG_FIGHTS — 로그 매치의 한타 레코드(궁극기 분석 탭과 동일)

승률은 0~1 실수(표본 0이면 None)와 분자·분모를 항상 함께 돌려준다. 반올림하지 않는다.
"""
from __future__ import annotations

from collections import OrderedDict
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from game_data import canonical_map_name
from parsers.log_parser import is_match_level_map

DEFINITIONS_VERSION = "1"

POPULATION_FIGHT_MATCHES_PLUS_MANUAL = "fight_matches_plus_manual"
POPULATION_ALL_MATCHES = "all_matches"
POPULATION_LOG_FIGHTS = "log_fights"

# 프론트와 같은 기본값(값 출처: frontend/src/FightLabStats.jsx)
DEFAULT_PERIOD_DAYS = 14   # A_PRESET_DAYS['2w'] = 14 (:57), 기본 프리셋 '2w' (:1411)
RESPONSE_WINDOW_SEC = 3    # RESPONSE_WINDOW_SEC = 3 (:836)
DEFAULT_MIN_SAMPLE = 5     # useFightScope minSample 기본 5 (:1406), 카운터 표 minS 기본 5 (:1235)
DEFAULT_COUNTER_LIMIT = 10

PERIOD_TZ = ZoneInfo("Asia/Seoul")


# ── 공통 헬퍼 ────────────────────────────────────────────────────────────────
def default_period(today: date | None = None) -> tuple[str, str]:
    """(from, to) — to = 오늘(Asia/Seoul), from = to − (DEFAULT_PERIOD_DAYS − 1)일."""
    to = today or datetime.now(PERIOD_TZ).date()
    frm = to - timedelta(days=DEFAULT_PERIOD_DAYS - 1)
    return frm.isoformat(), to.isoformat()


def _in_range(d, frm, to) -> bool:
    """프론트 inRange 와 동일: 빈 경계 = 무한, 'YYYY-MM-DD' 문자열 비교, 양끝 포함."""
    return (not frm or (bool(d) and d >= frm)) and (not to or (bool(d) and d <= to))


def _rate(num: int, den: int):
    return (num / den) if den > 0 else None


def _known(r) -> bool:
    return r.get("fight_winner") in ("us", "them")


def _wl(results) -> dict:
    """결과 문자열 목록('win'/'loss'/'draw') → 승·패·무와 맵 승률(분모 = 세 값의 합)."""
    w = sum(1 for x in results if x == "win")
    l = sum(1 for x in results if x == "loss")
    d = sum(1 for x in results if x == "draw")
    return {"matches": w + l + d, "wins": w, "losses": l, "draws": d, "map_winrate": _rate(w, w + l + d)}


def _match_winners(scrims) -> dict:
    """/api/scrims 세션 목록 → match_id → 유효 승자(winner 필드 = winner_override or winner)."""
    out = {}
    for s in scrims or []:
        for m in s.get("matches") or []:
            out[m.get("id")] = (m.get("winner") or "").strip()
    return out


def _first_fights(recs) -> list:
    """D2: (match_id, 라운드 키)별 start_timestamp 최소 레코드. 밀기·플래시포인트는 라운드 키 None(매치당 1개).
    동률이면 먼저 나온 레코드(응답 순서 = 라운드 내 시간순)."""
    best = OrderedDict()
    for r in recs:
        rk = None if is_match_level_map(r.get("map_type")) else r.get("round_number")
        k = (r.get("match_id"), rk)
        cur = best.get(k)
        if cur is None or (r.get("start_timestamp") or 0) < (cur.get("start_timestamp") or 0):
            best[k] = r
    return list(best.values())


def _fight_stat(recs, prefix: str) -> dict:
    k = [r for r in recs if _known(r)]
    w = sum(1 for r in k if r["fight_winner"] == "us")
    return {
        f"{prefix}s": len(k),
        f"{prefix}_wins": w,
        f"{prefix}_winrate": _rate(w, len(k)),
        f"{prefix}s_unknown": len(recs) - len(k),
    }


def _scoped_matches(records, match_summaries, frm, to, opponent, scrims):
    """기간·상대 필터 후 매치 단위 행과 제외 수.
    반환: (rows, recs_in_scope, excluded)
      rows: [{match_id, session_id, map, map_type, opponent, source, result, recs}]  — D6·D7 적용 후 승패 집계 대상
      recs_in_scope: 기간·상대 필터를 통과한 한타 레코드(첫 한타·한타 수 집계용)."""
    recs = [r for r in records
            if _in_range(r.get("session_date"), frm, to) and (opponent is None or r.get("enemy_team") == opponent)]
    by_match = OrderedDict()
    for r in recs:
        by_match.setdefault(r.get("match_id"), []).append(r)
    winners = _match_winners(scrims) if scrims is not None else None

    rows = []
    excluded = {"no_fight_matches": 0, "null_result_matches": 0, "manual_matches_in_first_fight": 0}
    for ms in match_summaries:
        if not _in_range(ms.get("session_date"), frm, to):
            continue
        if opponent is not None and ms.get("opponent") != opponent:
            continue
        mid = ms.get("match_id")
        source = ms.get("source") or "log"
        if source == "manual":
            excluded["manual_matches_in_first_fight"] += 1
            # match_summaries 는 빈 승자도 'draw' 로 적으므로(D7), 세션 목록의 유효 승자로 빈값을 가려낸다.
            if winners is not None and not winners.get(mid):
                excluded["null_result_matches"] += 1
                continue
            result = ms.get("match_result")
            mrecs = []
        else:
            mrecs = by_match.get(mid) or []
            if not mrecs:
                excluded["no_fight_matches"] += 1   # D6 (승자 유무와 무관하게 여기로 집계)
                continue
            result = mrecs[0].get("match_result")  # D1: _fight_to_record 의 match_result
            if result is None:
                excluded["null_result_matches"] += 1   # D7
                continue
        rows.append({
            "match_id": mid, "session_id": ms.get("session_id"),
            "map": canonical_map_name(ms.get("map_name")), "map_type": ms.get("map_type"),
            "opponent": ms.get("opponent"), "source": source, "result": result,
        })
    return rows, recs, excluded


# ── 1. 맵별 ──────────────────────────────────────────────────────────────────
def summarize_maps(records, match_summaries, frm=None, to=None, opponent=None, scrims=None) -> dict:
    """맵별 {map, map_type, matches, wins, losses, draws, map_winrate,
    first_fights, first_fight_wins, first_fight_winrate, first_fights_unknown, fights} + total + excluded.
    scrims(/api/scrims 세션 목록)를 주면 수기 매치의 빈 승자를 D7 로 제외한다."""
    rows, recs, excluded = _scoped_matches(records, match_summaries, frm, to, opponent, scrims)
    firsts = _first_fights(recs)

    def _row(key, map_type, mrows, mrecs, mfirsts):
        out = {"map": key, "map_type": map_type}
        out.update(_wl([x["result"] for x in mrows]))
        out.update(_fight_stat(mfirsts, "first_fight"))
        out["fights"] = len(mrecs)
        return out

    keys = OrderedDict()
    for x in rows:
        keys.setdefault(x["map"], x["map_type"])
    for r in recs:
        keys.setdefault(canonical_map_name(r.get("map_name")), r.get("map_type"))
    maps = []
    for key, mt in keys.items():
        maps.append(_row(
            key, mt,
            [x for x in rows if x["map"] == key],
            [r for r in recs if canonical_map_name(r.get("map_name")) == key],
            [f for f in firsts if canonical_map_name(f.get("map_name")) == key],
        ))
    maps.sort(key=lambda m: (-m["matches"], m["map"]))
    total = _row("__total__", None, rows, recs, firsts)
    return {"maps": maps, "total": total, "excluded": excluded}


# ── 2. 상대별 ────────────────────────────────────────────────────────────────
def summarize_opponents(records, match_summaries, frm=None, to=None, scrims=None) -> dict:
    """상대별 {opponent, sessions, matches, wins, losses, draws, map_winrate,
    first_fights, first_fight_wins, first_fight_winrate, first_fights_unknown} + total + excluded.
    sessions = 승패 집계 대상 매치가 속한 세션 수."""
    rows, recs, excluded = _scoped_matches(records, match_summaries, frm, to, None, scrims)
    firsts = _first_fights(recs)

    def _row(name, orows, ofirsts):
        out = {"opponent": name, "sessions": len({x["session_id"] for x in orows})}
        out.update(_wl([x["result"] for x in orows]))
        out.update(_fight_stat(ofirsts, "first_fight"))
        return out

    names = OrderedDict()
    for x in rows:
        names.setdefault(x["opponent"], None)
    for r in recs:
        names.setdefault(r.get("enemy_team"), None)
    opps = [_row(n, [x for x in rows if x["opponent"] == n], [f for f in firsts if f.get("enemy_team") == n])
            for n in names]
    opps.sort(key=lambda o: (-o["matches"], o["opponent"] or ""))
    return {"opponents": opps, "total": _row("__total__", rows, firsts), "excluded": excluded}


# ── 3. 기간(세션별) ───────────────────────────────────────────────────────────
_RESULT_KO = {"win": "승", "loss": "패", "draw": "무", None: "미정"}


def _session_match_rows(scrim, base_team: str) -> tuple[list, int]:
    """세션 dict(/api/scrims 형식) → base_team 참가 매치 행 [{map, opponent, result, our_score, enemy_score}]과
    base_team 미참가로 건너뛴 매치 수. result = D1(유효 승자 winner = winner_override or winner) 기준
    'win'/'loss'/'draw', 승자 빈값은 None(D7). 매치 순서는 입력 그대로(match_index 순)."""
    rows, skipped = [], 0
    for m in scrim.get("matches") or []:
        t1, t2 = m.get("team1_name"), m.get("team2_name")
        if t1 == base_team:
            opp, ours, theirs = t2, m.get("score_t1"), m.get("score_t2")
        elif t2 == base_team:
            opp, ours, theirs = t1, m.get("score_t2"), m.get("score_t1")
        else:
            skipped += 1
            continue
        w = (m.get("winner") or "").strip()  # 유효 승자(winner_override or winner)
        rows.append({
            "map": canonical_map_name(m.get("map_name")), "opponent": opp,
            "result": None if not w else ("draw" if w == "Draw" else ("win" if w == base_team else "loss")),
            "our_score": ours or 0, "enemy_score": theirs or 0,
        })
    return rows, skipped


def summarize_session(scrim, base_team: str) -> dict:
    """세션 1개 → {id, date, scrim_name, opponents[], matches, wins, losses, draws, no_result, maps[],
    skipped_matches_without_base_team}. matches = base_team 참가 매치 수(결과 없음 포함)."""
    rows, skipped = _session_match_rows(scrim, base_team)
    opponents = []
    for r in rows:
        if r["opponent"] not in opponents:
            opponents.append(r["opponent"])
    wl = _wl([r["result"] for r in rows if r["result"] is not None])
    return {
        "id": scrim.get("id"), "date": scrim.get("date"), "scrim_name": scrim.get("scrim_name"),
        "opponents": opponents, "matches": len(rows),
        "wins": wl["wins"], "losses": wl["losses"], "draws": wl["draws"],
        "no_result": sum(1 for r in rows if r["result"] is None),
        "maps": [r["map"] for r in rows],
        "skipped_matches_without_base_team": skipped,
    }


def summarize_period(scrims, frm=None, to=None, base_team: str = "") -> dict:
    """기간 내 세션별 {session_id, date, scrim_name, opponents[], matches, wins, losses, draws,
    no_result, maps[]} + total + excluded. 세션 순서는 입력(/api/scrims: date DESC, id DESC) 그대로.
    base_team 이 참가하지 않은 매치는 건너뛰고 total.skipped_matches_without_base_team 로 센다(fight-records 와 동일).
    base_team 참가 매치가 0인 세션은 행에서 빼고 excluded.sessions_without_base_team 로 센다.
    matches = base_team 참가 매치 수(결과 없음 포함), wins+losses+draws = 결과 있는 매치(D7)."""
    sessions = []
    skipped = 0
    no_base_sessions = 0
    for s in scrims or []:
        if not _in_range(s.get("date"), frm, to):
            continue
        row = summarize_session(s, base_team)
        skipped += row.pop("skipped_matches_without_base_team")
        if row["matches"] == 0:
            no_base_sessions += 1
            continue
        row["session_id"] = row.pop("id")
        sessions.append(row)
    tw = sum(x["wins"] for x in sessions)
    tl = sum(x["losses"] for x in sessions)
    td = sum(x["draws"] for x in sessions)
    total = {
        "sessions": len(sessions), "matches": sum(x["matches"] for x in sessions),
        "wins": tw, "losses": tl, "draws": td, "no_result": sum(x["no_result"] for x in sessions),
        "map_winrate": _rate(tw, tw + tl + td), "decided_matches": tw + tl + td,
        "skipped_matches_without_base_team": skipped,
    }
    return {"sessions": sessions, "total": total, "excluded": {"sessions_without_base_team": no_base_sessions}}


DISCORD_CONTENT_LIMIT = 2000


def format_session_message(scrim, base_team: str, limit: int = DISCORD_CONTENT_LIMIT) -> str:
    """세션 등록 완료 알림 본문 — 고정폭 코드 블록 1개(폭 보정 없음).
    1줄: 날짜 · vs 상대 · (세션명) · [id:세션ID](반복 호출 시 채널에서 중복 식별용) / 매치마다 '맵 / 승·패·무·미정 / 우리:상대 점수' / 끝줄: 합계 승-패-무(미정 수).
    limit 초과 시 뒤쪽 매치 줄부터 잘라내고 '…외 N매치' 줄을 붙인다."""
    rows, _ = _session_match_rows(scrim, base_team)
    sm = summarize_session(scrim, base_team)
    head = f"{sm['date']} vs {', '.join(sm['opponents']) or '-'} ({sm['scrim_name']}) [id:{sm['id']}]"
    total = f"합계 {sm['wins']}-{sm['losses']}-{sm['draws']}" + (f" (미정 {sm['no_result']})" if sm["no_result"] else "")
    lines = [f"{r['map']} / {_RESULT_KO[r['result']]} / {r['our_score']}:{r['enemy_score']}" for r in rows]

    def _build(body):
        return "```\n" + "\n".join([head, *body, total]) + "\n```"

    msg = _build(lines)
    keep = len(lines)
    while len(msg) > limit and keep > 0:
        keep -= 1
        msg = _build(lines[:keep] + [f"…외 {len(lines) - keep}매치"])
    return msg[:limit]


# ── 4. 궁극기 ────────────────────────────────────────────────────────────────
def _first_ts(r, side, hero):
    return min(u["timestamp"] for u in (r.get("ults") or []) if u.get("side") == side and u.get("hero") == hero)


def summarize_ults(records, frm=None, to=None, opponent=None,
                   response_window: float = RESPONSE_WINDOW_SEC, min_sample: int = DEFAULT_MIN_SAMPLE,
                   limit: int = DEFAULT_COUNTER_LIMIT) -> dict:
    """first_ult {us|them|none: {n, wins, winrate, fights}} (n = 승패 판정 가능 한타, fights = 전체),
    counters[] {enemy_hero, our_hero, n, wins, winrate, avg_react_sec,
                enemy_hero_n, enemy_hero_wins, enemy_hero_winrate, no_response_n, no_response_wins, no_response_winrate}
    — n >= min_sample 만, 승률 내림차순 → 표본 내림차순(→ 영웅명) 정렬, 상위 limit 행.
    수기 매치는 records 에 없으므로 자동 제외."""
    recs = [r for r in records
            if _in_range(r.get("session_date"), frm, to) and (opponent is None or r.get("enemy_team") == opponent)]

    first_ult = {}
    for side in ("us", "them", "none"):
        sub = [r for r in recs if r.get("first_ult_side") == side]
        k = [r for r in sub if _known(r)]
        w = sum(1 for r in k if r["fight_winner"] == "us")
        first_ult[side] = {"n": len(k), "wins": w, "winrate": _rate(w, len(k)), "fights": len(sub)}

    known = [r for r in recs if _known(r)]
    enemy_heroes = sorted({u.get("hero") for r in known for u in (r.get("ults") or []) if u.get("side") == "them"},
                          key=lambda h: h or "")
    counters = []
    for H in enemy_heroes:
        base = [r for r in known if any(u.get("side") == "them" and u.get("hero") == H for u in (r.get("ults") or []))]
        if not base:
            continue
        base_w = sum(1 for r in base if r["fight_winner"] == "us")
        agg = OrderedDict()   # our_hero → [n, wins, react_sum]
        no_resp = []
        for r in base:
            ts = _first_ts(r, "them", H)
            per = {}
            for u in r.get("ults") or []:
                if u.get("side") != "us":
                    continue
                if not (u["timestamp"] > ts) or (u["timestamp"] - ts) > response_window:
                    continue  # 동시(=) 제외 + 응수 창 초과 제외
                react = u["timestamp"] - ts
                if u.get("hero") not in per or react < per[u.get("hero")]:
                    per[u.get("hero")] = react
            if not per:
                no_resp.append(r)
            for h, react in per.items():
                e = agg.setdefault(h, [0, 0, 0.0])
                e[0] += 1
                e[1] += 1 if r["fight_winner"] == "us" else 0
                e[2] += react
        nr_w = sum(1 for r in no_resp if r["fight_winner"] == "us")
        for h, (n, w, rs) in agg.items():
            if n < min_sample:
                continue
            counters.append({
                "enemy_hero": H, "our_hero": h, "n": n, "wins": w, "winrate": _rate(w, n),
                "avg_react_sec": rs / n,
                "enemy_hero_n": len(base), "enemy_hero_wins": base_w, "enemy_hero_winrate": _rate(base_w, len(base)),
                "no_response_n": len(no_resp), "no_response_wins": nr_w, "no_response_winrate": _rate(nr_w, len(no_resp)),
            })
    counters.sort(key=lambda c: (-(c["winrate"] or 0), -c["n"], c["enemy_hero"] or "", c["our_hero"] or ""))
    return {
        "first_ult": first_ult,
        "counters": counters[:limit] if limit is not None else counters,
        "counters_total": len(counters),
        "fights": len(recs), "fights_known": len(known),
        "params": {"response_window": response_window, "min_sample": min_sample, "limit": limit},
    }
