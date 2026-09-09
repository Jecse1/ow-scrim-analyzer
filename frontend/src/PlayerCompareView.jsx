import React, { useState, useMemo, useEffect } from 'react';
import { Users, Search, Crosshair, Zap, Sword, PlusCircle, Trophy, X, GitCompareArrows, Shield, Target } from 'lucide-react';
import {
    RadarChart, Radar, PolarGrid, PolarAngleAxis, ResponsiveContainer, Tooltip, Legend
} from 'recharts';
import { useTheme } from "./ThemeContext";
import { useLanguage } from "./LanguageContext";
import { useIsMobile } from "./utils/responsive";
import { getHeroImageSrc, getDisplayName } from "./gameData";

// [STEP3] 이미지 리졸버는 gameData.getHeroImageSrc(SSOT image 필드 기반)로 통합·임포트.
const getRoleIconSrc = (roleLabel) => {
    if (roleLabel === '탱크' || roleLabel === '탱커') return '/roles/tank.png';
    if (roleLabel === '딜러') return '/roles/damage.png';
    if (roleLabel === '지원' || roleLabel === '힐러') return '/roles/support.png';
    return null;
};

const PLAYER_COLORS = ['#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#a855f7'];
// 6명 이상이면 골든앵글(137.5°)로 색상(hue)을 벌려 자동 생성 → 중복 없이 무제한 선택 가능
const colorForIndex = (i) => i < PLAYER_COLORS.length ? PLAYER_COLORS[i] : `hsl(${Math.round((i * 137.508) % 360)}, 65%, 55%)`;

