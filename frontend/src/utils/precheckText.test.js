import { describe, it, expect } from "vitest";
import { precheckLine } from "./precheckText";
import ko from "../i18n/ko";

describe("precheckLine", () => {
  it("경고·미확정 사유 없으면 빈 문자열", () => {
    expect(precheckLine({ warning_count: 0, warnings: [] }, ko)).toBe("");
    expect(precheckLine(undefined, ko)).toBe("");
  });

  it("경고 줄은 기존 형식 그대로", () => {
    const data = { warning_count: 3, warnings: [{ code: "bad_number" }, { code: "bad_number" }, { code: "no_match_end" }] };
    expect(precheckLine(data, ko)).toBe("\n로그 형식 경고 3건: bad_number×2, no_match_end×1");
  });

  it("미확정 사유는 경로 코드 대신 문구로", () => {
    const line = precheckLine({ warning_count: 0, undetermined_reason: "undetermined_push" }, ko);
    expect(line).toBe(`\n${ko.pcUdPrefix}: ${ko.pcUdPush}`);
    expect(line).not.toContain("undetermined_");
  });

  it("경고 다음 줄에 미확정 사유", () => {
    const data = { warning_count: 1, warnings: [{ code: "bad_timestamp" }], undetermined_reason: "undetermined_progress_tie" };
    expect(precheckLine(data, ko).split("\n")).toEqual(["", "로그 형식 경고 1건: bad_timestamp×1", `${ko.pcUdPrefix}: ${ko.pcUdProgressTie}`]);
  });

  it("미완 로그(incomplete_log)는 경고 줄 다음에 안내 문구", () => {
    const data = { warning_count: 2, warnings: [{ code: "incomplete_log" }, { code: "no_match_end" }] };
    expect(precheckLine(data, ko).split("\n")).toEqual(["", "로그 형식 경고 2건: incomplete_log×1, no_match_end×1", ko.pcIncomplete]);
  });

  it("모르는 경로 코드는 일반 문구(코드 비노출)", () => {
    const line = precheckLine({ undetermined_reason: "undetermined_future" }, ko);
    expect(line).toBe(`\n${ko.pcUdPrefix}: ${ko.pcUdOther}`);
  });
});
