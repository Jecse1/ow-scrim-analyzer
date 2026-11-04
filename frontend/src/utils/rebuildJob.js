// rebuild-db 비동기 작업 폴링(POST → 202 {job_id} → GET status). 화면(ScrimSessions)과 분리한 순수 로직 — vitest 대상.
// 서버 status: {state: idle|running|done|failed, job_id, sessions, matches, parse_errors, error, ...}

export const REBUILD_URL = '/api/admin/rebuild-db';
export const REBUILD_STATUS_URL = '/api/admin/rebuild-db/status';

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

// jobId 작업이 끝날 때까지 status 를 폴링한다. 반환 {outcome, status}
//  outcome: done | failed | interrupted(서버 재시작 등으로 다른 job/idle) | unreachable(연속 네트워크 오류) | cancelled
//  네트워크 오류는 연속 maxNetErrors 회까지 무시(pm2 재기동 중 잠깐 끊김).
export async function pollRebuildJob({
  jobId, getStatus, sleep = defaultSleep, intervalMs = 2000, maxNetErrors = 15, isCancelled = () => false,
}) {
  let netErrors = 0;
  let last = null;
  for (;;) {
    await sleep(intervalMs);
    if (isCancelled()) return { outcome: 'cancelled', status: last };
    let st;
    try {
      st = await getStatus();
      netErrors = 0;
    } catch {
      netErrors += 1;
      if (netErrors > maxNetErrors) return { outcome: 'unreachable', status: last };
      continue;
    }
    if (isCancelled()) return { outcome: 'cancelled', status: st };
    last = st;
    if (!st || st.job_id !== jobId) return { outcome: 'interrupted', status: st };
    if (st.state === 'done') return { outcome: 'done', status: st };
    if (st.state === 'failed') return { outcome: 'failed', status: st };
  }
}

const fill = (s, vars) => s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ''));

// 결과 알림 문구(i18n 사전 t). cancelled 는 알림 없음(null).
export function rebuildMessage(t, { outcome, status }) {
  if (outcome === 'cancelled') return null;
  if (outcome === 'done') {
    const n = status?.parse_errors?.length || 0;
    return fill(t.ssRebuildDone, { sessions: status?.sessions ?? 0, matches: status?.matches ?? 0 })
      + (n ? fill(t.ssRebuildParseErrors, { n }) : '');
  }
  if (outcome === 'failed') return failMessage(t, status?.error);
  if (outcome === 'interrupted') return t.ssRebuildInterrupted;
  return t.ssRebuildUnreachable;
}

// 서버 오류 문구(고정) → 알림. 디스크 부족만 따로, 나머지는 공통 실패.
export function failMessage(t, error) {
  return error === 'Insufficient disk space' ? t.ssRebuildNoDisk : t.ssRebuildFailed;
}
