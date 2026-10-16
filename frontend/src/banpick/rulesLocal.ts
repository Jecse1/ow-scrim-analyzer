/* 밴픽 규칙 프리셋 — SOLO(로컬) 해석기.
 *
 * ‼ 서버 backend/banpick/state.py · ruleset.py 와 "같은 의미"로 유지한다. 한쪽을 바꾸면 다른 쪽도 바꾼다.
 *   1v1 은 서버가 판정하고, 여기 함수는 서버가 없는 SOLO 모드가 같은 규칙으로 동작하게 하는 복제본이다.
 *   대응표(이 파일 ↔ state.py / ruleset.py):
 *     DEFAULT_RULESET     ↔ ruleset.DEFAULT
 *     normalizeRuleset    ↔ ruleset.load_ruleset 의 DEFAULT 병합(검증은 서버 몫, 여기선 형식이 틀리면 default)
 *     banSequence         ↔ state._begin_bans (banOrder → 팀 배열 banSeq)
 *     banQuotaOf          ↔ apply_ban 의 len(bans[team]) >= seq.count(team)
 *     repeatBlocked       ↔ state._repeat_blocked
 *     roleBanCountOf      ↔ state["roleBanCount"] (이번 세트 밴 역할 합산)
 *     banRejectReason     ↔ state.apply_ban 의 거부 조건 순서
 *     setModeLabel        ↔ state._set_mode_label
 *     firstSetChooser     ↔ state._start_next_set 의 1세트 선택권(firstSet host)
 *     nextSetMapPlan      ↔ state._start_next_set 의 fixed 맵풀 후보·자동 배정
 *     modeWindow          ↔ mapPool.noRepeatModeWithin (state._map_pickable · apply_set_result)
 *   단위 테스트: rulesLocal.test.ts (default·RL5 값). 서버 쪽은 backend/banpick/test_ruleset.py.
 */

export type Team = "A" | "B";
export type RepeatScope = "none" | "previousSet" | "allSets";

export type Ruleset = {
  name: string;
  bansPerSet: number;
  banOrder: ("first" | "second")[];
  roleCapPerSet: number;
  banRepeat: { scope: RepeatScope; perTeam: boolean };
  setStart: { loserChooses: string[]; firstSet: "config" | "host" };
  mapPool: {
    mode: "free" | "fixed";
    noRepeatModeWithin?: number;
    modes?: Record<string, string[]>;
    sequence?: Record<string, string[]>;
    reuse?: string;
  };
};

/** 세트 스냅샷 중 규칙 계산에 필요한 부분(BanpickApp SetSnapshot 의 부분집합). */
export type SetLike = { bans: Record<Team, string[]>; map: string | null; winner?: Team | null };

// ruleset.py DEFAULT 와 동일(현행 규칙 동치).
export const DEFAULT_RULESET: Ruleset = {
  name: "default",
  bansPerSet: 2,
  banOrder: ["first", "second"],
  roleCapPerSet: 1,
  banRepeat: { scope: "allSets", perTeam: true },
  setStart: { loserChooses: ["map", "banOrder"], firstSet: "config" },
  mapPool: { mode: "free", noRepeatModeWithin: 5 },
};

// ruleset.TYPE_TO_MODE — maps.json banpick.type(영문) ↔ 모드 라벨(한글)
export const TYPE_TO_MODE: Record<string, string> = {
  Control: "쟁탈", Escort: "화물", Hybrid: "혼합", Push: "밀기", Flashpoint: "플래시포인트", Clash: "격돌",
};

export const otherTeam = (t: Team): Team => (t === "A" ? "B" : "A");

/** 서버 응답(이미 DEFAULT 병합됨)을 받아 형식만 확인. 이상하면 default(SOLO 가 서버 없이도 열리게). */
export function normalizeRuleset(raw: any): Ruleset {
  if (!raw || typeof raw !== "object") return DEFAULT_RULESET;
  const rs: Ruleset = {
    ...DEFAULT_RULESET,
    ...raw,
    banRepeat: { ...DEFAULT_RULESET.banRepeat, ...(raw.banRepeat || {}) },
    setStart: { ...DEFAULT_RULESET.setStart, ...(raw.setStart || {}) },
    mapPool: { ...DEFAULT_RULESET.mapPool, ...(raw.mapPool || {}) },
  };
  const okOrder = Array.isArray(rs.banOrder) && rs.banOrder.length === rs.bansPerSet
    && rs.banOrder.every((x) => x === "first" || x === "second");
  const okFixed = rs.mapPool.mode !== "fixed" || (!!rs.mapPool.modes && !!rs.mapPool.sequence);
  if (!okOrder || !okFixed || !(rs.roleCapPerSet >= 1)) return DEFAULT_RULESET;
  return rs;
}

/** default 와 값이 같은지(이름 무관). SOLO 에서 기존 화면을 그대로 두기 위한 판정. */
export function isDefaultRuleset(rs: Ruleset): boolean {
  const strip = (r: Ruleset) => JSON.stringify({ ...r, name: "" });
  return strip(rs) === strip(DEFAULT_RULESET);
}

