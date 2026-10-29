import { describe, it, expect } from "vitest";
import { scenesQuery, skillName, skillLabel, fmtClock, fmtPlayTime, sceneVodUrl, splitPlayers, pickStep, currentStep, activeFilterCount, visibleHeroes, withMatchHeads, MIN_HERO_CARD_SEC } from "./skillScenes";
import { buildVideoLink } from "./videoLink";
import ko from "../i18n/ko";

const SKILLS = {
  "트레이서": { "1": { ko: "점멸", en: "Blink", zh: "闪现" }, "2": { ko: "시간 역행", en: "Recall", zh: "闪回" } },
  "미지": { "1": { ko: null, en: null, zh: null }, "2": { ko: null, en: null, zh: null } },
};

describe("scenesQuery", () => {
  it("빈 값·기본값은 빼고 순서를 고정한다", () => {
    expect(scenesQuery({ player: "A2", hero: "트레이서", slot: 1, group: false, sort: "date_desc", page: 1 }))
      .toBe("player=A2&hero=%ED%8A%B8%EB%A0%88%EC%9D%B4%EC%84%9C&slot=1");
    expect(scenesQuery({ player: "A2", dateFrom: "2026-10-01", dateTo: "", opponent: "T1", map: "일리오스", group: true, sort: "date_asc", page: 3 }))
      .toBe("player=A2&date_from=2026-10-01&opponent=T1&map=%EC%9D%BC%EB%A6%AC%EC%98%A4%EC%8A%A4&group=true&sort=date_asc&page=3");
  });
});

describe("스킬 라벨", () => {
  it("언어별 이름 + 키, 이름이 없으면 스킬1/2", () => {
    expect(skillLabel(SKILLS, "트레이서", 1, "ko", ko)).toBe("점멸 · Shift");
    expect(skillLabel(SKILLS, "트레이서", 2, "en", ko)).toBe("Recall · E");
    expect(skillName(SKILLS, "미지", 1, "ko", ko)).toBe(ko.skSkill1Fallback);
    expect(skillLabel(SKILLS, "", 1, "ko", ko)).toBe(`${ko.skSkill1Fallback} · Shift`);
    expect(skillName(SKILLS, "없는영웅", 2, "zh", ko)).toBe(ko.skSkill2Fallback);
  });
});

describe("시간 표시", () => {
  it("게임 시계 m:ss, 플레이 시간 h/m", () => {
    expect(fmtClock(0)).toBe("0:00");
    expect(fmtClock(402.5)).toBe("6:42");
    expect(fmtPlayTime(57936.71)).toBe("16.1h");
    expect(fmtPlayTime(1400)).toBe("23m");
  });
});

describe("sceneVodUrl", () => {
  const match = { video_url: "https://youtu.be/abc?t=5", video_offset: 100, game_setup_sec: 74, pauses: [{ start_sec: 200, end_sec: 230 }] };
  it("buildVideoLink 와 같은 값(리드 보정 추가 없음)", () => {
    const row = { timestamp: 159, effective_delta: 7 };
    expect(sceneVodUrl(match, row)).toBe(buildVideoLink(match.video_url, 159, match, undefined, 7));
    // 100 + 7 + (159 − 74) = 192 → 퍼즈(200 이후) 영향 없음
    expect(sceneVodUrl(match, row)).toBe("https://youtu.be/abc?t=192");
    // 퍼즈 시작 뒤 장면은 퍼즈 길이만큼 밀린다: 100 + 0 + (204 − 74) = 230 → +30
    expect(sceneVodUrl(match, { timestamp: 204, effective_delta: 0 })).toBe("https://youtu.be/abc?t=260");
  });
  it("영상이 없으면 null", () => {
    expect(sceneVodUrl({ ...match, video_url: "" }, { timestamp: 1 })).toBeNull();
    expect(sceneVodUrl(undefined, { timestamp: 1 })).toBeNull();
  });
});

