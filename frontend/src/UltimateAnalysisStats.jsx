// 궁극기 분석 탭 — "한타 분석 (베타)"의 [궁극기] 서브탭(요약 숫자+상황 표)과
// [궁 콤보·시퀀스] 서브탭(콤보/시퀀스/응수 섹션)을 통째로 이동한 페이지.
// 계산·컴포넌트는 FightLabStats.jsx의 것을 그대로 재사용(이동만) — 상태는 이 페이지에서 독립.
// 서브탭: [상황] [콤보·시퀀스] (B 패턴 분석은 추후 이 줄에 추가 예정).
import React, { useState, useMemo, useEffect } from 'react';
import { fetchCached } from './utils/apiCache';
import { useLanguage } from "./LanguageContext";
import {
    T, pct, tpl, isKnown, buildUltStats, flipRecord,
    useFightScope, FightScopeShell, SubTabPills, PerspectiveNotice,
    SituationTable, ExplainBox, VerdictChip, computeVerdict,
    UltimateComboSection, UltimateSequenceSection, UltimateCounterSection,
    VodList, VOD_PAGE,
    collectFollowups, seqWin, seqReactInFight, RESPONSE_WINDOW_SEC,
} from './FightLabStats';

const API_BASE = "";

// ═══ [교환 패턴] — 궁 교환의 "순서"를 낱개 표기로 집계: 궁 하나 = 칩 하나 ═══
// 3초 묶음(수) 접기는 이 표의 패턴 키에서 제거됨 — 궁 묶음(콤보)의 분석은 [콤보·시퀀스] 서브탭 전담.
// 정렬: timestamp, 동일 시각은 우리 궁 우선(콤보/이니시와 공통 규칙). 궁 0개 한타 = "무궁".
// 칩이 MAX_CHIPS(6)를 넘으면 앞 6칩 + "…"로 절단해 같은 버킷으로(패턴 폭발 방지).
// PATTERN_CHAIN_SEC·patternMoves는 [이니시]의 첫 궁 판정이 재사용하므로 유지(이 표에서는 미사용).
const PATTERN_CHAIN_SEC = 3;
const PATTERN_MAX_CHIPS = 6;

// 한타 → 수 배열 [{side, n, ults[]}] (동일 timestamp는 우리 궁 우선 — 콤보/패턴 공통 정렬 규칙)
// [이니시] 첫 궁 판정 전용으로 유지 — 교환 패턴 키 계산에는 더 이상 쓰이지 않음.
function patternMoves(r, chainSec) {
    const seq = [...(r.ults || [])].sort((a, b) =>
        (a.timestamp - b.timestamp) || ((a.side === 'us' ? 0 : 1) - (b.side === 'us' ? 0 : 1)));
    const moves = [];
    let last = null;
    seq.forEach(u => {
        const m = moves[moves.length - 1];
        if (m && m.side === u.side && u.timestamp - last <= chainSec) { m.n += 1; m.ults.push(u); }
        else moves.push({ side: u.side, n: 1, ults: [u] });
        last = u.timestamp;
    });
    return moves;
}

// 한타 → 궁 낱개 시퀀스(정렬 규칙은 patternMoves와 동일 — 공통 정렬만 재사용)
function ultSeqOf(r) {
    return [...(r.ults || [])].sort((a, b) =>
        (a.timestamp - b.timestamp) || ((a.side === 'us' ? 0 : 1) - (b.side === 'us' ? 0 : 1)));
}

// 구조 키(낱개): 'u-u-e' / 'none' / 절단 '-~' 접미
function patternKey(seq) {
    if (seq.length === 0) return 'none';
    return seq.slice(0, PATTERN_MAX_CHIPS).map(u => (u.side === 'us' ? 'u' : 'e')).join('-')
        + (seq.length > PATTERN_MAX_CHIPS ? '-~' : '');
}
// 구성 그룹 키 — 우리 궁 영웅을 낱개 순서대로(앞 MAX_CHIPS 칩 내). 상대 궁은 키에 넣지 않음(표본 보전,
// 표시에서만 빈도 병기). 우리 궁이 없는 패턴(적군만)은 null — 구성 드릴다운 미표시.
function patternCompKey(seq) {
    const ours = seq.slice(0, PATTERN_MAX_CHIPS).filter(u => u.side === 'us');
    if (ours.length === 0) return null;
    return ours.map(u => u.hero || '?').join(' → ');
}
const patternMirrorKey = (key) =>
    key === 'none' ? 'none' : key.replace(/[ue]/g, c => (c === 'u' ? 'e' : 'u'));

// ── 팀 색 칩 — 타임라인 뷰어(MatchStats COLOR_TEAM1/COLOR_TEAM2) 팀 색 토큰 재사용 ──
const CHIP_BLUE = '#60a5fa', CHIP_RED = '#f87171';
const chipStyle = (side) => ({
    display: 'inline-block', padding: '1px 7px', borderRadius: '5px',
    fontSize: '10px', fontWeight: 700, lineHeight: '16px', whiteSpace: 'nowrap',
    background: side === 'us' ? 'rgba(96,165,250,0.16)' : 'rgba(248,113,113,0.16)',
    color: side === 'us' ? CHIP_BLUE : CHIP_RED,
});
// 패턴 키 → 배지 칩 나열([아군][아군]→[적군], 절단은 '…')
function PatternChips({ pkey, t }) {
    if (pkey === 'none') return <span style={{ color: T.sub }}>{t.flPatNone}</span>;
    return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap' }}>
            {pkey.split('-').map((p, i) => (
                <React.Fragment key={i}>
                    {i > 0 && <span style={{ color: T.faint, fontSize: '10px' }}>→</span>}
                    {p === '~'
                        ? <span style={{ color: T.sub }}>…</span>
                        : <span style={chipStyle(p === 'u' ? 'us' : 'them')}
                            title={p === 'u' ? t.flPatChipUsTip : t.flPatChipOppTip}>
                            {p === 'u' ? t.flPatChipUs : t.flPatChipOpp}
                        </span>}
                </React.Fragment>
            ))}
        </span>
    );
}
// 한타 1건의 완전한 궁 시퀀스 한 줄(타임라인 뷰어 칩 스타일 재사용: 팀 색 점 + 이름) — VOD 항목용
function UltSeqLine({ r, t }) {
    const seq = ultSeqOf(r);
    return (
        <span style={{ flexBasis: '100%', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '4px', padding: '2px 0 4px' }}>
            {seq.map((u, i) => (
                <React.Fragment key={i}>
                    {i > 0 && <span style={{ color: T.faint, fontSize: '10px' }}>→</span>}
                    <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: '4px',
                        background: 'rgba(255,255,255,0.04)', border: `1px solid ${T.divider}`,
                        borderRadius: '6px', padding: '1px 7px', whiteSpace: 'nowrap', fontSize: '11px',
                    }}>
                        <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: u.side === 'us' ? CHIP_BLUE : CHIP_RED, flexShrink: 0 }} />
                        <span style={{ color: T.sub }}>{u.side === 'us' ? t.flPatUs : t.flPatOpp}</span>
                        <span style={{ color: T.text, fontWeight: 600 }}>{u.hero || '?'}</span>
                    </span>
                </React.Fragment>
            ))}
        </span>
    );
}