/** state._begin_bans: 선밴 팀(starter) 기준으로 banOrder 를 팀 배열로 전개. */
export function banSequence(rs: Ruleset, starter: Team): Team[] {
  return rs.banOrder.map((x) => (x === "first" ? starter : otherTeam(starter)));
}

/** 팀별 이번 세트 밴 수(= banSeq 안 등장 횟수). */
export function banQuotaOf(seq: Team[]): Record<Team, number> {
  return { A: seq.filter((x) => x === "A").length, B: seq.filter((x) => x === "B").length };
}

/** state._repeat_blocked: 재밴 금지 영웅 집합. */
export function repeatBlocked(rs: Ruleset, completedSets: SetLike[], team: Team): Set<string> {
  const { scope, perTeam } = rs.banRepeat;
  const out = new Set<string>();
  if (scope === "none") return out;
  const sets = scope === "previousSet" ? completedSets.slice(-1) : completedSets;
  const teams: Team[] = perTeam ? [team] : ["A", "B"];
  sets.forEach((s) => teams.forEach((tm) => (s.bans?.[tm] || []).forEach((h) => out.add(h))));
  return out;
}

/** 이번 세트 역할별 밴 수(양 팀 합산). roleOf: 영웅 id → 역할. */
export function roleBanCountOf(bans: Record<Team, string[]>, roleOf: (id: string) => string | undefined): Record<string, number> {
  const c: Record<string, number> = {};
  bans.A.concat(bans.B).forEach((id) => {
    const r = roleOf(id);
    if (r) c[r] = (c[r] ?? 0) + 1;
  });
  return c;
}

/** state.apply_ban 의 거부 조건(같은 순서). null = 밴 가능. */
export function banRejectReason(
  rs: Ruleset,
  a: { team: Team; heroId: string; role: string; bans: Record<Team, string[]>; banSeq: Team[]; completedSets: SetLike[]; roleOf: (id: string) => string | undefined },
): string | null {
  if (a.bans[a.team].length >= banQuotaOf(a.banSeq)[a.team]) return "already banned this set";
  if (repeatBlocked(rs, a.completedSets, a.team).has(a.heroId)) return "banned in a previous set";
  if ((roleBanCountOf(a.bans, a.roleOf)[a.role] ?? 0) >= rs.roleCapPerSet) return "role ban cap reached";
  if (a.bans.A.includes(a.heroId) || a.bans.B.includes(a.heroId)) return "already banned";
  return null;
}

/** state._set_mode_label: fixed 맵풀에서 이번 세트 모드 라벨(free·범위 밖이면 null). */
export function setModeLabel(rs: Ruleset, sets: number, completedCount: number): string | null {
  if (rs.mapPool.mode !== "fixed") return null;
  const seq = rs.mapPool.sequence?.[`bo${sets}`] || [];
  return completedCount < seq.length ? seq[completedCount] : null;
}

/** state._start_next_set 1세트 선택권: firstSet "host" 이고 설정이 랜덤(AUTO)이면 방장(A). */
export function firstSetChooser(rs: Ruleset, firstSetPicker: "AUTO" | Team, rand: () => number = Math.random): Team {
  let fsp = firstSetPicker;
  if (rs.setStart.firstSet === "host" && fsp === "AUTO") fsp = "A";
  return fsp === "AUTO" ? (rand() < 0.5 ? "A" : "B") : fsp;
}

/** state._start_next_set fixed 맵풀 부분: 이번 세트 모드·후보 맵·자동 배정 맵.
 *  mapTypeOf: 맵 id → banpick.type(영문). heroBanOnly(모드1)이면 맵 단계가 없어 계산하지 않는다. */
export function nextSetMapPlan(
  rs: Ruleset,
  a: { sets: number; completedSets: SetLike[]; usedMaps: Iterable<string>; heroBanOnly: boolean; mapTypeOf: (id: string) => string | undefined },
): { setMode: string | null; mapChoices: string[] | null; autoMap: string | null } {
  const label = setModeLabel(rs, a.sets, a.completedSets.length);
  if (!label || a.heroBanOnly) return { setMode: null, mapChoices: null, autoMap: null };
  const used = new Set(a.usedMaps);
  const choices = (rs.mapPool.modes?.[label] || []).filter((m) => !used.has(m));
  const seen = a.completedSets.some((s) => !!s.map && TYPE_TO_MODE[a.mapTypeOf(s.map) ?? ""] === label);
  const auto = choices.length > 0 && (seen || !rs.setStart.loserChooses.includes("map") || choices.length === 1);
  return { setMode: label, mapChoices: choices, autoMap: auto ? choices[0] : null };
}

/** 같은 모드 반복 금지 창(free 맵풀). */
export function modeWindow(rs: Ruleset): number {
  return rs.mapPool.noRepeatModeWithin ?? 5;
}
