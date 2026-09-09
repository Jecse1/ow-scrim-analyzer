// 전체 통계 → 요약 탭 상단 카드 전용 집계.
// ⚠️ MapAnalysisStats(맵 분석 탭)와 수치가 "정합"해야 하므로 정의를 그대로 맞춘다:
//   · 데이터 소스: /api/fight-records (base_team 관점, match_result = winner_override||winner 반영)
//   · 맵 승률 분모 = 결과 기록 매치(무 포함, 미기록 제외)
//   · 한타 승률 = 승자 판정 가능한 한타(무승부 제외) 중 우리(us) 승
// 정의가 어긋나면 두 탭 승률이 달라지므로, 아래 collectMatches/matchStat/fightStat는
// MapAnalysisStats.jsx의 동명 함수와 반드시 동일하게 유지할 것.

const isKnown = (r) => r.fight_winner === 'us' || r.fight_winner === 'them';

// 'YYYY-MM-DD' 문자열 범위 비교(빈 경계 = 무한). session_date와 동일 포맷 전제.
const inRange = (d, start, end) =>
    (!start || (d && d >= start)) && (!end || (d && d <= end));

// 한타 레코드 → 매치(맵) 단위 1행 (match_id 기준 중복 제거)
export function collectMatches(recs) {
    const m = new Map();
    recs.forEach(r => {
        if (!m.has(r.match_id)) m.set(r.match_id, {
            match_id: r.match_id,
            map_type: r.map_type || 'Unknown',
            result: r.match_result ?? null,
        });
    });
    return Array.from(m.values());
}

// 맵 승률: 분모 = 결과가 기록된 매치(무 포함, 미기록 제외)
export function matchStat(matches) {
    const rec = matches.filter(x => x.result === 'win' || x.result === 'loss' || x.result === 'draw');
    const wins = rec.filter(x => x.result === 'win').length;
    const losses = rec.filter(x => x.result === 'loss').length;
    return {
        plays: matches.length, denom: rec.length, wins, losses,
        draws: rec.length - wins - losses,
        win: rec.length > 0 ? wins / rec.length : null,
    };
}

// 한타 승률: 판정 가능한 한타만 표본(무승부 제외)
export function fightStat(recs) {
    const k = recs.filter(isKnown);
    const w = k.filter(r => r.fight_winner === 'us').length;
    return { sample: k.length, wins: w, win: k.length > 0 ? w / k.length : null };
}

// records → 요약 카드용 종합 지표.
//   rangeA    = [start, end]  현재 기간(빈 문자열 = 무한)
//   rangePrev = [start, end] | null  추세 비교용 이전 기간(없으면 추세 미표시)
export function buildMapSummary(records, rangeA, rangePrev) {
    const [aS, aE] = rangeA || ['', ''];
    const recsNow = records.filter(r => inRange(r.session_date, aS, aE));
    const matchesNow = collectMatches(recsNow);
    const overallMs = matchStat(matchesNow);
    const fs = fightStat(recsNow);

    // 최강/최약 맵타입: 결과 기록 매치 1개 이상인 타입 중 맵 승률 최고/최저
    // (MapAnalysisStats 요약 카드와 동일 기준 — 표본 하한 없음)
    const byType = new Map();
    matchesNow.forEach(m => {
        if (!byType.has(m.map_type)) byType.set(m.map_type, []);
        byType.get(m.map_type).push(m);
    });
    const typeStats = Array.from(byType.entries())
        .map(([type, ms]) => ({ type, ...matchStat(ms) }))
        .filter(x => x.denom >= 1 && x.win != null);
    const best = typeStats.length ? typeStats.reduce((a, b) => (b.win > a.win ? b : a)) : null;
    const worst = typeStats.length ? typeStats.reduce((a, b) => (b.win < a.win ? b : a)) : null;

    // 추세 = 현재 한타 승률 − 이전 기간 한타 승률 (pp). 이전 표본 없으면 null.
    let trend = null, prevFightWin = null, prevSample = 0;
    if (rangePrev && (rangePrev[0] || rangePrev[1])) {
        const recsPrev = records.filter(r => inRange(r.session_date, rangePrev[0], rangePrev[1]));
        const fsPrev = fightStat(recsPrev);
        prevFightWin = fsPrev.win;
        prevSample = fsPrev.sample;
        if (fs.win != null && fsPrev.win != null) trend = (fs.win - fsPrev.win) * 100;
    }

    return {
        matchPlays: overallMs.plays,
        overallMs,
        fightWin: fs.win, fightSample: fs.sample, fightWins: fs.wins,
        best, worst, trend, prevFightWin, prevSample,
    };
}
