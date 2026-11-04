import { describe, it, expect } from "vitest";
import { pollRebuildJob, rebuildMessage, failMessage } from "./rebuildJob";
import ko from "../i18n/ko";
import en from "../i18n/en";
import zh from "../i18n/zh";

const noSleep = () => Promise.resolve();
// 응답 배열을 차례로 돌려준다(Error 인스턴스면 throw)
const seq = (...items) => {
  let i = 0;
  const calls = { n: 0 };
  const fn = async () => {
    calls.n += 1;
    const x = items[Math.min(i++, items.length - 1)];
    if (x instanceof Error) throw x;
    return x;
  };
  return Object.assign(fn, { calls });
};
const run = (getStatus, extra = {}) => pollRebuildJob({ jobId: "j1", getStatus, sleep: noSleep, ...extra });

describe("pollRebuildJob", () => {
  it("running 을 지나 done 이면 done", async () => {
    const done = { state: "done", job_id: "j1", sessions: 3, matches: 9 };
    const r = await run(seq({ state: "running", job_id: "j1" }, { state: "running", job_id: "j1" }, done));
    expect(r).toEqual({ outcome: "done", status: done });
  });

  it("failed 면 failed(서버 고정 문구 보존)", async () => {
    const r = await run(seq({ state: "failed", job_id: "j1", error: "DB rebuild failed" }));
    expect(r.outcome).toBe("failed");
    expect(r.status.error).toBe("DB rebuild failed");
  });

  it("서버 재시작으로 idle·다른 job 이면 interrupted", async () => {
    expect((await run(seq({ state: "running", job_id: "j1" }, { state: "idle", job_id: null }))).outcome).toBe("interrupted");
    expect((await run(seq({ state: "done", job_id: "other" }))).outcome).toBe("interrupted");
  });

  it("네트워크 오류는 연속 maxNetErrors 회까지 무시, 넘으면 unreachable", async () => {
    const ok = await run(seq(new Error("x"), new Error("x"), { state: "done", job_id: "j1" }), { maxNetErrors: 2 });
    expect(ok.outcome).toBe("done");
    const gs = seq(new Error("x"));
    expect((await run(gs, { maxNetErrors: 2 })).outcome).toBe("unreachable");
    expect(gs.calls.n).toBe(3);
  });

  it("오류 횟수는 성공 응답에서 초기화된다", async () => {
    const r = await run(seq(new Error("x"), { state: "running", job_id: "j1" }, new Error("x"),
                            { state: "done", job_id: "j1" }), { maxNetErrors: 1 });
    expect(r.outcome).toBe("done");
  });

  it("isCancelled(화면 이탈)이면 더 묻지 않고 cancelled", async () => {
    const gs = seq({ state: "running", job_id: "j1" });
    const r = await run(gs, { isCancelled: () => true });
    expect(r.outcome).toBe("cancelled");
    expect(gs.calls.n).toBe(0);
  });

  it("매 조회 전 intervalMs 만큼 기다린다", async () => {
    const waits = [];
    await pollRebuildJob({ jobId: "j1", getStatus: seq({ state: "done", job_id: "j1" }),
                           sleep: async (ms) => { waits.push(ms); }, intervalMs: 1500 });
    expect(waits).toEqual([1500]);
  });
});

describe("rebuildMessage", () => {
  it("done: 세션·매치 수, 파싱 오류가 있으면 덧붙임", () => {
    expect(rebuildMessage(ko, { outcome: "done", status: { sessions: 121, matches: 647, parse_errors: [] } }))
      .toBe("DB 복구 완료: 세션 121개, 매치 647개");
    expect(rebuildMessage(en, { outcome: "done", status: { sessions: 1, matches: 2, parse_errors: ["a", "b"] } }))
      .toBe("DB rebuild done: 1 sessions, 2 matches restored. (2 parse errors — check backend logs)");
  });

  it("failed·interrupted·unreachable·cancelled", () => {
    expect(rebuildMessage(ko, { outcome: "failed", status: { error: "DB rebuild failed" } })).toBe(ko.ssRebuildFailed);
    expect(rebuildMessage(ko, { outcome: "failed", status: { error: "Insufficient disk space" } })).toBe(ko.ssRebuildNoDisk);
    expect(rebuildMessage(zh, { outcome: "interrupted", status: null })).toBe(zh.ssRebuildInterrupted);
    expect(rebuildMessage(en, { outcome: "unreachable", status: null })).toBe(en.ssRebuildUnreachable);
    expect(rebuildMessage(en, { outcome: "cancelled", status: null })).toBeNull();
  });

  it("3언어 모두 문구 키가 있고 자리표시자가 채워진다", () => {
    for (const t of [ko, en, zh]) {
      const s = rebuildMessage(t, { outcome: "done", status: { sessions: 5, matches: 7, parse_errors: ["x"] } });
      expect(s).toContain("5");
      expect(s).toContain("7");
      expect(s).not.toMatch(/\{\w+\}/);
      for (const k of ["ssRebuildFailed", "ssRebuildNoDisk", "ssRebuildInterrupted", "ssRebuildUnreachable", "ssRebuildAlreadyRunning"]) {
        expect(typeof t[k]).toBe("string");
      }
    }
    expect(failMessage(en, undefined)).toBe(en.ssRebuildFailed);
  });
});
