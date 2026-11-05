import { describe, it, expect } from "vitest";
import { sessionRecord, sessionsUrl, isTournament, SESSION_KINDS } from "./sessionRecord";

const m = (winner, winner_source) => ({ winner, winner_source });

describe("sessionRecord", () => {
  it("승·패·실제 무·미확정·미정을 나눠 센다", () => {
    const s = { matches: [m("Team A"), m("Team B"), m("Draw", "draw"), m("Draw", "undetermined"), m(""), m("무승부")] };
    expect(sessionRecord(s, "Team A")).toEqual({ w: 1, l: 1, d: 2, u: 1, n: 1, outcome: "draw" });
  });
  it("outcome 은 승·패만 비교(미확정·미정 무관)", () => {
    const s = { matches: [m("Team A"), m("Draw", "undetermined"), m("")] };
    expect(sessionRecord(s, "Team A").outcome).toBe("win");
    expect(sessionRecord({}, "Team A")).toEqual({ w: 0, l: 0, d: 0, u: 0, n: 0, outcome: "draw" });
  });
});

describe("sessionsUrl / isTournament", () => {
  it("기본·스크림은 파라미터 없는 기존 URL(공유 캐시 키 동일)", () => {
    expect(sessionsUrl("scrim")).toBe("/api/scrims");
    expect(sessionsUrl(undefined)).toBe("/api/scrims");
    expect(sessionsUrl("bogus")).toBe("/api/scrims");
  });
  it("대회·전체만 kind 파라미터", () => {
    expect(sessionsUrl("tournament")).toBe("/api/scrims?kind=tournament");
    expect(sessionsUrl("all")).toBe("/api/scrims?kind=all");
    expect(SESSION_KINDS).toEqual(["scrim", "tournament", "all"]);
  });
  it("kind 키가 tournament 일 때만 대회", () => {
    expect(isTournament({ kind: "tournament" })).toBe(true);
    expect(isTournament({})).toBe(false);
    expect(isTournament({ kind: null })).toBe(false);
    expect(isTournament(null)).toBe(false);
  });
});