export default function PlayerCompareView({ playersData }) {
    const { theme } = useTheme();
    const { t } = useLanguage();
    const isMobile = useIsMobile();
    const roleLabelDisplay = (role) => (role === '탱크' || role === '탱커') ? t.tank : role === '딜러' ? t.dps : (role === '지원' || role === '힐러') ? t.support : role;

    const [searchTerm, setSearchTerm] = useState("");
    const [selectedTeam, setSelectedTeam] = useState("All");
    const [selectedRole, setSelectedRole] = useState("All");
    const [selectedIds, setSelectedIds] = useState([]);
    // 비교 범위: 'all'(종합) 또는 특정 영웅 이름
    const [compareHero, setCompareHero] = useState('all');

    const filteredPlayers = useMemo(() => {
        if (!playersData) return [];
        return playersData.filter(p => {
            const matchName = p.name.toLowerCase().includes(searchTerm.toLowerCase());
            const matchTeam = selectedTeam === "All" || p.team === selectedTeam;
            const matchRole = selectedRole === "All" || p.role === selectedRole;
            return matchName && matchTeam && matchRole;
        });
    }, [playersData, searchTerm, selectedTeam, selectedRole]);

    const teamList = useMemo(() => {
        if (!playersData) return ["All"];
        const teams = new Set(playersData.map(p => p.team));
        return ["All", ...Array.from(teams).filter(Boolean)];
    }, [playersData]);

    // 선택된 선수 객체 (선택 순서 유지 → 색상 일관성)
    const selectedPlayers = useMemo(() => {
        return selectedIds
            .map(id => playersData?.find(p => p.id === id))
            .filter(Boolean);
    }, [selectedIds, playersData]);

    const togglePlayer = (id) => {
        setSelectedIds(prev => {
            if (prev.includes(id)) return prev.filter(x => x !== id);
            return [...prev, id];
        });
    };

    // 선택된 선수들의 영웅 합집합 (플레이 시간 합 기준 정렬)
    const heroUnion = useMemo(() => {
        const map = {};
        selectedPlayers.forEach(p => {
            (p.heroPool || []).forEach(h => {
                map[h.hero] = (map[h.hero] || 0) + (h.playTime || 0);
            });
        });
        return Object.entries(map).sort((a, b) => b[1] - a[1]).map(([hero]) => hero);
    }, [selectedPlayers]);

    // 선택한 영웅이 더 이상 선택 선수들의 영웅 풀에 없으면 '전체'로 복귀
    useEffect(() => {
        if (compareHero !== 'all' && !heroUnion.includes(compareHero)) setCompareHero('all');
    }, [heroUnion, compareHero]);

    const colorOf = (id) => {
        const i = selectedIds.indexOf(id);
        return i < 0 ? theme.border : colorForIndex(i);
    };

    // 초 → "M:SS" 또는 "N초"
    const fmtSec = (s) => s >= 60 ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : `${Math.round(s)}${t.pcSecUnit}`;
    const statOf = (p, hero) => (p.heroPool || []).find(h => h.hero === hero) || null;

    // 보조 지표는 역할별로 다르게: 탱커 → 10분당 경감, 지원 → 10분당 힐, 딜러 → 10분당 결정타
    const secType = (p) => (p.role === '탱크' || p.role === '탱커') ? 'mitig'
        : (p.role === '지원' || p.role === '힐러') ? 'heal' : 'fb';
    const SEC = {
        mitig: { val: p => Number(p.overview.mitigatedPer10), label: t.pcMetricMitig, tag: t.pcTagMitig, icon: Shield },
        heal: { val: p => Number(p.overview.healPer10), label: t.pcMetricHeal, tag: t.pcTagHeal, icon: PlusCircle },
        fb: { val: p => Number(p.overview.fbPer10), label: t.pcMetricFb, tag: t.pcTagFb, icon: Target },
    };
    const secTypeSet = new Set(selectedPlayers.map(secType));
    const uniformSecType = secTypeSet.size === 1 ? [...secTypeSet][0] : null;
    const secondaryLabel = uniformSecType ? SEC[uniformSecType].label : t.pcMetricSecondaryMixed;
    const secondaryIcon = uniformSecType ? SEC[uniformSecType].icon : PlusCircle;
    const isMixedSecondary = secTypeSet.size > 1;

    // 종합(전체) 지표. get → 숫자, group: 트로피를 같은 그룹끼리만 비교, cellNote: 셀 보조 텍스트
    const overallMetrics = [
        { key: 'winRate', label: t.pcMetricWinRate, icon: Trophy, get: p => Number(p.overview.winRate), fmt: v => `${v}%`, radar: true },
        { key: 'kd', label: t.pcMetricKd, icon: Crosshair, get: p => Number(p.overview.kd), fmt: v => v.toFixed(2), radar: true },
        { key: 'damagePer10', label: t.pcMetricDmg, icon: Sword, get: p => Number(p.overview.damagePer10), fmt: v => v.toLocaleString(), radar: true },
        {
            key: 'secondary', label: secondaryLabel, icon: secondaryIcon, radar: true,
            get: p => SEC[secType(p)].val(p),
            fmt: v => v.toLocaleString(),
            group: p => secType(p),
            cellNote: p => isMixedSecondary ? SEC[secType(p)].tag : null,
        },
        { key: 'ultUsedPerMatch', label: t.pcMetricUlt, icon: Zap, get: p => Number(p.overview.ultUsedPerMatch), fmt: v => v.toFixed(1), radar: true },
    ];

    // 특정 영웅 지표. get → 숫자|null(미플레이/표본없음). lower: 작을수록 좋음
    const heroMetricsFor = (hero) => [
        { key: 'winRate', label: t.pcMetricWinRate, icon: Trophy, get: p => { const s = statOf(p, hero); return s ? Number(s.winRate) : null; }, fmt: v => `${v}%`, color: v => v >= 50 ? theme.success : theme.danger, radar: true },
        { key: 'kd', label: t.pcMetricKd, icon: Crosshair, get: p => { const s = statOf(p, hero); return s ? Number(s.kd) : null; }, fmt: v => v.toFixed(2), radar: true },
        { key: 'ultEff', label: t.pcHeroUltEff, icon: Target, get: p => { const s = statOf(p, hero); return s && s.ultEff != null ? Number(s.ultEff) : null; }, fmt: v => v.toFixed(2), cellNote: p => { const s = statOf(p, hero); return s && s.ultUses ? `${s.ultUses}${t.pcHeroUltUses}` : null; }, radar: true },
        { key: 'ultWinRate', label: t.pcHeroUltWin, icon: Zap, get: p => { const s = statOf(p, hero); return s && s.ultWinRate != null ? Number(s.ultWinRate) : null; }, fmt: v => `${v}%`, color: v => v >= 50 ? theme.success : theme.danger, cellNote: p => { const s = statOf(p, hero); return s && s.ultFights ? `${s.ultFights}${t.pcHeroUltGames}` : null; }, radar: true },
        { key: 'ultChargeSec', label: t.pcHeroUltCharge, icon: Zap, lower: true, get: p => { const s = statOf(p, hero); return s && s.ultChargeSec != null ? Number(s.ultChargeSec) : null; }, fmt: fmtSec },
        { key: 'impactPer10', label: t.pcHeroImpact, icon: Sword, get: p => { const s = statOf(p, hero); return s ? Number(s.impactPer10) : null; }, fmt: v => v.toFixed(1), radar: true },
        { key: 'playTime', label: t.pcHeroPlayTime, get: p => { const s = statOf(p, hero); return s ? Math.round((s.playTime || 0) / 60) : null; }, fmt: v => `${v}${t.pcMin}`, noBest: true },
    ];

    const activeMetrics = compareHero === 'all' ? overallMetrics : heroMetricsFor(compareHero);
    const groupOf = (m, p) => m.group ? m.group(p) : 'all';

    // 지표별·그룹별 최고값 선수 id (null 제외, lower면 최솟값)
    const bestByMetric = useMemo(() => {
        const out = {};
        activeMetrics.forEach(m => {
            if (m.noBest) { out[m.key] = {}; return; }
            const perGroup = {}; // group -> { id, val, count }
            selectedPlayers.forEach(p => {
                const v = m.get(p);
                if (v == null) return;
                const g = groupOf(m, p);
                if (!perGroup[g]) perGroup[g] = { id: p.id, val: v, count: 1 };
                else {
                    perGroup[g].count += 1;
                    const better = m.lower ? v < perGroup[g].val : v > perGroup[g].val;
                    if (better) { perGroup[g].val = v; perGroup[g].id = p.id; }
                }
            });
            out[m.key] = perGroup;
        });
        return out;
    }, [selectedPlayers, compareHero]);

    // 레이더 차트 데이터 (활성 범위 지표 기준, 지표별 전체 최고값 기준 100% 정규화)
    // null(미플레이/표본없음)은 0으로 환산, raw 표시는 '–'
    const radarData = useMemo(() => {
        return activeMetrics.filter(m => m.radar).map(m => {
            const max = Math.max(0, ...selectedPlayers.map(p => { const v = m.get(p); return v == null ? 0 : v; }));
            const row = { metric: m.label };
            selectedPlayers.forEach(p => {
                const v = m.get(p);
                const num = v == null ? 0 : v;
                row[p.id] = max > 0 ? Math.round((num / max) * 100) : 0;
                row[`__raw_${p.id}`] = v == null ? '–' : m.fmt(v); // 실제값을 각 지표 포맷으로 표시
            });
            return row;
        });
    }, [selectedPlayers, compareHero]);

    if (!playersData || playersData.length === 0) {
        return <div style={{ padding: '60px', textAlign: 'center', color: theme.textSub }}>{t.ppNoPlayers}</div>;
    }

    const cardStyle = { background: theme.surface, borderRadius: '16px', border: `1px solid ${theme.border}`, padding: '24px' };

    return (
        <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: isMobile ? '16px' : '32px', alignItems: isMobile ? 'stretch' : 'flex-start', width: '100%', maxWidth: '1600px', margin: '0 auto', color: theme.text }}>

            {/* ⬅️ 왼쪽 사이드바: 선수 선택 (체크박스 다중선택) — 모바일은 상단 전체폭 */}
            <div style={{ width: isMobile ? '100%' : '280px', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div>
                    <h2 style={{ fontSize: '18px', fontWeight: '900', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Users size={20} /> {t.pcRosterTitle}
                    </h2>
                    <div style={{ fontSize: '12px', color: theme.textSub, marginTop: '6px' }}>
                        {t.pcSelectHint} · <strong style={{ color: theme.text }}>{selectedIds.length}</strong>{t.pcSelectedCount}
                    </div>
                </div>

                <div style={{ position: 'relative' }}>
                    <input
                        type="text"
                        placeholder={t.ppSearchPlaceholder}
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        style={{ width: '100%', padding: '10px 10px 10px 36px', borderRadius: '8px', border: `1px solid ${theme.border}`, background: theme.surface, color: theme.text, boxSizing: 'border-box', outline: 'none' }}
                    />
                    <Search size={16} color={theme.textSub} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)' }} />
                </div>

                <select
                    value={selectedTeam}
                    onChange={(e) => setSelectedTeam(e.target.value)}
                    style={{ width: '100%', padding: '10px', borderRadius: '8px', border: `1px solid ${theme.border}`, background: theme.surface, color: theme.text, outline: 'none', cursor: 'pointer' }}
                >
                    <option value="All">{t.allTeams}</option>
                    {teamList.filter(tm => tm !== "All").map(tm => <option key={tm} value={tm}>{tm}</option>)}
                </select>

                <div style={{ display: 'flex', gap: '4px', background: theme.surface, padding: '4px', borderRadius: '8px', border: `1px solid ${theme.border}` }}>
                    {['All', '탱크', '딜러', '지원'].map(role => (
                        <button key={role} onClick={() => setSelectedRole(role)}
                            style={{ flex: 1, padding: '8px 0', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '12px', background: selectedRole === role ? '#3b82f6' : 'transparent', color: selectedRole === role ? '#fff' : theme.textSub, transition: 'all 0.2s', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                            {role !== 'All' && <img src={getRoleIconSrc(role)} alt={role} style={{ width: 14, height: 14, filter: 'invert(1)', opacity: selectedRole === role ? 1 : 0.6 }} />}
                            {role === 'All' ? t.all : roleLabelDisplay(role)}
                        </button>
                    ))}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', overflowY: 'auto', maxHeight: isMobile ? '42vh' : 'calc(100vh - 320px)', paddingRight: '4px' }}>
                    {filteredPlayers.map(p => {
                        const isActive = selectedIds.includes(p.id);
                        const accent = isActive ? colorOf(p.id) : theme.border;
                        return (
                            <div key={p.id} onClick={() => togglePlayer(p.id)}
                                style={{ padding: '12px', borderRadius: '12px', cursor: 'pointer', background: isActive ? theme.surfaceHighlight : theme.surface, border: `1px solid ${accent}`, display: 'flex', alignItems: 'center', gap: '12px', transition: 'all 0.2s' }}>
                                <div style={{ width: 18, height: 18, flexShrink: 0, borderRadius: '5px', border: `2px solid ${isActive ? colorOf(p.id) : theme.textSub}`, background: isActive ? colorOf(p.id) : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    {isActive && <span style={{ color: '#fff', fontSize: '12px', fontWeight: 900, lineHeight: 1 }}>✓</span>}
                                </div>
                                <div style={{ width: 32, height: 32, borderRadius: '50%', background: theme.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                    <img src={getRoleIconSrc(p.role)} alt={p.role} style={{ width: 18, height: 18, filter: 'invert(1)', opacity: isActive ? 1 : 0.5 }} />
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                                    <span style={{ fontWeight: '900', fontSize: '15px', color: isActive ? colorOf(p.id) : theme.text }}>{p.name}</span>
                                    <span style={{ fontSize: '11px', color: theme.textSub, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.team} · {roleLabelDisplay(p.role)}</span>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* ➡️ 오른쪽 메인: 비교 결과 */}
            {selectedPlayers.length < 2 ? (
                <div style={{ flex: 1, minHeight: '400px', display: 'flex', flexDirection: 'column', gap: '16px', alignItems: 'center', justifyContent: 'center', color: theme.textSub, background: theme.surface, borderRadius: '16px', border: `1px dashed ${theme.border}` }}>
                    <GitCompareArrows size={40} opacity={0.5} />
                    {t.pcSelectPrompt}
                </div>
            ) : (
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '24px' }}>

                    {/* 선택된 선수 칩 */}
                    <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', paddingBottom: '16px', borderBottom: `1px solid ${theme.border}` }}>
                        {selectedPlayers.map(p => (
                            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 14px', borderRadius: '999px', background: theme.surface, border: `2px solid ${colorOf(p.id)}` }}>
                                <span style={{ width: 10, height: 10, borderRadius: '50%', background: colorOf(p.id) }} />
                                <span style={{ fontWeight: '900', fontSize: '15px' }}>{p.name}</span>
                                <span style={{ fontSize: '11px', color: theme.textSub }}>{p.team}</span>
                                <button onClick={() => togglePlayer(p.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: theme.textSub, display: 'flex', padding: 0 }}><X size={15} /></button>
                            </div>
                        ))}
                    </div>

                    {/* 통합 비교 (범위: 전체 / 영웅별) */}
                    <div style={cardStyle}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px', marginBottom: '20px' }}>
                            <h3 style={{ fontSize: '16px', fontWeight: '900', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <GitCompareArrows size={18} /> {t.pcMetricCompare}
                                {compareHero !== 'all' && (
                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', marginLeft: '2px' }}>
                                        <img src={getHeroImageSrc(compareHero)} alt={compareHero} style={{ width: 24, height: 24, borderRadius: '6px', background: '#000' }} onError={e => e.currentTarget.style.display = 'none'} />
                                        <span style={{ fontSize: '14px', color: theme.textSub }}>{getDisplayName(compareHero)}</span>
                                    </span>
                                )}
                            </h3>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span style={{ fontSize: '12px', color: theme.textSub }}>{t.pcScopeLabel}</span>
                                <select value={compareHero} onChange={e => setCompareHero(e.target.value)}
                                    style={{ padding: '8px 12px', borderRadius: '8px', border: `1px solid ${theme.border}`, background: theme.bg, color: theme.text, outline: 'none', cursor: 'pointer', fontWeight: 'bold' }}>
                                    <option value="all">{t.pcScopeAll}</option>
                                    {heroUnion.map(h => <option key={h} value={h}>{getDisplayName(h)}</option>)}
                                </select>
                            </div>
                        </div>
                        <div className="mobile-scroll-hint" style={{ overflowX: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
                                <thead>
                                    <tr>
                                        <th style={{ textAlign: 'left', padding: '10px 12px', color: theme.textSub, fontWeight: 600, fontSize: '12px', borderBottom: `1px solid ${theme.border}` }}></th>
                                        {selectedPlayers.map(p => (
                                            <th key={p.id} style={{ textAlign: 'center', padding: '10px 12px', borderBottom: `1px solid ${theme.border}`, color: colorOf(p.id), fontWeight: 900, minWidth: '110px' }}>{p.name}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {activeMetrics.map(m => {
                                        const Icon = m.icon;
                                        return (
                                            <tr key={m.key}>
                                                <td style={{ padding: '12px', color: theme.textSub, borderBottom: `1px solid ${theme.border}`, whiteSpace: 'nowrap' }}>
                                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>{Icon && <Icon size={14} />} {m.label}</span>
                                                </td>
                                                {selectedPlayers.map(p => {
                                                    const v = m.get(p);
                                                    const grp = bestByMetric[m.key]?.[groupOf(m, p)];
                                                    const isBest = grp && p.id === grp.id && grp.count > 1 && v != null && v > 0;
                                                    const note = m.cellNote ? m.cellNote(p) : null;
                                                    return (
                                                        <td key={p.id} style={{ textAlign: 'center', padding: '12px', borderBottom: `1px solid ${theme.border}`, background: isBest ? `${colorOf(p.id)}18` : 'transparent' }}>
                                                            {v == null ? (
                                                                <span style={{ fontWeight: 700, fontSize: '14px', color: theme.textSub }}>–</span>
                                                            ) : (
                                                                <span style={{ fontWeight: isBest ? 900 : 600, fontSize: isBest ? '16px' : '15px', color: isBest ? colorOf(p.id) : (m.color ? m.color(v) : theme.text), display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                                                                    {m.fmt(v)}
                                                                    {isBest && <Trophy size={13} />}
                                                                </span>
                                                            )}
                                                            {note && <div style={{ fontSize: '10px', color: theme.textSub, marginTop: '2px' }}>{note}</div>}
                                                        </td>
                                                    );
                                                })}
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* 레이더 차트 (전체/영웅별 범위 모두) */}
                    {radarData.length > 0 && (
                        <div style={cardStyle}>
                            <h3 style={{ fontSize: '16px', fontWeight: '900', margin: '0 0 4px 0', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <Zap size={18} /> {t.pcRadarTitle}
                                {compareHero !== 'all' && (
                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                                        <img src={getHeroImageSrc(compareHero)} alt={compareHero} style={{ width: 22, height: 22, borderRadius: '6px', background: '#000' }} onError={e => e.currentTarget.style.display = 'none'} />
                                        <span style={{ fontSize: '14px', color: theme.textSub }}>{getDisplayName(compareHero)}</span>
                                    </span>
                                )}
                            </h3>
                            <div style={{ fontSize: '11px', color: theme.textSub, marginBottom: '16px' }}>{t.pcRadarHint}</div>
                            <div style={{ width: '100%', height: 380 }}>
                                <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                                    <RadarChart data={radarData} outerRadius="72%">
                                        <PolarGrid stroke={theme.border} />
                                        <PolarAngleAxis dataKey="metric" tick={{ fill: theme.textSub, fontSize: 12 }} />
                                        {selectedPlayers.map(p => (
                                            <Radar key={p.id} name={p.name} dataKey={p.id} stroke={colorOf(p.id)} fill={colorOf(p.id)} fillOpacity={0.15} strokeWidth={2} />
                                        ))}
                                        <Legend wrapperStyle={{ fontSize: '13px', paddingTop: '12px' }} />
                                        <Tooltip
                                            contentStyle={{ backgroundColor: theme.surface, border: `1px solid ${theme.border}`, borderRadius: '8px', color: theme.text, fontSize: '12px' }}
                                            formatter={(val, name, props) => {
                                                const raw = props?.payload?.[`__raw_${props.dataKey}`];
                                                return [raw !== undefined ? raw : val, name];
                                            }}
                                        />
                                    </RadarChart>
                                </ResponsiveContainer>
                            </div>
                        </div>
                    )}

                </div>
            )}
        </div>
    );
}
