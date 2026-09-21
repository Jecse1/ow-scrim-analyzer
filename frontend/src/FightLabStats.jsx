import React, { useState, useMemo, useEffect } from 'react';
import { fetchCached } from './utils/apiCache';
import { getMapDisplayName, getDisplayName } from './gameData';
import { ChevronDown, ChevronRight, Youtube, SlidersHorizontal } from 'lucide-react';
import { useLanguage } from "./LanguageContext";
import { buildVideoLink, hasVideo } from "./utils/videoLink";
import { useVod, vodClickProps } from "./VodPlayerContext";
import { useIsMobile } from "./utils/responsive";

const API_BASE = "";

// ── 디자인 토큰 (이 탭 전용 다크 고정) ──
export const T = {
    bg: '#111113',                        // 페이지 배경
    panel: '#17171a',                     // 사이드바·접이식 패널
    panelBorder: '#26262a',               // 패널 테두리
    header: 'rgba(255,255,255,0.045)',    // 표 헤더 배경(살짝 구분)
    divider: 'rgba(255,255,255,0.07)',    // 행 구분선
    hover: 'rgba(255,255,255,0.035)',     // 행 hover
    text: '#e7e7ea',                      // 본문
    sub: '#9a9aa3',                       // 보조 회색(헤더·라벨)
    faint: '#7c7c85',                     // 각주 회색
    green: '#5bb98b',                     // 상승(채도 낮음)
    red: '#d16d6d',                       // 하락(채도 낮음)
    purple: '#9a8fd0',                    // P·보조 강조
    yellow: '#d8b45a',                    // 경고(변동/표본 부족)
    applyRed: '#e5484d',                  // Apply 버튼
    pillRed: '#c93b3f',                   // 선택된 서브탭 필
    pillBg: '#232326',                    // 비선택 필 배경
    inputBg: '#121214',                   // 드롭다운/입력 배경
    inputBorder: '#2a2a2e',               // 드롭다운/입력 테두리
};

// ── 날짜 헬퍼 ('YYYY-MM-DD' 문자열, UTC 산술로 시간대 오차 방지) ──────────────
const toMs = (s) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
const fmtMs = (ms) => {
    const d = new Date(ms);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
};
const addDays = (s, n) => fmtMs(toMs(s) + n * 86400000);
const daysInclusive = (a, b) => Math.round((toMs(b) - toMs(a)) / 86400000) + 1;
const todayStr = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// 세션 date 기준, 시작·끝 포함(inclusive). null = 무제한.
const inRange = (dateStr, [start, end]) =>
    (!start || dateStr >= start) && (!end || dateStr <= end);

const rangesOverlap = ([aS, aE], [bS, bE]) => {
    const s1 = aS || '0000-00-00', e1 = aE || '9999-99-99';
    const s2 = bS || '0000-00-00', e2 = bE || '9999-99-99';
    return !(e2 < s1 || s2 > e1);
};

const A_PRESET_DAYS = { '1w': 7, '2w': 14, '1m': 30 };

// ── 집계 ────────────────────────────────────────────────────────────────────
export const isKnown = (r) => r.fight_winner === 'us' || r.fight_winner === 'them';

// subset의 한타 승률(승자 판정 가능한 한타만 표본으로 셈)
const winStat = (subset) => {
    const k = subset.filter(isKnown);
    return { sample: k.length, win: k.length > 0 ? k.filter(r => r.fight_winner === 'us').length / k.length : null };
};
const occOf = (subset, denom) => (denom.length > 0 ? subset.length / denom.length : null);

// 교전 서브탭: key → { occ, sample, win }
function buildEngageStats(S) {
    const D = S.filter(r => r.first_kill && (r.first_kill.by === 'us' || r.first_kill.by === 'them'));
    const fp = D.filter(r => r.first_kill.by === 'us');
    const fd = D.filter(r => r.first_kill.by === 'them');
    const role = (x) => fd.filter(r => r.first_kill.victim_role === x);
    const fkT = fp.filter(r => r.first_kill_traded);
    const fdT = fd.filter(r => r.first_death_traded);
    const mk = (subset, denom) => ({ occ: occOf(subset, denom), ...winStat(subset) });
    return {
        firstPick: mk(fp, D),
        firstDeath: mk(fd, D),
        fdTank: mk(role('tank'), fd),
        fdDamage: mk(role('damage'), fd),
        fdSupport: mk(role('support'), fd),
        fdOther: mk(role('other'), fd),
        fkTraded: mk(fkT, fp),
        fdTraded: mk(fdT, fd),
        _unknownCount: S.filter(r => r.fight_winner === 'unknown').length,
        _total: S.length,
    };
}

// 궁극기 서브탭
export function buildUltStats(S) {
    const withUlt = S.filter(r => r.first_ult_side !== 'none');
    const mk = (subset, denom) => ({ occ: occOf(subset, denom), ...winStat(subset) });
    const ultUsed = S.filter(r => r.our_ult_count >= 1);
    return {
        ultUsed: mk(ultUsed, S),
        firstUlt: mk(S.filter(r => r.first_ult_side === 'us'), withUlt),
        enemyFirstUlt: mk(S.filter(r => r.first_ult_side === 'them'), withUlt),
        ultAdv: mk(S.filter(r => r.our_ult_count > r.enemy_ult_count), S),
        ultDis: mk(S.filter(r => r.our_ult_count < r.enemy_ult_count), S),
        ultEven: mk(S.filter(r => r.our_ult_count === r.enemy_ult_count && r.our_ult_count >= 1), S),
        ult1: mk(S.filter(r => r.our_ult_count === 1), S),
        ult2: mk(S.filter(r => r.our_ult_count === 2), S),
        ult3: mk(S.filter(r => r.our_ult_count >= 3), S),
        _avgUlt: S.length > 0 ? S.reduce((a, r) => a + r.our_ult_count, 0) / S.length : null,
        _unknownCount: S.filter(r => r.fight_winner === 'unknown').length,
        _total: S.length,
    };
}

export const pct = (v, digits = 1) => (v == null ? '-' : `${(v * 100).toFixed(digits)}%`);
// i18n 미니 템플릿: "{n}명 중 {k}위" 같은 문자열의 {키} 치환 (어순이 다른 en 대응)
export const tpl = (s, vars) => String(s || '').replace(/\{(\w+)\}/g, (_, k) => vars[k]);

// ── [선수] 서브탭 ────────────────────────────────────────────────────────────
// /api/player-fight-stats 아이템((매치×선수×영웅) 가산 레코드)을 그룹핑해 합산.
const aggregatePlayers = (list, byHero) => {
    const map = {};
    list.forEach(it => {
        const team = it.side === 'us' ? it.our_team : it.enemy_team;
        const key = (byHero ? `${it.player_name}|${it.hero}` : it.player_name) + `@${team}`;
        const a = map[key] || (map[key] = {
            key, player: it.player_name, team, side: it.side, hero: byHero ? it.hero : null,
            fights: 0, kp_sum: 0, kp_fights: 0, first_kills: 0, first_deaths: 0,
            ult_uses: 0, ult_fight_wins: 0, ult_fight_known: 0,
            rounds: 0, duration: 0, fb: 0, deaths: 0, dmg: 0, heal: 0, ults_ps: 0,
            roleTime: {},
        });
        a.fights += it.fights; a.kp_sum += it.kp_sum; a.kp_fights += it.kp_fights;
        a.first_kills += it.first_kills; a.first_deaths += it.first_deaths;
        a.ult_uses += it.ult_uses; a.ult_fight_wins += it.ult_fight_wins; a.ult_fight_known += it.ult_fight_known;
        a.rounds += it.rounds; a.duration += it.duration_sec;
        a.fb += it.final_blows; a.deaths += it.deaths; a.dmg += it.hero_damage; a.heal += it.healing; a.ults_ps += it.ults_used;
        a.roleTime[it.role] = (a.roleTime[it.role] || 0) + it.hero_time;
    });
    Object.values(map).forEach(a => {
        a.role = Object.keys(a.roleTime).length
            ? Object.entries(a.roleTime).sort((x, y) => y[1] - x[1])[0][0]
            : 'other';
    });
    return Object.values(map);
};

// 지표 정의: calc(집계) / dir(높을수록 좋음 여부) / thr(백분위 최소표본 종류) / sample(표본 수)
const PB_METRICS = [
    { k: 'fights', group: 'fight', axes: false, calc: a => a.fights, fmt: v => v },
    { k: 'kp', group: 'fight', dir: 'higher', thr: 'fight', sample: a => a.kp_fights, calc: a => a.kp_fights > 0 ? a.kp_sum / a.kp_fights : null, fmt: v => pct(v) },
    { k: 'fk', group: 'fight', dir: 'higher', thr: 'fight', sample: a => a.fights, calc: a => a.fights > 0 ? a.first_kills / a.fights : null, fmt: v => pct(v) },
    { k: 'fd', group: 'fight', dir: 'lower', thr: 'fight', sample: a => a.fights, calc: a => a.fights > 0 ? a.first_deaths / a.fights : null, fmt: v => pct(v) },
    { k: 'upf', group: 'fight', dir: 'higher', thr: 'fight', sample: a => a.fights, calc: a => a.fights > 0 ? a.ult_uses / a.fights : null, fmt: v => v == null ? '-' : v.toFixed(2) },
    { k: 'uwin', group: 'fight', dir: 'higher', thr: 'fight', sample: a => a.ult_fight_known, calc: a => a.ult_fight_known > 0 ? a.ult_fight_wins / a.ult_fight_known : null, fmt: v => pct(v) },
    { k: 'kd', group: 'round', dir: 'higher', thr: 'round', sample: a => a.rounds, calc: a => a.rounds <= 0 ? null : (a.deaths > 0 ? a.fb / a.deaths : a.fb), fmt: v => v == null ? '-' : v.toFixed(2) },
    { k: 'dmg10', group: 'round', dir: 'higher', thr: 'round', sample: a => a.rounds, calc: a => a.duration > 0 ? a.dmg / a.duration * 600 : null, fmt: v => v == null ? '-' : Math.round(v).toLocaleString() },
    { k: 'heal10', group: 'round', dir: 'higher', thr: 'round', supportOnly: true, sample: a => a.rounds, calc: a => a.duration > 0 ? a.heal / a.duration * 600 : null, fmt: v => v == null ? '-' : Math.round(v).toLocaleString() },
    { k: 'ult10', group: 'round', dir: 'higher', thr: 'round', sample: a => a.rounds, calc: a => a.duration > 0 ? a.ults_ps / a.duration * 600 : null, fmt: v => v == null ? '-' : v.toFixed(1) },
];