function UltimatePatternSection({ recsNow, recsPast, compareOn, minSample, t, GREEN, RED, perspective }) {
    const [onlyUlt, setOnlyUlt] = useState(true); // 궁 사용 한타만 보기(기본 ON) — 끄면 무궁 포함
    const [barOn, setBarOn] = useState(true);     // 승률 셀 미니 바(기본 ON)
    const [secView, setSecView] = useState('all'); // 섹션 필터: 'all' | 'us' | 'opp' — 스크롤 없이 상대 선궁 바로 보기
    const [vodOpen, setVodOpen] = useState({});
    const [compSel, setCompSel] = useState({}); // 패턴 키 → 선택된 구성 키(VOD 목록을 그 구성 한타로 좁힘)
    const toggleVod = (id) => {
        setVodOpen(o => { const n = { ...o }; if (n[id]) delete n[id]; else n[id] = VOD_PAGE; return n; });
        setCompSel(s => { if (!(id in s)) return s; const n = { ...s }; delete n[id]; return n; });
    };
    const moreVod = (id) => setVodOpen(o => ({ ...o, [id]: (o[id] || VOD_PAGE) + VOD_PAGE }));
    const toggleComp = (pk, ck) => setCompSel(s => { const n = { ...s }; if (n[pk] === ck) delete n[pk]; else n[pk] = ck; return n; });
    // 주목 패턴 카드 클릭 → 해당 행 펼침 + 스크롤(행이 현재 섹션 필터에 가려져 있으면 그 섹션으로 전환)
    const focusRow = (k) => {
        setSecView(v => {
            const need = k.startsWith('u') ? 'us' : k.startsWith('e') ? 'opp' : 'all';
            return (v === 'all' || v === need) ? v : need;
        });
        setVodOpen(o => ({ ...o, [k]: o[k] || VOD_PAGE }));
        // 섹션 전환 시 행이 다시 마운트될 수 있어 렌더 커밋 이후로 지연
        setTimeout(() =>
            document.getElementById(`pat-row-${k}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60);
    };

    const result = useMemo(() => {
        // 토글 ON이면 무궁(궁 0개) 한타를 표본에서 제외 — 발생률·요약·표 모두 이 모집단 기준(필터만, 계산 규칙 무변경)
        const Kall = recsNow.filter(isKnown);
        const K = onlyUlt ? Kall.filter(r => (r.ults || []).length > 0) : Kall;
        const map = new Map(); // key → { key, fights[] }
        const perFightSeq = new Map(); // 한타 → 낱개 궁 시퀀스(인사이트·구성 표시 재사용)
        K.forEach(r => {
            const seq = ultSeqOf(r);
            perFightSeq.set(r, seq);
            const k = patternKey(seq);
            let e = map.get(k);
            if (!e) { e = { key: k, fights: [] }; map.set(k, e); }
            e.fights.push(r);
        });
        const winOf = (fs) => fs.length > 0 ? fs.filter(r => r.fight_winner === 'us').length / fs.length : null;
        // 과거(추세 기간) 동일 정의 집계
        const pastMap = new Map();
        if (compareOn) {
            recsPast.filter(isKnown).filter(r => !onlyUlt || (r.ults || []).length > 0).forEach(r => {
                const k = patternKey(ultSeqOf(r));
                pastMap.set(k, (pastMap.get(k) || []).concat([r]));
            });
        }
        const rows = Array.from(map.values()).map(e => {
            const win = winOf(e.fights);
            // Δ(vs 상대) = 미러 패턴(아↔적 반전)의 "상대 승률"(= 1 − 그 패턴의 우리 승률)과 비교.
            // 미러가 자기 자신인 대칭 패턴(무궁 포함)은 비교 무의미 → null.
            const mk = patternMirrorKey(e.key);
            let dOpp = null;
            if (mk !== e.key) {
                const m = map.get(mk);
                const mw = m ? winOf(m.fights) : null;
                if (win != null && mw != null) dOpp = (win - (1 - mw)) * 100;
            }
            let trend = null;
            if (compareOn && win != null) {
                const pf = pastMap.get(e.key) || [];
                if (pf.length >= minSample) { const pw = winOf(pf); if (pw != null) trend = (win - pw) * 100; }
            }
            // 구성 드릴다운 — 그룹 키는 "우리 궁 영웅(낱개 순서)"만(상대 궁은 키 제외 — 표본 보전).
            // 우리 궁이 있는 패턴이면 모든 한타가 정확히 하나의 구성에 속함(구성 표본 합 = 패턴 표본).
            const compMap = new Map();
            e.fights.forEach(r => {
                const ck = patternCompKey(perFightSeq.get(r));
                if (ck != null) compMap.set(ck, (compMap.get(ck) || []).concat([r]));
            });
            // 표시용 슬롯: 패턴 칩 순서 그대로 — 우리 자리 = 영웅명, 상대 자리 = 실제 상대 궁 빈도(상위 2 + 기타)
            const sides = e.key === 'none' ? [] : e.key.split('-').filter(p => p !== '~');
            const comps = Array.from(compMap.entries()).map(([ck, fs]) => {
                let ui = 0;
                const ourHeroes = ck.split(' → ');
                const slots = sides.map((s, i) => {
                    if (s === 'u') return { side: 'us', hero: ourHeroes[ui++] };
                    const tally = new Map();
                    fs.forEach(r => { const h = perFightSeq.get(r)[i].hero || '?'; tally.set(h, (tally.get(h) || 0) + 1); });
                    const sorted = Array.from(tally.entries()).sort((a, b) => b[1] - a[1]);
                    return { side: 'them', top: sorted.slice(0, 2), other: sorted.slice(2).reduce((a, [, n]) => a + n, 0) };
                });
                return { key: ck, fights: fs, sample: fs.length, win: winOf(fs), ok: fs.length >= minSample, slots, truncated: e.key.endsWith('-~') };
            }).sort((a, b) => b.sample - a.sample);
            return {
                ...e, sample: e.fights.length, occ: e.fights.length / K.length,
                win, dOpp, trend, ok: e.fights.length >= minSample, comps,
            };
        }).sort((a, b) => b.sample - a.sample);

        // 첫 칩 기준 섹션 분리 + 소계(표본 합·가중 평균 승률 = 섹션 한타 전체의 승률)
        const secOf = (pred) => {
            const secRows = rows.filter(pred);
            const fights = secRows.flatMap(r => r.fights);
            return { rows: secRows, sample: fights.length, win: winOf(fights) };
        };
        const secUs = secOf(r => r.key.startsWith('u'));
        const secOpp = secOf(r => r.key.startsWith('e'));
        const secNone = secOf(r => r.key === 'none');

        // 주목 패턴: 최소 표본 충족 행 중 승률 상위 3 + 하위 3(중복 제거, 무궁 제외)
        const eligible = rows.filter(r => r.ok && r.win != null && r.key !== 'none');
        const best = [...eligible].sort((a, b) => b.win - a.win).slice(0, 3);
        const worst = [...eligible].sort((a, b) => a.win - b.win).slice(0, 3)
            .filter(r => !best.some(b => b.key === r.key));

        // 인사이트: 첫 칩/마지막 칩(절단 전 전체 시퀀스 기준, 무궁 제외)
        const withUlt = K.filter(r => perFightSeq.get(r).length > 0);
        const grp = (pick) => {
            const us = withUlt.filter(r => pick(perFightSeq.get(r)) === 'us');
            const them = withUlt.filter(r => pick(perFightSeq.get(r)) === 'them');
            return { aWin: winOf(us), aN: us.length, bWin: winOf(them), bN: them.length };
        };
        return {
            rows, total: K.length, kinds: map.size,
            topPattern: rows.length > 0 ? rows[0].key : null,
            secUs, secOpp, secNone, best, worst,
            insFirst: grp(seq => seq[0].side),
            insLast: grp(seq => seq[seq.length - 1].side),
        };
    }, [recsNow, recsPast, compareOn, minSample, onlyUlt]);

    const thStyle = { padding: '8px 12px', textAlign: 'left', fontSize: '12px', fontWeight: 400, color: T.sub, whiteSpace: 'nowrap' };
    const tdCell = { padding: '6px 12px', fontSize: '12px', textAlign: 'left', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' };
    const dColor = (d) => (d == null || Math.abs(d) < 1) ? T.sub : (d > 0 ? GREEN : RED);
    const fmtD = (d) => d == null ? '—' : `${d > 0 ? '+' : '−'}${Math.abs(d).toFixed(1)}${t.flUnitPp}`;
    const trendText = (tr) => tr == null ? '—'
        : `${tr >= 1 ? '↑' : tr <= -1 ? '↓' : '→'} ${tr > 0 ? '+' : tr < 0 ? '−' : ''}${Math.abs(Math.round(tr))}${t.flUnitPp}`;
    const trendColor = (tr) => (tr == null || Math.abs(tr) < 1) ? T.sub : (tr > 0 ? GREEN : RED);
    const ins = (g, tplStr) => tpl(tplStr, { a: pct(g.aWin), an: g.aN, b: pct(g.bWin), bn: g.bN });
    const nCols = compareOn ? 7 : 6;

    // 승률 셀 — 미니 바(배경 채움 + 50% 기준선), 토글 OFF면 숫자만
    const winCell = (win) => (!barOn || win == null) ? pct(win) : (
        <div style={{ position: 'relative', minWidth: '96px', height: '18px', display: 'flex', alignItems: 'center' }}>
            <div style={{ position: 'absolute', inset: 0, background: T.pillBg, borderRadius: '4px', overflow: 'hidden' }}>
                <div style={{ width: `${win * 100}%`, height: '100%', background: win >= 0.5 ? 'rgba(63,185,80,0.28)' : 'rgba(229,72,77,0.28)' }} />
            </div>
            <div style={{ position: 'absolute', left: '50%', top: '2px', bottom: '2px', width: '1px', background: T.faint }} />
            <span style={{ position: 'relative', paddingLeft: '6px' }}>{pct(win)}</span>
        </div>
    );

    // 구성 셀 — 전체 시퀀스: 우리 자리 = 영웅명(파랑), 상대 자리 = 실제 상대 궁 빈도 병기(빨강, 상위 2+기타)
    const compCell = (c) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap' }}>
            {c.slots.map((sl, i) => (
                <React.Fragment key={i}>
                    {i > 0 && <span style={{ color: T.faint, fontSize: '10px' }}>→</span>}
                    {sl.side === 'us'
                        ? <span style={{ color: CHIP_BLUE, fontWeight: 600 }}>{sl.hero}</span>
                        : <span style={{ color: CHIP_RED }}>
                            {t.flPatOpp}({sl.top.map(([h, n]) => `${h} ${n}`).join('/')}{sl.other > 0 ? `/${tpl(t.flPatOppOther, { n: sl.other })}` : ''})
                        </span>}
                </React.Fragment>
            ))}
            {c.truncated && <span style={{ color: T.sub }}> …</span>}
        </span>
    );

    // 패턴 행 1개(+펼침: 구성 미니 표 + VOD)
    const renderRow = (e) => {
        const openN = vodOpen[e.key];
        const selComp = e.comps.find(c => c.key === compSel[e.key]) || null;
        return (
            <React.Fragment key={e.key}>
                <tr id={`pat-row-${e.key}`} className="flb-row" onClick={() => toggleVod(e.key)}
                    style={{ borderBottom: `1px solid ${T.divider}`, opacity: e.ok ? 1 : 0.45, cursor: 'pointer' }}>
                    <td style={tdCell}>
                        <span style={{ color: T.sub, marginRight: '6px', fontSize: '10px' }}>{openN ? '▾' : '▸'}</span>
                        <PatternChips pkey={e.key} t={t} />
                    </td>
                    <td style={tdCell}>{pct(e.occ)}</td>
                    <td style={tdCell}>{winCell(e.win)}</td>
                    <td style={{ ...tdCell, color: dColor(e.dOpp) }}>{fmtD(e.dOpp)}</td>
                    {compareOn && <td style={{ ...tdCell, color: trendColor(e.trend) }}>{trendText(e.trend)}</td>}
                    <td style={{ ...tdCell, color: T.sub }}>{e.sample}</td>
                    <td style={{ ...tdCell, color: e.ok ? T.sub : T.yellow }}>{e.ok ? t.flStatusOk : t.flLowSample}</td>
                </tr>
                {openN && (
                    <tr>
                        <td colSpan={nCols} style={{ padding: 0 }}>
                            {/* 구성 미니 표 — 우리 궁이 있는 패턴만. 행 클릭 → VOD 목록을 그 구성 한타로 좁힘 */}
                            {e.comps.length > 0 && (
                                <div style={{ padding: '10px 12px 2px 28px', background: 'rgba(255,255,255,0.02)' }}>
                                    <div style={{ fontSize: '11px', marginBottom: '6px' }}>
                                        <span style={{ fontWeight: 600, color: T.text }}>{t.flPatCompTitle}</span>
                                        <span style={{ marginLeft: '10px', color: T.yellow }}>{t.flPatCompNotice}</span>
                                    </div>
                                    <table style={{ borderCollapse: 'collapse' }}>
                                        <thead>
                                            <tr>{[t.flPatCompCol, t.flColSampleOne, t.flColWin, t.flColStatus].map((h, i) =>
                                                <th key={i} style={{ ...thStyle, padding: '3px 12px', fontSize: '11px' }}>{h}</th>)}</tr>
                                        </thead>
                                        <tbody>
                                            {e.comps.slice(0, 5).map(c => {
                                                const sel = compSel[e.key] === c.key;
                                                return (
                                                    <tr key={c.key} className="flb-row" onClick={() => toggleComp(e.key, c.key)}
                                                        style={{ cursor: 'pointer', opacity: c.ok ? 1 : 0.45, background: sel ? 'rgba(229,72,77,0.10)' : 'transparent' }}>
                                                        <td style={{ ...tdCell, padding: '4px 12px', whiteSpace: 'normal' }}>{sel ? '▸ ' : ''}{compCell(c)}</td>
                                                        <td style={{ ...tdCell, padding: '4px 12px', color: T.sub }}>{c.sample}</td>
                                                        <td style={{ ...tdCell, padding: '4px 12px' }}>{pct(c.win)}</td>
                                                        <td style={{ ...tdCell, padding: '4px 12px', color: c.ok ? T.sub : T.yellow }}>{c.ok ? t.flStatusOk : t.flLowSample}</td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                            {/* 구성 선택 시: VOD 각 항목에 완전한 궁 시퀀스 한 줄 추가 */}
                            <VodList
                                items={(selComp || e).fights.map(r => ({ r, extra: selComp ? <UltSeqLine r={r} t={t} /> : null }))}
                                shown={openN} onMore={() => moreVod(e.key)}
                                t={t} perspective={perspective} GREEN={GREEN} RED={RED} />
                        </td>
                    </tr>
                )}
            </React.Fragment>
        );
    };

    // 섹션 헤더 행(소계: 표본 합·가중 평균 승률)
    const sectionHeader = (title, sec) => (
        <tr style={{ background: T.header }}>
            <td colSpan={nCols} style={{ padding: '7px 12px', fontSize: '12px', fontWeight: 600, color: T.text }}>
                {title}
                <span style={{ marginLeft: '10px', fontWeight: 400, color: T.sub }}>
                    {tpl(t.flPatSecSub, { n: sec.sample, w: pct(sec.win) })}
                </span>
            </td>
        </tr>
    );

    // 주목 패턴 카드(충족 중 승률 상위/하위) — 클릭 시 해당 행 스크롤+펼침
    const hotCard = (e, good) => (
        <div key={e.key} onClick={() => focusRow(e.key)}
            style={{
                display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '6px 10px',
                borderRadius: '8px', cursor: 'pointer', background: T.pillBg,
                border: `1px solid ${good ? 'rgba(63,185,80,0.45)' : 'rgba(229,72,77,0.45)'}`,
            }}>
            <PatternChips pkey={e.key} t={t} />
            <span style={{ fontSize: '12px', fontWeight: 700, color: good ? GREEN : RED }}>{pct(e.win)}</span>
            <span style={{ fontSize: '10px', color: T.sub }}>({e.sample})</span>
        </div>
    );

    return (
        <div>
            {/* 상단 요약 + 컨트롤 */}
            <div style={{ display: 'flex', gap: '40px', alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: '14px' }}>
                <div>
                    <div style={{ fontSize: '22px', fontWeight: 600, color: T.text }}>{result.total}</div>
                    <div style={{ fontSize: '11px', color: T.sub, marginTop: '2px' }}>{t.flPatSumFights}</div>
                </div>
                <div>
                    <div style={{ fontSize: '22px', fontWeight: 600, color: T.text }}>{result.kinds}</div>
                    <div style={{ fontSize: '11px', color: T.sub, marginTop: '2px' }}>{t.flPatSumKinds}</div>
                </div>
                <div>
                    <div style={{ fontSize: '22px', fontWeight: 600, color: T.text, lineHeight: '22px' }}>
                        {result.topPattern ? <PatternChips pkey={result.topPattern} t={t} /> : '-'}
                    </div>
                    <div style={{ fontSize: '11px', color: T.sub, marginTop: '2px' }}>{t.flPatSumTop}</div>
                </div>
                <div style={{ marginLeft: 'auto', display: 'flex', gap: '10px', alignItems: 'flex-end' }}>
                    <button onClick={() => setOnlyUlt(v => !v)}
                        style={{ background: onlyUlt ? T.pillRed : T.pillBg, color: onlyUlt ? '#fff' : T.sub, border: 'none', padding: '7px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: 500 }}>
                        {t.flPatOnlyUlt}
                    </button>
                    <button onClick={() => setBarOn(v => !v)}
                        style={{ background: barOn ? T.pillRed : T.pillBg, color: barOn ? '#fff' : T.sub, border: 'none', padding: '7px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: 500 }}>
                        {t.flPatBarToggle}
                    </button>
                </div>
            </div>

            {/* 인사이트 줄 2개 */}
            <div style={{ fontSize: '12px', color: T.sub, marginBottom: '12px', lineHeight: 1.8 }}>
                <div>• {ins(result.insFirst, t.flPatInsFirst)}</div>
                <div>• {ins(result.insLast, t.flPatInsLast)}</div>
            </div>

            {/* 주목 패턴 카드 줄 */}
            {(result.best.length > 0 || result.worst.length > 0) && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '12px' }}>
                    <span style={{ fontSize: '11px', color: T.sub, fontWeight: 600 }}>{t.flPatHotTitle}</span>
                    {result.best.map(e => hotCard(e, true))}
                    {result.worst.map(e => hotCard(e, false))}
                </div>
            )}

            {/* 표 위 안내 + 섹션 필터 pill(스크롤 없이 원하는 섹션 바로 보기) */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', margin: '0 0 8px' }}>
                <p style={{ color: T.sub, fontSize: '12px', margin: 0 }}>{t.flPatTableNote}</p>
                <div style={{ marginLeft: 'auto', display: 'flex', gap: '6px' }}>
                    {[
                        ['all', t.all, null],
                        ['us', t.flPatSecUs, result.secUs.sample],
                        ['opp', t.flPatSecOpp, result.secOpp.sample],
                    ].map(([v, label, n]) => (
                        <button key={v} onClick={() => setSecView(v)}
                            style={{
                                background: secView === v ? T.pillRed : T.pillBg, color: secView === v ? '#fff' : T.sub,
                                border: 'none', padding: '5px 11px', borderRadius: '6px', cursor: 'pointer', fontSize: '11px', fontWeight: 500,
                            }}>
                            {label}{n != null ? ` (${n})` : ''}
                        </button>
                    ))}
                </div>
            </div>

            {/* 메인 표 — 첫 칩 기준 두 섹션(+무궁), 섹션 필터 적용 */}
            <div className="mobile-scroll-hint" style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead style={{ background: T.header }}>
                        <tr>{[
                            t.flPatColPattern, t.flColOccur, t.flColWin, t.flColDWin,
                            ...(compareOn ? [t.flColTrend] : []),
                            t.flColSampleOne, t.flColStatus,
                        ].map((h, i) => <th key={i} style={thStyle}>{h}</th>)}</tr>
                    </thead>
                    <tbody>
                        {result.rows.length === 0 && (
                            <tr><td colSpan={nCols} style={{ padding: '30px', textAlign: 'center', color: T.sub }}>{t.noFilteredData}</td></tr>
                        )}
                        {secView !== 'opp' && result.secUs.rows.length > 0 && sectionHeader(t.flPatSecUs, result.secUs)}
                        {secView !== 'opp' && result.secUs.rows.map(renderRow)}
                        {secView !== 'us' && result.secOpp.rows.length > 0 && sectionHeader(t.flPatSecOpp, result.secOpp)}
                        {secView !== 'us' && result.secOpp.rows.map(renderRow)}
                        {secView === 'all' && result.secNone.rows.length > 0 && sectionHeader(t.flPatNone, result.secNone)}
                        {secView === 'all' && result.secNone.rows.map(renderRow)}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

// ═══ [이니시] — 선궁(한타의 첫 궁)의 질 분석: "누가, 어떤 궁으로 열 때 이기는가" ═══
// 첫 궁 판정 = 교환 패턴의 첫 수 정의 그대로 재사용(patternMoves — timestamp 정렬,
// 동시각은 우리 우선 타이 규칙). 응수 미니 표 = 응수 분석과 동일 계산(collectFollowups,
// RESPONSE_WINDOW_SEC=3초 창) 재사용. 새 판정 로직 없음. 모집단: 판정 가능+궁 사용 한타.
function UltimateInitiationSection({ recsNow, recsPast, compareOn, minSample, t, GREEN, RED, perspective }) {
    const [openOur, setOpenOur] = useState({});   // 우리 표: 영웅 → VOD 표시 개수(펼침=선수 분해+VOD)
    const [openOpp, setOpenOpp] = useState({});   // 상대 표: 영웅 → VOD 표시 개수(펼침=응수 미니 표+VOD)
    const [secView, setSecView] = useState('all'); // 표 필터: 'all' | 'us' | 'opp' — 스크롤 없이 상대 표 바로 보기(교환 패턴과 동일 UX)
    const mkToggle = (set) => (id) => set(o => { const n = { ...o }; if (n[id]) delete n[id]; else n[id] = VOD_PAGE; return n; });
    const mkMore = (set) => (id) => set(o => ({ ...o, [id]: (o[id] || VOD_PAGE) + VOD_PAGE }));
    const toggleOur = mkToggle(setOpenOur), moreOur = mkMore(setOpenOur);
    const toggleOpp = mkToggle(setOpenOpp), moreOpp = mkMore(setOpenOpp);

    // 첫 궁 = 첫 수의 첫 궁(교환 패턴 인사이트 insFirst와 동일 판정 — chainSec은 첫 궁에 영향 없음)
    const firstUltOf = (r) => patternMoves(r, PATTERN_CHAIN_SEC)[0].ults[0];

    const result = useMemo(() => {
        const K = recsNow.filter(isKnown).filter(r => (r.ults || []).length > 0);
        const winOf = (fs) => fs.length > 0 ? fs.filter(r => r.fight_winner === 'us').length / fs.length : null;
        const firstMap = new Map();
        const usInit = [], themInit = [];
        K.forEach(r => { const u = firstUltOf(r); firstMap.set(r, u); (u.side === 'us' ? usInit : themInit).push(r); });

        // 과거(추세) — 동일 정의
        const pastFirst = new Map();
        const pastUs = [], pastThem = [];
        if (compareOn) {
            recsPast.filter(isKnown).filter(r => (r.ults || []).length > 0).forEach(r => {
                const u = firstUltOf(r); pastFirst.set(r, u); (u.side === 'us' ? pastUs : pastThem).push(r);
            });
        }

        // 영웅별 행 구성(우리/상대 공통) — 점유율 분모 = 그 표의 선궁 한타 전체, Δ 기준 = 그 표 전체 승률
        const buildRows = (fights, pastFights) => {
            const overall = winOf(fights);
            const m = new Map();
            fights.forEach(r => {
                const h = firstMap.get(r).hero || '?';
                if (!m.has(h)) m.set(h, []);
                m.get(h).push(r);
            });
            const pm = new Map();
            pastFights.forEach(r => {
                const h = pastFirst.get(r).hero || '?';
                pm.set(h, (pm.get(h) || []).concat([r]));
            });
            const rows = Array.from(m.entries()).map(([hero, fs]) => {
                const win = winOf(fs);
                let trend = null;
                if (compareOn && win != null) {
                    const pf = pm.get(hero) || [];
                    if (pf.length >= minSample) { const pw = winOf(pf); if (pw != null) trend = (win - pw) * 100; }
                }
                return {
                    hero, fights: fs, sample: fs.length, share: fs.length / fights.length,
                    win, delta: (win != null && overall != null) ? (win - overall) * 100 : null,
                    trend, ok: fs.length >= minSample,
                };
            }).sort((a, b) => b.sample - a.sample);
            return { rows, overall };
        };
        const our = buildRows(usInit, pastUs);
        const opp = buildRows(themInit, pastThem);

        // 우리 표 드릴다운: 같은 이니시 궁을 누가 열었나(첫 궁의 player별)
        our.rows.forEach(row => {
            const m = new Map();
            row.fights.forEach(r => {
                const p = firstMap.get(r).player || '?';
                m.set(p, (m.get(p) || []).concat([r]));
            });
            row.players = Array.from(m.entries())
                .map(([player, fs]) => ({ player, sample: fs.length, win: winOf(fs) }))
                .sort((a, b) => b.sample - a.sample);
        });
        // 상대 표 드릴다운: 그 이니시 한타에 대한 우리 3초 응수 상위 3
        // (응수 분석과 동일 계산·동일 정렬(충족→승률→표본), 모집단만 '그 궁이 이니시인 한타'로 한정)
        opp.rows.forEach(row => {
            row.responses = Array.from(collectFollowups(row.fights, 'them', row.hero, RESPONSE_WINDOW_SEC).values())
                .filter(e => e.side === 'us')
                .map(e => ({
                    ...e, sample: e.fights.length, win: seqWin(e.fights),
                    avgReact: e.fights.length > 0 ? e.reactSum / e.fights.length : null,
                    ok: e.fights.length >= minSample,
                }))
                .filter(e => e.win != null)
                .sort((a, b) => ((b.ok ? 1 : 0) - (a.ok ? 1 : 0)) || (b.win - a.win) || (b.sample - a.sample))
                .slice(0, 3);
        });

        return {
            total: K.length, usN: usInit.length, themN: themInit.length,
            rate: K.length > 0 ? usInit.length / K.length : null,
            usWin: winOf(usInit), themWin: winOf(themInit),
            our, opp,
        };
    }, [recsNow, recsPast, compareOn, minSample]);

    const thStyle = { padding: '8px 12px', textAlign: 'left', fontSize: '12px', fontWeight: 400, color: T.sub, whiteSpace: 'nowrap' };
    const tdCell = { padding: '6px 12px', fontSize: '12px', textAlign: 'left', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' };
    const dColor = (d) => (d == null || Math.abs(d) < 1) ? T.sub : (d > 0 ? GREEN : RED);
    const fmtD = (d) => d == null ? '—' : `${d > 0 ? '+' : '−'}${Math.abs(d).toFixed(1)}${t.flUnitPp}`;
    const trendText = (tr) => tr == null ? '—'
        : `${tr >= 1 ? '↑' : tr <= -1 ? '↓' : '→'} ${tr > 0 ? '+' : tr < 0 ? '−' : ''}${Math.abs(Math.round(tr))}${t.flUnitPp}`;
    const trendColor = (tr) => (tr == null || Math.abs(tr) < 1) ? T.sub : (tr > 0 ? GREEN : RED);
    const reactText = (v) => v == null ? '—' : `${v.toFixed(1)}s`;
    const usWord = t.flSeqSideOur, themWord = t.flSeqSideOpp;
    const nCols = compareOn ? 8 : 7;

    // 표 1개 렌더(우리/상대 공통 구조 — 드릴다운 내용만 다름)
    const renderTable = (tbl, sideWord, openMap, toggle, more, renderDrill) => (
        <div className="mobile-scroll-hint" style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead style={{ background: T.header }}>
                    <tr>{[
                        t.flInitColUlt, t.flColSampleOne, t.flInitColShare, t.flColWin, t.flInitColDelta,
                        ...(compareOn ? [t.flColTrend] : []),
                        t.flColStatus,
                    ].map((h, i) => <th key={i} style={thStyle}>{h}</th>)}</tr>
                </thead>
                <tbody>
                    {tbl.rows.length === 0 && (
                        <tr><td colSpan={nCols} style={{ padding: '30px', textAlign: 'center', color: T.sub }}>{t.noFilteredData}</td></tr>
                    )}
                    {tbl.rows.map(row => {
                        const openN = openMap[row.hero];
                        return (
                            <React.Fragment key={row.hero}>
                                <tr className="flb-row" onClick={() => toggle(row.hero)}
                                    style={{ borderBottom: `1px solid ${T.divider}`, opacity: row.ok ? 1 : 0.45, cursor: 'pointer' }}>
                                    <td style={tdCell}>{sideWord} {row.hero}</td>
                                    <td style={{ ...tdCell, color: T.sub }}>{row.sample}</td>
                                    <td style={tdCell}>{pct(row.share)}</td>
                                    <td style={tdCell}>{pct(row.win)}</td>
                                    <td style={{ ...tdCell, color: dColor(row.delta) }}>{fmtD(row.delta)}</td>
                                    {compareOn && <td style={{ ...tdCell, color: trendColor(row.trend) }}>{trendText(row.trend)}</td>}
                                    <td style={{ ...tdCell, color: row.ok ? T.sub : T.yellow }}>{row.ok ? t.flStatusOk : t.flLowSample}</td>
                                </tr>
                                {openN && (
                                    <tr>
                                        <td colSpan={nCols} style={{ padding: 0 }}>
                                            {renderDrill(row)}
                                            <VodList items={row.fights.map(r => ({ r }))} shown={openN} onMore={() => more(row.hero)}
                                                t={t} perspective={perspective} GREEN={GREEN} RED={RED} />
                                        </td>
                                    </tr>
                                )}
                            </React.Fragment>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );

    const miniWrap = { padding: '10px 12px 2px 28px', background: 'rgba(255,255,255,0.02)' };
    const miniTitle = { fontSize: '11px', fontWeight: 600, color: T.text, marginBottom: '6px' };
    const miniTh = { ...thStyle, padding: '3px 12px', fontSize: '11px' };
    const miniTd = { ...tdCell, padding: '4px 12px' };

    // 우리 표 드릴다운: 선수별 분해
    const drillOur = (row) => (
        <div style={miniWrap}>
            <div style={miniTitle}>{t.flInitPlayersTitle}</div>
            <table style={{ borderCollapse: 'collapse' }}>
                <thead><tr>{[t.flInitColPlayer, t.flColSampleOne, t.flColWin].map((h, i) => <th key={i} style={miniTh}>{h}</th>)}</tr></thead>
                <tbody>
                    {row.players.map(p => (
                        <tr key={p.player}>
                            <td style={miniTd}>{p.player}</td>
                            <td style={{ ...miniTd, color: T.sub }}>{p.sample}</td>
                            <td style={miniTd}>{pct(p.win)}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
    // 상대 표 드릴다운: 우리 3초 응수 상위 3
    const drillOpp = (row) => (
        <div style={miniWrap}>
            <div style={miniTitle}>{t.flInitRespTitle}</div>
            {row.responses.length === 0 ? (
                <div style={{ fontSize: '11px', color: T.sub, padding: '2px 12px 8px' }}>{t.flInitRespNone}</div>
            ) : (
                <table style={{ borderCollapse: 'collapse' }}>
                    <thead><tr>{[t.flCtrColResp, t.flColSampleOne, t.flColWin, t.flSeqColReact].map((h, i) => <th key={i} style={miniTh}>{h}</th>)}</tr></thead>
                    <tbody>
                        {row.responses.map(e => (
                            <tr key={e.key} style={{ opacity: e.ok ? 1 : 0.45 }}>
                                <td style={miniTd}>{usWord} {e.hero}{!e.ok && <span style={{ marginLeft: '6px', fontSize: '10px', color: T.yellow }}>{t.flLowSample}</span>}</td>
                                <td style={{ ...miniTd, color: T.sub }}>{e.sample}</td>
                                <td style={miniTd}>{pct(e.win)}</td>
                                <td style={{ ...miniTd, color: T.sub }}>{reactText(e.avgReact)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </div>
    );

    return (
        <div>
            {/* 요약 줄 — 교환 패턴 인사이트(insFirst)와 동일 계산·동일 모집단(무궁 제외) */}
            <div style={{ display: 'flex', gap: '40px', alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: '18px' }}>
                <div>
                    <div style={{ fontSize: '22px', fontWeight: 600, color: T.text }}>{pct(result.rate)}</div>
                    <div style={{ fontSize: '11px', color: T.sub, marginTop: '2px' }}>{tpl(t.flInitSumRate, { m: result.usN, n: result.total })}</div>
                </div>
                <div>
                    <div style={{ fontSize: '22px', fontWeight: 600, color: T.text }}>{pct(result.usWin)}</div>
                    <div style={{ fontSize: '11px', color: T.sub, marginTop: '2px' }}>{tpl(t.flInitSumUsWin, { n: result.usN })}</div>
                </div>
                <div>
                    <div style={{ fontSize: '22px', fontWeight: 600, color: T.text }}>{pct(result.themWin)}</div>
                    <div style={{ fontSize: '11px', color: T.sub, marginTop: '2px' }}>{tpl(t.flInitSumThemWin, { n: result.themN })}</div>
                </div>
            </div>

            {/* 표 필터 pill — 교환 패턴과 동일 UX(스크롤 없이 상대 표 바로 보기) */}
            <div style={{ display: 'flex', gap: '6px', marginBottom: '12px' }}>
                {[
                    ['all', t.all, null],
                    ['us', t.flInitOurTitle, result.usN],
                    ['opp', t.flInitOppTitle, result.themN],
                ].map(([v, label, n]) => (
                    <button key={v} onClick={() => setSecView(v)}
                        style={{
                            background: secView === v ? T.pillRed : T.pillBg, color: secView === v ? '#fff' : T.sub,
                            border: 'none', padding: '5px 11px', borderRadius: '6px', cursor: 'pointer', fontSize: '11px', fontWeight: 500,
                        }}>
                        {label}{n != null ? ` (${n})` : ''}
                    </button>
                ))}
            </div>

            {/* 우리 이니시 궁 */}
            {secView !== 'opp' && (
                <>
                    <h2 style={{ fontSize: '16px', fontWeight: 600, color: T.text, margin: '0 0 4px' }}>{t.flInitOurTitle}</h2>
                    <p style={{ color: T.sub, fontSize: '12px', margin: '0 0 10px' }}>{t.flInitOurDesc}</p>
                    {renderTable(result.our, usWord, openOur, toggleOur, moreOur, drillOur)}
                </>
            )}

            {/* 상대 이니시 궁 */}
            {secView !== 'us' && (
                <>
                    <h2 style={{ fontSize: '16px', fontWeight: 600, color: T.text, margin: secView === 'opp' ? '0 0 4px' : '24px 0 4px' }}>{t.flInitOppTitle}</h2>
                    <p style={{ color: T.sub, fontSize: '12px', margin: '0 0 10px' }}>{t.flInitOppDesc}</p>
                    {renderTable(result.opp, themWord, openOpp, toggleOpp, moreOpp, drillOpp)}
                </>
            )}
        </div>
    );
}

export default function UltimateAnalysisStats() {
    const { t } = useLanguage();

    const [data, setData] = useState(null); // { meta, records }
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const [subTab, setSubTab] = useState('situation'); // 'situation' | 'comboseq'

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
    const sc = useFightScope(records, t);

    const statsA = useMemo(() => buildUltStats(sc.recsNow), [sc.recsNow]);
    const statsB = useMemo(() => (sc.compareOn ? buildUltStats(sc.recsB) : null), [sc.compareOn, sc.recsB]);
    // Δ(vs 상대): 현재 표와 동일한 한타들을 flipRecord(검증된 대칭 매핑)로 뒤집어 같은 집계에 태움.
    const statsOpp = useMemo(() => buildUltStats(sc.recsNow.map(flipRecord)), [sc.recsNow]);

    // 행 정의: rateDir = 발생률의 "좋은 방향" ('higher'|'lower'|null=중립) — 기존 [궁극기] 서브탭 그대로
    const rowDefs = [
        { key: 'ultUsed', label: t.flRowUltUsed, rateDir: null },
        { key: 'firstUlt', label: t.flRowFirstUlt, rateDir: null },
        { key: 'enemyFirstUlt', label: t.flRowEnemyFirstUlt, rateDir: null },
        { key: 'ultAdv', label: t.flRowUltAdv, rateDir: 'higher' },
        { key: 'ultDis', label: t.flRowUltDis, rateDir: 'lower' },
        { key: 'ultEven', label: t.flRowUltEven, rateDir: null },
        { key: 'ult1', label: t.flRowUlt1, rateDir: null },
        { key: 'ult2', label: t.flRowUlt2, rateDir: null },
        { key: 'ult3', label: t.flRowUlt3, rateDir: null },
    ];

    const GREEN = T.green, RED = T.red;
    // 총평 카드는 상황 표가 있는 서브탭([상황])에서만 표시(기존 동작 유지)
    const verdict = (subTab === 'situation' && sc.compareOn && statsB) ? computeVerdict(rowDefs, statsA, statsB, sc.minSample) : null;

    const explains = subTab === 'situation'
        ? [t.flExpSidebar, t.flExpWinner, t.flExpTwoCols, t.flExpOccur, t.flExpUltUsed, t.flExpFirstUlt, t.flExpUltCount, t.flExpUltInvest, t.flExpDryFight, t.flExpTrend, t.flExpStability, t.flExpSample]
        : subTab === 'patterns'
        ? [t.flExpSidebar, t.flExpWinner, t.flExpPat1, t.flExpPat2, t.flExpPat3, t.flExpPat4, t.flExpPat5, t.flExpPatComp, t.flExpVod]
        : subTab === 'init'
        ? [t.flExpSidebar, t.flExpWinner, t.flExpInit1, t.flExpInit2, t.flExpInit3, t.flExpInit4, t.flExpVod]
        : [t.flExpSidebar, t.flExpWinner, t.flExpCombo1, t.flExpCombo2, t.flExpCombo3, t.flExpSeq1, t.flExpSeq2, t.flExpSeq3, t.flExpCtr1, t.flExpCtr2, t.flExpCtr3, t.flExpWindows, t.flExpVod];

    return (
        <FightScopeShell title={t.flUaTitle} desc={t.flUaDesc} sc={sc} t={t} opponentOnlyForThem
            captionRight={!loading && !error ? <VerdictChip verdict={verdict} t={t} /> : null}>
            <SubTabPills tabs={[['situation', t.flUaTabSituation], ['comboseq', t.flUaTabComboSeq], ['patterns', t.flPatTab], ['init', t.flInitTab]]} active={subTab} onChange={setSubTab} />

            {/* [상황] 상단 요약 숫자 2개 (큰 수치처럼 플랫하게) — 기존 [궁극기] 서브탭 그대로 */}
            {subTab === 'situation' && !loading && (
                <div style={{ display: 'flex', gap: '40px', marginBottom: '14px', flexWrap: 'wrap' }}>
                    <div>
                        <div style={{ fontSize: '22px', fontWeight: 600, color: T.text }}>
                            {statsA._avgUlt == null ? '-' : statsA._avgUlt.toFixed(2)}
                            {sc.compareOn && statsB && <span style={{ fontSize: '12px', color: T.sub, fontWeight: 400, marginLeft: '8px' }}>{t.flPastShort} {statsB._avgUlt == null ? '-' : statsB._avgUlt.toFixed(2)}</span>}
                        </div>
                        <div style={{ fontSize: '11px', color: T.sub, marginTop: '2px' }}>{t.flSumAvgUlt}</div>
                    </div>
                    <div>
                        <div style={{ fontSize: '22px', fontWeight: 600, color: T.text }}>
                            {pct(statsA.ultUsed?.win)}
                            {sc.compareOn && statsB && <span style={{ fontSize: '12px', color: T.sub, fontWeight: 400, marginLeft: '8px' }}>{t.flPastShort} {pct(statsB.ultUsed?.win)}</span>}
                        </div>
                        <div style={{ fontSize: '11px', color: T.sub, marginTop: '2px' }}>{t.flSumUltConv}</div>
                    </div>
                </div>
            )}

            <PerspectiveNotice sc={sc} t={t} />

            {/* [상황] 상황 표 */}
            {subTab === 'situation' && (
                <SituationTable rowDefs={rowDefs} statsA={statsA} statsB={statsB} statsOpp={statsOpp}
                    compareOn={sc.compareOn} minSample={sc.minSample} loading={loading} error={error} t={t} />
            )}

            {/* [콤보·시퀀스] — 탭 전환 시 내부 상태(생성 스냅샷)가 초기화되지 않도록 항상 마운트하고 display로만 숨김 */}
            {!loading && !error && (
                <div style={{ display: subTab === 'comboseq' ? 'block' : 'none' }}>
                    <UltimateComboSection
                        recsNow={sc.recsNow} recsPast={sc.recsB} compareOn={sc.compareOn}
                        t={t} GREEN={GREEN} RED={RED} perspective={sc.perspective}
                    />
                    <UltimateSequenceSection
                        recsNow={sc.recsNow} recsPast={sc.recsB} compareOn={sc.compareOn}
                        t={t} GREEN={GREEN} RED={RED} perspective={sc.perspective}
                    />
                    <UltimateCounterSection
                        recsNow={sc.recsNow}
                        t={t} GREEN={GREEN} RED={RED} perspective={sc.perspective}
                    />
                </div>
            )}
            {subTab === 'comboseq' && loading && (
                <div style={{ padding: '60px', textAlign: 'center', color: T.sub }}>{t.ffLoading}</div>
            )}

            {/* [교환 패턴] */}
            {subTab === 'patterns' && !loading && !error && (
                <UltimatePatternSection
                    recsNow={sc.recsNow} recsPast={sc.recsB} compareOn={sc.compareOn}
                    minSample={sc.minSample}
                    t={t} GREEN={GREEN} RED={RED} perspective={sc.perspective}
                />
            )}
            {subTab === 'patterns' && loading && (
                <div style={{ padding: '60px', textAlign: 'center', color: T.sub }}>{t.ffLoading}</div>
            )}

            {/* [이니시] */}
            {subTab === 'init' && !loading && !error && (
                <UltimateInitiationSection
                    recsNow={sc.recsNow} recsPast={sc.recsB} compareOn={sc.compareOn}
                    minSample={sc.minSample}
                    t={t} GREEN={GREEN} RED={RED} perspective={sc.perspective}
                />
            )}
            {subTab === 'init' && loading && (
                <div style={{ padding: '60px', textAlign: 'center', color: T.sub }}>{t.ffLoading}</div>
            )}

            <ExplainBox lines={explains} t={t} />
        </FightScopeShell>
    );
}
