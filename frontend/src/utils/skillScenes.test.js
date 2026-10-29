import { describe, it, expect } from "vitest";
import { scenesQuery, skillName, skillLabel, fmtClock, fmtPlayTime, sceneVodUrl, splitPlayers } from "./skillScenes";
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
    expect(skillLabel(SKILLS, "트레이서", 1, "ko", ko)).toBe("점멸 (Shift)");
    expect(skillLabel(SKILLS, "트레이서", 2, "en", ko)).toBe("Recall (E)");
    expect(skillName(SKILLS, "미지", 1, "ko", ko)).toBe(ko.skSkill1Fallback);
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
