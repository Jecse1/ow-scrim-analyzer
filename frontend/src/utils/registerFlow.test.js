import { describe, it, expect } from "vitest";
import { snapshotFile, submitBlockers, hasBlockers, classifyUploads, uploadFailReason, formatFailReason } from "./registerFlow";
import ko from "../i18n/ko";

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

describe("classifyUploads", () => {
  const ok = (index) => ({ index, ok: true });
  const ng = (index) => ({ index, ok: false, reason: { code: "network", detail: "Network Error" } });

  it("전부 성공 → all", () => {
    expect(classifyUploads([ok(1), ok(2)])).toEqual({ kind: "all", ok: 2, failed: [] });
  });

  it("하나도 안 올라감 → none(세션 자동 삭제)", () => {
    const r = classifyUploads([ng(1), ng(2), ng(3)]);
    expect(r.kind).toBe("none");
    expect(r.failed.map((f) => f.index)).toEqual([1, 2, 3]);
  });

  it("일부 실패 → partial, 실패 매치 번호 유지", () => {
    const r = classifyUploads([ok(1), ng(2), ok(3), ng(4)]);
    expect(r.kind).toBe("partial");
    expect(r.ok).toBe(2);
    expect(r.failed.map((f) => f.index)).toEqual([2, 4]);
  });

  it("로그 매치가 없는 수기 전용 등록은 all(삭제하지 않는다)", () => {
    expect(classifyUploads([]).kind).toBe("all");
  });
});

describe("uploadFailReason / formatFailReason", () => {
  it("서버 응답이 있으면 상태 코드와 detail", () => {
    const r = uploadFailReason({ message: "x", response: { status: 409, data: { detail: "Session 1 is deleted" } } });
    expect(r).toEqual({ code: "http", status: 409, detail: "Session 1 is deleted" });
    expect(formatFailReason(r, ko)).toBe("HTTP 409 — Session 1 is deleted");
  });

  it("응답 없는 실패는 network(브라우저가 net:: 코드를 숨김) — 파일 재선택 안내 포함", () => {
    const r = uploadFailReason({ message: "Network Error", code: "ERR_NETWORK" });
    expect(r).toEqual({ code: "network", detail: "Network Error" });
    expect(formatFailReason(r, ko)).toBe(`${ko.ubNetwork} (Network Error)`);
  });

  it("파일 읽기 실패·ERR_UPLOAD_FILE_CHANGED 는 '첨부 후 파일이 바뀌었습니다'", () => {
    expect(formatFailReason(uploadFailReason({ name: "NotReadableError" }), ko)).toBe(ko.smFileChanged);
    expect(uploadFailReason({ message: "net::ERR_UPLOAD_FILE_CHANGED" }).code).toBe("fileChanged");
  });
});
