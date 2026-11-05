// 세션 전적 — 매치 winner(override 반영 최종값) 기준. 요약 API(services/summary.py, definitions_version 2)와 같은 분류:
//  - winner === 기준 팀            → w(승)
//  - winner_source=undetermined   → u(미확정: 로그로 승자를 못 가린 매치, 무승부와 별개)
//  - winner in (Draw/무승부)       → d(무: 실제 무승부만)
//  - winner 빈값                   → n(미정: 결과 없음)
//  - 그 외(상대팀명)               → l(패)
// 세션 승패 결과(outcome)는 w·l 만 비교한다.
export function sessionRecord(s, ourTeam) {
  let w = 0, l = 0, d = 0, u = 0, n = 0;
  for (const m of (s?.matches || [])) {
    const win = (m.winner || '').trim();
    if (win === ourTeam) w++;
    else if (m.winner_source === 'undetermined') u++;
    else if (!win) n++;
    else if (win === 'Draw' || win === '무승부') d++;
    else l++;
  }
  const outcome = w > l ? 'win' : w < l ? 'loss' : 'draw';
  return { w, l, d, u, n, outcome };
}

// 세션 종류 — 서버 services/session_kind.py 와 같은 값. 스크림 세션 응답에는 kind 키가 없다(NULL).
// 기본(스크림)은 파라미터 없는 '/api/scrims' 그대로 — 다른 화면과 같은 URL 이라 공유 캐시·요청이 예전과 같다.
export const SESSION_KINDS = ['scrim', 'tournament', 'all'];

export function sessionsUrl(kind) {
  return kind === 'tournament' || kind === 'all' ? `/api/scrims?kind=${kind}` : '/api/scrims';
}

export function isTournament(s) {
  return s?.kind === 'tournament';
}
