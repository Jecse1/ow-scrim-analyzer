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
