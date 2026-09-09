import axios from "axios";

// 앱 세션당 1회 fetch 공유 캐시.
// 같은 URL의 동시/반복 요청을 하나의 in-flight Promise로 묶는다:
//  - StrictMode(dev) 이중 마운트로 인한 2중 발사 → 1발
//  - 탭 전환 후 재진입 시 리마운트 재요청 → 캐시 반환 (네트워크 0)
// 실패한 요청은 캐시에서 제거해 다음 시도 때 재요청한다.
const cache = new Map(); // url -> Promise<data>

export function fetchCached(url) {
  if (!cache.has(url)) {
    const p = axios.get(url).then((r) => r.data);
    p.catch(() => cache.delete(url));
    cache.set(url, p);
  }
  return cache.get(url);
}

// 데이터 변경(스크림 등록/삭제/재구축 등) 성공 후 호출 — 다음 접근부터 재요청.
export function invalidateApiCache() {
  cache.clear();
}
