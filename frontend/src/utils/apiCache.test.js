import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import axios, { AxiosError, CanceledError } from "axios";
import { fetchCached, invalidateApiCache, onLoadError, isServerSlowError } from "./apiCache";

const httpError = (status) => new AxiosError(`status ${status}`, "ERR_BAD_RESPONSE", {}, {}, { status, data: "" });
const networkError = () => new AxiosError("Network Error", "ERR_NETWORK", {}, {}); // 요청은 나갔고 응답 없음

describe("isServerSlowError", () => {
  it("504·네트워크 오류만 해당", () => {
    expect(isServerSlowError(httpError(504))).toBe(true);
    expect(isServerSlowError(networkError())).toBe(true);
    for (const s of [400, 404, 500, 502, 503]) expect(isServerSlowError(httpError(s))).toBe(false);
    expect(isServerSlowError(new CanceledError(undefined, {}, {}))).toBe(false); // 실제 취소처럼 request 가 있는 경우
  });
});

describe("fetchCached 로딩 실패 알림", () => {
  let get, seen, off;
  beforeEach(() => {
    invalidateApiCache();
    get = vi.spyOn(axios, "get");
    seen = [];
    off = onLoadError((url) => seen.push(url));
  });
  afterEach(() => { off(); vi.restoreAllMocks(); });

  it("504 면 구독자에게 URL 을 알리고, 실패한 요청은 캐시에서 빠져 다음 접근 때 다시 요청한다", async () => {
    get.mockRejectedValueOnce(httpError(504)).mockResolvedValueOnce({ data: [1] });
    await expect(fetchCached("/api/fight-records")).rejects.toBeInstanceOf(AxiosError);
    expect(seen).toEqual(["/api/fight-records"]);
    await expect(fetchCached("/api/fight-records")).resolves.toEqual([1]);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("네트워크 오류도 알린다", async () => {
    get.mockRejectedValueOnce(networkError());
    await expect(fetchCached("/api/scrims/full-events")).rejects.toThrow();
    expect(seen).toEqual(["/api/scrims/full-events"]);
  });

  it("같은 URL 의 동시 요청이 함께 실패해도 알림은 1번", async () => {
    get.mockRejectedValueOnce(httpError(504));
    const a = fetchCached("/api/scrims"), b = fetchCached("/api/scrims");
    await Promise.allSettled([a, b]);
    expect(get).toHaveBeenCalledTimes(1);
    expect(seen).toEqual(["/api/scrims"]);
  });

  it("다른 실패(500·404·502)·취소·성공은 알리지 않는다", async () => {
    for (const s of [500, 404, 502]) {
      get.mockRejectedValueOnce(httpError(s));
      await expect(fetchCached(`/api/x${s}`)).rejects.toThrow();
    }
    get.mockRejectedValueOnce(new CanceledError(undefined, {}, {}));
    await expect(fetchCached("/api/cancel")).rejects.toThrow();
    get.mockResolvedValueOnce({ data: { ok: 1 } });
    await expect(fetchCached("/api/ok")).resolves.toEqual({ ok: 1 });
    expect(seen).toEqual([]);
  });

  it("구독 해지 뒤에는 알리지 않는다", async () => {
    off();
    get.mockRejectedValueOnce(httpError(504));
    await expect(fetchCached("/api/fight-records")).rejects.toThrow();
    expect(seen).toEqual([]);
  });
});
