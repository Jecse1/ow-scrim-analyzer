// 스킬 분석 탭(SkillScenesStats.jsx) 순수 헬퍼 — 요청 쿼리·스킬 라벨·시간 표시·VOD 링크.
// 서버 API: /api/abilities/options · /api/abilities/scenes (backend/routers/abilities.py).
import { buildVideoLink, hasVideo } from "./videoLink";

export const SKILL_KEYS = { 1: "Shift", 2: "E" };   // 슬롯 → 키(로그 Ability 1 = Shift, Ability 2 = E)

// 필터 → /api/abilities/scenes 쿼리 문자열(빈 값은 빼고, 순서 고정 — 같은 조건이면 같은 URL).
export function scenesQuery(f) {
  const q = new URLSearchParams();
  const put = (k, v) => { if (v !== undefined && v !== null && v !== "" && v !== false) q.set(k, String(v)); };
  put("player", f.player);
  put("hero", f.hero);
  put("slot", f.slot);
  put("date_from", f.dateFrom);
  put("date_to", f.dateTo);
  put("opponent", f.opponent);
  put("map", f.map);
  put("group", f.group ? "true" : "");
  put("sort", f.sort && f.sort !== "date_desc" ? f.sort : "");
  put("page", f.page && f.page > 1 ? f.page : "");
  return q.toString();
}

// 스킬 표시명: 서버 hero_skills[hero][slot][lang](en/zh 는 서버가 이미 en→ko 로 대체) → 없으면 "스킬1/2".
export function skillName(heroSkills, hero, slot, lang, t) {
  const n = heroSkills?.[hero]?.[String(slot)]?.[lang] || heroSkills?.[hero]?.[String(slot)]?.ko;
  return n || (slot === 1 ? t.skSkill1Fallback : t.skSkill2Fallback);
}

// 스킬 버튼 라벨 "점멸 · Shift" (이름 없으면 "스킬1 · Shift")
export function skillLabel(heroSkills, hero, slot, lang, t) {
  return `${skillName(heroSkills, hero, slot, lang, t)} · ${SKILL_KEYS[slot]}`;
}

// 단계 선택(선수 → 영웅 → 스킬). 같은 값을 다시 고르면 그대로.
// 선수를 고르면 최다 플레이 영웅(topHero) + 스킬1, 영웅을 바꾸면 스킬1 을 자동 선택해 결과를 바로 보인다.
export function pickStep(f, key, value, topHero) {
  if (f[key] === value) return f;
  if (key === "player") return { ...f, page: 1, player: value, hero: topHero || "", slot: topHero ? 1 : "" };
  if (key === "hero") return { ...f, page: 1, hero: value, slot: value ? 1 : "" };
  return { ...f, page: 1, [key]: value };
}

export const MIN_HERO_CARD_SEC = 60;   // 영웅 카드 기본 표시 하한(1분 미만은 "+n" 으로 접음)

// 영웅 카드 표시 목록: 접힘이면 1분 미만은 숨기되 선택 중인 영웅은 남긴다. hidden = 숨긴 수
export function visibleHeroes(heroes, selected, expanded) {
  const all = heroes || [];
  if (expanded) return { shown: all, hidden: 0 };
  const shown = all.filter((h) => h.seconds >= MIN_HERO_CARD_SEC || h.hero === selected);
  return { shown, hidden: all.length - shown.length };
}

// 결과 행 → 매치 머리줄을 끼운 목록. 매치가 바뀔 때마다(페이지 첫 행 포함) 머리줄 1개. 행 순서는 그대로.
export function withMatchHeads(rows) {
  const out = [];
  let prev = null;
  rows.forEach((r, i) => {
    if (r.match_id !== prev) out.push({ head: true, match_id: r.match_id, key: `h-${r.match_id}-${i}` });
    out.push({ head: false, row: r, i });
    prev = r.match_id;
  });
  return out;
}

// 지금 골라야 할 단계: player → hero → slot, 다 골랐으면 null
export function currentStep(f) {
  if (!f.player) return "player";
  if (!f.hero) return "hero";
  if (!f.slot) return "slot";
  return null;
}

// 보조 필터 중 기본값이 아닌 것의 수(모바일 "필터" 접기 버튼에 표시)
export function activeFilterCount(f) {
  return [f.dateFrom, f.dateTo, f.opponent, f.map, f.group, f.sort && f.sort !== "date_desc"].filter(Boolean).length;
}

// 게임 시계(초) → m:ss
export function fmtClock(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// 플레이 시간(초) → "12.3h" / "45m"
export function fmtPlayTime(sec) {
  const s = Number(sec) || 0;
  return s >= 3600 ? `${(s / 3600).toFixed(1)}h` : `${Math.round(s / 60)}m`;
}

// 장면 행 → VOD 링크(없으면 null). 기존 buildVideoLink 그대로 — 리드 보정 추가 없음(timestamp 는 events 와 같은 −2초 값).
export function sceneVodUrl(match, row) {
  if (!match || !hasVideo(match.video_url)) return null;
  return buildVideoLink(match.video_url, row.timestamp, match, undefined, row.effective_delta || 0);
}

// 선택지 선수 목록 → 우리 팀 / 상대 두 묶음(이름순 유지)
export function splitPlayers(players) {
  const ours = [], others = [];
  for (const p of players || []) (p.ours ? ours : others).push(p);
  return { ours, others };
}
