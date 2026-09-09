// 맵 분석 탭 — 우리 팀이 어떤 맵/맵 타입에 강하고 약한지 (맵 선택·밴픽의 근거).
// 구성: ① 맵 타입 요약 ② 맵별 상세(행 클릭 → 매치 목록) ③ 주별 추이 매트릭스.
// 데이터: /api/fight-records 재사용 — 매치 단위 필드(match_result/our_score/enemy_score)는
//         이 탭을 위해 응답에 추가된 필드(기존 필드 무변경). 공용 스코프(useFightScope 등)는
//         FightLabStats에서 재사용하되 상태는 이 탭에서 독립. 맵 필터는 무의미하므로 hideMap.
import React, { useState, useMemo, useEffect } from 'react';
import { fetchCached } from './utils/apiCache';
import { useLanguage } from "./LanguageContext";
import { useIsMobile } from "./utils/responsive";
import {
    T, tpl, isKnown,
    useFightScope, FightScopeShell, SubTabPills, PerspectiveNotice, ExplainBox,
} from './FightLabStats';

const API_BASE = "";
const TOP_HERO_MIN = 3; // Top 영웅(근사) 영웅별 최소 표본(한타) — 지표 설명에 명시

// ── 날짜/주 헬퍼 ('YYYY-MM-DD' 문자열 + UTC 산술 — FightLabStats와 동일 규칙) ──────
const toMs = (s) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
const fmtMs = (ms) => {
    const d = new Date(ms);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
};
const addDays = (s, n) => fmtMs(toMs(s) + n * 86400000);
// 주 = 월요일 시작(월~일). getUTCDay(): 일0 월1 … 토6 → 월요일까지 되돌리는 오프셋 (day+6)%7
const mondayOf = (s) => { const wd = (new Date(toMs(s)).getUTCDay() + 6) % 7; return addDays(s, -wd); };
const shortMD = (s) => { const d = new Date(toMs(s)); return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`; };
const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// 주 라벨 "6월 4주차": 달 = 그 주 월요일의 달, N = 그 달의 몇 번째 월요일인지 (⌊(일-1)/7⌋+1)
const weekLabelOf = (mondayStr, t) => {
    const d = new Date(toMs(mondayStr));
    const m = d.getUTCMonth() + 1;
    const n = Math.floor((d.getUTCDate() - 1) / 7) + 1;
    return tpl(t.maWeekLabelTpl, { m, n, mon: EN_MONTHS[m - 1] });
};

const pct0 = (v) => (v == null ? '-' : `${Math.round(v * 100)}%`);

// ── 집계 ─────────────────────────────────────────────────────────────────────
// 한타 레코드 → 매치(맵) 단위 1행 (match_id 기준 중복 제거)
function collectMatches(recs) {
    const m = new Map();
    recs.forEach(r => {
        if (!m.has(r.match_id)) m.set(r.match_id, {
            match_id: r.match_id, session_id: r.session_id, session_date: r.session_date || '',
            map_name: r.map_name, map_type: r.map_type || 'Unknown', enemy_team: r.enemy_team,
            result: r.match_result ?? null,
            overridden: !!r.match_result_overridden, // 수기 승패 보정 여부(밀기 등)
            our_score: r.our_score ?? null, enemy_score: r.enemy_score ?? null,
        });
    });
    return Array.from(m.values());
}

// 맵 승률: 분모 = 결과가 기록된 매치(무승부 포함, 미기록 제외). oppWin = 상대 시점 맵 승률.
function matchStat(matches) {
    const rec = matches.filter(x => x.result === 'win' || x.result === 'loss' || x.result === 'draw');
    const wins = rec.filter(x => x.result === 'win').length;
    const losses = rec.filter(x => x.result === 'loss').length;
    return {
        plays: matches.length, denom: rec.length, wins, losses,
        draws: rec.length - wins - losses,
        win: rec.length > 0 ? wins / rec.length : null,
        oppWin: rec.length > 0 ? losses / rec.length : null,
    };
}

// 한타 승률: 승자 판정 가능한 한타만 표본 (기존 탭들과 동일 규칙)
function fightStat(recs) {
    const k = recs.filter(isKnown);
    const w = k.filter(r => r.fight_winner === 'us').length;
    return { sample: k.length, wins: w, win: k.length > 0 ? w / k.length : null };
}

// Top 영웅(근사): "우리가 궁을 쓴 영웅"이 포함된 한타의 승률. 영웅당 한타 1회 집계, 무승부 제외.
function topHeroes(recs, minN = TOP_HERO_MIN) {
    const acc = {};
    recs.forEach(r => {
        if (!isKnown(r)) return;
        const seen = new Set();
        (r.ults || []).forEach(u => { if (u.side === 'us' && u.hero) seen.add(u.hero); });
        seen.forEach(h => {
            const a = acc[h] || (acc[h] = { n: 0, w: 0 });
            a.n += 1;
            if (r.fight_winner === 'us') a.w += 1;
        });
    });
    return Object.entries(acc)
        .filter(([, a]) => a.n >= minN)
        .map(([hero, a]) => ({ hero, n: a.n, win: a.w / a.n }))
        .sort((x, y) => (y.win - x.win) || (y.n - x.n))
        .slice(0, 3);
}

const groupInto = (arr, keyFn) => {
    const m = new Map();
    arr.forEach(x => { const k = keyFn(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); });
    return m;
};

// 그룹(맵 타입 1개 또는 맵 1개) → 표 1행 데이터
function buildRow(key, recs, pastRecs, totalPlays) {
    const matches = collectMatches(recs);
    const ms = matchStat(matches);
    const fs = fightStat(recs);
    const fsPast = fightStat(pastRecs || []);
    return {
        key, recs, matches, ms, fs,
        mapType: recs[0]?.map_type || 'Unknown',
        playRate: totalPlays > 0 ? matches.length / totalPlays : null,
        // Δ(vs 상대) = 우리 한타 승률 − 상대 한타 승률(같은 한타의 반대 시점 = 1 − 우리)
        delta: fs.win != null ? (fs.win - (1 - fs.win)) * 100 : null,
        // 추세(vs 과거) = 최근 한타 승률 − 과거 한타 승률
        trend: (fs.win != null && fsPast.win != null) ? (fs.win - fsPast.win) * 100 : null,
        pastWin: fsPast.win, pastSample: fsPast.sample,
        top: topHeroes(recs),
    };
}

// ── 방향색 (0차 토큰 채도, 50% 기준. 정확히 50%는 중립) ─────────────────────────
const dirColor = (win) =>
    (win == null || Math.abs(win - 0.5) < 0.005) ? T.text : win > 0.5 ? T.green : T.red;
// 주별 셀 배경: 50%에서 멀수록 진하게, 옅은 채도 상한
const cellBg = (win) => {
    if (win == null) return 'transparent';
    const d = win - 0.5;
    if (Math.abs(d) < 0.005) return 'transparent';
    const a = Math.min(0.30, 0.06 + Math.abs(d) * 0.55);
    return d > 0 ? `rgba(91,185,139,${a})` : `rgba(209,109,109,${a})`; // T.green / T.red
};
const deltaTextColor = (dPP) =>
    (dPP == null || Math.abs(dPP) < 1) ? T.sub : dPP > 0 ? T.green : T.red;

// ── 공통 셀 스타일 ────────────────────────────────────────────────────────────
const td = { padding: '6px 12px', fontSize: '12px', textAlign: 'left', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' };
const th = { padding: '8px 12px', textAlign: 'left', fontSize: '12px', color: T.sub, whiteSpace: 'nowrap' };
const sectionTitle = { fontSize: '15px', fontWeight: 600, color: T.text, margin: '26px 0 10px' };

function TopHeroesCell({ top, t }) {
    if (!top.length) return <span style={{ color: T.faint }}>{t.maTopHeroNone}</span>;
    return (
        <span>
            {top.map((h, i) => (
                <span key={h.hero}>
                    {i > 0 && <span style={{ color: T.faint }}>{', '}</span>}
                    <span style={{ color: T.text }}>{h.hero}</span>
                    <span style={{ color: dirColor(h.win) }}> {pct0(h.win)}</span>
                    <span style={{ color: T.faint }}> ({h.n})</span>
                </span>
            ))}
        </span>
    );
}

export default function MapAnalysisStats({ onGoSession }) {
    const { t } = useLanguage();
    const isMobile = useIsMobile();

    const [data, setData] = useState(null); // { meta, records }
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        let alive = true;
        (async () => {
            try {
                const d = await fetchCached(`${API_BASE}/api/fight-records`);
                if (alive) setData(d || null);
            } catch (err) {
                console.error("❌ Failed to fetch fight-records:", err);
                if (alive) setError(err);
            } finally {
                if (alive) setLoading(false);
            }
        })();
        return () => { alive = false; };
    }, []);

    const records = data?.records || [];
    const sc = useFightScope(records, t); // 상태는 이 탭 독립(훅 인스턴스 분리)

    const [expandedType, setExpandedType] = useState(null);     // ① 타입 행 클릭 → 맵별 드릴다운
    const [expandedMap, setExpandedMap] = useState(null);        // ② 행 클릭 펼침
    const [weekMetric, setWeekMetric] = useState('fight');       // ③ 토글: 'fight' | 'map' | 'picks'
    const [selectedWeek, setSelectedWeek] = useState(null);      // ③ 주 헤더 클릭 → 그 주 상세

    // ── ①② 행 데이터 (현재 기간 vs 과거 기간) ──
    const { typeRows, mapRows, totalPlays, overallMs } = useMemo(() => {
        const now = sc.recsNow;
        const past = sc.compareOn ? sc.recsB : [];
        const allMatches = collectMatches(now);
        const total = allMatches.length;
        const byRate = (a, b) => (b.matches.length - a.matches.length) || a.key.localeCompare(b.key);
        const typePast = groupInto(past, r => r.map_type || 'Unknown');
        const tRows = Array.from(groupInto(now, r => r.map_type || 'Unknown').entries())
            .map(([k, v]) => buildRow(k, v, typePast.get(k), total)).sort(byRate);
        const mapPast = groupInto(past, r => r.map_name || '?');
        const mRows = Array.from(groupInto(now, r => r.map_name || '?').entries())
            .map(([k, v]) => buildRow(k, v, mapPast.get(k), total)).sort(byRate);
        return { typeRows: tRows, mapRows: mRows, totalPlays: total, overallMs: matchStat(allMatches) };
    }, [sc.recsNow, sc.recsB, sc.compareOn]);

    // 요약 카드: 최강/최약 = 결과 기록 매치가 1개 이상인 타입 중 맵 승률 최고/최저 (표본 하한 없음)
    const qualified = typeRows.filter(r => r.ms.denom >= 1 && r.ms.win != null);
    const best = qualified.length ? qualified.reduce((a, b) => (b.ms.win > a.ms.win ? b : a)) : null;
    const worst = qualified.length ? qualified.reduce((a, b) => (b.ms.win < a.ms.win ? b : a)) : null;

    // ── ③ 주별 매트릭스 (행 = 전체 + 맵 타입, 열 = 월요일 시작 주, 최근이 오른쪽) ──
    const weekly = useMemo(() => {
        const now = sc.recsNow;
        const dates = now.map(r => r.session_date).filter(Boolean).sort();
        if (!dates.length) return null;
        const start = sc.rangeA[0] || dates[0];
        const end = sc.rangeA[1] || dates[dates.length - 1];
        if (start > end) return null;
        const weeks = [];
        for (let w = mondayOf(start); w <= mondayOf(end); w = addDays(w, 7)) weeks.push(w);
        const rows = [
            { key: '__all__', label: t.maWeeklyRowAll, recs: now },
            ...typeRows.map(r => ({ key: r.key, label: r.key, recs: r.recs })),
        ];
        const cells = rows.map(row => weeks.map(w => {
            const end7 = addDays(w, 6);
            const wRecs = row.recs.filter(r => r.session_date >= w && r.session_date <= end7);
            const picks = collectMatches(wRecs).length;
            if (weekMetric === 'picks') return { picks };
            if (weekMetric === 'fight') {
                const f = fightStat(wRecs);
                return { win: f.win, n: f.sample, w: f.wins, picks };
            }
            const m = matchStat(collectMatches(wRecs));
            return { win: m.win, n: m.denom, w: m.wins, picks };
        }));
        return { weeks, rows, cells };
    }, [sc.recsNow, sc.rangeA, typeRows, weekMetric, t]);

    // 주 헤더 클릭 → 그 주 맵별 상세 ("그 주에 뭘 골랐고 어땠나")
    const weekDetail = useMemo(() => {
        if (!selectedWeek || !weekly || !weekly.weeks.includes(selectedWeek)) return null;
        const end7 = addDays(selectedWeek, 6);
        const wRecs = sc.recsNow.filter(r => r.session_date >= selectedWeek && r.session_date <= end7);
        const rows = Array.from(groupInto(wRecs, r => r.map_name || '?').entries())
            .map(([k, v]) => {
                const matches = collectMatches(v);
                return { key: k, mapType: v[0]?.map_type || 'Unknown', picks: matches.length, ms: matchStat(matches), fs: fightStat(v) };
            })
            .sort((a, b) => (b.picks - a.picks) || a.key.localeCompare(b.key));
        return { rows, totalPicks: rows.reduce((a, r) => a + r.picks, 0), range: `${shortMD(selectedWeek)} ~ ${shortMD(end7)}` };
    }, [selectedWeek, weekly, sc.recsNow]);

    const metricLabel = weekMetric === 'fight' ? t.maWeeklyMetricFight : weekMetric === 'map' ? t.maWeeklyMetricMap : t.maWeeklyMetricPicks;
    const fmtDelta = (dPP) => dPP == null ? '—' : `${dPP > 0 ? '+' : '−'}${Math.abs(dPP).toFixed(1)}${t.flUnitPp}`;
    const fmtTrend = (dPP) => dPP == null ? '—'
        : `${dPP >= 1 ? '↑' : dPP <= -1 ? '↓' : '→'} ${dPP > 0 ? '+' : dPP < 0 ? '−' : ''}${Math.abs(Math.round(dPP))}${t.flUnitPp}`;

    // ①② 공통 데이터 셀들 (한타 승률 | Δ | 추세 | Top 영웅) — 표본 하한 없음(상태 열 제거)
    const commonCells = (r) => (
        <>
            <td style={td}>{r.fs.win == null ? '-' : `${pct0(r.fs.win)}`}<span style={{ color: T.faint }}> ({r.fs.sample})</span></td>
            <td title={r.fs.win != null ? tpl(t.maTipUsOppTpl, { a: pct0(r.fs.win), b: pct0(1 - r.fs.win) }) : undefined}
                style={{ ...td, color: deltaTextColor(r.delta) }}>{fmtDelta(r.delta)}</td>
            <td title={r.trend != null ? tpl(t.maTipTrendTpl, { b: `${pct0(r.pastWin)} (${r.pastSample})`, a: `${pct0(r.fs.win)} (${r.fs.sample})` }) : undefined}
                style={{ ...td, color: deltaTextColor(r.trend) }}>{sc.compareOn ? fmtTrend(r.trend) : '—'}</td>
            <td style={{ ...td, whiteSpace: 'normal', minWidth: '220px' }}><TopHeroesCell top={r.top} t={t} /></td>
        </>
    );

    const resultLabel = (res) =>
        res === 'win' ? { txt: t.maResultWin, color: T.green }
            : res === 'loss' ? { txt: t.maResultLoss, color: T.red }
            : res === 'draw' ? { txt: t.maResultDraw, color: T.sub }
            : { txt: t.maResultUnknown, color: T.faint };

    const summaryCard = (label, value, sub) => (
        <div style={{ flex: 1, minWidth: isMobile ? 150 : undefined, background: T.panel, border: `1px solid ${T.panelBorder}`, borderRadius: '8px', padding: '12px 16px' }}>
            <div style={{ fontSize: '11px', color: T.sub, marginBottom: '6px' }}>{label}</div>
            <div style={{ fontSize: '18px', fontWeight: 700, color: T.text }}>{value}</div>
            {sub && <div style={{ fontSize: '11px', color: T.faint, marginTop: '4px' }}>{sub}</div>}
        </div>
    );

    const explains = [
        t.flExpSidebar, t.maExpMapWin, t.maExpPlayRate, t.maExpDelta,
        tpl(t.maExpTopHeroes, { n: TOP_HERO_MIN }), t.maExpWeek, t.maExpPushFix, t.maExpStatus, t.maExpCausal,
    ];

    const loadErrRow = (colSpan) => (
        <tr><td colSpan={colSpan} style={{ padding: '60px', textAlign: 'center', color: T.sub }}>
            {loading ? t.ffLoading : t.ffError}
        </td></tr>
    );

    return (
        <FightScopeShell title={t.maTitle} desc={t.maDesc} sc={sc} t={t} hideMap hideMinSample opponentOnlyForThem>
            <PerspectiveNotice sc={sc} t={t} />

            {/* 요약 카드: 전체 맵 승률 · 최강 맵 타입 · 최약 맵 타입 */}
            {!loading && !error && (
                <div style={{ display: 'flex', flexWrap: isMobile ? 'wrap' : 'nowrap', gap: '12px', marginBottom: '4px' }}>
                    {summaryCard(t.maSummaryOverall,
                        overallMs.win == null ? '-' : (
                            <span>
                                <span style={{ color: dirColor(overallMs.win) }}>{pct0(overallMs.win)}</span>
                                <span style={{ fontSize: '12px', fontWeight: 400, color: T.sub }}> ({tpl(t.maWlDrawTpl, { w: overallMs.wins, l: overallMs.losses, d: overallMs.draws })})</span>
                            </span>
                        ),
                        tpl(t.maCellPlayTpl, { p: '', n: overallMs.plays }).trim())}
                    {summaryCard(t.maSummaryBest,
                        best ? <span>{best.key} <span style={{ color: T.green }}>{pct0(best.ms.win)}</span></span> : <span style={{ color: T.faint, fontSize: '13px' }}>{t.maSummaryNone}</span>,
                        best ? tpl(t.maCellWinTpl, { p: pct0(best.ms.win), w: best.ms.wins }) : null)}
                    {summaryCard(t.maSummaryWorst,
                        worst ? <span>{worst.key} <span style={{ color: T.red }}>{pct0(worst.ms.win)}</span></span> : <span style={{ color: T.faint, fontSize: '13px' }}>{t.maSummaryNone}</span>,
                        worst ? tpl(t.maCellWinTpl, { p: pct0(worst.ms.win), w: worst.ms.wins }) : null)}
                </div>
            )}

            {/* ① 맵 타입 요약 — 행 클릭 → 그 타입의 맵별 드릴다운 */}
            <h2 style={sectionTitle}>{t.maTypeTitle}</h2>
            <p style={{ color: T.faint, fontSize: '11px', margin: '0 0 8px' }}>{t.maTypeHint}</p>
            <div className="mobile-scroll-hint" style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead style={{ background: T.header }}>
                        <tr>{[t.maColType, t.maColPlayRate, t.maColMapWin, t.maColFightWin, t.maColDelta, t.maColTrend, t.maColTopHeroes]
                            .map((h, i) => <th key={i} style={th}>{h}</th>)}</tr>
                    </thead>
                    <tbody>
                        {(loading || error) && loadErrRow(7)}
                        {!loading && !error && typeRows.map(r => {
                            const isPushRow = r.key === '밀기' || r.key === 'Push';
                            const open = expandedType === r.key;
                            const subRows = mapRows.filter(x => x.mapType === r.key); // 타입→맵 매핑 = 백엔드 map_type 재사용
                            return (
                                <React.Fragment key={r.key}>
                                    <tr className="flb-row" onClick={() => setExpandedType(open ? null : r.key)}
                                        style={{ borderBottom: `1px solid ${T.divider}`, cursor: 'pointer' }}>
                                        <td style={{ ...td, color: T.text, fontWeight: 600 }}>{open ? '▾ ' : '▸ '}{r.key}</td>
                                        <td style={td}>{tpl(t.maCellPlayTpl, { p: pct0(r.playRate), n: r.matches.length })}</td>
                                        <td style={td} title={isPushRow ? t.maPushTip : undefined}>
                                            {r.ms.win == null ? '-' : tpl(t.maCellWinTpl, { p: pct0(r.ms.win), w: r.ms.wins })}
                                            {isPushRow && <span style={{ color: T.yellow, marginLeft: 4 }}>*</span>}
                                        </td>
                                        {commonCells(r)}
                                    </tr>
                                    {open && (
                                        <tr style={{ borderBottom: `1px solid ${T.divider}` }}>
                                            <td colSpan={7} style={{ padding: '4px 12px 12px 28px', background: 'rgba(255,255,255,0.02)' }}>
                                                <table style={{ borderCollapse: 'collapse' }}>
                                                    <thead>
                                                        <tr>{[t.maColMap, t.maColPicks, t.maColMapWin, t.maColFightWin]
                                                            .map((h, i) => <th key={i} style={{ ...th, padding: '6px 22px 4px 0' }}>{h}</th>)}</tr>
                                                    </thead>
                                                    <tbody>
                                                        {subRows.map(x => (
                                                            <tr key={x.key}>
                                                                <td style={{ ...td, padding: '4px 22px 4px 0', color: T.text, fontWeight: 600 }}>{x.key}</td>
                                                                <td style={{ ...td, padding: '4px 22px 4px 0' }}>{x.matches.length}</td>
                                                                <td style={{ ...td, padding: '4px 22px 4px 0', color: dirColor(x.ms.win) }}>
                                                                    {x.ms.win == null ? '-' : pct0(x.ms.win)}<span style={{ color: T.faint }}> ({x.ms.wins}/{x.ms.denom})</span>
                                                                </td>
                                                                <td style={{ ...td, padding: '4px 0', color: dirColor(x.fs.win) }}>
                                                                    {x.fs.win == null ? '-' : pct0(x.fs.win)}<span style={{ color: T.faint }}> ({x.fs.wins}/{x.fs.sample})</span>
                                                                </td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </td>
                                        </tr>
                                    )}
                                </React.Fragment>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            {/* ② 맵별 상세 — 행 클릭 → 매치 목록 펼침 */}
            <h2 style={sectionTitle}>{t.maMapsTitle}</h2>
            <p style={{ color: T.faint, fontSize: '11px', margin: '0 0 8px' }}>{t.maMapsHint}</p>
            <div className="mobile-scroll-hint" style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead style={{ background: T.header }}>
                        <tr>{[t.maColMap, t.maColType, t.maColPlayRate, t.maColMapWin, t.maColFightWin, t.maColDelta, t.maColTrend, t.maColTopHeroes]
                            .map((h, i) => <th key={i} style={th}>{h}</th>)}</tr>
                    </thead>
                    <tbody>
                        {(loading || error) && loadErrRow(8)}
                        {!loading && !error && mapRows.map(r => {
                            const open = expandedMap === r.key;
                            return (
                                <React.Fragment key={r.key}>
                                    <tr className="flb-row" onClick={() => setExpandedMap(open ? null : r.key)}
                                        style={{ borderBottom: `1px solid ${T.divider}`, cursor: 'pointer' }}>
                                        <td style={{ ...td, color: T.text, fontWeight: 600 }}>{open ? '▾ ' : '▸ '}{r.key}</td>
                                        <td style={{ ...td, color: T.sub }}>{r.mapType}</td>
                                        <td style={td}>{tpl(t.maCellPlayTpl, { p: pct0(r.playRate), n: r.matches.length })}</td>
                                        <td title={(r.mapType === '밀기' || r.mapType === 'Push') ? t.maPushTip : undefined}
                                            style={{ ...td, color: dirColor(r.ms.win), fontWeight: 600 }}>
                                            {r.ms.win == null ? '-' : tpl(t.maCellWinTpl, { p: pct0(r.ms.win), w: r.ms.wins })}
                                        </td>
                                        {commonCells(r)}
                                    </tr>
                                    {open && (
                                        <tr style={{ borderBottom: `1px solid ${T.divider}` }}>
                                            <td colSpan={8} style={{ padding: '4px 12px 12px 28px', background: 'rgba(255,255,255,0.02)' }}>
                                                <table style={{ borderCollapse: 'collapse' }}>
                                                    <thead>
                                                        <tr>{[t.maMlDate, t.maMlOpp, t.maMlScore, t.maMlResult, t.maMlLink]
                                                            .map((h, i) => <th key={i} style={{ ...th, padding: '6px 18px 4px 0' }}>{h}</th>)}</tr>
                                                    </thead>
                                                    <tbody>
                                                        {[...r.matches]
                                                            .sort((a, b) => (b.session_date.localeCompare(a.session_date)) || (b.match_id > a.match_id ? 1 : -1))
                                                            .map(m => {
                                                                const rl = resultLabel(m.result);
                                                                return (
                                                                    <tr key={m.match_id}>
                                                                        <td style={{ ...td, padding: '4px 18px 4px 0', color: T.sub }}>{m.session_date || '-'}</td>
                                                                        <td style={{ ...td, padding: '4px 18px 4px 0' }}>{m.enemy_team || '-'}</td>
                                                                        <td style={{ ...td, padding: '4px 18px 4px 0' }}>
                                                                            {(m.our_score != null && m.enemy_score != null && (m.our_score + m.enemy_score) > 0) ? `${m.our_score} : ${m.enemy_score}` : '-'}
                                                                        </td>
                                                                        <td style={{ ...td, padding: '4px 18px 4px 0', color: rl.color, fontWeight: 600 }}>
                                                                            {rl.txt}
                                                                            {m.overridden && <span style={{ color: T.faint, fontWeight: 400, fontSize: '10px', marginLeft: 5 }}>({t.maCorrected})</span>}
                                                                        </td>
                                                                        <td style={{ ...td, padding: '4px 0' }}>
                                                                            {onGoSession && m.session_id ? (
                                                                                <button onClick={(e) => { e.stopPropagation(); onGoSession(m.session_id); }}
                                                                                    style={{ background: T.pillBg, color: T.sub, border: `1px solid ${T.inputBorder}`, borderRadius: '5px', padding: '2px 10px', fontSize: '11px', cursor: 'pointer' }}>
                                                                                    {t.maMlOpen}
                                                                                </button>
                                                                            ) : <span style={{ color: T.faint }}>-</span>}
                                                                        </td>
                                                                    </tr>
                                                                );
                                                            })}
                                                    </tbody>
                                                </table>
                                            </td>
                                        </tr>
                                    )}
                                </React.Fragment>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            {/* ③ 주별 추이 매트릭스 — 토글 3모드(한타 승률/맵 승률/픽 횟수), 주 헤더 클릭 → 그 주 상세 */}
            <h2 style={sectionTitle}>{t.maWeeklyTitle}</h2>
            <SubTabPills active={weekMetric} onChange={setWeekMetric}
                tabs={[['fight', t.maWeeklyMetricFight], ['map', t.maWeeklyMetricMap], ['picks', t.maWeeklyMetricPicks]]} />
            {!loading && !error && weekly && (
                <div className="mobile-scroll-hint" style={{ overflowX: 'auto' }}>
                    <table style={{ borderCollapse: 'collapse' }}>
                        <thead style={{ background: T.header }}>
                            <tr>
                                <th style={th}>{t.maColType}</th>
                                {weekly.weeks.map(w => {
                                    const active = selectedWeek === w;
                                    return (
                                        <th key={w} style={{ ...th, textAlign: 'center', padding: '4px 6px' }}>
                                            <button onClick={() => setSelectedWeek(active ? null : w)}
                                                title={`${shortMD(w)} ~ ${shortMD(addDays(w, 6))}`}
                                                style={{ background: active ? T.pillBg : 'transparent', color: active ? T.text : T.sub,
                                                    border: `1px solid ${active ? T.inputBorder : 'transparent'}`, borderRadius: '6px',
                                                    padding: '4px 8px', fontSize: '12px', fontWeight: active ? 700 : 500, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                                                {weekLabelOf(w, t)}
                                            </button>
                                        </th>
                                    );
                                })}
                            </tr>
                        </thead>
                        <tbody>
                            {weekly.rows.map((row, ri) => (
                                <tr key={row.key} style={{ borderBottom: `1px solid ${T.divider}` }}>
                                    <td style={{ ...td, color: T.text, fontWeight: row.key === '__all__' ? 700 : 500 }}>{row.label}</td>
                                    {weekly.weeks.map((w, wi) => {
                                        const c = weekly.cells[ri][wi];
                                        const range = `${shortMD(w)} ~ ${shortMD(addDays(w, 6))}`;
                                        if (weekMetric === 'picks') {
                                            // 픽 횟수 모드: 매치 수, 색 없음
                                            return (
                                                <td key={w} title={tpl(t.maWeeklyPicksTipTpl, { range, n: c.picks })}
                                                    style={{ ...td, textAlign: 'center', color: c.picks > 0 ? T.text : T.faint }}>
                                                    {c.picks > 0 ? c.picks : '—'}
                                                </td>
                                            );
                                        }
                                        if (!c.n || c.win == null) {
                                            // 표본 하한 없음 — 그 주에 표본이 아예 없을 때만 '—'
                                            return (
                                                <td key={w} title={tpl(t.maWeeklyLowTipTpl, { range, n: c.n })}
                                                    style={{ ...td, textAlign: 'center', color: T.faint }}>—</td>
                                            );
                                        }
                                        return (
                                            <td key={w} title={tpl(t.maWeeklyCellTipTpl, { range, metric: metricLabel, p: pct0(c.win), w: c.w, n: c.n })}
                                                style={{ ...td, textAlign: 'center', background: cellBg(c.win), color: dirColor(c.win), fontWeight: 600 }}>
                                                {pct0(c.win)} <span style={{ color: T.sub, fontWeight: 400 }}>({c.n})</span>
                                            </td>
                                        );
                                    })}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
            {!loading && !error && !weekly && (
                <p style={{ color: T.faint, fontSize: '12px' }}>{t.noData}</p>
            )}

            {/* 주 헤더 클릭 → 그 주 상세: 맵 | 타입 | 픽 수 | 맵 승률 | 한타 승률 */}
            {!loading && !error && weekDetail && (
                <div style={{ marginTop: '14px', background: T.panel, border: `1px solid ${T.panelBorder}`, borderRadius: '8px', padding: '12px 16px' }}>
                    <div style={{ fontSize: '13px', fontWeight: 600, color: T.text, marginBottom: '8px' }}>
                        {tpl(t.maWeekDetailTpl, { label: weekLabelOf(selectedWeek, t), range: weekDetail.range, n: weekDetail.totalPicks })}
                    </div>
                    <table style={{ borderCollapse: 'collapse' }}>
                        <thead>
                            <tr>{[t.maColMap, t.maColType, t.maColPicks, t.maColMapWin, t.maColFightWin]
                                .map((h, i) => <th key={i} style={{ ...th, padding: '6px 22px 4px 0' }}>{h}</th>)}</tr>
                        </thead>
                        <tbody>
                            {weekDetail.rows.map(r => (
                                <tr key={r.key}>
                                    <td style={{ ...td, padding: '4px 22px 4px 0', color: T.text, fontWeight: 600 }}>{r.key}</td>
                                    <td style={{ ...td, padding: '4px 22px 4px 0', color: T.sub }}>{r.mapType}</td>
                                    <td style={{ ...td, padding: '4px 22px 4px 0' }}>{r.picks}</td>
                                    <td style={{ ...td, padding: '4px 22px 4px 0', color: dirColor(r.ms.win) }}>
                                        {r.ms.win == null ? '-' : `${pct0(r.ms.win)}`}<span style={{ color: T.faint }}> ({r.ms.wins}/{r.ms.denom})</span>
                                    </td>
                                    <td style={{ ...td, padding: '4px 0', color: dirColor(r.fs.win) }}>
                                        {r.fs.win == null ? '-' : `${pct0(r.fs.win)}`}<span style={{ color: T.faint }}> ({r.fs.wins}/{r.fs.sample})</span>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            <ExplainBox lines={explains} t={t} />
        </FightScopeShell>
    );
}
