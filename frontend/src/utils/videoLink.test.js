import { describe, it, expect } from "vitest";
import { isSafeVideoUrl } from "./videoLink";

describe("isSafeVideoUrl", () => {
  it("http/https 절대 URL 만 허용", () => {
    for (const ok of ["https://youtu.be/abc?t=10", "https://www.youtube.com/watch?v=abc&t=5s", "http://example.com/v", "  https://youtu.be/x  "])
      expect(isSafeVideoUrl(ok)).toBe(true);
  });
  it("javascript:·data:·상대 주소·빈 값 거부", () => {
    for (const bad of ["javascript:alert(1)", " JavaScript:alert(1)", "java\tscript:alert(1)", "data:text/html,<b>x</b>",
                       "vbscript:x", "//youtu.be/abc", "youtu.be/abc", "", "   ", null, undefined, 123])
      expect(isSafeVideoUrl(bad)).toBe(false);
  });
});