describe("splitPlayers", () => {
  it("우리 팀/상대로 나눈다", () => {
    const r = splitPlayers([{ name: "A", ours: true }, { name: "B", ours: false }, { name: "C", ours: true }]);
    expect(r.ours.map((p) => p.name)).toEqual(["A", "C"]);
    expect(r.others.map((p) => p.name)).toEqual(["B"]);
  });
});

describe("단계 선택", () => {
  const base = { player: "", hero: "", slot: "", dateFrom: "2026-10-01", opponent: "T1", page: 3 };
  it("선수를 고르면 최다 플레이 영웅 + 스킬1, 보조 필터는 유지", () => {
    const a = pickStep(base, "player", "A2", "트레이서");
    expect(a).toMatchObject({ player: "A2", hero: "트레이서", slot: 1, dateFrom: "2026-10-01", opponent: "T1", page: 1 });
    expect(pickStep(base, "player", "A2", undefined)).toMatchObject({ player: "A2", hero: "", slot: "" });   // 영웅 기록 없음
    expect(pickStep(a, "player", "", undefined)).toMatchObject({ player: "", hero: "", slot: "" });
  });
  it("영웅을 바꾸면 스킬1", () => {
    const f = { ...base, player: "A2", hero: "트레이서", slot: 2 };
    expect(pickStep(f, "hero", "겐지")).toMatchObject({ player: "A2", hero: "겐지", slot: 1, page: 1 });
    expect(pickStep(f, "slot", 1)).toMatchObject({ hero: "트레이서", slot: 1 });
  });
  it("같은 값을 다시 고르면 바뀌지 않는다", () => {
    const f = { ...base, player: "A2", hero: "트레이서", slot: 2 };
    expect(pickStep(f, "hero", "트레이서")).toBe(f);
    expect(pickStep(f, "player", "A2", "겐지")).toBe(f);
  });
  it("현재 단계", () => {
    expect(currentStep(base)).toBe("player");
    expect(currentStep({ ...base, player: "A2" })).toBe("hero");
    expect(currentStep({ ...base, player: "A2", hero: "트레이서" })).toBe("slot");
    expect(currentStep({ ...base, player: "A2", hero: "트레이서", slot: 2 })).toBe(null);
  });
  it("기본값이 아닌 보조 필터 수", () => {
    expect(activeFilterCount({ sort: "date_desc", group: false })).toBe(0);
    expect(activeFilterCount({ dateFrom: "2026-10-01", map: "일리오스", group: true, sort: "date_asc" })).toBe(4);
  });
});

describe("영웅 카드 접기", () => {
  const hs = [{ hero: "트레이서", seconds: 5000 }, { hero: "겐지", seconds: MIN_HERO_CARD_SEC }, { hero: "솜브라", seconds: 59 }, { hero: "한조", seconds: 0 }];
  it("1분 미만은 숨기고 숨긴 수를 센다, 선택 중이면 남긴다", () => {
    expect(visibleHeroes(hs, "트레이서", false)).toEqual({ shown: hs.slice(0, 2), hidden: 2 });
    expect(visibleHeroes(hs, "솜브라", false)).toEqual({ shown: hs.slice(0, 3), hidden: 1 });
    expect(visibleHeroes(hs, "트레이서", true)).toEqual({ shown: hs, hidden: 0 });
    expect(visibleHeroes(undefined, "", false)).toEqual({ shown: [], hidden: 0 });
  });
});

describe("매치 머리줄", () => {
  it("매치가 바뀔 때마다 머리줄, 행 순서 그대로", () => {
    const rows = [{ match_id: "a", game_time: 1 }, { match_id: "a", game_time: 2 }, { match_id: "b", game_time: 0 }, { match_id: "a", game_time: 9 }];
    const out = withMatchHeads(rows);
    expect(out.map((x) => (x.head ? `H:${x.match_id}` : x.row.game_time))).toEqual(["H:a", 1, 2, "H:b", 0, "H:a", 9]);
    expect(out.filter((x) => !x.head).map((x) => x.row)).toEqual(rows);
    expect(new Set(out.filter((x) => x.head).map((x) => x.key)).size).toBe(3);
    expect(withMatchHeads([])).toEqual([]);
  });
});
