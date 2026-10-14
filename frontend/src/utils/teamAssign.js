// 등록 모달 "우리 팀" 선택 → manual-register 의 team1Name/team2Name 조립.
// 서버 파서는 로그 첫 match_start 의 첫 팀을 team1_name 자리로 보낸다(위치 대응) —
// POST /api/logs/roster 응답의 slot 1 = team1_name 자리, slot 2 = team2_name 자리.
import { BASE_TEAM } from "../config";

// match: { source, ourSlot(1|2|null), opponentName }
// 수기 매치·명단 없는 로그 매치는 기존과 같이 1팀 = 우리 팀.
export function assembleTeamNames(match) {
  const opp = (match.opponentName || "").trim();
  if (match.source !== "manual" && match.ourSlot === 2) return [opp, BASE_TEAM];
  return [BASE_TEAM, opp];
}

// 같은 세션 앞 매치와 선수 집합이 같으면 같은 쪽을 미리 고른다. 반환: 1 | 2 | null
export function inferOurSlot(prevMatches, roster) {
  if (!roster?.teams) return null;
  const setOf = (team) => new Set((team?.players || []).map((p) => p.name));
  const same = (a, b) => a.size > 0 && a.size === b.size && [...a].every((n) => b.has(n));
  for (let i = prevMatches.length - 1; i >= 0; i--) {
    const m = prevMatches[i];
    if (m.source === "manual" || !m.ourSlot || m.roster?.status !== "ok") continue;
    const ours = setOf(m.roster.data.teams[m.ourSlot - 1]);
    for (const team of roster.teams) {
      if (same(ours, setOf(team))) return team.slot;
    }
    return null; // 가장 가까운 선택 매치와만 비교
  }
  return null;
}
