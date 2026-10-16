// rulesLocal.ts 단위 테스트 — default(현행 규칙 동치)와 합성 4밴 프리셋(backend/banpick/test_ruleset.py 의 SYNTH 와 같은 값).
import { describe, expect, it } from "vitest";
import { BANPICK_HEROES, BANPICK_MAPS } from "../gameData";
import {
  DEFAULT_RULESET, normalizeRuleset, isDefaultRuleset, banSequence, banQuotaOf, repeatBlocked, roleBanCountOf,
  banRejectReason, setModeLabel, firstSetChooser, nextSetMapPlan, modeWindow, type Ruleset, type SetLike, type Team,
} from "./rulesLocal";

const SYNTH: Ruleset = {
  name: "synthetic-4ban",
  bansPerSet: 4,
  banOrder: ["first", "second", "second", "first"],
  roleCapPerSet: 2,
  banRepeat: { scope: "previousSet", perTeam: true },
  setStart: { loserChooses: ["map", "banOrder"], firstSet: "host" },
  mapPool: {
    mode: "fixed",
    modes: {
      쟁탈: ["busan", "samoa"], 혼합: ["neoncross", "paraiso"], 밀기: ["lunasafi", "colosseo"],
      화물: ["rialto", "grimsvotn"], 플래시포인트: ["suravasa", "atliss"],
    },
    sequence: {
      bo3: ["쟁탈", "혼합", "플래시포인트"],
      bo5: ["쟁탈", "혼합", "플래시포인트", "화물", "밀기"],
      bo7: ["쟁탈", "혼합", "플래시포인트", "화물", "밀기", "혼합", "쟁탈"],
    },
    reuse: "remaining-auto",
  },
};

const roleOf = (id: string) => (BANPICK_HEROES as any[]).find((h) => h.id === id)?.role;
const mapTypeOf = (id: string) => (BANPICK_MAPS as any[]).find((m) => m.id === id)?.type;
const ofRole = (r: string) => (BANPICK_HEROES as any[]).filter((h) => h.role === r).map((h) => h.id as string);
const [T1, T2, T3] = ofRole("Tank");
const [D1] = ofRole("Damage");
const set = (A: string[], B: string[], map: string | null = null, winner: Team | null = "A"): SetLike => ({ bans: { A, B }, map, winner });
const reject = (rs: Ruleset, team: Team, heroId: string, bans: Record<Team, string[]>, banSeq: Team[], completedSets: SetLike[] = []) =>
  banRejectReason(rs, { team, heroId, role: roleOf(heroId)!, bans, banSeq, completedSets, roleOf });

describe("default 프리셋 = 현행 규칙", () => {
  it("밴 순서: 선밴 팀 1 → 상대 1, 팀당 1개", () => {
    expect(banSequence(DEFAULT_RULESET, "B")).toEqual(["B", "A"]);
    expect(banQuotaOf(banSequence(DEFAULT_RULESET, "A"))).toEqual({ A: 1, B: 1 });
  });
  it("역할 상한 1 = 기존 역할 선점: 상대가 탱커를 밴하면 탱커 거부, 팀 2번째 밴 거부", () => {
    const seq = banSequence(DEFAULT_RULESET, "A");
    expect(reject(DEFAULT_RULESET, "A", T1, { A: [], B: [] }, seq)).toBeNull();
    expect(reject(DEFAULT_RULESET, "B", T2, { A: [T1], B: [] }, seq)).toBe("role ban cap reached");
    expect(reject(DEFAULT_RULESET, "B", D1, { A: [T1], B: [] }, seq)).toBeNull();
    expect(reject(DEFAULT_RULESET, "A", D1, { A: [T1], B: [] }, seq)).toBe("already banned this set");
  });
  it("재밴 금지: 과거 전 세트의 자기 팀 밴만", () => {
    const sets = [set([T1], [D1]), set([T2], [T3])];
    expect([...repeatBlocked(DEFAULT_RULESET, sets, "A")].sort()).toEqual([T1, T2].sort());
    expect(reject(DEFAULT_RULESET, "A", T1, { A: [], B: [] }, ["A", "B"], sets)).toBe("banned in a previous set");
    expect(reject(DEFAULT_RULESET, "A", D1, { A: [], B: [] }, ["A", "B"], sets)).toBeNull(); // 상대가 밴했던 영웅은 가능
  });
  it("맵: free 맵풀이라 후보·자동 배정 없음, 모드 반복 창 5, 1세트 선택권은 설정값", () => {
    expect(nextSetMapPlan(DEFAULT_RULESET, { sets: 3, completedSets: [], usedMaps: [], heroBanOnly: false, mapTypeOf }))
      .toEqual({ setMode: null, mapChoices: null, autoMap: null });
    expect(modeWindow(DEFAULT_RULESET)).toBe(5);
    expect(firstSetChooser(DEFAULT_RULESET, "AUTO", () => 0.7)).toBe("B");
    expect(firstSetChooser(DEFAULT_RULESET, "B")).toBe("B");
  });
  it("조회 실패·형식 오류는 default, 이름만 다른 default 는 default 로 판정", () => {
    expect(normalizeRuleset(null)).toBe(DEFAULT_RULESET);
    expect(normalizeRuleset({ bansPerSet: 3, banOrder: ["first"] })).toBe(DEFAULT_RULESET);
    expect(isDefaultRuleset(normalizeRuleset({ ...DEFAULT_RULESET, name: "x" }))).toBe(true);
    expect(isDefaultRuleset(normalizeRuleset(SYNTH))).toBe(false);
  });
  it("roleBanCountOf: 이번 세트 역할별 합산", () => {
    expect(roleBanCountOf({ A: [T1, D1], B: [T2] }, roleOf)).toEqual({ Tank: 2, Damage: 1 });
  });
});

