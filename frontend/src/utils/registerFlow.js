// 스크림 등록(모달 → manual-register → 매치별 upload) 흐름의 순수 함수. 화면·네트워크와 분리해 vitest 로 검사한다.

// 첨부한 로그 파일 내용을 메모리로 복사한 File. 브라우저는 업로드 직전에 디스크 파일을 다시 읽는데,
// 첨부 뒤 같은 이름으로 다시 내려받는 등 파일이 바뀌면 요청을 보내지 않고 막는다(net::ERR_UPLOAD_FILE_CHANGED).
// 첨부 시점에 복사해 두면 명단 읽기·업로드·재시도 모두 첨부한 그 내용으로 나간다.
export async function snapshotFile(file) {
  const buf = await file.arrayBuffer();
  return new File([buf], file.name, { type: file.type || "text/plain", lastModified: file.lastModified });
}

// 제출 불가 사유(로그 매치만 — 수기 매치는 파일·명단이 없다). 값은 SET 번호(1부터) 목록.
export function submitBlockers(matches, files) {
  const sets = (pred) => matches
    .map((m, i) => (m.source !== "manual" && pred(m, i) ? i + 1 : null))
    .filter((n) => n !== null);
  return {
    loading: sets((m) => m.roster?.status === "loading"),
    rosterError: sets((m) => m.roster?.status === "error"),
    missingFile: sets((m, i) => !files?.[i]),
  };
}

export function hasBlockers(b) {
  return b.loading.length + b.rosterError.length + b.missingFile.length > 0;
}

// 업로드 실패 원인 분류. 브라우저는 net::ERR_* 코드를 스크립트에 알려 주지 않아(axios 에는 "Network Error" 뿐)
// 서버 응답이 없는 실패는 network 로 묶고, 파일 읽기 실패(NotReadableError)만 fileChanged 로 가린다.
export function uploadFailReason(err) {
  const msg = String(err?.message || "");
  if (err?.name === "NotReadableError" || msg.includes("ERR_UPLOAD_FILE_CHANGED")) return { code: "fileChanged" };
  if (err?.response) {
    const d = err.response.data?.detail;
    return { code: "http", status: err.response.status, detail: typeof d === "string" ? d : d ? JSON.stringify(d) : "" };
  }
  return { code: "network", detail: msg };
}

export function formatFailReason(r, t) {
  if (r?.code === "fileChanged") return t.smFileChanged;
  if (r?.code === "http") return `HTTP ${r.status}${r.detail ? ` — ${r.detail}` : ""}`;
  return `${t.ubNetwork}${r?.detail ? ` (${r.detail})` : ""}`;
}

// 매치별 업로드 결과([{ index, ok, reason? }], 로그 매치만) → 등록 마무리 분기.
//   none    = 로그 매치가 있는데 하나도 안 올라감 → 방금 만든 세션 자동 삭제
//   partial = 일부 실패 → 세션 유지 + 실패 매치 재시도
//   all     = 전부 성공(로그 매치가 없는 수기 전용 등록 포함) → 완료 알림
export function classifyUploads(results) {
  const failed = results.filter((r) => !r.ok);
  const ok = results.length - failed.length;
  let kind = "all";
  if (results.length > 0 && ok === 0) kind = "none";
  else if (failed.length > 0) kind = "partial";
  return { kind, ok, failed };
}
