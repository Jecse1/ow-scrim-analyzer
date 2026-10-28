import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import ko from "./i18n/ko";
import UploadIssueBanner from "./UploadIssueBanner";

// 테마·언어 컨텍스트는 고정값으로(브라우저 저장소 없이 렌더)
vi.mock("./ThemeContext", () => ({ useTheme: () => ({ theme: new Proxy({}, { get: () => "#888" }) }) }));
vi.mock("./LanguageContext", () => ({ useLanguage: () => ({ t: ko }) }));

const render = (issue) => renderToStaticMarkup(<UploadIssueBanner issue={issue} onRetry={() => {}} onReload={() => {}} onDismiss={() => {}} />);

describe("UploadIssueBanner", () => {
  it("slow: 새로고침 안내·버튼만, 세션 줄·실패 목록 없음", () => {
    const html = render({ kind: "slow" });
    expect(html).toContain(ko.ubSlowTitle);
    expect(html).toContain(ko.ubSlowHint);
    expect(html).toContain(ko.ubReload);
    expect(html).not.toContain(`${ko.ubSession}:`);
    expect(html).not.toContain(ko.ubRetry);
  });

  it("업로드 배너(partial)는 그대로 — 세션 줄·재시도, 새로고침 버튼 없음", () => {
    const html = render({ kind: "partial", scrimId: "261028-A", scrimName: "S", failed: [{ index: 2, map: "Busan", reason: "x" }], busy: null });
    expect(html).toContain(ko.ubPartialTitle.replace("{n}", 1));
    expect(html).toContain(`${ko.ubSession}: S (261028-A)`);
    expect(html).toContain(ko.ubRetry);
    expect(html).not.toContain(ko.ubReload);
    expect(html).not.toContain(ko.ubSlowTitle);
  });

  it("issue 가 없으면 렌더하지 않는다", () => {
    expect(render(null)).toBe("");
  });
});
