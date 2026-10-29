# -*- coding: utf-8 -*-
"""services/ability_query.py — 스킬 사용 장면 조회(선택지·필터 조회·하이라이트 검색).

데이터 출처: 스킬 행은 ability_uses.db(db/ability_store.py), 매치 정보(날짜·세션·맵·팀·영상·퍼즈·라운드 보정)와
선수의 그 매치 팀은 scrim.db. scrim.db 쪽은 응답 캐시 세대(cache._GEN)마다 1번만 읽어 둔다(_META) — scrim.db 가
바뀌는 API 는 모두 그 세대를 올리므로 세대가 같으면 내용도 같다.

규칙
- 에코 복제 중 행(copy_hero)은 결과·횟수에서 뺀다(다른 영웅의 스킬). 준비 시간 행은 포함하고 is_setup 으로 표시.
- 팀명은 그 매치 player_stats 의 team_name(자리 바꾸기·팀명 변경을 따라감). 우리/상대 = base_team 기준.
  상대팀 필터 = 그 선수 팀의 맞은편 팀.
- 10분당 = 사용 횟수 / (같은 범위의 원문 영웅별 플레이 시간) × 600. 영웅이 정해지지 않으면 null.
- "기록 없음" = 범위 안의 로그 매치 중 스킬 로그가 없는(has_log=0) 또는 아직 처리되지 않은 매치 수.
  선수를 정하면 그 선수가 뛴 매치만 센다.
- 연속 사용 묶기: 같은 매치·선수·영웅·슬롯에서 직전 사용과 GROUP_GAP_SEC 이하 간격이면 한 행(첫 사용 시각, 횟수).
- 정렬: date_desc(기본) = 날짜·세션 내림차순, 세트·게임시간 오름차순 / date_asc = 모두 오름차순.
- VOD: 행의 timestamp(events.timestamp 와 같은 값)·effective_delta(라운드 보정, serializers 와 같은 계산)와
  matches[match_id] 의 video_url·video_offset·game_setup_sec·pauses 가 buildVideoLink 입력 그대로다.
"""
import re

from config import effective_video_delta
from db import ability_store
from game_data import HEROES_DATA, canonical_map_name
from parsers.log_parser import resolve_map_type

PAGE_SIZE = 100
GROUP_GAP_SEC = 3.0
SEARCH_LIMIT = 300
SLOT_KEYS = {1: "Ability 1", 2: "Ability 2"}

_META: dict = {"gen": None, "data": None}


# ── 매치 정보(scrim.db) ───────────────────────────────────────────────────────

async def load_meta(gen: int) -> dict:
    """match_id → 매치 정보(살아 있는 로그 매치). 같은 응답 캐시 세대면 다시 읽지 않는다."""
    if _META["gen"] == gen and _META["data"] is not None:
        return _META["data"]
    from sqlalchemy import select, or_
    from db.database import AsyncSessionLocal
    from db.models import Match, Session, Pause, Round, PlayerStat
    async with AsyncSessionLocal() as db:
        ms = (await db.execute(
            select(Match.id, Match.session_id, Session.scrim_name, Session.date, Match.match_index, Match.map_name,
                   Match.team1_name, Match.team2_name, Match.video_url, Match.video_offset, Match.game_setup_sec)
            .join(Session, Session.id == Match.session_id)
            .where(Match.deleted_at.is_(None), Session.deleted_at.is_(None),
                   or_(Match.source == "log", Match.source.is_(None))))).all()
        pauses = (await db.execute(select(Pause.match_id, Pause.start_sec, Pause.end_sec, Pause.duration)
                                   .order_by(Pause.id))).all()
        rounds = (await db.execute(select(Round.match_id, Round.round_number, Round.video_delta_sec))).all()
        pteams = (await db.execute(select(PlayerStat.match_id, PlayerStat.player_name, PlayerStat.team_name)
                                   .distinct())).all()
    meta = {}
    for mid, sid, name, date, idx, mp, t1, t2, vurl, voff, gss in ms:
        meta[mid] = {"session_id": sid, "scrim_name": name or "", "date": date or "", "match_index": idx,
                     "map_name": mp or "", "map_canon": canonical_map_name(mp or ""), "map_type": resolve_map_type(mp or ""),
                     "team1_name": t1 or "", "team2_name": t2 or "", "video_url": vurl or "", "video_offset": voff or 0,
                     "game_setup_sec": gss, "pauses": [], "round_delta": {}, "pteam": {}}
    for mid, s, e, d in pauses:
        if mid in meta:
            meta[mid]["pauses"].append({"start_sec": s, "end_sec": e, "duration": d})
    for mid, rn, vd in rounds:
        if mid in meta:
            meta[mid]["round_delta"][rn] = vd
    for mid, p, t in pteams:
        if mid in meta:
            meta[mid]["pteam"].setdefault(p, t)
    _META.update({"gen": gen, "data": meta})
    return meta


