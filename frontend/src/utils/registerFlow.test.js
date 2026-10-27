import { describe, it, expect } from "vitest";
import { snapshotFile, submitBlockers, hasBlockers } from "./registerFlow";

const log = (roster = { status: "ok" }) => ({ source: "log", roster });
const manual = () => ({ source: "manual", roster: null });
const file = (name = "a.txt") => new File(["x"], name, { type: "text/plain" });

describe("submitBlockers", () => {
  it("로그 매치에 파일·명단이 다 있으면 제출 가능", () => {
    const b = submitBlockers([log(), log()], [file(), file()]);
    expect(b).toEqual({ loading: [], rosterError: [], missingFile: [] });
    expect(hasBlockers(b)).toBe(false);
  });

  it("로그 매치에 파일이 없으면 SET 번호로 막는다(빈 칸·undefined·배열 짧음 모두)", () => {
    const b = submitBlockers([log(null), log(null), log(null)], [null, undefined]);
    expect(b.missingFile).toEqual([1, 2, 3]);
    expect(hasBlockers(b)).toBe(true);
  });

  it("수기 매치는 파일 없어도 된다", () => {
    const b = submitBlockers([manual(), log()], [null, file()]);
    expect(b.missingFile).toEqual([]);
    expect(hasBlockers(b)).toBe(false);
  });

  it("명단 읽는 중·명단 오류도 기존처럼 막는다", () => {
    const b = submitBlockers([log({ status: "loading" }), log({ status: "error" }), log()], [file(), file(), file()]);
    expect(b.loading).toEqual([1]);
    expect(b.rosterError).toEqual([2]);
    expect(hasBlockers(b)).toBe(true);
  });

  it("파일 읽기 실패(명단 오류 + 파일 비움)는 두 사유 모두에 잡힌다", () => {
    const b = submitBlockers([log({ status: "error" })], [null]);
    expect(b.rosterError).toEqual([1]);
    expect(b.missingFile).toEqual([1]);
  });
});

describe("snapshotFile", () => {
  it("이름·내용이 같은 별도 File(메모리 사본)", async () => {
    const src = new File(["line1\nline2"], "Log-2026-10-27.txt", { type: "text/plain", lastModified: 1000 });
    const copy = await snapshotFile(src);
    expect(copy).not.toBe(src);
    expect(copy.name).toBe(src.name);
    expect(copy.lastModified).toBe(1000);
    expect(await copy.text()).toBe("line1\nline2");
  });

  it("type 이 비면 text/plain", async () => {
    const copy = await snapshotFile(new File(["x"], "a.txt"));
    expect(copy.type).toBe("text/plain");
  });

  it("읽기 실패는 그대로 던진다(호출부가 '파일이 바뀌었습니다' 로 안내)", async () => {
    const broken = { name: "a.txt", arrayBuffer: () => Promise.reject(Object.assign(new Error("x"), { name: "NotReadableError" })) };
    await expect(snapshotFile(broken)).rejects.toMatchObject({ name: "NotReadableError" });
  });
});