function PlayerBreakdown({ pfs, rangeA, rangeB, compareOn, minSample, perspective, selectedMap, selectedOpponent, t, GREEN, RED, ACCENT }) {
    const [byHero, setByHero] = useState(false);
    const [colGroup, setColGroup] = useState('fight'); // 'fight' | 'round' — 사진 밀도 유지용 열 그룹 전환
    const [sortKey, setSortKey] = useState('name');    // 'name' | 'fights' | 지표 key
    const [lbMetric, setLbMetric] = useState('kp');    // 순위표: 지표 선택
    const [lbRole, setLbRole] = useState('tank');      // 순위표: 역할 선택

    const meta = pfs?.meta || {};
    const MIN_F = meta.min_sample_for_percentile_fights ?? 20;
    const MIN_R = meta.min_sample_for_percentile_rounds ?? 10;
    const MIN_POOL = meta.percentile_min_pool ?? 8;
    const items = pfs?.items || [];
    const side = perspective === 'them' ? 'them' : 'us';

    const matchFilter = it =>
        (selectedOpponent === 'All' || it.enemy_team === selectedOpponent) &&
        (selectedMap === 'All' || it.map_name === selectedMap);

    // 행(기간 A, 시점·필터 적용) / 자기 과거(기간 B, 동일 조건)
    const rowsA = useMemo(
        () => aggregatePlayers(items.filter(it => it.side === side && matchFilter(it) && inRange(it.session_date, rangeA)), byHero),
        [items, side, selectedMap, selectedOpponent, rangeA, byHero]
    );
    const rowsBMap = useMemo(() => {
        if (!compareOn) return {};
        const list = aggregatePlayers(items.filter(it => it.side === side && matchFilter(it) && inRange(it.session_date, rangeB)), byHero);
        return Object.fromEntries(list.map(e => [e.key, e]));
    }, [items, side, selectedMap, selectedOpponent, rangeB, byHero, compareOn]);

    // 백분위 풀: 기간 A 전체 데이터(양 시점·필터 무관), 동일 그룹핑
    const pool = useMemo(
        () => aggregatePlayers(items.filter(it => inRange(it.session_date, rangeA)), byHero),
        [items, rangeA, byHero]
    );

    // 순위표: 셀 괄호 순위와 동일한 풀(pool)·동일한 공동 순위 규칙(cellFor의 pl 구성식과 동일)을
    // 표로 펼친 것. 별도 재계산 규칙 없음 — 같은 데이터·같은 식.
    const lb = useMemo(() => {
        const m = PB_METRICS.find(x => x.k === lbMetric);
        if (!m || m.axes === false) return null;
        if (m.supportOnly && lbRole !== 'support') return { m, na: true };
        const minS = m.thr === 'fight' ? MIN_F : MIN_R;
        const all = pool.filter(x => x.role === lbRole);
        const ranked = all
            .filter(x => (m.sample ? m.sample(x) : 0) >= minS)
            .map(x => ({ x, v: m.calc(x), s: m.sample ? m.sample(x) : null }))
            .filter(e => e.v != null);
        ranked.forEach(e => {
            e.rank = 1 + ranked.filter(o => m.dir === 'lower' ? o.v < e.v : o.v > e.v).length; // 공동 순위(cellFor와 동일)
        });
        ranked.sort((a, b) => (a.rank - b.rank) || a.x.player.localeCompare(b.x.player));
        const unranked = all
            .filter(x => (m.sample ? m.sample(x) : 0) < minS)
            .map(x => ({ x, v: m.calc(x), s: m.sample ? m.sample(x) : null }))
            .sort((a, b) => (b.s || 0) - (a.s || 0));
        return { m, ranked, unranked, poolN: ranked.length };
    }, [pool, lbMetric, lbRole]); // eslint-disable-line

    // 정렬(표시 전용): 선수명 오름차순 / 한타 수 내림차순 / 지표는 좋은 값이 위로(반전 지표는 오름차순)
    const sorted = useMemo(() => {
        const arr = [...rowsA];
        if (sortKey === 'name') arr.sort((x, y) => x.player.localeCompare(y.player));
        else if (sortKey === 'fights') arr.sort((x, y) => y.fights - x.fights);
        else {
            const m = PB_METRICS.find(mm => mm.k === sortKey);
            if (m) arr.sort((x, y) => {
                const vx = (m.supportOnly && x.role !== 'support') ? null : m.calc(x);
                const vy = (m.supportOnly && y.role !== 'support') ? null : m.calc(y);
                if (vx == null && vy == null) return 0;
                if (vx == null) return 1;
                if (vy == null) return -1;
                return m.dir === 'lower' ? vx - vy : vy - vx;
            });
        }
        return arr;
    }, [rowsA, sortKey]);

    const roleLabel = (r) => r === 'tank' ? t.tank : r === 'damage' ? t.dps : r === 'support' ? t.support : '-';
    // 순위 표기용 축약 역할명 — "(지원 3위)" 형식으로 어느 풀의 순위인지 즉시 드러나게
    const roleShort = (r) => r === 'tank' ? t.flPbRoleTank : r === 'damage' ? t.flPbRoleDps : r === 'support' ? t.flPbRoleSup : '-';

    const cellFor = (e, m) => {
        if (m.supportOnly && e.role !== 'support') return { na: true };
        const vA = m.calc(e);
        const eB = rowsBMap[e.key];
        const vB = compareOn && eB && !(m.supportOnly && eB.role !== 'support') ? m.calc(eB) : null;
        const sampleB = compareOn && eB && m.sample ? m.sample(eB) : null;
        // ②③ 풀 = 등수 계산과 동일(기간 A 전체 데이터·우리+상대·동일 역할·최소 표본 충족).
        //     2행 풀평균과 3행 등수가 반드시 같은 풀을 공유하도록 pl 하나로 계산한다.
        //     동점 = 공동 순위(더 좋은 값의 수 + 1)
        const minS = m.thr === 'fight' ? MIN_F : MIN_R;
        const pl = pool
            .filter(x => x.role === e.role && (m.sample ? m.sample(x) : 0) >= minS)
            .map(x => ({ key: x.key, v: m.calc(x), side: x.side }))
            .filter(x => x.v != null);
        const poolN = pl.length;
        const poolUs = pl.filter(x => x.side === 'us').length;
        const poolShort = poolN < MIN_POOL;
        let pRank = null;
        if (!poolShort) {
            const mine = pl.find(x => x.key === e.key);
            if (mine != null) {
                const better = pl.filter(x => m.dir === 'lower' ? x.v < mine.v : x.v > mine.v).length;
                pRank = better + 1;
            }
        }
        const poolAvg = poolN > 0 ? pl.reduce((s, x) => s + x.v, 0) / poolN : null;
        return { vA, vB, poolAvg, pRank, poolN, poolUs, poolThem: poolN - poolUs, poolShort, sampleA: m.sample ? m.sample(e) : null, sampleB };
    };

    const fmtDiff = (m, d) => {
        const s = d >= 0 ? '+' : '−';
        const ab = Math.abs(d);
        if (['kp', 'fk', 'fd', 'uwin'].includes(m.k)) return `${s}${(ab * 100).toFixed(1)}${t.flUnitPp}`;
        if (m.k === 'dmg10' || m.k === 'heal10') return `${s}${Math.round(ab).toLocaleString()}`;
        return `${s}${ab.toFixed(2)}`;
    };

    const thStyle = { padding: '8px 12px', textAlign: 'left', fontSize: '12px', fontWeight: 400, color: T.sub, whiteSpace: 'nowrap' };
    const chip = (active) => ({
        background: active ? T.pillRed : T.pillBg, color: active ? '#fff' : T.sub,
        border: 'none', padding: '5px 12px', borderRadius: '6px',
        cursor: 'pointer', fontSize: '12px', fontWeight: 500,
    });
    const ctlLabel = { fontSize: '11px', fontWeight: 500, color: T.sub, marginBottom: '4px' };
    const ctlSelect = { background: T.inputBg, color: T.text, border: `1px solid ${T.inputBorder}`, borderRadius: '6px', padding: '6px 10px', fontSize: '12px', fontWeight: 400, outline: 'none', cursor: 'pointer', minWidth: '170px' };

    // 화살표: 변화 없음은 회색 '→', 개선/악화는 방향색 ↑↓ (반전 지표는 색 반전)
    const Arrow = ({ diff, dir }) => {
        if (diff == null) return null;
        const glyph = diff > 0.0005 ? '↑' : diff < -0.0005 ? '↓' : '→';
        let color = T.sub;
        if (glyph !== '→') color = (dir === 'lower' ? diff < 0 : diff > 0) ? GREEN : RED;
        return <span style={{ color, fontWeight: 900, fontSize: '11px' }}>{glyph}</span>;
    };

    const metricLabel = { kp: t.flPbKp, fk: t.flPbFk, fd: t.flPbFd, upf: t.flPbUpf, uwin: t.flPbUwin, kd: t.flPbKd, dmg10: t.flPbDmg10, heal10: t.flPbHeal10, ult10: t.flPbUlt10 };
    const groupMetrics = PB_METRICS.filter(m => m.k !== 'fights' && m.group === colGroup);
    const onColGroup = (g) => {
        setColGroup(g);
        if (!['name', 'fights'].includes(sortKey) && !PB_METRICS.find(m => m.k === sortKey && m.group === g)) setSortKey('name');
    };

    return (
        <div>
            {/* 상단 컨트롤: 좌 그룹 기준 + 열 그룹, 우 정렬 기준 */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '12px', flexWrap: 'wrap', gap: '10px' }}>
                <div style={{ display: 'flex', gap: '14px', alignItems: 'flex-end' }}>
                    <div>
                        <div style={ctlLabel}>{t.flPbGroupLabel}</div>
                        <select value={byHero ? 'ph' : 'p'} onChange={e => setByHero(e.target.value === 'ph')} style={ctlSelect}>
                            <option value="p">{t.flPbGroupPlayer}</option>
                            <option value="ph">{t.flPbGroupPlayerHero}</option>
                        </select>
                    </div>
                    <div style={{ display: 'flex', gap: '6px' }}>
                        <button onClick={() => onColGroup('fight')} style={chip(colGroup === 'fight')}>{t.flPbGroupFight}</button>
                        <button onClick={() => onColGroup('round')} style={chip(colGroup === 'round')}>{t.flPbGroupRound}</button>
                    </div>
                </div>
                <div>
                    <div style={ctlLabel}>{t.flPbSortLabel}</div>
                    <select value={sortKey} onChange={e => setSortKey(e.target.value)} style={ctlSelect}>
                        <option value="name">{t.flPbSortName}</option>
                        <option value="fights">{t.flPbFights}</option>
                        {groupMetrics.map(m => <option key={m.k} value={m.k}>{metricLabel[m.k]}</option>)}
                    </select>
                </div>
            </div>

            <div className="mobile-scroll-hint" style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '900px' }}>
                    <thead style={{ background: T.header }}>
                        <tr>
                            <th style={thStyle}>{t.flPbColPlayer}</th>
                            <th style={thStyle}>{t.flPbFights}</th>
                            {groupMetrics.map(m => <th key={m.k} style={thStyle}>{metricLabel[m.k]}</th>)}
                            <th style={thStyle}>{t.flPbColSignals}</th>
                        </tr>
                    </thead>
                    <tbody>
                        {sorted.map((e, idx) => {
                            const lowSample = e.fights < minSample;
                            const rowBg = 'transparent';
                            // 모든 지표 셀을 먼저 계산 — Signals는 열 그룹과 무관하게 전 지표 기준
                            const cmap = {};
                            PB_METRICS.forEach(m => { if (m.axes !== false) cmap[m.k] = cellFor(e, m); });
                            const sigs = [];
                            PB_METRICS.forEach(m => {
                                if (m.axes === false) return;
                                const c = cmap[m.k];
                                if (!c || c.na || c.poolShort || !c.pRank) return;
                                const topP = Math.round(c.pRank / c.poolN * 100);
                                if (topP > 80) sigs.push({ bad: true, text: `${metricLabel[m.k]}${t.flPbSigLowSuffix}` });
                                else if (topP <= 20) sigs.push({ bad: false, text: `${metricLabel[m.k]}${t.flPbSigTopSuffix}` });
                            });
                            sigs.sort((x, y) => (y.bad ? 1 : 0) - (x.bad ? 1 : 0)); // 주의 우선
                            const shown = sigs.slice(0, 2);
                            const tdCell = { padding: '5px 12px', textAlign: 'left', fontSize: '13px', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' };
                            return (
                                <tr key={e.key} className="flb-row" style={{ background: rowBg, borderBottom: `1px solid ${T.divider}`, opacity: lowSample ? 0.45 : 1 }}>
                                    <td style={tdCell}>
                                        {e.player}{side === 'them' ? <span style={{ color: T.sub }}> ({e.team})</span> : null}
                                        {byHero && <span style={{ fontSize: '11px', color: T.sub }}> · {getDisplayName(e.hero)}</span>}
                                        {lowSample && <span style={{ marginLeft: '6px', fontSize: '10px', color: T.yellow }}>{t.flLowSample}</span>}
                                    </td>
                                    <td title={compareOn ? `${t.flPastShort} ${rowsBMap[e.key]?.fights ?? 0}` : undefined} style={tdCell}>{e.fights}</td>
                                    {groupMetrics.map(m => {
                                        const c = cmap[m.k];
                                        if (c.na) return <td key={m.k} style={{ ...tdCell, color: T.sub }}>—</td>;
                                        // 괄호 표기: 공동 순위 등수. 풀 부족 → (풀 부족), 본인 표본 미달 → (—)
                                        const pTxt = c.pRank != null ? `(${tpl(t.flPbRankRoleTpl, { role: roleShort(e.role), k: c.pRank })})`
                                            : c.poolShort ? `(${t.flPbNoPool})` : '(—)';
                                        const unit = m.thr === 'fight' ? t.flPbUnitFight : t.flPbUnitRound;
                                        const tipParts = [];
                                        // 등수가 맨 앞 (스펙 순서)
                                        if (c.pRank != null) tipParts.push(tpl(t.flPbRankTpl, { n: c.poolN, k: c.pRank }));
                                        else tipParts.push(c.poolShort ? `${t.flPbPoolShortPre}${c.poolN}${t.flPbPoolShortPost}` : t.flPbPDashSample);
                                        if (c.vA != null && c.vB != null) tipParts.push(`${t.flPbTipVsPast} ${fmtDiff(m, c.vA - c.vB)}`);
                                        tipParts.push(`${t.flPbTipSample} ${c.sampleA ?? '-'}${unit}${c.sampleB != null ? ` (${t.flPastShort} ${c.sampleB})` : ''}`);
                                        if (!c.poolShort && c.poolAvg != null && c.vA != null) tipParts.push(`${t.flPbPoolAvg} ${fmtDiff(m, c.vA - c.poolAvg)}`);
                                        tipParts.push(tpl(t.flPbPoolTpl, { role: roleLabel(e.role), us: c.poolUs, them: c.poolThem }));
                                        return (
                                            <td key={m.k} title={tipParts.join(' · ')} style={tdCell}>
                                                {m.fmt(c.vA)}{' '}
                                                {compareOn && c.vA != null && c.vB != null && <Arrow diff={c.vA - c.vB} dir={m.dir} />}{' '}
                                                <span style={{ fontSize: '11px', color: c.poolShort ? T.yellow : ACCENT }}>{pTxt}</span>
                                            </td>
                                        );
                                    })}
                                    <td style={{ ...tdCell, color: T.sub, fontSize: '12px' }}>
                                        {shown.length === 0 ? '—' : shown.map(s => s.text).join(' · ')}
                                    </td>
                                </tr>
                            );
                        })}
                        {sorted.length === 0 && (
                            <tr><td colSpan={3 + groupMetrics.length} style={{ padding: '50px', textAlign: 'center', color: T.sub }}>{t.noFilteredData}</td></tr>
                        )}
                    </tbody>
                </table>
            </div>

            {/* 각주 (하단 문구 위치) */}
            <p style={{ color: T.faint, fontSize: '11px', margin: '10px 2px 0' }}>{t.flPbFootnote}</p>
            <p style={{ color: T.faint, fontSize: '11px', margin: '4px 2px 0' }}>{t.flPbPoolWarn}</p>

            {/* 순위표(리더보드) — 셀 괄호 순위와 동일 풀·동일 공동 순위를 표로 펼침 */}
            <div style={{ marginTop: '24px' }}>
                <h3 style={{ fontSize: '14px', fontWeight: 600, color: T.text, margin: '0 0 10px' }}>{t.flLbTitle}</h3>
                <div style={{ display: 'flex', gap: '14px', alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: '10px' }}>
                    <div>
                        <div style={ctlLabel}>{t.flLbMetric}</div>
                        <select value={lbMetric} onChange={e => setLbMetric(e.target.value)} style={ctlSelect}>
                            {PB_METRICS.filter(m => m.axes !== false).map(m => (
                                <option key={m.k} value={m.k}>{metricLabel[m.k]}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <div style={ctlLabel}>{t.flLbRole}</div>
                        <select value={lbRole} onChange={e => setLbRole(e.target.value)} style={{ ...ctlSelect, minWidth: '100px' }}>
                            <option value="tank">{t.tank}</option>
                            <option value="damage">{t.dps}</option>
                            <option value="support">{t.support}</option>
                        </select>
                    </div>
                </div>
                {lb && lb.na && (
                    <p style={{ color: T.sub, fontSize: '12px' }}>{t.flLbSupportOnly}</p>
                )}
                {lb && !lb.na && (
                    <>
                        {lb.poolN < MIN_POOL && (
                            <p style={{ color: T.yellow, fontSize: '11px', margin: '0 0 8px' }}>
                                ⚠ {tpl(t.flLbPoolWarnTpl, { n: lb.poolN, min: MIN_POOL })}
                            </p>
                        )}
                        <div className="mobile-scroll-hint" style={{ overflowX: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                <thead style={{ background: T.header }}>
                                    <tr>{[t.flLbColRank, t.flPbColPlayer, t.flLbColTeam, t.flLbColValue, t.flColSampleOne]
                                        .map((h, i) => <th key={i} style={thStyle}>{h}</th>)}</tr>
                                </thead>
                                <tbody>
                                    {lb.ranked.length === 0 && lb.unranked.length === 0 && (
                                        <tr><td colSpan={5} style={{ padding: '24px', textAlign: 'center', color: T.sub }}>{t.noFilteredData}</td></tr>
                                    )}
                                    {lb.ranked.map(e => (
                                        <tr key={e.x.key} className="flb-row"
                                            style={{ borderBottom: `1px solid ${T.divider}`, background: e.x.side === 'us' ? T.header : 'transparent' }}>
                                            <td style={{ padding: '5px 12px', fontSize: '13px', fontVariantNumeric: 'tabular-nums', color: e.rank <= 3 ? T.purple : T.text }}>{e.rank}</td>
                                            <td style={{ padding: '5px 12px', fontSize: '13px' }}>
                                                {e.x.player}{e.x.hero && <span style={{ fontSize: '11px', color: T.sub }}> · {getDisplayName(e.x.hero)}</span>}
                                            </td>
                                            <td style={{ padding: '5px 12px', fontSize: '12px', color: e.x.side === 'us' ? T.purple : T.sub }}>{e.x.team}</td>
                                            <td style={{ padding: '5px 12px', fontSize: '13px', fontVariantNumeric: 'tabular-nums' }}>{lb.m.fmt(e.v)}</td>
                                            <td style={{ padding: '5px 12px', fontSize: '12px', color: T.sub, fontVariantNumeric: 'tabular-nums' }}>{e.s ?? '-'}</td>
                                        </tr>
                                    ))}
                                    {lb.unranked.map(e => (
                                        <tr key={e.x.key} style={{ borderBottom: `1px solid ${T.divider}`, opacity: 0.45 }}>
                                            <td style={{ padding: '5px 12px', fontSize: '11px', color: T.sub, whiteSpace: 'nowrap' }}>{t.flLbUnranked}</td>
                                            <td style={{ padding: '5px 12px', fontSize: '13px' }}>
                                                {e.x.player}{e.x.hero && <span style={{ fontSize: '11px', color: T.sub }}> · {getDisplayName(e.x.hero)}</span>}
                                            </td>
                                            <td style={{ padding: '5px 12px', fontSize: '12px', color: T.sub }}>{e.x.team}</td>
                                            <td style={{ padding: '5px 12px', fontSize: '13px', color: T.sub, fontVariantNumeric: 'tabular-nums' }}>{e.v == null ? '-' : lb.m.fmt(e.v)}</td>
                                            <td style={{ padding: '5px 12px', fontSize: '12px', color: T.sub, fontVariantNumeric: 'tabular-nums' }}>{e.s ?? '-'}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}

// ── 상대 시점: 레코드를 반대 관점으로 뒤집는 래퍼. 집계 함수는 수정 없이 재사용 ──
// 트레이드 bool은 관점 대칭이라 서로 맞바꾸면 정확히 반대 시점이 된다:
//   first_kill_traded  = "첫킬 낸 쪽이 5초 내 킬을 되돌려받음" → 상대 시점에선 '첫데스 되갚음'
//   first_death_traded = "첫데스 당한 쪽이 5초 내 되갚음"      → 상대 시점에선 '첫킬 트레이드됨'
// victim_role은 죽은 선수의 역할(진영 무관)이므로 그대로 둔다.
const flipSide = (s) => (s === 'us' ? 'them' : s === 'them' ? 'us' : s);
export const flipRecord = (r) => ({
    ...r,
    fight_winner: flipSide(r.fight_winner),
    first_kill: r.first_kill ? { ...r.first_kill, by: flipSide(r.first_kill.by) } : null,
    first_kill_traded: r.first_death_traded,
    first_death_traded: r.first_kill_traded,
    our_ult_count: r.enemy_ult_count,
    enemy_ult_count: r.our_ult_count,
    first_ult_side: flipSide(r.first_ult_side),
    ults: (r.ults || []).map(u => ({ ...u, side: flipSide(u.side) })),
    // 매치(맵) 단위 필드도 대칭 반전 — 맵 분석 탭용. 기존 탭은 이 필드들을 읽지 않으므로 동작 무변경.
    match_result: r.match_result === 'win' ? 'loss' : r.match_result === 'loss' ? 'win' : r.match_result,
    our_score: r.enemy_score,
    enemy_score: r.our_score,
});

// ── 궁극기 콤보 분석 (컨트롤 행 + 상위/하위 콤보 표) ─────────────
// "콤보" = 같은 한타에서 우리(현재 시점 팀)가 함께 사용한 궁 조합(ultimate_start 기준).
// 한타에 궁이 콤보 크기보다 많으면 크기 N의 모든 부분조합을 각각 집계(한 한타가 여러 콤보에 포함).
const CMB_ROLE_ORDER = { tank: 0, damage: 1, support: 2, other: 3 };

function combosOfSize(arr, n) {
    const out = [];
    const rec = (start, cur) => {
        if (cur.length === n) { out.push([...cur]); return; }
        for (let i = start; i <= arr.length - (n - cur.length); i++) { cur.push(arr[i]); rec(i + 1, cur); cur.pop(); }
    };
    rec(0, []);
    return out;
}

// 콤보 판정 시간 창(초): 직전 우리 궁으로부터 이 간격 이내면 같은 콤보 체인
const COMBO_WINDOW_SEC = 3;

// recs → Map(콤보 키 → { key, members, fights[] }).
// 새 정의: 콤보 = 우리 궁들의 "시간 연쇄"(체인).
//   R1. 직전 우리 궁으로부터 windowSec 이내(≤, 동일 timestamp 포함)면 같은 체인.
//   R2. 두 우리 궁 사이에 상대 궁이 끼면 체인 단절(뒤 궁은 콤보가 아니라 응수 — 응수/시퀀스 분석 영역).
//       동일 timestamp의 상대 궁은 '사이에 낀' 것으로 보지 않음(정렬 시 우리 궁 우선).
//   R3. 길이 1 체인(단독 궁)은 콤보 아님. 크기 N 부분조합은 체인 멤버에서 추출(체인이 시간 근접 보장).
// 멤버는 체인 내 중복 제거 후 역할→이름 순 정렬로 키 안정화. 같은 한타에 체인이 여러 개라도
// 동일 콤보 키는 한타당 1회만 집계(기존과 동일한 한타 단위 표본 규칙).
function collectCombos(recs, groupBy, comboSize, windowSec = COMBO_WINDOW_SEC) {
    const map = new Map();
    recs.forEach(r => {
        const seq = [...(r.ults || [])].sort((a, b) =>
            (a.timestamp - b.timestamp) || ((a.side === 'us' ? 0 : 1) - (b.side === 'us' ? 0 : 1)));
        const chains = [];
        let cur = null, lastTs = null;
        seq.forEach(u => {
            if (u.side !== 'us') { cur = null; return; }                       // R2
            if (cur && u.timestamp - lastTs <= windowSec) cur.push(u);        // R1
            else { cur = [u]; chains.push(cur); }
            lastTs = u.timestamp;
        });
        const fightCombos = new Map();
        chains.forEach(chain => {
            const seen = new Map();
            chain.forEach(u => {
                const k = groupBy === 'h' ? (u.hero || '?') : `${u.player} (${u.hero})`;
                // hero/player 원본 보존은 표시명 재조립용 — 키(k) 계산은 무변경(집계 불변)
                if (!seen.has(k)) seen.set(k, { key: k, role: u.role || 'other', hero: u.hero || '?', player: groupBy === 'h' ? null : u.player });
            });
            const members = Array.from(seen.values()).sort((a, b) =>
                ((CMB_ROLE_ORDER[a.role] ?? 3) - (CMB_ROLE_ORDER[b.role] ?? 3)) || a.key.localeCompare(b.key));
            if (members.length < comboSize) return;                            // R3 (comboSize ≥ 2)
            combosOfSize(members, comboSize).forEach(combo => {
                const ck = combo.map(m => m.key).join(' + ');
                if (!fightCombos.has(ck)) fightCombos.set(ck, combo);
            });
        });
        fightCombos.forEach((combo, ck) => {
            let e = map.get(ck);
            if (!e) { e = { key: ck, members: combo, fights: [] }; map.set(ck, e); }
            e.fights.push(r);
        });
    });
    return map;
}

// 콤보 통계: 표본/승률·평균 궁 투자 모두 승자 판정 가능 한타만(기존 winStat과 동일 기준, 모집단 통일).
const comboStat = (fights) => {
    const known = fights.filter(isKnown);
    return {
        sample: known.length,
        win: known.length > 0 ? known.filter(r => r.fight_winner === 'us').length / known.length : null,
        avgInvest: known.length > 0 ? known.reduce((a, r) => a + r.our_ult_count, 0) / known.length : null,
    };
};

// ── 해당 장면 VOD 목록 (콤보/시퀀스 표 행 클릭 시 펼침) ──────────────────────
// 링크 = buildVideoLink(video_url, 한타 시작, 매치) — 첫한타 탭과 동일 유틸 재사용.
// start_timestamp는 stored 좌표(파서 -2초 리드 포함)라 영상상 한타 시작 2초 전부터 재생된다.
// 집계 로직 무수정 — 집계가 이미 보유한 표본 한타 목록의 표시 전용 코드.
export const VOD_PAGE = 20;

const vodLinkOf = (r) => {
    if (!hasVideo(r.video_url)) return null;
    const match = { video_offset: r.video_offset, game_setup_sec: r.game_setup_sec, pauses: r.pauses || [] };
    return buildVideoLink(r.video_url, Math.max(0, Number(r.start_timestamp) || 0), match, undefined, r.effective_delta || 0);
};

// 표시 전용 반응시간 — 집계(collectFollowups)와 동일 규칙(선택 궁 첫 사용 이후 응수 창 내 최소 간격)
export const seqReactInFight = (r, sel, fol, windowSec = RESPONSE_WINDOW_SEC) => {
    const ts = seqFirstTs(r, sel.side, sel.hero);
    const after = (r.ults || []).filter(u => u.side === fol.side && u.hero === fol.hero
        && u.timestamp > ts && (u.timestamp - ts) <= windowSec);
    return after.length ? Math.min(...after.map(u => u.timestamp)) - ts : null;
};

// 펼침 목록: 최신 세션부터, VOD_PAGE개씩 '더 보기'. items = [{ r, react? }]
export function VodList({ items, shown, onMore, t, perspective, GREEN, RED }) {
    const { openVod } = useVod();
    const sorted = [...items].sort((a, b) =>
        String(b.r.session_date || '').localeCompare(String(a.r.session_date || '')) ||
        ((b.r.session_id || 0) - (a.r.session_id || 0)) ||
        ((b.r.start_timestamp || 0) - (a.r.start_timestamp || 0)));
    const slice = sorted.slice(0, shown);
    return (
        <div style={{ padding: '4px 12px 10px 28px', background: 'rgba(255,255,255,0.02)' }}>
            {slice.map((it, i) => {
                const r = it.r;
                const link = vodLinkOf(r);
                const won = r.fight_winner === 'us';
                const opp = perspective === 'them' ? r.our_team : r.enemy_team;
                return (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '4px 0', fontSize: '12px', borderBottom: `1px solid ${T.divider}`, whiteSpace: 'nowrap', flexWrap: 'wrap', fontVariantNumeric: 'tabular-nums' }}>
                        <span style={{ color: T.sub }}>{r.session_date} · vs {opp}</span>
                        <span style={{ color: T.text }}>{getMapDisplayName(r.map_name)}</span>
                        <span style={{ color: T.sub }}>{r.round_number != null ? `R${r.round_number}` : '-'}</span>
                        <span style={{ color: won ? GREEN : RED, fontWeight: 600 }}>{won ? t.osWinBadge : t.osLossBadge}</span>
                        {it.react != null && <span style={{ color: T.sub }}>{t.flVodReact} {it.react.toFixed(1)}s</span>}
                        {link ? (
                            <a href={link} target="_blank" rel="noopener noreferrer"
                                onClick={e => { e.stopPropagation(); vodClickProps(openVod, link, `${getMapDisplayName(r.map_name)} · vs ${opp}`).onClick(e); }}
                                style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '2px 9px', borderRadius: '6px', background: 'rgba(229,72,77,0.13)', color: T.applyRed, textDecoration: 'none', fontWeight: 600, fontSize: '11px' }}>
                                <Youtube size={13} /> {t.ffWatch}
                            </a>
                        ) : (
                            <span style={{ color: T.faint, fontSize: '11px' }}>{t.ffNoVideo}</span>
                        )}
                        {it.extra || null}
                    </div>
                );
            })}
            {sorted.length > shown && (
                <button onClick={e => { e.stopPropagation(); onMore(); }}
                    style={{ marginTop: '8px', background: T.pillBg, color: T.sub, border: 'none', padding: '4px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '11px' }}>
                    {t.flVodMore} ({sorted.length - shown})
                </button>
            )}
        </div>
    );
}

export function UltimateComboSection({ recsNow, recsPast, compareOn, t, GREEN, RED, perspective }) {
    const [roleFilter, setRoleFilter] = useState('all'); // 콤보 구성원 역할 기준
    const [groupBy, setGroupBy] = useState('h');         // 'h' 영웅만(기본) | 'ph' 선수+영웅
    const [comboSize, setComboSize] = useState(2);       // 2~3
    const [comboWin, setComboWin] = useState(COMBO_WINDOW_SEC); // 콤보 간격(초), 1~10
    const [topK, setTopK] = useState(5);
    const [minCombo, setMinCombo] = useState(3);         // 최소 콤보 표본
    const [params, setParams] = useState(null);          // '콤보 생성' 클릭 시점의 설정 스냅샷
    const [vodOpen, setVodOpen] = useState({});           // 행 id → 펼침 표시 개수(없으면 접힘)
    const toggleVod = (id) => setVodOpen(o => { const n = { ...o }; if (n[id]) delete n[id]; else n[id] = VOD_PAGE; return n; });
    const moreVod = (id) => setVodOpen(o => ({ ...o, [id]: (o[id] || VOD_PAGE) + VOD_PAGE }));
    // 표시 정렬(선정 로직과 무관 — Top-k/하위 멤버십은 그대로, 표 안의 순서만 변경).
    // 기본: 표본 내림차순. 헤더 클릭으로 표본/승률 전환, 재클릭 시 방향 반전.
    const [sortKey, setSortKey] = useState('sample');  // 'sample' | 'win'
    const [sortDir, setSortDir] = useState('desc');    // 'desc' | 'asc'
    const onSort = (k) => {
        if (sortKey === k) setSortDir(d => (d === 'desc' ? 'asc' : 'desc'));
        else { setSortKey(k); setSortDir('desc'); }
    };
    const sortArrow = (k) => (sortKey === k ? (sortDir === 'desc' ? ' ▼' : ' ▲') : '');

    const result = useMemo(() => {
        if (!params) return null;
        const nowMap = collectCombos(recsNow, params.groupBy, params.comboSize, params.comboWin);
        const pastMap = compareOn ? collectCombos(recsPast, params.groupBy, params.comboSize, params.comboWin) : null;
        let entries = Array.from(nowMap.values()).map(e => {
            const s = comboStat(e.fights);
            // 추세 = 추세 기간(과거)의 동일 콤보 승률 대비. 과거 표본이 최소 콤보 표본 미만이면 null(—).
            let trend = null;
            if (pastMap && s.win != null) {
                const p = pastMap.get(e.key);
                if (p) {
                    const ps = comboStat(p.fights);
                    if (ps.sample >= params.minCombo && ps.win != null) trend = (s.win - ps.win) * 100;
                }
            }
            return { ...e, ...s, trend, ok: s.sample >= params.minCombo };
        }).filter(e => e.win != null);
        if (params.roleFilter !== 'all') entries = entries.filter(e => e.members.some(m => m.role === params.roleFilter));
        return { entries, total: entries.length };
    }, [params, recsNow, recsPast, compareOn]);

    // Top-k 선정 자체를 현재 정렬 키로 수행(표시 순서만이 아니라 순위 산정 기준).
    // 기본 = 표본 내림차순 → 상위 표: 표본 많은 콤보부터. 승률 클릭 시 기존 고승률/저승률 방식.
    // 하위 표는 항상 상위 표의 반대 방향. 표본 부족 콤보는 어느 기준에서도 충족 콤보 위로 승격되지 않음.
    const ranked = useMemo(() => {
        if (!params || !result) return null;
        const cmpKey = sortKey === 'win'
            ? (a, b) => ((b.win - a.win) || (b.sample - a.sample))       // 승률, 동률은 표본 많은 쪽
            : (a, b) => ((b.sample - a.sample) || (b.win - a.win));     // 표본, 동률은 승률 높은 쪽
        const pick = (mul) => [...result.entries].sort((a, b) =>
            ((b.ok ? 1 : 0) - (a.ok ? 1 : 0)) || mul * cmpKey(a, b)).slice(0, params.topK);
        const dirMul = sortDir === 'desc' ? 1 : -1;
        return { top: pick(dirMul), bottom: pick(-dirMul) };
    }, [params, result, sortKey, sortDir]);

    const ctlLabel = { fontSize: '11px', fontWeight: 500, color: T.sub, marginBottom: '4px' };
    const ctlSelect = { background: T.inputBg, color: T.text, border: `1px solid ${T.inputBorder}`, borderRadius: '6px', padding: '6px 10px', fontSize: '12px', fontWeight: 400, outline: 'none', cursor: 'pointer' };
    const ctlNumber = { ...ctlSelect, cursor: 'text', width: '64px', boxSizing: 'border-box' };
    const thStyle = { padding: '8px 12px', textAlign: 'left', fontSize: '12px', fontWeight: 400, color: T.sub, whiteSpace: 'nowrap' };
    const tdCell = { padding: '6px 12px', fontSize: '12px', textAlign: 'left', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' };

    const roleLabel = (r) => r === 'tank' ? t.tank : r === 'damage' ? t.dps : r === 'support' ? t.support : '-';
    const rolesText = (members) => {
        const rs = [];
        members.forEach(m => { if (!rs.includes(m.role)) rs.push(m.role); });
        return rs.map(roleLabel).join(', ');
    };
    const trendColor = (tr) => (tr == null || Math.abs(tr) < 1) ? T.sub : (tr > 0 ? GREEN : RED);
    const trendText = (tr) => tr == null ? '—'
        : `${tr >= 1 ? '↑' : tr <= -1 ? '↓' : '→'} ${tr > 0 ? '+' : tr < 0 ? '−' : ''}${Math.abs(Math.round(tr))}${t.flUnitPp}`;

    const comboTable = (title, rows, tid) => (
        <div style={{ marginTop: '14px' }}>
            <h3 style={{ fontSize: '14px', fontWeight: 600, color: T.text, margin: '0 0 8px' }}>{title}</h3>
            <div className="mobile-scroll-hint" style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead style={{ background: T.header }}>
                        <tr>
                            <th style={thStyle}>{t.flCmbColCombo}</th>
                            <th style={thStyle}>{t.flCmbColRoles}</th>
                            <th style={{ ...thStyle, cursor: 'pointer', userSelect: 'none' }} onClick={() => onSort('sample')}>{t.flColSampleOne}{sortArrow('sample')}</th>
                            <th style={{ ...thStyle, cursor: 'pointer', userSelect: 'none' }} onClick={() => onSort('win')}>{t.flColWin}{sortArrow('win')}</th>
                            <th style={thStyle}>{t.flCmbColAvgInvest}</th>
                            {compareOn && <th style={thStyle}>{t.flColTrend}</th>}
                            <th style={thStyle}>{t.flColStatus}</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.length === 0 && (
                            <tr><td colSpan={7} style={{ padding: '30px', textAlign: 'center', color: T.sub }}>{t.flCmbEmpty}</td></tr>
                        )}
                        {rows.map(e => {
                            const id = `${tid}:${e.key}`;
                            const openN = vodOpen[id];
                            return (
                                <React.Fragment key={e.key}>
                                    <tr className="flb-row" onClick={() => toggleVod(id)}
                                        style={{ borderBottom: `1px solid ${T.divider}`, opacity: e.ok ? 1 : 0.45, cursor: 'pointer' }}>
                                        {/* 라벨은 members 순서 그대로 표시명으로 재조립(키는 정본 유지) */}
                                        <td style={{ ...tdCell, whiteSpace: 'normal' }}>{e.members.map(m => m.player ? `${m.player} (${getDisplayName(m.hero)})` : getDisplayName(m.hero)).join(' + ')}</td>
                                        <td style={{ ...tdCell, color: T.sub }}>{rolesText(e.members)}</td>
                                        <td style={{ ...tdCell, color: T.sub }}>{e.sample}</td>
                                        <td style={tdCell}>{pct(e.win)}</td>
                                        <td style={tdCell}>{e.avgInvest == null ? '-' : e.avgInvest.toFixed(1)}</td>
                                        {compareOn && <td style={{ ...tdCell, color: trendColor(e.trend) }}>{trendText(e.trend)}</td>}
                                        <td style={{ ...tdCell, color: e.ok ? T.sub : T.yellow }}>{e.ok ? t.flStatusOk : t.flLowSample}</td>
                                    </tr>
                                    {openN && (
                                        <tr>
                                            <td colSpan={compareOn ? 7 : 6} style={{ padding: 0 }}>
                                                <VodList items={e.fights.filter(isKnown).map(r => ({ r }))}
                                                    shown={openN} onMore={() => moreVod(id)}
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
        </div>
    );

    return (
        <div style={{ marginTop: '28px' }}>
            <h2 style={{ fontSize: '16px', fontWeight: 600, color: T.text, margin: '0 0 12px' }}>{t.flCmbTitle}</h2>
            {/* 컨트롤 행 (상단 배치) */}
            <div style={{ display: 'flex', gap: '14px', alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: '4px' }}>
                <div>
                    <div style={ctlLabel}>{t.flCmbRoleFilter}</div>
                    <select value={roleFilter} onChange={e => setRoleFilter(e.target.value)} style={ctlSelect}>
                        <option value="all">{t.all}</option>
                        <option value="tank">{t.tank}</option>
                        <option value="damage">{t.dps}</option>
                        <option value="support">{t.support}</option>
                    </select>
                </div>
                <div>
                    <div style={ctlLabel}>{t.flCmbGroupBy}</div>
                    <select value={groupBy} onChange={e => setGroupBy(e.target.value)} style={ctlSelect}>
                        <option value="ph">{t.flCmbGroupPH}</option>
                        <option value="h">{t.flCmbGroupH}</option>
                    </select>
                </div>
                <div>
                    <div style={ctlLabel}>{t.flCmbSize}</div>
                    <select value={comboSize} onChange={e => setComboSize(Number(e.target.value))} style={ctlSelect}>
                        <option value={2}>2</option>
                        <option value={3}>3</option>
                    </select>
                </div>
                <div>
                    <div style={ctlLabel}>{t.flCmbWindow}</div>
                    <input type="number" min="1" max="10" value={comboWin}
                        onChange={e => setComboWin(Math.min(10, Math.max(1, Number(e.target.value) || 1)))} style={ctlNumber} />
                </div>
                <div>
                    <div style={ctlLabel}>{t.flCmbTopK}</div>
                    <input type="number" min="1" value={topK}
                        onChange={e => setTopK(Math.max(1, Number(e.target.value) || 1))} style={ctlNumber} />
                </div>
                <div>
                    <div style={ctlLabel}>{t.flCmbMinSample}</div>
                    <input type="number" min="1" value={minCombo}
                        onChange={e => setMinCombo(Math.max(1, Number(e.target.value) || 1))} style={ctlNumber} />
                </div>
                <button onClick={() => { setParams({ roleFilter, groupBy, comboSize, topK, minCombo, comboWin }); setSortKey('sample'); setSortDir('desc'); }}
                    style={{ background: T.applyRed, color: '#fff', border: 'none', borderRadius: '7px', padding: '7px 18px', fontWeight: 700, fontSize: '12px', cursor: 'pointer' }}>
                    {t.flCmbGenerate}
                </button>
            </div>
            {!result && <p style={{ color: T.faint, fontSize: '11px', margin: '8px 2px 0' }}>{t.flCmbPrompt}</p>}
            {result && ranked && (
                <>
                    {comboTable(t.flCmbTopTitle, ranked.top, 'top')}
                    {comboTable(t.flCmbBottomTitle, ranked.bottom, 'bot')}
                    <p style={{ color: T.faint, fontSize: '11px', margin: '10px 2px 0' }}>{t.flCmbNote}</p>
                </>
            )}
        </div>
    );
}

// ── 궁극기 시퀀스 분석 (첫 궁 선택 → 후속 궁 두 표 → 상호작용) ──
// "후속" = 선택 궁이 나온 한타에서 그 궁의 첫 사용 timestamp보다 "이후"(초과),
//          응수 창(RESPONSE_WINDOW_SEC, 기본 3초) 이내에 사용된 궁.
// timestamp가 같으면(동시 사용) 후속으로 세지 않음 — 동시 콤보는 콤보 분석 영역.
// 모든 수치(표본·시퀀스율·반응시간)는 승패 판정 가능 한타 기준(콤보 섹션과 동일 모집단 규칙).

// 응수/시퀀스 후속 인정 창(초) — 콤보 창(COMBO_WINDOW_SEC)과 값이 같아도 별개 상수(개별 조정 가능)
// export는 [이니시] 서브탭(UltimateAnalysisStats)의 응수 미니 표 재사용용 — 값·계산 무변경.
export const RESPONSE_WINDOW_SEC = 3;

// (side, hero) 궁이 나온 승패 판정 가능 한타 목록
const seqSelFights = (recs, side, hero) =>
    recs.filter(r => isKnown(r) && (r.ults || []).some(u => u.side === side && u.hero === hero));
export const seqWin = (fights) =>
    fights.length > 0 ? fights.filter(r => r.fight_winner === 'us').length / fights.length : null;
// 한타 내 해당 궁의 첫 사용 timestamp
const seqFirstTs = (r, side, hero) =>
    Math.min(...(r.ults || []).filter(u => u.side === side && u.hero === hero).map(u => u.timestamp));

// 선택 궁의 후속 궁 집계: Map("side|hero" → { side, hero, fights[], reactSum })
// 후속은 한타당 1회(가장 빠른 사용 기준), 선택 궁 자신(같은 측·같은 영웅)은 제외.
export function collectFollowups(baseFights, side, hero, windowSec = RESPONSE_WINDOW_SEC) {
    const map = new Map();
    baseFights.forEach(r => {
        const ts = seqFirstTs(r, side, hero);
        const perFight = new Map();
        (r.ults || []).forEach(u => {
            if (u.side === side && u.hero === hero) return;
            if (!(u.timestamp > ts) || (u.timestamp - ts) > windowSec) return; // 동시(=) 제외 + 응수 창 초과 제외
            const k = `${u.side}|${u.hero}`;
            const react = u.timestamp - ts;
            const cur = perFight.get(k);
            if (!cur || react < cur.react) perFight.set(k, { side: u.side, hero: u.hero, react });
        });
        perFight.forEach((v, k) => {
            let e = map.get(k);
            if (!e) { e = { key: k, side: v.side, hero: v.hero, fights: [], reactSum: 0 }; map.set(k, e); }
            e.fights.push(r); e.reactSum += v.react;
        });
    });
    return map;
}

// A궁 → B궁 시퀀스가 나온 한타: A 첫 사용 이후(초과) B가 사용된 판정 가능 한타 + 반응시간
function seqPairFights(recs, A, B, windowSec = RESPONSE_WINDOW_SEC) {
    const out = [];
    recs.forEach(r => {
        if (!isKnown(r)) return;
        const aU = (r.ults || []).filter(u => u.side === A.side && u.hero === A.hero);
        if (!aU.length) return;
        const aTs = Math.min(...aU.map(u => u.timestamp));
        const bAfter = (r.ults || []).filter(u => u.side === B.side && u.hero === B.hero
            && u.timestamp > aTs && (u.timestamp - aTs) <= windowSec);
        if (!bAfter.length) return;
        out.push({ r, react: Math.min(...bAfter.map(u => u.timestamp)) - aTs });
    });
    return out;
}

export function UltimateSequenceSection({ recsNow, recsPast, compareOn, t, GREEN, RED, perspective }) {
    const [side1, setSide1] = useState('us');
    const [role1, setRole1] = useState('all');
    const [hero1, setHero1] = useState('');
    const [minS, setMinS] = useState(5);
    const [respWin, setRespWin] = useState(RESPONSE_WINDOW_SEC); // 응수 창(초), 1~30
    const [p1, setP1] = useState(null);      // 1단계 '분석' 클릭 시점 스냅샷
    const [prefill, setPrefill] = useState('');
    const [side2, setSide2] = useState('them');
    const [hero2, setHero2] = useState('');
    const [p2, setP2] = useState(null);      // 3단계 '상호작용 분석' 스냅샷
    const [vodOpen, setVodOpen] = useState({});
    const toggleVod = (id) => setVodOpen(o => { const n = { ...o }; if (n[id]) delete n[id]; else n[id] = VOD_PAGE; return n; });
    const moreVod = (id) => setVodOpen(o => ({ ...o, [id]: (o[id] || VOD_PAGE) + VOD_PAGE }));

    // 해당 측·역할에서 실제 등장한 궁 영웅 목록
    const heroList = useMemo(() => {
        const s = new Set();
        recsNow.forEach(r => (r.ults || []).forEach(u => {
            if (u.side !== side1) return;
            if (role1 !== 'all' && u.role !== role1) return;
            s.add(u.hero);
        }));
        return Array.from(s).sort();
    }, [recsNow, side1, role1]);
    useEffect(() => { if (!heroList.includes(hero1)) setHero1(heroList[0] || ''); }, [heroList]); // eslint-disable-line
    const hero2List = useMemo(() => {
        const s = new Set();
        recsNow.forEach(r => (r.ults || []).forEach(u => { if (u.side === side2) s.add(u.hero); }));
        return Array.from(s).sort();
    }, [recsNow, side2]);
    useEffect(() => { if (hero2 && !hero2List.includes(hero2)) setHero2(hero2List[0] || ''); }, [hero2List]); // eslint-disable-line

    const sideLabel = (s) => s === 'us' ? t.flSeqSideOur : t.flSeqSideOpp;
    const ultLabel = (s, h) => `${sideLabel(s)} ${getDisplayName(h)}`;
    const fmtD = (d) => d == null ? '—' : `${d > 0 ? '+' : '−'}${Math.abs(d).toFixed(1)}${t.flUnitPp}`;
    const trendText = (tr) => tr == null ? '—'
        : `${tr >= 1 ? '↑' : tr <= -1 ? '↓' : '→'} ${tr > 0 ? '+' : tr < 0 ? '−' : ''}${Math.abs(Math.round(tr))}${t.flUnitPp}`;
    const trendColor = (tr) => (tr == null || Math.abs(tr) < 1) ? T.sub : (tr > 0 ? GREEN : RED);
    const dColor = (d) => (d == null || Math.abs(d) < 1) ? T.sub : (d > 0 ? GREEN : RED);
    const reactText = (v) => v == null ? '—' : `${v.toFixed(1)}s`;

    // ── 1·2단계 결과 ──
    const res1 = useMemo(() => {
        if (!p1) return null;
        const base = seqSelFights(recsNow, p1.side, p1.hero);
        const win = seqWin(base);
        if (win == null) return { empty: true };
        // Δ(vs 상대): 기존 상황 표와 동일 — 같은 한타들을 flipRecord로 뒤집어 동일 선택의 대칭 수치와 비교
        const oppWin = seqWin(seqSelFights(recsNow.map(flipRecord), p1.side, p1.hero));
        const dOpp = oppWin != null ? (win - oppWin) * 100 : null;
        // 추세(vs 과거): 기존 규칙 — 과거 동일 선택 승률과의 차이
        const pastWin = compareOn ? seqWin(seqSelFights(recsPast, p1.side, p1.hero)) : null;
        const trend = pastWin != null ? (win - pastWin) * 100 : null;
        // 후속 궁 집계 → 좌(상대 후속=카운터, 승률 낮은 순) / 우(우리 후속, 승률 높은 순)
        const entries = Array.from(collectFollowups(base, p1.side, p1.hero, p1.respWin).values()).map(e => {
            const w = seqWin(e.fights);
            return {
                ...e, sample: e.fights.length, win: w,
                seqRate: e.fights.length / base.length,
                dWin: w != null ? (w - win) * 100 : null,
                avgReact: e.fights.length > 0 ? e.reactSum / e.fights.length : null,
                ok: e.fights.length >= p1.minS,
            };
        }).filter(e => e.win != null);
        const rank = (list, cmp) => [...list].sort((a, b) =>
            ((b.ok ? 1 : 0) - (a.ok ? 1 : 0)) || cmp(a, b) || (b.sample - a.sample)).slice(0, 5);
        return {
            base, win, dOpp, trend,
            counters: rank(entries.filter(e => e.side === 'them'), (a, b) => a.win - b.win),
            followups: rank(entries.filter(e => e.side === 'us'), (a, b) => b.win - a.win),
            allFollowups: entries,
        };
    }, [p1, recsNow, recsPast, compareOn]);

    // ── 4단계 결과 ──
    const res2 = useMemo(() => {
        if (!p1 || !p2 || !res1 || res1.empty) return null;
        const A = { side: p1.side, hero: p1.hero };
        const B = { side: p2.side, hero: p2.hero };
        const overallWin = seqWin(recsNow.filter(isKnown));
        const mkSingle = (S) => {
            const f = seqSelFights(recsNow, S.side, S.hero);
            const w = seqWin(f);
            let trend = null;
            if (compareOn && w != null) {
                const pf = seqSelFights(recsPast, S.side, S.hero);
                if (pf.length >= p2.minS) { const pw = seqWin(pf); if (pw != null) trend = (w - pw) * 100; }
            }
            return { label: `${ultLabel(S.side, S.hero)} ${t.flSeqUltWord}`, sample: f.length, rate: null, win: w,
                dWin: (w != null && overallWin != null) ? (w - overallWin) * 100 : null, trend, react: null, ok: f.length >= p2.minS,
                fights: f };  // VOD 목록 노출용(집계가 이미 보유한 표본 목록 — 수치 계산 무변경)
        };
        const mkSeq = (X, Y, denom) => {
            const list = seqPairFights(recsNow, X, Y, p1.respWin);
            const f = list.map(x => x.r);
            const w = seqWin(f);
            let trend = null;
            if (compareOn && w != null) {
                const pl = seqPairFights(recsPast, X, Y, p1.respWin);
                if (pl.length >= p2.minS) { const pw = seqWin(pl.map(x => x.r)); if (pw != null) trend = (w - pw) * 100; }
            }
            return { label: `${ultLabel(X.side, X.hero)} → ${ultLabel(Y.side, Y.hero)}`, sample: f.length,
                rate: denom > 0 ? f.length / denom : null, win: w,
                dWin: (w != null && overallWin != null) ? (w - overallWin) * 100 : null, trend,
                react: list.length > 0 ? list.reduce((a, x) => a + x.react, 0) / list.length : null, ok: f.length >= p2.minS,
                fightsDetail: list };  // VOD 목록 노출용({r, react} — 수치 계산 무변경)
        };
        const rowA = mkSingle(A), rowB = mkSingle(B);
        const rowAB = mkSeq(A, B, rowA.sample), rowBA = mkSeq(B, A, rowB.sample);
        return { rowA, rowB, rowAB, rowBA };
    }, [p1, p2, res1, recsNow, recsPast, compareOn]); // eslint-disable-line

    const ctlLabel = { fontSize: '11px', fontWeight: 500, color: T.sub, marginBottom: '4px' };
    const ctlSelect = { background: T.inputBg, color: T.text, border: `1px solid ${T.inputBorder}`, borderRadius: '6px', padding: '6px 10px', fontSize: '12px', fontWeight: 400, outline: 'none', cursor: 'pointer' };
    const ctlNumber = { ...ctlSelect, cursor: 'text', width: '64px', boxSizing: 'border-box' };
    const btnRed = { background: T.applyRed, color: '#fff', border: 'none', borderRadius: '7px', padding: '7px 18px', fontWeight: 700, fontSize: '12px', cursor: 'pointer' };
    const thStyle = { padding: '8px 12px', textAlign: 'left', fontSize: '12px', fontWeight: 400, color: T.sub, whiteSpace: 'nowrap' };
    const tdCell = { padding: '6px 12px', fontSize: '12px', textAlign: 'left', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' };
    const stepTitle = { fontSize: '13px', fontWeight: 600, color: T.text, margin: '18px 0 8px' };

    // 2단계 표(좌우 공용) — 행 클릭 시 표본 한타 VOD 목록 펼침(반응시간 표기 포함)
    const followTable = (title, rows, tid) => (
        <div style={{ flex: 1, minWidth: '380px' }}>
            <h4 style={{ fontSize: '13px', fontWeight: 600, color: T.text, margin: '0 0 6px' }}>{title}</h4>
            <div className="mobile-scroll-hint" style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead style={{ background: T.header }}>
                        <tr>{[t.flSeqColFollow, t.flColSampleOne, t.flSeqColSeqRate, t.flColWin, t.flSeqColDWin, t.flSeqColReact]
                            .map((h, i) => <th key={i} style={thStyle}>{h}</th>)}</tr>
                    </thead>
                    <tbody>
                        {rows.length === 0 && (
                            <tr><td colSpan={6} style={{ padding: '24px', textAlign: 'center', color: T.sub }}>{t.flCmbEmpty}</td></tr>
                        )}
                        {rows.map(e => {
                            const id = `${tid}:${e.key}`;
                            const openN = vodOpen[id];
                            return (
                                <React.Fragment key={e.key}>
                                    <tr className="flb-row" onClick={() => toggleVod(id)}
                                        style={{ borderBottom: `1px solid ${T.divider}`, opacity: e.ok ? 1 : 0.45, cursor: 'pointer' }}>
                                        <td style={tdCell}>{ultLabel(e.side, e.hero)}{!e.ok && <span style={{ marginLeft: '6px', fontSize: '10px', color: T.yellow }}>{t.flLowSample}</span>}</td>
                                        <td style={{ ...tdCell, color: T.sub }}>{e.sample}</td>
                                        <td style={tdCell}>{pct(e.seqRate)}</td>
                                        <td style={tdCell}>{pct(e.win)}</td>
                                        <td style={{ ...tdCell, color: dColor(e.dWin) }}>{fmtD(e.dWin)}</td>
                                        <td style={{ ...tdCell, color: T.sub }}>{reactText(e.avgReact)}</td>
                                    </tr>
                                    {openN && p1 && (
                                        <tr>
                                            <td colSpan={6} style={{ padding: 0 }}>
                                                <VodList items={e.fights.map(r => ({ r, react: seqReactInFight(r, p1, e, p1.respWin) }))}
                                                    shown={openN} onMore={() => moreVod(id)}
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
        </div>
    );

    const sameUlt = p1 && side2 === p1.side && hero2 === p1.hero;

    return (
        <div style={{ marginTop: '28px' }}>
            <h2 style={{ fontSize: '16px', fontWeight: 600, color: T.text, margin: '0 0 4px' }}>{t.flSeqTitle}</h2>
            {/* 최소 표본 (Minimum sample 자리 — 별도 행) */}
            <div style={{ margin: '10px 0 2px' }}>
                <div style={ctlLabel}>{t.flMinSample}</div>
                <input type="number" min="1" value={minS}
                    onChange={e => setMinS(Math.max(1, Number(e.target.value) || 1))} style={ctlNumber} />
            </div>

            {/* Step 1 — 첫 궁 선택 */}
            <div style={stepTitle}>{t.flSeqStep1}</div>
            <div style={{ display: 'flex', gap: '14px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <div>
                    <div style={ctlLabel}>{t.flSeqSide}</div>
                    <select value={side1} onChange={e => setSide1(e.target.value)} style={ctlSelect}>
                        <option value="us">{t.flSeqSideOur}</option>
                        <option value="them">{t.flSeqSideOpp}</option>
                    </select>
                </div>
                <div>
                    <div style={ctlLabel}>{t.flCmbRoleFilter}</div>
                    <select value={role1} onChange={e => setRole1(e.target.value)} style={ctlSelect}>
                        <option value="all">{t.all}</option>
                        <option value="tank">{t.tank}</option>
                        <option value="damage">{t.dps}</option>
                        <option value="support">{t.support}</option>
                    </select>
                </div>
                <div>
                    <div style={ctlLabel}>{t.flSeqHero}</div>
                    <select value={hero1} onChange={e => setHero1(e.target.value)} style={{ ...ctlSelect, minWidth: '140px' }}>
                        {heroList.map(h => <option key={h} value={h}>{getDisplayName(h)}</option>)}
                    </select>
                </div>
                <div>
                    <div style={ctlLabel}>{t.flSeqRespWin}</div>
                    <input type="number" min="1" max="30" value={respWin}
                        onChange={e => setRespWin(Math.min(30, Math.max(1, Number(e.target.value) || 1)))} style={ctlNumber} />
                </div>
                <button disabled={!hero1} onClick={() => { setP1({ side: side1, hero: hero1, minS, respWin }); setP2(null); setPrefill(''); }}
                    style={{ ...btnRed, opacity: hero1 ? 1 : 0.45 }}>
                    {t.flSeqAnalyze}
                </button>
            </div>

            {/* Step 1 요약 한 줄 */}
            {p1 && res1 && (
                res1.empty
                    ? <p style={{ color: T.sub, fontSize: '12px', margin: '10px 2px 0' }}>{t.flSeqNoData}</p>
                    : <div style={{ margin: '12px 2px 0' }}>
                        <div style={{ fontSize: '13px', fontWeight: 600, color: T.text }}>{ultLabel(p1.side, p1.hero)} {t.flSeqUltWord}</div>
                        <div style={{ fontSize: '12px', color: T.sub, marginTop: '2px' }}>
                            {tpl(t.flSeqSummaryTpl, {
                                n: res1.base.length, win: pct(res1.win), d: fmtD(res1.dOpp),
                                trend: compareOn ? trendText(res1.trend) : '—',
                            })}
                        </div>
                    </div>
            )}

            {/* Step 2 — 후속 궁 두 표 (좌우 배치) */}
            {p1 && res1 && !res1.empty && (
                <>
                    <div style={stepTitle}>{t.flSeqStep2}</div>
                    <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
                        {followTable(t.flSeqTopCounters, res1.counters, 'cnt')}
                        {followTable(t.flSeqTopFollowups, res1.followups, 'fol')}
                    </div>
                    <p style={{ color: T.faint, fontSize: '11px', margin: '10px 2px 0' }}>{t.flSeqNote}</p>

                    {/* Step 3 — 두 번째 궁 (프리필 + 수동 선택) */}
                    <div style={stepTitle}>{t.flSeqStep3}</div>
                    <div style={{ display: 'flex', gap: '14px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                        <div>
                            <div style={ctlLabel}>{t.flSeqPrefill}</div>
                            <select value={prefill} style={{ ...ctlSelect, minWidth: '170px' }}
                                onChange={e => {
                                    setPrefill(e.target.value);
                                    if (e.target.value) {
                                        const [s, h] = e.target.value.split('|');
                                        setSide2(s); setHero2(h);
                                    }
                                }}>
                                <option value="">{t.flSeqManualOpt}</option>
                                {res1.allFollowups.map(e => (
                                    <option key={e.key} value={e.key}>{ultLabel(e.side, e.hero)}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <div style={ctlLabel}>{t.flSeqSide}</div>
                            <select value={side2} onChange={e => { setSide2(e.target.value); setPrefill(''); }} style={ctlSelect}>
                                <option value="us">{t.flSeqSideOur}</option>
                                <option value="them">{t.flSeqSideOpp}</option>
                            </select>
                        </div>
                        <div>
                            <div style={ctlLabel}>{t.flSeqHero}</div>
                            <select value={hero2} onChange={e => { setHero2(e.target.value); setPrefill(''); }} style={{ ...ctlSelect, minWidth: '140px' }}>
                                <option value="">-</option>
                                {hero2List.map(h => <option key={h} value={h}>{getDisplayName(h)}</option>)}
                            </select>
                        </div>
                        <button disabled={!hero2 || sameUlt}
                            onClick={() => setP2({ side: side2, hero: hero2, minS })}
                            style={{ ...btnRed, opacity: (!hero2 || sameUlt) ? 0.45 : 1 }}>
                            {t.flSeqAnalyze2}
                        </button>
                    </div>
                    {hero2 && <p style={{ color: T.sub, fontSize: '12px', margin: '8px 2px 0' }}>{t.flSeqSecondLabel}: {ultLabel(side2, hero2)}</p>}
                    {sameUlt && <p style={{ color: T.yellow, fontSize: '11px', margin: '6px 2px 0' }}>{t.flSeqSameWarn}</p>}
                    {!p2 && !sameUlt && <p style={{ color: T.faint, fontSize: '11px', margin: '8px 2px 0' }}>{t.flSeqPickSecond}</p>}
                </>
            )}

            {/* Step 4 — 상호작용 표 (4행) + 요약문 + 각주 */}
            {p2 && res2 && (
                <>
                    <div style={stepTitle}>{t.flSeqStep4}</div>
                    <div className="mobile-scroll-hint" style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead style={{ background: T.header }}>
                                <tr>{[
                                    t.flColSituation, t.flColSampleOne, t.flColOccur, t.flColWin, t.flSeqColDWin,
                                    ...(compareOn ? [t.flColTrend] : []),
                                    t.flSeqColReact,
                                ].map((h, i) => <th key={i} style={thStyle}>{h}</th>)}</tr>
                            </thead>
                            <tbody>
                                {[res2.rowA, res2.rowB, res2.rowAB, res2.rowBA].map((row, i) => {
                                    const id = `int:${i}`;
                                    const openN = vodOpen[id];
                                    const items = row.fightsDetail
                                        ? row.fightsDetail.map(x => ({ r: x.r, react: x.react }))
                                        : (row.fights || []).map(r => ({ r }));
                                    return (
                                        <React.Fragment key={i}>
                                            <tr className="flb-row" onClick={() => toggleVod(id)}
                                                style={{ borderBottom: `1px solid ${T.divider}`, opacity: row.ok ? 1 : 0.45, cursor: 'pointer' }}>
                                                <td style={tdCell}>{row.label}{!row.ok && <span style={{ marginLeft: '6px', fontSize: '10px', color: T.yellow }}>{t.flLowSample}</span>}</td>
                                                <td style={{ ...tdCell, color: T.sub }}>{row.sample}</td>
                                                <td style={tdCell}>{row.rate == null ? '—' : pct(row.rate)}</td>
                                                <td style={tdCell}>{pct(row.win)}</td>
                                                <td style={{ ...tdCell, color: dColor(row.dWin) }}>{fmtD(row.dWin)}</td>
                                                {compareOn && <td style={{ ...tdCell, color: trendColor(row.trend) }}>{trendText(row.trend)}</td>}
                                                <td style={{ ...tdCell, color: T.sub }}>{reactText(row.react)}</td>
                                            </tr>
                                            {openN && (
                                                <tr>
                                                    <td colSpan={compareOn ? 7 : 6} style={{ padding: 0 }}>
                                                        <VodList items={items} shown={openN} onMore={() => moreVod(id)}
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
                    <p style={{ color: T.sub, fontSize: '12px', margin: '10px 2px 0', lineHeight: 1.7 }}>
                        {res2.rowAB.label}: {pct(res2.rowAB.win)} · {res2.rowBA.label}: {pct(res2.rowBA.win)}
                        {res2.rowAB.win != null && res2.rowBA.win != null &&
                            <> · {t.flSeqDiffWord} {fmtD((res2.rowAB.win - res2.rowBA.win) * 100)}</>}
                    </p>
                    <p style={{ color: T.faint, fontSize: '11px', margin: '6px 2px 0' }}>{t.flSeqStep4Note}</p>
                </>
            )}
        </div>
    );
}

// ── 궁극기 응수(카운터) 분석 — 시퀀스 분석 아래 신설 섹션 ─────────────────────
// "상대 궁 A가 열렸을 때 우리가 어떤 궁 B로 응수하면 승률이 높은가"의 수비 매뉴얼.
// 계산은 기존 시퀀스 로직(seqSelFights/seqWin/seqFirstTs/collectFollowups) 재사용 —
// 관점만 "상대 궁 선택 → 우리 후속"으로 고정. 새 판정 로직 없음(응수 = 기존 후속 규칙과 동일).
export function UltimateCounterSection({ recsNow, t, GREEN, RED, perspective }) {
    const [minS, setMinS] = useState(5);      // 최고 응수 궁 인정 최소 표본
    const [respWin, setRespWin] = useState(RESPONSE_WINDOW_SEC); // 응수 창(초), 1~30 — 즉시 반영(이 표는 버튼 없음)
    const [selHero, setSelHero] = useState('all');   // 상대 궁 영웅 선택('all' = 표본 많은 순 Top 10)
    const [drillOpen, setDrillOpen] = useState({});  // 상대 궁 영웅 → 드릴다운 펼침
    const [vodOpen, setVodOpen] = useState({});      // 응수 행 id → VOD 표시 개수
    const toggleDrill = (h) => setDrillOpen(o => ({ ...o, [h]: !o[h] }));
    const toggleVod = (id) => setVodOpen(o => { const n = { ...o }; if (n[id]) delete n[id]; else n[id] = VOD_PAGE; return n; });
    const moreVod = (id) => setVodOpen(o => ({ ...o, [id]: (o[id] || VOD_PAGE) + VOD_PAGE }));

    const rows = useMemo(() => {
        const heroes = new Set();
        recsNow.forEach(r => (r.ults || []).forEach(u => { if (u.side === 'them') heroes.add(u.hero); }));
        const out = [];
        heroes.forEach(H => {
            const base = seqSelFights(recsNow, 'them', H);
            if (!base.length) return;
            // 무응수 = 그 상대 궁 첫 사용 이후 응수 창 내에 우리 궁이 하나도 없던 한타
            const noResp = base.filter(r => {
                const ts = seqFirstTs(r, 'them', H);
                return !(r.ults || []).some(u => u.side === 'us' && u.timestamp > ts && (u.timestamp - ts) <= respWin);
            });
            const noRespWin = seqWin(noResp);
            const responses = Array.from(collectFollowups(base, 'them', H, respWin).values())
                .filter(e => e.side === 'us')
                .map(e => {
                    const w = seqWin(e.fights);
                    return {
                        ...e, sample: e.fights.length, win: w,
                        rate: e.fights.length / base.length,
                        dNo: (w != null && noRespWin != null) ? (w - noRespWin) * 100 : null,
                        avgReact: e.fights.length > 0 ? e.reactSum / e.fights.length : null,
                        ok: e.fights.length >= minS,
                    };
                })
                .filter(e => e.win != null)
                .sort((a, b) => ((b.ok ? 1 : 0) - (a.ok ? 1 : 0)) || (b.win - a.win) || (b.sample - a.sample));
            const best = responses.find(e => e.ok) || null; // 정렬상 첫 충족 행 = 충족 후보 중 승률 1위
            out.push({ hero: H, sample: base.length, winWith: seqWin(base), noRespN: noResp.length, noRespWin, responses, best });
        });
        out.sort((a, b) => b.sample - a.sample);
        // 특정 상대 궁 선택 시 Top 10 밖이어도 그 행만 표시, '전체'면 표본 많은 순 Top 10
        return selHero === 'all' ? out.slice(0, 10) : out.filter(x => x.hero === selHero);
    }, [recsNow, minS, respWin, selHero]);

    // 상대 궁 영웅 목록(현재 필터 스코프에서 실제 등장한 궁)
    const enemyHeroList = useMemo(() => {
        const s = new Set();
        recsNow.forEach(r => (r.ults || []).forEach(u => { if (u.side === 'them') s.add(u.hero); }));
        return Array.from(s).sort();
    }, [recsNow]);

    const ctlLabel = { fontSize: '11px', fontWeight: 500, color: T.sub, marginBottom: '4px' };
    const ctlNumber = { background: T.inputBg, color: T.text, border: `1px solid ${T.inputBorder}`, borderRadius: '6px', padding: '6px 10px', fontSize: '12px', outline: 'none', cursor: 'text', width: '64px', boxSizing: 'border-box' };
    const thStyle = { padding: '8px 12px', textAlign: 'left', fontSize: '12px', fontWeight: 400, color: T.sub, whiteSpace: 'nowrap' };
    const tdCell = { padding: '6px 12px', fontSize: '12px', textAlign: 'left', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' };
    const dColor = (d) => (d == null || Math.abs(d) < 1) ? T.sub : (d > 0 ? GREEN : RED);
    const fmtD = (d) => d == null ? '—' : `${d > 0 ? '+' : '−'}${Math.abs(d).toFixed(1)}${t.flUnitPp}`;
    const reactText = (v) => v == null ? '—' : `${v.toFixed(1)}s`;
    const usWord = t.flSeqSideOur, themWord = t.flSeqSideOpp;

    return (
        <div style={{ marginTop: '28px' }}>
            <h2 style={{ fontSize: '16px', fontWeight: 600, color: T.text, margin: '0 0 4px' }}>{t.flCtrTitle}</h2>
            <p style={{ color: T.sub, fontSize: '12px', margin: '0 0 10px' }}>{t.flCtrDesc}</p>
            <div style={{ display: 'flex', gap: '14px', marginBottom: '10px' }}>
                <div>
                    <div style={ctlLabel}>{t.flMinSample}</div>
                    <input type="number" min="1" value={minS}
                        onChange={e => setMinS(Math.max(1, Number(e.target.value) || 1))} style={ctlNumber} />
                </div>
                <div>
                    <div style={ctlLabel}>{t.flSeqRespWin}</div>
                    <input type="number" min="1" max="30" value={respWin}
                        onChange={e => setRespWin(Math.min(30, Math.max(1, Number(e.target.value) || 1)))} style={ctlNumber} />
                </div>
                <div>
                    <div style={ctlLabel}>{t.flCtrColEnemyUlt}</div>
                    <select value={selHero} onChange={e => setSelHero(e.target.value)}
                        style={{ ...ctlNumber, width: 'auto', minWidth: '140px', cursor: 'pointer' }}>
                        <option value="all">{t.all}</option>
                        {enemyHeroList.map(h => <option key={h} value={h}>{getDisplayName(h)}</option>)}
                    </select>
                </div>
            </div>

            <h3 style={{ fontSize: '14px', fontWeight: 600, color: T.text, margin: '0 0 8px' }}>{t.flCtrOverviewTitle}</h3>
            <div className="mobile-scroll-hint" style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead style={{ background: T.header }}>
                        <tr>{[t.flCtrColEnemyUlt, t.flColSampleOne, t.flCtrColWinWith, t.flCtrColNoResp, t.flCtrColBest, t.flCtrColBestWin, t.flCtrColBestN]
                            .map((h, i) => <th key={i} style={thStyle}>{h}</th>)}</tr>
                    </thead>
                    <tbody>
                        {rows.length === 0 && (
                            <tr><td colSpan={7} style={{ padding: '30px', textAlign: 'center', color: T.sub }}>{t.flCmbEmpty}</td></tr>
                        )}
                        {rows.map(row => (
                            <React.Fragment key={row.hero}>
                                <tr className="flb-row" onClick={() => toggleDrill(row.hero)}
                                    style={{ borderBottom: `1px solid ${T.divider}`, cursor: 'pointer' }}>
                                    <td style={tdCell}>
                                        {drillOpen[row.hero]
                                            ? <ChevronDown size={12} color={T.sub} style={{ verticalAlign: '-2px', marginRight: '4px' }} />
                                            : <ChevronRight size={12} color={T.sub} style={{ verticalAlign: '-2px', marginRight: '4px' }} />}
                                        {themWord} {getDisplayName(row.hero)}
                                    </td>
                                    <td style={{ ...tdCell, color: T.sub }}>{row.sample}</td>
                                    <td style={tdCell}>{pct(row.winWith)}</td>
                                    <td title={`${t.flCtrColNoResp}: ${row.noRespN}`} style={tdCell}>{pct(row.noRespWin)}</td>
                                    <td style={tdCell}>{row.best ? `${usWord} ${getDisplayName(row.best.hero)}` : <span style={{ color: T.yellow }}>{t.flLowSample}</span>}</td>
                                    <td style={tdCell}>{row.best ? pct(row.best.win) : '—'}</td>
                                    <td style={{ ...tdCell, color: T.sub }}>{row.best ? row.best.sample : '—'}</td>
                                </tr>
                                {drillOpen[row.hero] && (
                                    <tr>
                                        <td colSpan={7} style={{ padding: '0 0 8px 24px' }}>
                                            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                                <thead>
                                                    <tr>{[t.flCtrColResp, t.flColSampleOne, t.flCtrColRespRate, t.flColWin, t.flCtrColDNo, t.flSeqColReact]
                                                        .map((h, i) => <th key={i} style={{ ...thStyle, padding: '6px 12px' }}>{h}</th>)}</tr>
                                                </thead>
                                                <tbody>
                                                    {row.responses.length === 0 && (
                                                        <tr><td colSpan={6} style={{ padding: '16px', textAlign: 'center', color: T.sub }}>{t.flCmbEmpty}</td></tr>
                                                    )}
                                                    {row.responses.map(e => {
                                                        const id = `${row.hero}|${e.hero}`;
                                                        const openN = vodOpen[id];
                                                        return (
                                                            <React.Fragment key={e.key}>
                                                                <tr className="flb-row" onClick={ev => { ev.stopPropagation(); toggleVod(id); }}
                                                                    style={{ borderBottom: `1px solid ${T.divider}`, opacity: e.ok ? 1 : 0.45, cursor: 'pointer' }}>
                                                                    <td style={tdCell}>{usWord} {getDisplayName(e.hero)}{!e.ok && <span style={{ marginLeft: '6px', fontSize: '10px', color: T.yellow }}>{t.flLowSample}</span>}</td>
                                                                    <td style={{ ...tdCell, color: T.sub }}>{e.sample}</td>
                                                                    <td style={tdCell}>{pct(e.rate)}</td>
                                                                    <td style={tdCell}>{pct(e.win)}</td>
                                                                    <td style={{ ...tdCell, color: dColor(e.dNo) }}>{fmtD(e.dNo)}</td>
                                                                    <td style={{ ...tdCell, color: T.sub }}>{reactText(e.avgReact)}</td>
                                                                </tr>
                                                                {openN && (
                                                                    <tr>
                                                                        <td colSpan={6} style={{ padding: 0 }}>
                                                                            <VodList
                                                                                items={e.fights.map(r => ({ r, react: seqReactInFight(r, { side: 'them', hero: row.hero }, { side: 'us', hero: e.hero }, respWin) }))}
                                                                                shown={openN} onMore={() => moreVod(id)}
                                                                                t={t} perspective={perspective} GREEN={GREEN} RED={RED} />
                                                                        </td>
                                                                    </tr>
                                                                )}
                                                            </React.Fragment>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>
                                        </td>
                                    </tr>
                                )}
                            </React.Fragment>
                        ))}
                    </tbody>
                </table>
            </div>
            <p style={{ color: T.faint, fontSize: '11px', margin: '10px 2px 0' }}>{t.flCtrNote}</p>
        </div>
    );
}

// ═══ 공용 스코프 — 한타 분석 / 궁극기 분석 양쪽에서 재사용 ═══════════════════════
// 기존 FightLabStats 본체에서 그대로 추출(동작 무변경). 훅 인스턴스별로 상태 독립.
export function useFightScope(records, t) {
    const [perspective, setPerspective] = useState('us'); // 'us' (기준 팀) | 'them' (상대 시점)
    const [minSample, setMinSample] = useState(5);
    const [selectedOpponent, setSelectedOpponent] = useState('All');
    const [selectedMap, setSelectedMap] = useState('All');

    const today = todayStr();
    const [presetA, setPresetA] = useState('2w'); // '1w' | '2w' | '1m' | 'custom'
    const [customAStart, setCustomAStart] = useState(addDays(today, -13));
    const [customAEnd, setCustomAEnd] = useState(today);
    const [presetB, setPresetB] = useState('all_before'); // 'all_before' | 'prev_same' | 'custom'
    const [customBStart, setCustomBStart] = useState(addDays(today, -27));
    const [customBEnd, setCustomBEnd] = useState(addDays(today, -14));

    // 비교 토글 제거: '전체' 기간이면 비교 없음, 그 외엔 항상 비교 표시
    const compareOn = presetA !== 'all';

    // 사이드바 초안(draft) — '적용' 버튼을 눌러야 실제 필터(applied 상태들)에 반영
    const [draft, setDraft] = useState({
        presetA: '2w', customAStart: addDays(today, -13), customAEnd: today,
        presetB: 'all_before', customBStart: addDays(today, -27), customBEnd: addDays(today, -14),
        perspective: 'us', opponent: 'All', map: 'All', minSample: 5,
    });
    const setD = (patch) => setDraft(d => ({ ...d, ...patch }));
    const applyDraft = () => {
        setPresetA(draft.presetA); setCustomAStart(draft.customAStart); setCustomAEnd(draft.customAEnd);
        setPresetB(draft.presetB); setCustomBStart(draft.customBStart); setCustomBEnd(draft.customBEnd);
        setPerspective(draft.perspective); setSelectedOpponent(draft.opponent); setSelectedMap(draft.map);
        setMinSample(draft.minSample);
    };

    const opponentList = useMemo(() => {
        const s = new Set(); records.forEach(r => { if (r.enemy_team) s.add(r.enemy_team); });
        return Array.from(s).sort();
    }, [records]);
    const mapList = useMemo(() => {
        const s = new Set(); records.forEach(r => { if (r.map_name) s.add(r.map_name); });
        return Array.from(s).sort();
    }, [records]);

    // 맵/상대팀 필터 (두 기간에 동일 적용). 필터는 항상 원본(기준 팀 기준) 필드로 판정.
    const filtered = useMemo(() => records.filter(r => {
        if (selectedOpponent !== 'All' && r.enemy_team !== selectedOpponent) return false;
        if (selectedMap !== 'All' && r.map_name !== selectedMap) return false;
        return true;
    }), [records, selectedOpponent, selectedMap]);

    // 시점 적용: 상대 시점이면 필터링된 레코드를 뒤집어 동일 집계 함수에 태운다.
    const viewRecords = useMemo(
        () => (perspective === 'them' ? filtered.map(flipRecord) : filtered),
        [filtered, perspective]
    );

    // 기간 A/B 날짜 범위 산출
    const rangeA = useMemo(() => {
        if (presetA === 'all') return [null, null];
        if (presetA === 'custom') return [customAStart || null, customAEnd || null];
        const days = A_PRESET_DAYS[presetA] || 14;
        return [addDays(today, -(days - 1)), today];
    }, [presetA, customAStart, customAEnd, today]);

    const rangeB = useMemo(() => {
        if (presetB === 'custom') return [customBStart || null, customBEnd || null];
        const aStart = rangeA[0];
        if (!aStart) return [null, null];
        if (presetB === 'all_before') return [null, addDays(aStart, -1)];
        // 'prev_same': A 길이만큼 바로 앞 구간
        const aEnd = rangeA[1] || today;
        const len = daysInclusive(aStart, aEnd);
        const endB = addDays(aStart, -1);
        return [addDays(endB, -(len - 1)), endB];
    }, [presetB, customBStart, customBEnd, rangeA, today]);

    const overlap = compareOn && rangesOverlap(rangeA, rangeB);

    const recsA = useMemo(() => viewRecords.filter(r => inRange(r.session_date, rangeA)), [viewRecords, rangeA]);
    const recsB = useMemo(() => viewRecords.filter(r => inRange(r.session_date, rangeB)), [viewRecords, rangeB]);
    // 자주 쓰는 파생값: 현재 기간의 표시 대상 레코드
    const recsNow = compareOn ? recsA : viewRecords;

    const firstSessionDate = useMemo(
        () => records.reduce((min, r) => (!min || (r.session_date && r.session_date < min) ? r.session_date : min), null),
        [records]
    );
    const lastSessionDate = useMemo(
        () => records.reduce((max, r) => (!max || (r.session_date && r.session_date > max) ? r.session_date : max), null),
        [records]
    );
    // 선택 기간에 레코드가 0건일 때 한 번에 '전체'로 전환(초안+적용 동시)
    const applyAllPeriod = () => { setDraft(d => ({ ...d, presetA: 'all' })); setPresetA('all'); };
    const presetALabel = presetA === 'all' ? t.flPresetAll : presetA === '1w' ? t.flPreset1w : presetA === '2w' ? t.flPreset2w : presetA === '1m' ? t.flPreset1m : t.flPresetCustom;
    const pastLabel = presetB === 'all_before' ? t.flCmpPastAll
        : presetB === 'prev_same' ? (presetA === 'custom' ? t.flPresetPrevSame : `${t.flCmpPrevPrefix}${presetALabel}`)
        : `${t.flPastShort} (${t.flPresetCustom})`;

    return {
        perspective, minSample, selectedOpponent, selectedMap,
        compareOn, draft, setD, applyDraft,
        opponentList, mapList, viewRecords,
        rangeA, rangeB, overlap, recsA, recsB, recsNow,
        firstSessionDate, lastSessionDate, applyAllPeriod, today, presetA, presetALabel, pastLabel,
    };
}

// 사이드바 (좌측): 초안을 수정하고 '적용'을 눌러야 반영 — 기존 aside JSX 그대로 추출
// 옵션(전부 기본 false — 기존 사용처 동작 무변경, 맵 분석 탭 전용):
//   hideMap: 맵 필터 숨김 · hideMinSample: 최소 표본 입력 숨김(표본 하한 없는 탭)
//   opponentOnlyForThem: 상대팀 선택을 '상대 시점'일 때만 노출(우리 시점 전환 시 상대 필터 초기화)
export function ScopeSidebar({ sc, t, hideMap = false, hideMinSample = false, opponentOnlyForThem = false }) {
    const dateInputStyle = { width: '100%', boxSizing: 'border-box', background: T.inputBg, color: T.text, border: `1px solid ${T.inputBorder}`, borderRadius: '6px', padding: '4px 7px', fontSize: '12px', outline: 'none' };
    const sideLabel = { fontSize: '11px', fontWeight: 500, color: T.sub, marginBottom: '5px' };
    const sideSelect = { width: '100%', boxSizing: 'border-box', background: T.inputBg, color: T.text, border: `1px solid ${T.inputBorder}`, borderRadius: '6px', padding: '6px 8px', fontSize: '12px', fontWeight: 400, outline: 'none', cursor: 'pointer' };
    const { draft, setD, applyDraft, opponentList, mapList } = sc;
    const isMobile = useIsMobile();
    const [open, setOpen] = useState(false); // 모바일: 접이식(기본 접힘). 데스크톱은 항상 펼침.
    const showBody = !isMobile || open;
    // 접힌 상태에서도 현재 조건을 알 수 있게 — 적용된 필터 한 줄 요약(캡션과 동일 필드)
    const filterSummary = [
        sc.presetA === 'all' ? t.flPresetAll : sc.presetALabel,
        sc.perspective === 'us' ? t.flPerspUs : t.flPerspThem,
        (sc.selectedOpponent && sc.selectedOpponent !== 'All') ? sc.selectedOpponent : null,
        (!hideMap && sc.selectedMap && sc.selectedMap !== 'All') ? sc.selectedMap : null,
    ].filter(Boolean).join(' · ');
    return (
        <aside style={{ width: isMobile ? '100%' : '200px', boxSizing: 'border-box', flexShrink: 0, background: T.panel, border: `1px solid ${T.panelBorder}`, borderRadius: '8px', padding: isMobile ? (open ? '12px' : '8px 12px') : '14px', display: 'flex', flexDirection: 'column', gap: showBody ? '12px' : 0 }}>
            {isMobile && (
                <button onClick={() => setOpen(o => !o)} aria-expanded={open}
                    style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', minHeight: 40, background: 'transparent', border: 'none', color: T.text, cursor: 'pointer', padding: '2px 0', font: 'inherit' }}>
                    <SlidersHorizontal size={15} style={{ flexShrink: 0, color: T.sub }} />
                    <span style={{ flex: 1, minWidth: 0, textAlign: 'left', fontSize: '12px', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: open ? T.text : T.sub }}>
                        {t.flSideFilter || t.flApply}{filterSummary ? `: ${filterSummary}` : ''}
                    </span>
                    <ChevronDown size={16} style={{ flexShrink: 0, color: T.sub, transition: 'transform .15s', transform: open ? 'rotate(180deg)' : 'none' }} />
                </button>
            )}
            {showBody && (<>
            <div>
                <div style={sideLabel}>{t.flSideDate}</div>
                <select value={draft.presetA} onChange={e => setD({ presetA: e.target.value })} style={sideSelect}>
                    <option value="all">{t.flPresetAll}</option>
                    <option value="1w">{t.flPreset1w}</option>
                    <option value="2w">{t.flPreset2w}</option>
                    <option value="1m">{t.flPreset1m}</option>
                    <option value="custom">{t.flPresetCustom}</option>
                </select>
                {draft.presetA === 'custom' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '8px' }}>
                        <input type="date" value={draft.customAStart} onChange={e => setD({ customAStart: e.target.value })} style={dateInputStyle} />
                        <input type="date" value={draft.customAEnd} onChange={e => setD({ customAEnd: e.target.value })} style={dateInputStyle} />
                    </div>
                )}
            </div>
            <div style={{ opacity: draft.presetA === 'all' ? 0.45 : 1 }}>
                <div style={sideLabel}>{t.flSideTrend}</div>
                <select value={draft.presetB} disabled={draft.presetA === 'all'} onChange={e => setD({ presetB: e.target.value })} style={sideSelect}>
                    <option value="prev_same">{t.flPresetPrevSame}</option>
                    <option value="all_before">{t.flPresetAllBefore}</option>
                    <option value="custom">{t.flPresetCustom}</option>
                </select>
                {draft.presetB === 'custom' && draft.presetA !== 'all' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '8px' }}>
                        <input type="date" value={draft.customBStart} onChange={e => setD({ customBStart: e.target.value })} style={dateInputStyle} />
                        <input type="date" value={draft.customBEnd} onChange={e => setD({ customBEnd: e.target.value })} style={dateInputStyle} />
                    </div>
                )}
            </div>
            <div>
                <div style={sideLabel}>{t.flSideView}</div>
                <select value={draft.perspective}
                    onChange={e => {
                        const v = e.target.value;
                        setD(opponentOnlyForThem && v !== 'them' ? { perspective: v, opponent: 'All' } : { perspective: v });
                    }} style={sideSelect}>
                    <option value="us">{t.flPerspUs}</option>
                    <option value="them">{t.flPerspThem}</option>
                </select>
            </div>
            {(!opponentOnlyForThem || draft.perspective === 'them') && (
                <div>
                    <div style={sideLabel}>{t.flSideOpp}</div>
                    <select value={draft.opponent} onChange={e => setD({ opponent: e.target.value })} style={sideSelect}>
                        <option value="All">{t.ffAllOpponents}</option>
                        {opponentList.map(tm => <option key={tm} value={tm}>{tm}</option>)}
                    </select>
                </div>
            )}
            {!hideMap && (
                <div>
                    <div style={sideLabel}>{t.flSideMap}</div>
                    <select value={draft.map} onChange={e => setD({ map: e.target.value })} style={sideSelect}>
                        <option value="All">{t.ffAllMaps}</option>
                        {mapList.map(mp => <option key={mp} value={mp}>{getMapDisplayName(mp)}</option>)}
                    </select>
                </div>
            )}
            {!hideMinSample && (
                <div>
                    <div style={sideLabel}>{t.flSideMin}</div>
                    <input type="number" min="0" value={draft.minSample}
                        onChange={e => setD({ minSample: Math.max(0, Number(e.target.value) || 0) })}
                        style={{ ...sideSelect, cursor: 'text' }} />
                </div>
            )}
            <button onClick={applyDraft}
                style={{ alignSelf: 'flex-start', minHeight: isMobile ? 44 : undefined, background: '#e5484d', color: '#fff', border: 'none', borderRadius: '7px', padding: isMobile ? '9px 22px' : '7px 18px', fontWeight: 700, fontSize: '12px', cursor: 'pointer' }}>
                {t.flApply}
            </button>
            </>)}
        </aside>
    );
}

// 스코프 캡션(좌) + 우측 노드(총평 칩 등) — 기존 캡션 행 JSX 그대로 추출
// hideMap: 맵 항목 숨김(맵 분석 탭용). 기본 false — 기존 사용처 동작 무변경.
export function ScopeCaption({ sc, t, right, hideMap = false }) {
    const fmtRange = ([s, e]) => `${s || '…'} ~ ${e || '…'}`;
    return (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginBottom: '14px' }}>
            <div style={{ fontSize: '12px', color: T.sub }}>
                {t.flScopePeriod}: <span style={{ color: T.text }}>{sc.presetA === 'all' ? `${t.flPresetAll} (${sc.firstSessionDate || '…'} ~ ${sc.today})` : `${sc.presetALabel} (${fmtRange(sc.rangeA)})`}</span>
                {' · '}{t.flScopeTrend}: <span style={{ color: T.text }}>{sc.presetA === 'all' ? t.flScopeNone : sc.pastLabel}</span>
                {' · '}{t.flScopeView}: <span style={{ color: T.text }}>{sc.perspective === 'us' ? t.flPerspUs : t.flPerspThem}</span>
                {' · '}{t.flScopeOpp}: <span style={{ color: T.text }}>{sc.selectedOpponent === 'All' ? t.all : sc.selectedOpponent}</span>
                {!hideMap && <>{' · '}{t.flScopeMap}: <span style={{ color: T.text }}>{sc.selectedMap === 'All' ? t.all : sc.selectedMap}</span></>}
            </div>
            {right}
        </div>
    );
}

// 총평 칩 — 기존 캡션 우측 JSX 그대로 추출
export function VerdictChip({ verdict, t }) {
    if (!verdict) return null;
    return (
        <span style={{ fontSize: '11px', color: T.faint, whiteSpace: 'nowrap' }}>
            <span style={{ color: T.green }}>{verdict.improved} {t.flVerdictImproved}</span>
            {' · '}<span style={{ color: T.red }}>{verdict.worse} {t.flVerdictWorse}</span>
            {' · '}{verdict.same} {t.flVerdictSame}
        </span>
    );
}

// 총평 집계 — 기존 verdict IIFE 본체 그대로 추출(서브탭 가드는 호출부 책임)
export function computeVerdict(rowDefs, statsA, statsB, minSample) {
    let improved = 0, worse = 0, same = 0;
    rowDefs.forEach(def => {
        const a = statsA[def.key], b = statsB[def.key];
        if (!a || !b) return;
        if (def.hideIfEmpty && (a.sample || 0) === 0 && (b.sample || 0) === 0 && (a.occ || 0) === 0 && (b.occ || 0) === 0) return;
        if (a.sample < minSample || b.sample < minSample) return; // 표본 부족 행 제외
        if (a.win == null || b.win == null) return;
        const delta = a.win - b.win;
        if (delta >= 0.01) improved++;
        else if (delta <= -0.01) worse++;
        else same++;
    });
    return { improved, worse, same };
}

// 상황 표 + 판정 불가 안내 — 기존 renderRow/표 JSX 그대로 추출
export function SituationTable({ rowDefs, statsA, statsB, statsOpp, compareOn, minSample, loading, error, t }) {
    const GREEN = T.green, RED = T.red;
    // Δ값 색: 좋은 방향(goodDir) 기준 개선 초록/악화 빨강, ±1pp 미만·방향 없음(null)은 회색
    const deltaColor = (dPP, goodDir) => {
        if (dPP == null || !goodDir || Math.abs(dPP) < 1) return T.sub;
        return (goodDir === 'higher' ? dPP > 0 : dPP < 0) ? GREEN : RED;
    };
    // 승률 방향색(R1): 50% 경계 기준 은은한 초록/빨강, 정확히 50%·값 없음은 중립.
    const winColor = (w) => (w == null || Math.abs(w - 0.5) < 0.005) ? T.text : w > 0.5 ? GREEN : RED;
    const fmtDelta = (dPP) => dPP == null ? '—' : `${dPP > 0 ? '+' : '−'}${Math.abs(dPP).toFixed(1)}${t.flUnitPp}`;

    // 형식 행: 상황 | 발생률 | Δ발생률(vs 상대) | 승률 | Δ승률(vs 상대) | 추세(vs 과거) | 표본 | 안정성 | 상태
    const renderRow = (def, idx) => {
        const a = statsA[def.key];
        const b = statsB ? statsB[def.key] : null;
        const o = statsOpp[def.key]; // 상대편의 대칭 상황 (같은 한타 셋)
        if (def.hideIfEmpty && (a?.sample || 0) === 0 && (b?.sample || 0) === 0 && (a?.occ || 0) === 0 && (b?.occ || 0) === 0) return null;
        const lowSample = (a.sample < minSample) || (compareOn && b && b.sample < minSample);
        // Δ열 = vs 상대 (기간 B와 무관)
        const dOcc = (a.occ != null && o && o.occ != null) ? (a.occ - o.occ) * 100 : null;
        const dWin = (a.win != null && o && o.win != null) ? (a.win - o.win) * 100 : null;
        // 추세 열 = vs 과거 (기존 계산 그대로)
        const trend = (compareOn && a.win != null && b && b.win != null) ? (a.win - b.win) * 100 : null;
        // 안정성(표시 규칙): 현재·과거 표본 모두 (최소 표본 × 4) 이상 = 안정, 아니면 변동
        const stable = a.sample >= minSample * 4 && (!compareOn || (b && b.sample >= minSample * 4));
        const td = { padding: '6px 12px', fontSize: '12px', textAlign: 'left', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' };
        const tipOcc = o ? `${t.flTipUs} ${pct(a.occ)} vs ${t.flTipOpp} ${pct(o.occ)}` : undefined;
        const tipWin = o ? `${t.flTipUs} ${pct(a.win)} vs ${t.flTipOpp} ${pct(o.win)}` : undefined;
        const tipTrend = compareOn && b ? `${t.flPastShort} ${pct(b.win)} → ${t.flRecentShort} ${pct(a.win)}` : undefined;
        return (
            <tr key={def.key} className="flb-row" style={{ borderBottom: `1px solid ${T.divider}`, opacity: lowSample ? 0.45 : 1 }}>
                <td style={{ ...td, paddingLeft: def.indent ? '28px' : '12px', color: def.indent ? T.sub : T.text }}>
                    {def.indent ? '└ ' : ''}{def.label}
                </td>
                <td style={td}>{pct(a.occ)}</td>
                <td title={tipOcc} style={{ ...td, color: deltaColor(dOcc, def.rateDir) }}>{fmtDelta(dOcc)}</td>
                <td style={{ ...td, color: winColor(a.win) }}>{pct(a.win)}</td>
                <td title={tipWin} style={{ ...td, color: deltaColor(dWin, 'higher') }}>{fmtDelta(dWin)}</td>
                {compareOn && (
                    <td title={tipTrend} style={{ ...td, color: deltaColor(trend, 'higher') }}>
                        {trend == null ? '—' : `${trend >= 1 ? '↑' : trend <= -1 ? '↓' : '→'} ${trend > 0 ? '+' : trend < 0 ? '−' : ''}${Math.abs(Math.round(trend))}${t.flUnitPp}`}
                    </td>
                )}
                <td title={compareOn && b ? `${t.flPastShort} ${b.sample}` : undefined} style={{ ...td, color: T.sub }}>{a.sample}</td>
                <td style={{ ...td, color: stable ? T.sub : T.yellow }}>{stable ? t.flStabStable : t.flStabVolatile}</td>
                <td style={{ ...td, color: lowSample ? T.yellow : T.sub }}>{lowSample ? t.flLowSample : t.flStatusOk}</td>
            </tr>
        );
    };

    return (
        <>
            <div className="mobile-scroll-hint" style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead style={{ background: T.header }}>
                        <tr>
                            {[
                                t.flColSituation, t.flColOccur, t.flColDOcc, t.flColWin, t.flColDWin,
                                ...(compareOn ? [t.flColTrend] : []),
                                t.flColSampleOne, t.flColStability, t.flColStatus,
                            ].map((h, i) => (
                                <th key={i} style={{ padding: '8px 12px', textAlign: 'left', fontSize: '12px', color: T.sub, whiteSpace: 'nowrap' }}>{h}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {loading && (
                            <tr><td colSpan="9" style={{ padding: '60px', textAlign: 'center', color: T.sub }}>{t.ffLoading}</td></tr>
                        )}
                        {!loading && error && (
                            <tr><td colSpan="9" style={{ padding: '60px', textAlign: 'center', color: T.sub }}>{t.ffError}</td></tr>
                        )}
                        {!loading && !error && rowDefs.map(renderRow)}
                    </tbody>
                </table>
            </div>
            {/* 판정 불가 한타 안내 */}
            {!loading && !error && (
                <p style={{ color: T.faint, fontSize: '11px', marginTop: '10px' }}>
                    {t.flUnknownNotePre}
                    {compareOn
                        ? `${t.flRecentShort} ${statsA._unknownCount}/${statsA._total} · ${t.flPastShort} ${statsB ? `${statsB._unknownCount}/${statsB._total}` : '-'}`
                        : `${statsA._unknownCount}/${statsA._total}`}
                    {t.flUnknownNotePost}
                </p>
            )}
        </>
    );
}

// 지표 설명 접이식 — 기존 JSX 그대로 추출(열림 상태는 내부 보관)
export function ExplainBox({ lines, t }) {
    const [open, setOpen] = useState(false);
    return (
        <div style={{ marginTop: '16px', border: `1px solid ${T.panelBorder}`, borderRadius: '6px', overflow: 'hidden' }}>
            <button onClick={() => setOpen(o => !o)}
                style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '6px', background: 'transparent', color: T.text, border: 'none', padding: '10px 14px', cursor: 'pointer', fontWeight: 400, fontSize: '13px' }}>
                {open ? <ChevronDown size={14} color={T.sub} /> : <ChevronRight size={14} color={T.sub} />} {t.flExplainTitle}
            </button>
            {open && (
                <ul style={{ margin: 0, padding: '4px 16px 14px 34px', color: T.sub, fontSize: '12px', lineHeight: 1.8 }}>
                    {lines.map((line, i) => <li key={i}>{line}</li>)}
                </ul>
            )}
        </div>
    );
}

// 서브탭 필 버튼 줄 (필형)
export function SubTabPills({ tabs, active, onChange }) {
    return (
        <div style={{ display: 'flex', gap: '6px', marginBottom: '14px' }}>
            {tabs.map(([k, label]) => (
                <button key={k} onClick={() => onChange(k)}
                    style={{
                        background: active === k ? T.pillRed : T.pillBg,
                        color: active === k ? '#fff' : T.sub,
                        border: 'none',
                        padding: '6px 16px', borderRadius: '6px', cursor: 'pointer', fontWeight: 500, fontSize: '13px',
                    }}>
                    {label}
                </button>
            ))}
        </div>
    );
}

// 상대 시점 안내 문구
export function PerspectiveNotice({ sc, t }) {
    if (sc.perspective !== 'them') return null;
    return (
        <p style={{ color: T.sub, fontSize: '12px', margin: '0 0 12px' }}>
            <span style={{ color: T.yellow }}>⚠</span> {t.flPerspNotice}
        </p>
    );
}

// 페이지 공통 셸: 배경 + 제목 + 사이드바 + 캡션/겹침 경고 + 본문
// hideMap/hideMinSample/opponentOnlyForThem: 맵 분석 탭용 사이드바 옵션(기본 false — 기존 사용처 무변경).
export function FightScopeShell({ title, desc, sc, t, captionRight, children, hideMap = false, hideMinSample = false, opponentOnlyForThem = false }) {
    const isMobile = useIsMobile();
    return (
        <div style={{ background: T.bg, minHeight: 'calc(100vh - 64px)', color: T.text }}>
        <style>{`.flb-row:hover{background:${T.hover} !important}`}</style>
        <div style={{ padding: isMobile ? '16px 12px' : '24px 36px', maxWidth: '1280px', margin: '0 auto' }}>
            <div style={{ marginBottom: '18px' }}>
                <h1 style={{ fontSize: '20px', fontWeight: 600, color: T.text, margin: 0 }}>{title}</h1>
                <p style={{ color: T.sub, marginTop: '6px', fontSize: '12px' }}>{desc}</p>
            </div>
            <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: isMobile ? '12px' : '20px', alignItems: isMobile ? 'stretch' : 'flex-start' }}>
                <ScopeSidebar sc={sc} t={t} hideMap={hideMap} hideMinSample={hideMinSample} opponentOnlyForThem={opponentOnlyForThem} />
                <main style={{ flex: 1, minWidth: 0 }}>
                    <ScopeCaption sc={sc} t={t} right={captionRight} hideMap={hideMap} />
                    {sc.overlap && (
                        <p style={{ color: T.yellow, fontSize: '12px', margin: '0 0 12px' }}>⚠ {t.flOverlapWarn}</p>
                    )}
                    {sc.presetA !== 'all' && sc.viewRecords.length > 0 && sc.recsA.length === 0 && (
                        <p style={{ color: T.yellow, fontSize: '12px', margin: '0 0 12px', display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                            <span>⚠ {(t.flNoDataInPeriod || '').replace('{date}', sc.lastSessionDate || '-')}</span>
                            <button type="button" onClick={sc.applyAllPeriod} style={{ fontSize: '11px', padding: '2px 8px', background: 'transparent', color: T.text, border: `1px solid ${T.inputBorder}`, borderRadius: '4px', cursor: 'pointer' }}>{t.flShowAllPeriod}</button>
                        </p>
                    )}
                    {children}
                </main>
            </div>
        </div>
        </div>
    );
}

// ═══ 한타 분석 (베타) — [교전] [선수] 서브탭만 (궁극기 관련은 '궁극기 분석' 탭으로 이동) ═══
export default function FightLabStats() {
    const { t } = useLanguage();

    const [data, setData] = useState(null); // { meta, records }
    const [pfs, setPfs] = useState(null);   // { meta, items } — [선수] 서브탭 전용
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const [subTab, setSubTab] = useState('fights'); // 'fights' | 'players'

    useEffect(() => {
        let alive = true;
        (async () => {
            try {
                const d = await fetchCached(`${API_BASE}/api/fight-records`);
                if (alive) setData(d || null);
                const d2 = await fetchCached(`${API_BASE}/api/player-fight-stats`);
                if (alive) setPfs(d2 || null);
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

    const statsA = useMemo(() => buildEngageStats(sc.recsNow), [sc.recsNow]);
    const statsB = useMemo(() => (sc.compareOn ? buildEngageStats(sc.recsB) : null), [sc.compareOn, sc.recsB]);
    // Δ(vs 상대): 현재 표와 동일한 한타들을 flipRecord(검증된 대칭 매핑)로 뒤집어 같은 집계에 태움.
    const statsOpp = useMemo(() => buildEngageStats(sc.recsNow.map(flipRecord)), [sc.recsNow]);

    // 행 정의: rateDir = 발생률의 "좋은 방향" ('higher'|'lower'|null=중립)
    const rowDefs = subTab !== 'fights' ? [] : [
        { key: 'firstPick', label: t.flRowFirstPick, rateDir: 'higher' },
        { key: 'firstDeath', label: t.flRowFirstDeath, rateDir: 'lower' },
        { key: 'fdTank', label: t.flRowFdTank, rateDir: 'lower', indent: true },
        { key: 'fdDamage', label: t.flRowFdDamage, rateDir: 'lower', indent: true },
        { key: 'fdSupport', label: t.flRowFdSupport, rateDir: 'lower', indent: true },
        { key: 'fdOther', label: t.flRowFdOther, rateDir: 'lower', indent: true, hideIfEmpty: true },
        { key: 'fkTraded', label: t.flRowFkTraded, rateDir: 'lower' },
        { key: 'fdTraded', label: t.flRowFdTraded, rateDir: 'higher' },
    ];

    const ACCENT = T.purple, GREEN = T.green, RED = T.red;
    const verdict = (subTab === 'fights' && sc.compareOn && statsB) ? computeVerdict(rowDefs, statsA, statsB, sc.minSample) : null;

    const explains = subTab === 'fights'
        ? [t.flExpSidebar, t.flExpWinner, t.flExpTwoCols, t.flExpOccur, t.flExpFirstPick, t.flExpFirstDeath, t.flExpFdRole, t.flExpFkTraded, t.flExpFdTraded, t.flExpTrend, t.flExpStability, t.flExpSample]
        : [t.flExpSidebar, t.flPbExpSrc, t.flPbExpFights, t.flPbExpKp, t.flPbExpFkFd, t.flPbExpAxes, t.flPbExpSignals, t.flPbExpPool, t.flPbExpHeal, t.flPbExpLb];

    return (
        <FightScopeShell title={t.flTitle} desc={t.flDesc} sc={sc} t={t} opponentOnlyForThem
            captionRight={!loading && !error ? <VerdictChip verdict={verdict} t={t} /> : null}>
            <SubTabPills tabs={[['fights', t.flTabFights], ['players', t.flTabPlayers]]} active={subTab} onChange={setSubTab} />
            <PerspectiveNotice sc={sc} t={t} />

            {/* [선수] 서브탭 */}
            {subTab === 'players' && !loading && !error && (
                <PlayerBreakdown
                    pfs={pfs} rangeA={sc.rangeA} rangeB={sc.rangeB} compareOn={sc.compareOn}
                    minSample={sc.minSample} perspective={sc.perspective}
                    selectedMap={sc.selectedMap} selectedOpponent={sc.selectedOpponent}
                    t={t} GREEN={GREEN} RED={RED} ACCENT={ACCENT}
                />
            )}
            {subTab === 'players' && loading && (
                <div style={{ padding: '60px', textAlign: 'center', color: T.sub }}>{t.ffLoading}</div>
            )}

            {/* [교전] 상황 표 */}
            {subTab === 'fights' && (
                <SituationTable rowDefs={rowDefs} statsA={statsA} statsB={statsB} statsOpp={statsOpp}
                    compareOn={sc.compareOn} minSample={sc.minSample} loading={loading} error={error} t={t} />
            )}

            <ExplainBox lines={explains} t={t} />
        </FightScopeShell>
    );
}