def _match_public(m: dict) -> dict:
    return {k: m[k] for k in ("session_id", "scrim_name", "date", "match_index", "map_name", "team1_name", "team2_name",
                              "video_url", "video_offset", "game_setup_sec", "pauses")}


def _delta(m: dict, round_no) -> int:
    return effective_video_delta(m["round_delta"].get(round_no), m["map_type"], round_no)


# ── 이름 해석(영웅·스킬) ─────────────────────────────────────────────────────

def _norm(s) -> str:
    return re.sub(r"\s+", "", str(s or "")).casefold()


def _hero_forms(h: dict) -> list:
    return [h.get("logName"), h.get("ko"), h.get("en"), h.get("zh"), h.get("displayKo"), *(h.get("aliases") or []),
            *(h.get("koreanHeroMap") or {}).keys(), *(h.get("roleForms") or [])]


_HERO_BY_FORM: dict = {}
_SKILL_BY_NAME: dict = {}    # 정규화 스킬명 → [(영웅 logName, "Ability 1"|"Ability 2"|"Ultimate")]
for _h in HEROES_DATA:
    for _f in _hero_forms(_h):
        if _f:
            _HERO_BY_FORM.setdefault(_norm(_f), _h["logName"])
    for _fld in ("skills", "skillsEn", "skillsZh"):
        for _k, _v in (_h.get(_fld) or {}).items():
            if _v:
                _lst = _SKILL_BY_NAME.setdefault(_norm(_v), [])
                if (_h["logName"], _k) not in _lst:
                    _lst.append((_h["logName"], _k))
    for _k, _names in (_h.get("skillAliases") or {}).items():
        for _v in _names:
            _lst = _SKILL_BY_NAME.setdefault(_norm(_v), [])
            if (_h["logName"], _k) not in _lst:
                _lst.append((_h["logName"], _k))
_HERO_ENTRY = {_h["logName"]: _h for _h in HEROES_DATA}


def resolve_hero(name) -> "str | None":
    return _HERO_BY_FORM.get(_norm(name)) if name else None


def resolve_skill(name, hero: "str | None" = None) -> list:
    """스킬명(ko/en/zh·skillAliases, 공백·대소문자 무시) → [(영웅, 키)]. 동명 스킬은 모두, hero 를 주면 그 영웅만."""
    cands = list(_SKILL_BY_NAME.get(_norm(name), []))
    return [c for c in cands if hero is None or c[0] == hero]


def skill_names(hero: str) -> dict:
    """{"1": {"ko","en","zh"}, "2": {...}} — 언어별 이름(없으면 en→ko 대체, 어디에도 없으면 null → 화면에서 "스킬1/2")."""
    h = _HERO_ENTRY.get(hero) or _HERO_ENTRY.get(resolve_hero(hero) or "")
    out = {}
    for slot, key in SLOT_KEYS.items():
        ko = ((h or {}).get("skills") or {}).get(key) or None
        en = ((h or {}).get("skillsEn") or {}).get(key) or ko
        zh = ((h or {}).get("skillsZh") or {}).get(key) or en
        out[str(slot)] = {"ko": ko, "en": en, "zh": zh}
    return out


# 키 토큰(정규화 → 킬 ability 문자열과 같은 키). 스킬 이름과 동등하게 해석한다.
KEY_TOKENS = {
    "좌클릭": "Primary Fire", "좌": "Primary Fire", "lmb": "Primary Fire",
    "우클릭": "Secondary Fire", "우": "Secondary Fire", "rmb": "Secondary Fire",
    "쉬프트": "Ability 1", "shift": "Ability 1",
    "e": "Ability 2",
    "q": "Ultimate", "궁": "Ultimate", "궁극기": "Ultimate",
    "근접": "Melee", "v": "Melee",
}
# 한 글자 키 토큰 — 영웅·선수 토큰이 함께 있을 때만 키로 본다(아니면 선수명 부분 일치 그대로).
SINGLE_CHAR_KEYS = {"e", "q", "v", "좌", "우"}
USE_KEYS = ("Ability 1", "Ability 2")   # 스킬 사용 기록(ability_uses)이 있는 키


