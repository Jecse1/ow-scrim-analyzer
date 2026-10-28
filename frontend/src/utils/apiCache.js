import axios from "axios";

// 앱 세션당 1회 fetch 공유 캐시.
// 같은 URL의 동시/반복 요청을 하나의 in-flight Promise로 묶는다:
//  - StrictMode(dev) 이중 마운트로 인한 2중 발사 → 1발
//  - 탭 전환 후 재진입 시 리마운트 재요청 → 캐시 반환 (네트워크 0)
// 실패한 요청은 캐시에서 제거해 다음 시도 때 재요청한다.
const cache = new Map(); // url -> Promise<data>

// 통계 요청이 504(nginx 가 백엔드 응답을 60초 기다리다 끊음)·네트워크 오류로 실패하면 구독자(App 의 배너)에게 알린다.
// 서버는 그 계산을 계속하므로(단일 비행 캐시) 잠시 뒤 새로고침하면 대개 바로 받는다.
// 화면마다 오류 처리가 다르고(빈 화면으로 넘어가는 곳도 있다) 이 공유 fetch 를 모두 지나가므로 여기서 한 번에 잡는다.
const loadErrorListeners = new Set();

export function isServerSlowError(err) {
  if (axios.isCancel(err)) return false;
  if (err?.response) return err.response.status === 504;
  return Boolean(err?.request) || err?.code === "ERR_NETWORK"; // 응답 없이 끊김(연결 실패·중간 끊김)
}

// cb(url, err) 구독. 반환값을 호출하면 해지.
export function onLoadError(cb) {
  loadErrorListeners.add(cb);
  return () => loadErrorListeners.delete(cb);
}

export function fetchCached(url) {
  if (!cache.has(url)) {
    const p = axios.get(url).then((r) => r.data);
    p.catch((err) => {
      cache.delete(url);
      if (isServerSlowError(err)) loadErrorListeners.forEach((cb) => cb(url, err));
    });
    cache.set(url, p);
  }
  return cache.get(url);
}

// 데이터 변경(스크림 등록/삭제/재구축 등) 성공 후 호출 — 다음 접근부터 재요청.
export function invalidateApiCache() {
  cache.clear();
}