describe("합성 4밴 프리셋(SYNTH)", () => {
  it("밴 순서 1/2,3/4: 선밴·후밴·후밴·선밴, 팀당 2개", () => {
    expect(banSequence(SYNTH, "A")).toEqual(["A", "B", "B", "A"]);
    expect(banQuotaOf(banSequence(SYNTH, "B"))).toEqual({ A: 2, B: 2 });
  });
  it("역할 상한 2(양 팀 합산): 탱커 2개 뒤 3번째 탱커 거부", () => {
    const seq = banSequence(SYNTH, "A");
    expect(reject(SYNTH, "B", T2, { A: [T1], B: [] }, seq)).toBeNull();
    expect(reject(SYNTH, "B", T3, { A: [T1], B: [T2] }, seq)).toBe("role ban cap reached");
    expect(reject(SYNTH, "A", D1, { A: [T1, T2], B: [] }, seq)).toBe("already banned this set");
  });
  it("재밴 금지 previousSet: 직전 세트 자기 팀 밴만, 두 세트 전·상대 밴은 가능", () => {
    const sets = [set([T3], []), set([T1], [T2])];
    expect([...repeatBlocked(SYNTH, sets, "A")]).toEqual([T1]);
    expect(reject(SYNTH, "A", T1, { A: [], B: [] }, ["A", "B", "B", "A"], sets)).toBe("banned in a previous set");
    expect(reject(SYNTH, "A", T3, { A: [], B: [] }, ["A", "B", "B", "A"], sets)).toBeNull();
    expect(reject(SYNTH, "A", T2, { A: [], B: [] }, ["A", "B", "B", "A"], sets)).toBeNull();
  });
  it("1세트: 방장 지정(랜덤이면 A), 후보 = 쟁탈 2맵, 자동 배정 없음", () => {
    expect(firstSetChooser(SYNTH, "AUTO", () => 0.9)).toBe("A");
    expect(firstSetChooser(SYNTH, "B")).toBe("B");
    expect(setModeLabel(SYNTH, 3, 0)).toBe("쟁탈");
    expect(nextSetMapPlan(SYNTH, { sets: 3, completedSets: [], usedMaps: [], heroBanOnly: false, mapTypeOf }))
      .toEqual({ setMode: "쟁탈", mapChoices: ["busan", "samoa"], autoMap: null });
  });
  it("BO7 6·7세트: 같은 모드 재등장 → 안 쓴 맵 자동 배정", () => {
    const done = [set([], [], "busan"), set([], [], "neoncross"), set([], [], "suravasa"), set([], [], "rialto"), set([], [], "lunasafi")];
    const used = done.map((s) => s.map!);
    expect(nextSetMapPlan(SYNTH, { sets: 7, completedSets: done, usedMaps: used, heroBanOnly: false, mapTypeOf }))
      .toEqual({ setMode: "혼합", mapChoices: ["paraiso"], autoMap: "paraiso" });
    const done6 = done.concat([set([], [], "paraiso")]);
    expect(nextSetMapPlan(SYNTH, { sets: 7, completedSets: done6, usedMaps: used.concat("paraiso"), heroBanOnly: false, mapTypeOf }))
      .toEqual({ setMode: "쟁탈", mapChoices: ["samoa"], autoMap: "samoa" });
  });
  it("모드1(밴만)은 맵 계획 없음", () => {
    expect(nextSetMapPlan(SYNTH, { sets: 3, completedSets: [], usedMaps: [], heroBanOnly: true, mapTypeOf }).mapChoices).toBeNull();
  });
});