def parse_query(q: str) -> dict:
    """하이라이트 검색 문구 → {"player","hero","skill","key"}.
    1) 스킬명(공백 포함 가능)을 가장 긴 연속 토큰부터 찾아 뗀다. 2) 두 글자 이상 키 토큰(우클릭·shift·궁극기 등).
    3) 남은 토큰 중 첫 영웅. 4) 한 글자 키 토큰(e·q·v·좌·우)은 영웅이나 다른 선수 토큰이 있을 때만 키, 아니면 선수.
    5) 나머지는 선수(여러 개면 공백으로 이어 붙임). 스킬명이 있으면 키 토큰은 쓰지 않는다."""
    toks = (q or "").split()
    used = [False] * len(toks)
    skill = None
    for size in range(len(toks), 0, -1):
        for i in range(0, len(toks) - size + 1):
            if any(used[i:i + size]):
                continue
            if _norm("".join(toks[i:i + size])) in _SKILL_BY_NAME:
                skill = " ".join(toks[i:i + size])
                for j in range(i, i + size):
                    used[j] = True
                break
        if skill:
            break
    key = None
    for i, t in enumerate(toks):
        n = _norm(t)
        if not used[i] and n in KEY_TOKENS and n not in SINGLE_CHAR_KEYS:
            used[i] = True
            key = key or KEY_TOKENS[n]
    hero = None
    for i, t in enumerate(toks):
        if not used[i] and hero is None and resolve_hero(t):
            hero = resolve_hero(t)
            used[i] = True
    rest = [(i, t) for i, t in enumerate(toks) if not used[i]]
    singles = [(i, t) for i, t in rest if _norm(t) in SINGLE_CHAR_KEYS]
    others = [(i, t) for i, t in rest if _norm(t) not in SINGLE_CHAR_KEYS]
    if singles and (hero or others):
        key = key or KEY_TOKENS[_norm(singles[0][1])]
        rest = others
    return {"player": " ".join(t for _, t in rest) or None, "hero": hero, "skill": skill,
            "key": None if skill else key}


# ── 공통 필터 ─────────────────────────────────────────────────────────────────

def _match_ok(m: dict, p: dict) -> bool:
    if p.get("date_from") and m["date"] < p["date_from"]:
        return False
    if p.get("date_to") and m["date"] > p["date_to"]:
        return False
    if p.get("map") and m["map_canon"] != canonical_map_name(p["map"]):
        return False
    if p.get("video_only") and not m["video_url"].strip():
        return False
    return True


def _player_ok(m: dict, player: str, p: dict) -> "tuple[bool, str | None]":
    """(통과, 그 선수의 이 매치 팀명). 우리/상대·상대팀 필터."""
    team = m["pteam"].get(player)
    side = p.get("side") or "all"
    base = p.get("base_team") or ""
    if side == "us" and team != base:
        return False, team
    if side == "them" and (team is None or team == base or base not in (m["team1_name"], m["team2_name"])):
        return False, team
    if p.get("opponent"):
        other = m["team2_name"] if team == m["team1_name"] else m["team1_name"] if team == m["team2_name"] else None
        if other != p["opponent"]:
            return False, team
    return True, team


def _sort_key(row, meta, desc: bool):
    m = meta[row["match_id"]]
    if desc:
        return (_Rev(m["date"]), _Rev(m["session_id"]), m["match_index"], row["game_time"])
    return (m["date"], m["session_id"], m["match_index"], row["game_time"])


class _Rev:
    """문자열 내림차순 정렬용 래퍼(같은 키 안의 나머지는 오름차순 유지)."""
    __slots__ = ("v",)

    def __init__(self, v):
        self.v = v

    def __lt__(self, o):
        return self.v > o.v

    def __eq__(self, o):
        return self.v == o.v


def _collect(meta: dict, p: dict, players, heroes, slots, pairs=None):
    """필터를 통과한 사용 행 목록 + 범위 안 매치 집합(기록 없음·분모 계산용)."""
    keys = ability_store.match_keys()
    mk2mid = {mk: mid for mid, (mk, _) in keys.items() if mid in meta}
    out = []
    for pl, hero, slot, mkey, gt, rno, ts, tslot, setup in ability_store.fetch_uses(players, heroes, slots):
        if pairs is not None and (hero, slot) not in pairs:
            continue
        mid = mk2mid.get(mkey)
        if mid is None:
            continue
        m = meta[mid]
        if not _match_ok(m, p):
            continue
        ok, team = _player_ok(m, pl, p)
        if not ok:
            continue
        out.append({"match_id": mid, "round_no": rno, "game_time": gt, "timestamp": ts,
                    "effective_delta": _delta(m, rno), "is_setup": bool(setup), "count": 1,
                    "player_name": pl, "hero_name": hero, "slot": slot, "team_name": team})
    return out, keys, mk2mid


