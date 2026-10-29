// 하이라이트 검색의 스킬·키 문구 처리(OverallStats.jsx) — 순수 함수.
// 문구 해석의 정본은 서버(/api/abilities/search, backend/services/ability_query.parse_query)다.
// 여기서는 ① 입력을 스킬 검색으로 보낼지(isSkillQuery) ② 서버 결과(스킬 사용 장면)와 기존 full-events 의
// 결정타·궁극기 사용을 합치는 일(buildSkillMoments)만 한다. 스킬·키 토큰이 없는 입력은 기존 태그 분류 그대로.
import { HEROES, getHeroByName, resolveMapEntry, findMapEntriesByPartial } from "../gameData";

const norm = (s) => String(s ?? "").replace(/\s+/g, "").toLowerCase();

// 서버 KEY_TOKENS 와 같은 표(키 토큰 → 킬 ability 문자열과 같은 키)
export const KEY_TOKENS = {
  "좌클릭": "Primary Fire", "좌": "Primary Fire", "lmb": "Primary Fire",
  "우클릭": "Secondary Fire", "우": "Secondary Fire", "rmb": "Secondary Fire",
  "쉬프트": "Ability 1", "shift": "Ability 1",
  "e": "Ability 2",
  "q": "Ultimate", "궁": "Ultimate", "궁극기": "Ultimate",
  "근접": "Melee", "v": "Melee",
};
const SINGLE_CHAR_KEYS = new Set(["e", "q", "v", "좌", "우"]);

// heroes.json 의 스킬 이름(ko·en·zh, 모든 키) + skillAliases
const SKILL_NAMES = new Set();
for (const h of HEROES) {
  for (const fld of ["skills", "skillsEn", "skillsZh"]) for (const v of Object.values(h[fld] || {})) if (v) SKILL_NAMES.add(norm(v));
  for (const names of Object.values(h.skillAliases || {})) for (const v of names) SKILL_NAMES.add(norm(v));
}

// 입력 전체가 기존 태그로 해석되는지 — OverallStats.addTag 의 영웅(정확)·맵(정확 또는 후보 1개인 부분 일치)과 같은 판정.
export function isExistingTag(text) {
  const clean = String(text ?? "").trim();
  if (!clean) return false;
  if (getHeroByName(clean) || resolveMapEntry(clean)) return true;
  return findMapEntriesByPartial(clean).length === 1;
}

// 입력 문구가 스킬·키 검색인지. 기존 동작을 지키려고 다음은 false:
//   reserved(기존 이벤트·결과 키워드: "궁극기"·"궁"·"킬"·"승" 등)와 입력 전체가 같음,
//   입력 전체가 기존 영웅·맵으로 해석됨(예: 맵 "Blizzard World" ⊃ 메이 궁 "Blizzard").
// 한 글자 키(e·q·v·좌·우)는 다른 토큰이 함께 있을 때만 키(서버 규칙과 같다).
export function isSkillQuery(text, reserved = []) {
  const clean = String(text ?? "").trim();
  if (!clean || reserved.includes(clean) || isExistingTag(clean)) return false;
  const toks = clean.split(/\s+/);
  for (let size = toks.length; size >= 1; size--) {
    for (let i = 0; i + size <= toks.length; i++) {
      if (SKILL_NAMES.has(norm(toks.slice(i, i + size).join("")))) return true;
    }
  }
  if (toks.some((t) => KEY_TOKENS[norm(t)] && !SINGLE_CHAR_KEYS.has(norm(t)))) return true;
  const singles = toks.filter((t) => SINGLE_CHAR_KEYS.has(norm(t)));
  return singles.length > 0 && singles.length < toks.length;
}

// 킬 이벤트 ability 문자열이 키와 같은지(기본 발사는 로그에 "0"·빈 값으로도 온다 — MatchStats getAbilityName 과 같은 판정)
export function abilityMatches(evAbility, key) {
  const a = String(evAbility ?? "").trim();
  const low = a.toLowerCase();
  if (key === "Primary Fire") return !a || a === "0" || a === "null" || low.includes("primary");
  if (key === "Secondary Fire") return low.includes("secondary");
  if (key === "Melee") return low.includes("melee");
  return a === key;
}

const sameHero = (a, b) => {
  const ka = getHeroByName(a)?.logName || norm(a);
  const kb = getHeroByName(b)?.logName || norm(b);
  return ka === kb;
};

// 서버 검색 결과 + 기존 매치(full-events 병합본, 영상 있는 매치만) → 스킬 장면 목록.
//   matches: OverallStats 의 baseMatches 중 영상 있는 것(순서 = /api/scrims 순서, 최신 세션 먼저)
//   search : /api/abilities/search 응답(rows·resolved·sources)
// 반환 원소: { match, source: 'use'|'kill'|'ult', ev(킬·궁 이벤트) | row(사용 행), timestamp, roundNumber, effectiveDelta,
//            player, hero, team, ability }. 정렬 = 매치 순서(최신 세션 먼저) → 같은 매치 안은 시각 오름차순.
export function buildSkillMoments(matches, search) {
  if (!search) return [];
  const skills = search.resolved?.skills || [];
  const pq = (search.resolved?.player_query || "").toLowerCase();
  const order = new Map(matches.map((m, i) => [m.id, i]));
  const out = [];
  const entryFor = (hero, pred) => skills.find((s) => (s.hero == null || sameHero(hero, s.hero)) && pred(s.ability));

  for (const r of search.rows || []) {
    const m = matches[order.get(r.match_id)];
    if (!m) continue;
    out.push({ match: m, source: "use", row: r, timestamp: r.timestamp, roundNumber: r.round_no, effectiveDelta: r.effective_delta || 0,
      player: r.player_name, hero: r.hero_name, team: r.team_name, ability: r.slot === 1 ? "Ability 1" : "Ability 2" });
  }
  const wantKills = search.sources?.kills, wantUlts = search.sources?.ultimate_starts;
  if (skills.length && (wantKills || wantUlts)) {
    for (const m of matches) {
      for (const rnd of m.rounds || []) {
        for (const ev of rnd.events || []) {
          if (pq && !(ev.player_name || "").toLowerCase().includes(pq)) continue;
          let source = null, entry = null;
          if (wantKills && ev.event_type === "kill") {
            entry = entryFor(ev.player_hero, (k) => abilityMatches(ev.ability, k));
            source = "kill";
          } else if (wantUlts && ev.event_type === "ultimate_start") {
            entry = entryFor(ev.player_hero, (k) => k === "Ultimate");
            source = "ult";
          }
          if (!entry) continue;
          out.push({ match: m, source, ev, timestamp: ev.timestamp, roundNumber: rnd.round_number, effectiveDelta: rnd.effective_delta || 0,
            player: ev.player_name, hero: ev.player_hero, team: ev.player_team, ability: entry.ability });
        }
      }
    }
  }
  out.sort((a, b) => (order.get(a.match.id) - order.get(b.match.id)) || (a.timestamp - b.timestamp));
  return out;
}
