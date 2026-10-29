import { describe, it, expect } from "vitest";
import { isSkillQuery, abilityMatches, buildSkillMoments, KEY_TOKENS } from "./skillSearch";
import { HEROES, MAPS } from "../gameData";

// OverallStats.jsx 의 EVENT_KEYWORDS·RESULT_KEYWORDS 키와 같은 목록(그쪽을 바꾸면 여기도 맞출 것)
const EVENT_KEYS = ["궁극기", "궁", "ult", "처치", "킬", "kill", "죽음", "데스", "death"];
const RESULT_KEYS = ["승리", "승", "win", "패배", "패", "loss", "lose", "무승부", "무", "draw"];
const RESERVED = [...EVENT_KEYS, ...RESULT_KEYS];

describe("isSkillQuery — 스킬·키 토큰이 없는 입력은 기존 태그 분류 그대로", () => {
  it("이벤트·결과 키워드 단독은 기존 동작(\"궁극기\"·\"궁\" 포함)", () => {
    for (const k of RESERVED) expect(isSkillQuery(k, RESERVED), k).toBe(false);
  });
  it("모든 영웅 이름·별칭과 모든 맵 이름은 스킬 검색으로 가지 않는다", () => {
    const heroForms = HEROES.flatMap((h) => [h.logName, h.ko, h.en, h.displayKo, ...(h.aliases || [])]).filter(Boolean);
    for (const n of heroForms) expect(isSkillQuery(n, RESERVED), n).toBe(false);
    const mapForms = MAPS.flatMap((m) => [m.ko, m.en, ...(m.aliases || [])]).filter(Boolean);
    for (const n of mapForms) expect(isSkillQuery(n, RESERVED), n).toBe(false);
  });
  it("선수명·선수+영웅 문구·한 글자 키 단독은 기존 동작", () => {
    for (const q of ["Someone", "CheckMate", "A2", "someone 오리사", "someone 트레이서", "e", "E", "q", "v", "좌", "우", "e q", "", "   "]) {
      expect(isSkillQuery(q, RESERVED), q).toBe(false);
    }
  });
  it("스킬명·키 토큰이 든 문구는 스킬 검색", () => {
    for (const q of ["someone 오리사 우클릭", "someone 오리사 투창", "트레이서 shift", "점멸", "Blink", "수호의 창",
      "someone e", "트레이서 q", "A2 궁", "불사조 부활", "Vermillion Revival", "우클릭", "근접", "LMB", "구르기"]) {
      expect(isSkillQuery(q, RESERVED), q).toBe(true);
    }
  });
  it("키 토큰 표는 서버(ability_query.KEY_TOKENS)와 같은 18종", () => {
    expect(Object.keys(KEY_TOKENS).sort()).toEqual(
      ["e", "lmb", "q", "rmb", "shift", "v", "궁", "궁극기", "근접", "우", "우클릭", "좌", "좌클릭", "쉬프트"].sort());
  });
});

describe("abilityMatches", () => {
  it("기본 발사는 0·빈 값도, 나머지는 원래 키", () => {
    expect(abilityMatches("0", "Primary Fire")).toBe(true);
    expect(abilityMatches("Primary Fire", "Primary Fire")).toBe(true);
    expect(abilityMatches("Secondary Fire", "Secondary Fire")).toBe(true);
    expect(abilityMatches("Melee", "Melee")).toBe(true);
    expect(abilityMatches("Ability 1", "Ability 1")).toBe(true);
    expect(abilityMatches("Ability 1", "Ability 2")).toBe(false);
    expect(abilityMatches("Secondary Fire", "Primary Fire")).toBe(false);
  });
});

const ev = (type, ts, player, hero, ability, extra = {}) => ({ event_type: type, timestamp: ts, player_name: player, player_hero: hero, ability, player_team: "FLC", target_name: "X", ...extra });
const M1 = { id: "m1", map_name: "일리오스", rounds: [{ round_number: 1, effective_delta: 0, events: [
  ev("kill", 50, "Someone", "오리사", "Secondary Fire"),
  ev("kill", 60, "Someone", "오리사", "Primary Fire"),
  ev("kill", 70, "Other", "오리사", "Secondary Fire"),
  ev("ultimate_start", 80, "Someone", "오리사", "Ultimate"),
  ev("kill", 90, "Someone", "트레이서", "Ability 1"),
] }] };
const M2 = { id: "m2", map_name: "리장 타워", rounds: [{ round_number: 2, effective_delta: 7, events: [
  ev("kill", 10, "someone2", "오리사", "Secondary Fire"),
] }] };

describe("buildSkillMoments", () => {
  it("우클릭(결정타만): 선수 부분 일치·영웅·키가 맞는 킬, 매치 순서 → 시각 순", () => {
    const search = { rows: [], resolved: { player_query: "someone", skills: [{ hero: "오리사", ability: "Secondary Fire" }] },
      sources: { ability_uses: false, kills: true, ultimate_starts: false, use_records: false } };
    const out = buildSkillMoments([M2, M1], search);
    expect(out.map((x) => [x.match.id, x.source, x.timestamp])).toEqual([["m2", "kill", 10], ["m1", "kill", 50]]);
    expect(out[0].effectiveDelta).toBe(7);
  });
  it("Ability 1: 서버 사용 장면 + 같은 스킬 결정타를 합쳐 시각 순", () => {
    const search = { rows: [{ match_id: "m1", round_no: 1, game_time: 30, timestamp: 88, effective_delta: 0, player_name: "Someone", hero_name: "트레이서", slot: 1, team_name: "FLC" }],
      resolved: { player_query: "someone", skills: [{ hero: "트레이서", ability: "Ability 1" }] },
      sources: { ability_uses: true, kills: true, ultimate_starts: false, use_records: true } };
    const out = buildSkillMoments([M1], search);
    expect(out.map((x) => [x.source, x.timestamp, x.ability])).toEqual([["use", 88, "Ability 1"], ["kill", 90, "Ability 1"]]);
  });
  it("궁극기: ultimate_start + 궁극기 결정타, 영웅 없는 키는 모든 영웅", () => {
    const search = { rows: [], resolved: { player_query: "someone", skills: [{ hero: null, ability: "Ultimate" }] },
      sources: { ability_uses: false, kills: true, ultimate_starts: true, use_records: true } };
    const out = buildSkillMoments([M1], search);
    expect(out.map((x) => [x.source, x.timestamp])).toEqual([["ult", 80]]);
  });
  it("검색 결과가 없거나 해석된 스킬이 없으면 빈 목록", () => {
    expect(buildSkillMoments([M1], null)).toEqual([]);
    expect(buildSkillMoments([M1], { rows: [], resolved: { skills: [] }, sources: { kills: true } })).toEqual([]);
  });
});