def _group(rows: list) -> list:
    rows = sorted(rows, key=lambda r: (r["match_id"], r["player_name"], r["hero_name"], r["slot"], r["game_time"]))
    out = []
    for r in rows:
        last = out[-1] if out else None
        if (last and last["match_id"] == r["match_id"] and last["player_name"] == r["player_name"]
                and last["hero_name"] == r["hero_name"] and last["slot"] == r["slot"]
                and r["game_time"] - last["last_game_time"] <= GROUP_GAP_SEC):
            last["count"] += 1
            last["last_game_time"] = r["game_time"]
        else:
            out.append({**r, "last_game_time": r["game_time"]})
    return out


# ── 필터 조회 ─────────────────────────────────────────────────────────────────

def scenes(meta: dict, p: dict) -> dict:
    player, hero, slot = p.get("player"), p.get("hero"), p.get("slot")
    rows, keys, mk2mid = _collect(meta, p, [player] if player else None, [hero] if hero else None,
                                  [slot] if slot else None)
    uses = len(rows)
    if p.get("group"):
        rows = _group(rows)
    desc = (p.get("sort") or "date_desc") != "date_asc"
    rows.sort(key=lambda r: _sort_key(r, meta, desc))
    page = max(1, int(p.get("page") or 1))
    page_rows = rows[(page - 1) * PAGE_SIZE: page * PAGE_SIZE]

    # 범위 안 매치(매치 필터 + 선수가 정해지면 그 선수가 뛰고 우리/상대·상대팀 조건을 통과한 매치)
    scope = []
    for mid, m in meta.items():
        if not _match_ok(m, p):
            continue
        if player and (player not in m["pteam"] or not _player_ok(m, player, p)[0]):
            continue
        scope.append(mid)
    logged = {mid for mid in scope if keys.get(mid, (None, False))[1]}
    no_log = len(scope) - len(logged)

    seconds = None
    if hero:
        # 분모 범위 = 사용 행과 같은 조건(매치 필터 + 그 선수의 우리/상대·상대팀) — player_stats 등장 여부는 따지지 않는다
        mkeys = {mk: mid for mid, (mk, has) in keys.items() if has and mid in meta and _match_ok(meta[mid], p)}
        seconds = 0.0
        for mkey, pl, h, sec in ability_store.hero_seconds([player] if player else None, [hero]):
            mid = mkeys.get(mkey)
            if mid and _player_ok(meta[mid], pl, p)[0]:
                seconds += sec
    per10 = round(uses / seconds * 600, 2) if seconds else None
    return {
        "meta": {"player": player, "hero": hero, "slot": slot, "date_from": p.get("date_from"), "date_to": p.get("date_to"),
                 "opponent": p.get("opponent"), "map": p.get("map"), "side": p.get("side") or "all",
                 "base_team": p.get("base_team"), "group": bool(p.get("group")), "group_gap_sec": GROUP_GAP_SEC,
                 "sort": "date_asc" if not desc else "date_desc", "page": page, "page_size": PAGE_SIZE,
                 "total_rows": len(rows), "pages": (len(rows) + PAGE_SIZE - 1) // PAGE_SIZE},
        "summary": {"uses": uses, "hero_seconds": round(seconds, 2) if seconds is not None else None, "per10": per10,
                    "matches": len({r["match_id"] for r in rows}), "log_matches": len(logged), "no_log_matches": no_log},
        "matches": {mid: _match_public(meta[mid]) for mid in dict.fromkeys(r["match_id"] for r in page_rows)},
        "rows": page_rows,
    }


# ── 선택지 ───────────────────────────────────────────────────────────────────

def options(meta: dict, base_team: str) -> dict:
    keys = ability_store.match_keys()
    live = {mk: mid for mid, (mk, has) in keys.items() if mid in meta and has}
    players: dict = {}

    def _hero(pl, h):
        pe = players.setdefault(pl, {"name": pl, "teams": set(), "heroes": {}})
        return pe["heroes"].setdefault(h, {"hero": h, "uses1": 0, "uses2": 0, "seconds": 0.0, "matches": set()})

    for mkey, pl, h, sec in ability_store.hero_seconds():
        mid = live.get(mkey)
        if mid:
            e = _hero(pl, h)
            e["seconds"] += sec
            e["matches"].add(mid)
    for pl, h, slot, mkey, n in ability_store.use_counts():
        mid = live.get(mkey)
        if mid:
            e = _hero(pl, h)
            e["uses1" if slot == 1 else "uses2"] += n
            e["matches"].add(mid)
    for mid in live.values():
        for pl, team in meta[mid]["pteam"].items():
            if pl in players and team:
                players[pl]["teams"].add(team)
    out_players, heroes_seen = [], set()
    for pl in sorted(players, key=str.casefold):
        pe = players[pl]
        hs = sorted(pe["heroes"].values(), key=lambda e: (-e["seconds"], e["hero"]))
        heroes_seen.update(e["hero"] for e in hs)
        out_players.append({"name": pl, "teams": sorted(pe["teams"]), "ours": base_team in pe["teams"],
                            "heroes": [{"hero": e["hero"], "uses1": e["uses1"], "uses2": e["uses2"],
                                        "seconds": round(e["seconds"], 2), "matches": len(e["matches"])} for e in hs]})
    log_matches = sum(1 for mid in meta if keys.get(mid, (None, False))[1])
    return {"base_team": base_team, "players": out_players,
            "hero_skills": {h: skill_names(h) for h in sorted(heroes_seen)},
            "log_matches": log_matches, "no_log_matches": len(meta) - log_matches}


# ── 하이라이트 검색 ───────────────────────────────────────────────────────────

def _sources(cands) -> dict:
    """결과 소스 안내(STEP 5 화면이 킬 결정타·궁극기 사용을 붙일 때 쓰는 값).
    ability_uses = 스킬 사용 장면(이 응답 rows), kills = 그 키의 결정타(full-events kill.ability),
    ultimate_starts = 궁극기 사용(ultimate_start), use_records = 사용 기록이 있는 키인지(좌클릭·우클릭·근접은 없음)."""
    if cands is None:
        return {"ability_uses": True, "kills": False, "ultimate_starts": False, "use_records": True}
    keys = {k for _, k in cands}
    au, ult = bool(keys & set(USE_KEYS)), "Ultimate" in keys
    return {"ability_uses": au, "kills": bool(keys), "ultimate_starts": ult, "use_records": au or ult}


def search(meta: dict, p: dict) -> dict:
    """선수(부분 일치)·영웅·스킬명/키 토큰으로 스킬 사용 장면 최신순 상한 SEARCH_LIMIT."""
    parsed = parse_query(p.get("q") or "")
    player_q = p.get("player") or parsed["player"]
    hero = resolve_hero(p.get("hero")) if p.get("hero") else parsed["hero"]
    skill = p.get("skill") or parsed["skill"]
    key = None if skill else (KEY_TOKENS.get(_norm(p.get("key"))) or p.get("key") if p.get("key") else parsed["key"])
    limit = max(1, min(int(p.get("limit") or SEARCH_LIMIT), SEARCH_LIMIT))
    resolved = {"player_query": player_q, "hero": hero, "skill": skill, "skills": [], "players": []}
    cands = None
    if skill:
        cands = resolve_skill(skill, hero)
    elif key:
        cands = [(hero, key)]
        resolved["key"] = key
    if cands is not None:
        resolved["skills"] = [{"hero": h, "ability": k} for h, k in cands]
    empty = {"total": 0, "limit": limit, "truncated": False, "resolved": resolved, "sources": _sources(cands),
             "matches": {}, "rows": []}

    pairs, slots = None, None
    heroes = [hero] if hero else None
    if cands is not None:
        use = [(h, int(k[-1])) for h, k in cands if k in USE_KEYS]
        if not use:   # 궁극기·좌클릭·우클릭·근접 또는 그 영웅의 스킬이 아님 → 스킬 사용 장면 없음(결정타·궁극기 결합은 프론트)
            return empty
        slots = sorted({s for _, s in use})
        if all(h is not None for h, _ in use):
            pairs = set(use)
            heroes = sorted({h for h, _ in use})
    if not (player_q or hero or skill or key):
        return empty
    players = None
    if player_q:
        ql = player_q.casefold()
        players = [n for n in ability_store.player_names() if ql in n.casefold()]
        resolved["players"] = sorted(players, key=str.casefold)
        if not players:
            return empty
    rows, _, _ = _collect(meta, p, players, heroes, slots, pairs)
    rows.sort(key=lambda r: _sort_key(r, meta, True))
    top = rows[:limit]
    return {"total": len(rows), "limit": limit, "truncated": len(rows) > limit, "resolved": resolved,
            "sources": _sources(cands),
            "matches": {mid: _match_public(meta[mid]) for mid in dict.fromkeys(r["match_id"] for r in top)},
            "rows": top}
