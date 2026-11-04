import { describe, it, expect } from "vitest";
import { sessionRecord } from "./sessionRecord";

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
