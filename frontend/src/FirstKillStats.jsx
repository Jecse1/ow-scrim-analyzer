import React, { useState, useMemo } from 'react';
import { Shield, Sword, PlusCircle, Crosshair, ArrowUpDown, Calendar, ChevronDown, ChevronUp, Users } from 'lucide-react';
import { useTheme } from "./ThemeContext";
import { useLanguage } from "./LanguageContext";
import { useIsMobile, ScrollX } from "./utils/responsive";
import { getDisplayName, HERO_SKILL_MAP, getHeroImageSrc, TANK_HEROES, SUPPORT_HEROES } from "./gameData";
import { BASE_TEAM } from "./config";

const normalizeName = (name) => (name ? name.trim() : "");

// 우리 팀(기준 팀). 랭킹에서 우리 팀 선수 행을 구분 표시한다.
const OUR_TEAM = BASE_TEAM;
// R2: 비율(첫킬률)의 표본 = 참여 한타 수. 이 값 미만은 흐림 + 랭킹 후순위(하단 분리).
// totalFights는 스케일이 커(주전 수천) 앱 기본값 5로는 무의미 → 이 화면 전용 임계값.
const MIN_FIGHTS = 30;


// [i18n] 표시명은 gameData.getDisplayName(단일 함수)로 통일 — 로컬 별칭맵/헬퍼 제거.

const getRoleInfo = (heroName) => {
    const name = getDisplayName(heroName);
    const tanks = TANK_HEROES;
    const supports = SUPPORT_HEROES;
    if (tanks.includes(name)) return { label: '탱커', order: 1 };
    if (supports.includes(name)) return { label: '힐러', order: 3 };
    return { label: '딜러', order: 2 };
};

const getRoleIconSrc = (roleLabel) => {
    if (roleLabel === '탱커' || roleLabel === '탱크') return '/roles/tank.png';
    if (roleLabel === '딜러') return '/roles/damage.png';
    if (roleLabel === '힐러' || roleLabel === '지원') return '/roles/support.png';
    return null;
};

// [STEP3] 이미지 리졸버는 gameData.getHeroImageSrc(SSOT image 필드 기반)로 통합·임포트.

// 💡 전체 스킬 풀

const getAbilityName = (heroName, abilityRaw) => {
    if (!abilityRaw) return "기본 발사";
    const cleanAbility = String(abilityRaw).trim();
    if (cleanAbility === '0' || cleanAbility === 'null') return '기본 발사';
    if (cleanAbility.toLowerCase().includes('primary')) return '기본 발사';
    if (cleanAbility.toLowerCase().includes('secondary')) return '보조 발사';
    if (cleanAbility.toLowerCase().includes('melee')) return '근접 공격';
    
    const displayHero = getDisplayName(heroName);
    let skillName = cleanAbility;
    
    if (HERO_SKILL_MAP[displayHero] && HERO_SKILL_MAP[displayHero][cleanAbility]) {
        skillName = HERO_SKILL_MAP[displayHero][cleanAbility];
    } else if (HERO_SKILL_MAP[heroName] && HERO_SKILL_MAP[heroName][cleanAbility]) {
        skillName = HERO_SKILL_MAP[heroName][cleanAbility];
    }
    
    if (cleanAbility === 'Ability 1') return skillName === 'Ability 1' ? '기술 1 (Shift)' : `${skillName} (Shift)`;
    if (cleanAbility === 'Ability 2') return skillName === 'Ability 2' ? '기술 2 (E)' : `${skillName} (E)`;
    if (cleanAbility === 'Ultimate') return skillName === 'Ultimate' ? '궁극기 (Q)' : `${skillName} (Q)`;
    
    return skillName;
};

const getTopN = (arr, key, n = 5) => {
    const counts = {};
    arr.forEach(item => {
        const val = item[key];
        if (val) counts[val] = (counts[val] || 0) + 1;
    });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, n).map(([name, count]) => ({ name, count }));
};

export default function FirstKillStats({ allScrims }) {
    const { theme } = useTheme();
    const { t } = useLanguage();
    const isMobile = useIsMobile();
    const roleLabelDisplay = (role) => role === '탱커' ? t.tank : role === '딜러' ? t.dps : role === '힐러' ? t.support : role;
    const [selectedRole, setSelectedRole] = useState('All');
    const [sortConfig, setSortConfig] = useState({ key: 'rate', direction: 'desc' });
    const [startDate, setStartDate] = useState("");
    const [endDate, setEndDate] = useState("");
    const [expandedPlayer, setExpandedPlayer] = useState(null);
    
    const [selectedMyTeam, setSelectedMyTeam] = useState('All');
    const [selectedEnemyTeam, setSelectedEnemyTeam] = useState('All');

    const teamList = useMemo(() => {
        const teams = new Set();
        if (!allScrims) return [];
        allScrims.forEach(s => s.matches?.forEach(m => m.stats?.forEach(p => p.team_name && teams.add(p.team_name))));
        return Array.from(teams);
    }, [allScrims]);

    const filteredScrims = useMemo(() => {
        if (!allScrims) return [];
        return allScrims.filter(scrim => {
            if (!scrim.date) return true;
            const sDate = new Date(scrim.date);
            if (startDate && new Date(startDate) > sDate) return false;
            if (endDate && new Date(endDate) < sDate) return false;
            return true;
        });
    }, [allScrims, startDate, endDate]);

    const playerStats = useMemo(() => {
        const pMap = {};

        if (!filteredScrims || filteredScrims.length === 0) return [];

        filteredScrims.forEach(scrim => {
            const matches = scrim.matches || [];
            
            matches.forEach(match => {
                const teamsInMatch = new Set((match.stats || []).map(s => s.team_name).filter(Boolean));
                if (selectedMyTeam !== 'All' && !teamsInMatch.has(selectedMyTeam)) return;
                if (selectedEnemyTeam !== 'All' && !teamsInMatch.has(selectedEnemyTeam)) return;

                const rounds = match.rounds || [];
                const matchEvents = rounds.flatMap(r => r.events || []).sort((a,b) => a.timestamp - b.timestamp);
                
                const fights = [];
                let curF = null;
                matchEvents.forEach(ev => {
                    if (ev.event_type !== 'kill' && ev.event_type !== 'ultimate_start') return;
                    if (!curF || ev.timestamp > curF.fixedEndTime) {
                        if (curF) fights.push(curF);
                        curF = { startTime: ev.timestamp, fixedEndTime: ev.timestamp + 20, first_kill_event: null };
                    }
                    if (ev.event_type === 'kill' && !curF.first_kill_event) {
                        curF.first_kill_event = ev;
                    }
                });
                if (curF) fights.push(curF);

                const matchFightsCount = fights.length;

                (match.stats || []).forEach(p => {
                    const name = normalizeName(p.player_name);
                    if (!name || name === "Unknown") return;

                    if (selectedMyTeam !== 'All' && p.team_name !== selectedMyTeam) return;

                    if (!pMap[name]) {
                        const roleData = getRoleInfo(p.hero_name);
                        pMap[name] = {
                            name, hero: p.hero_name, roleLabel: roleData.label, roleOrder: roleData.order,
                            team: (p.team_name || "").trim(), totalFights: 0, firstKills: 0, killLogs: []
                        };
                    }
                    pMap[name].totalFights += matchFightsCount;
                });

                fights.forEach(f => {
                    if (f.first_kill_event) {
                        const ev = f.first_kill_event;
                        const name = normalizeName(ev.player_name);
                        if (pMap[name]) {
                            pMap[name].firstKills += 1;
                            pMap[name].killLogs.push({
                                targetName: normalizeName(ev.target_name),
                                targetHero: ev.target_hero,
                                // 💡 스킬명|희생자이름|희생자영웅 순서로 저장
                                detailedSkill: `${getAbilityName(ev.player_hero, ev.ability)}|${normalizeName(ev.target_name)}|${ev.target_hero}`
                            });
                        }
                    }
                });
            });
        });

        return Object.values(pMap).filter(p => p.totalFights > 0);
    }, [filteredScrims, selectedMyTeam, selectedEnemyTeam]);

    const sortedData = useMemo(() => {
        let filtered = playerStats;
        if (selectedRole !== 'All') filtered = playerStats.filter(p => p.roleLabel === selectedRole);

        const sorted = [...filtered].sort((a, b) => {
            let valA = a[sortConfig.key];
            let valB = b[sortConfig.key];
            if (sortConfig.key === 'rate') {
                valA = a.totalFights > 0 ? (a.firstKills / a.totalFights) : 0;
                valB = b.totalFights > 0 ? (b.firstKills / b.totalFights) : 0;
            }
            if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
            if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
            return 0;
        });
        // R2: 표본(참여 한타) 미달 선수는 정렬 결과 유지한 채 하단으로 분리(극소표본이 상위 오염 방지).
        return [
            ...sorted.filter(p => p.totalFights >= MIN_FIGHTS),
            ...sorted.filter(p => p.totalFights < MIN_FIGHTS),
        ];
    }, [playerStats, selectedRole, sortConfig]);

    const handleSort = (key) => setSortConfig(prev => ({ key, direction: prev.key === key && prev.direction === 'desc' ? 'asc' : 'desc' }));
    const toggleExpand = (playerName) => setExpandedPlayer(expandedPlayer === playerName ? null : playerName);

    const SUCCESS_COLOR = "#10b981";
    const selectStyle = { background: theme.bg, color: theme.text, border: `1px solid ${theme.borderHighlight}`, padding: '8px 12px', borderRadius: '8px', outline: 'none', fontSize: '13px', fontWeight: 'bold', cursor: 'pointer' };

    return (
        <div style={{ padding: isMobile ? '20px 12px' : '40px', maxWidth: '1200px', margin: '0 auto', color: theme.text }}>
            <div style={{ marginBottom: isMobile ? '20px' : '32px' }}>
                <h1 style={{ fontSize: isMobile ? '24px' : '32px', fontWeight: '900', display: 'flex', alignItems: 'center', gap: isMobile ? '10px' : '12px' }}>
                    <Crosshair size={isMobile ? 26 : 36} color={SUCCESS_COLOR} /> {t.fkTitle}
                </h1>
                <p style={{ color: theme.textSub, marginTop: '8px', fontSize: isMobile ? '13px' : undefined }}>{t.fkDesc}</p>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '24px', flexWrap: 'wrap', gap: '16px' }}>
                <div style={{ display: 'flex', gap: '10px' }}>
                    {['All', '탱커', '딜러', '힐러'].map(role => (
                        <button key={role} onClick={() => setSelectedRole(role)}
                            style={{ padding: '10px 20px', borderRadius: '8px', border: '1px solid', borderColor: selectedRole === role ? '#3b82f6' : theme.border, background: selectedRole === role ? '#3b82f620' : theme.surface, color: selectedRole === role ? '#3b82f6' : theme.textSub, cursor: 'pointer', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            {role === 'All' ? <Users size={16}/> : <img src={getRoleIconSrc(role)} alt={role} style={{ width: 16, height: 16, filter: 'invert(1)', opacity: selectedRole === role ? 1 : 0.5 }} />}
                            {role === 'All' ? t.allPositions : roleLabelDisplay(role)}
                        </button>
                    ))}
                </div>

                <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: theme.surfaceHighlight, padding: '8px 16px', borderRadius: '8px', border: `1px solid ${theme.border}` }}>
                        <span style={{ fontSize: '13px', fontWeight: 'bold', color: theme.textSub }}>{t.matchup}</span>
                        <select value={selectedMyTeam} onChange={e => setSelectedMyTeam(e.target.value)} style={selectStyle}>
                            <option value="All">{t.myTeamAll}</option>
                            {teamList.map(tm => <option key={tm} value={tm}>{tm}</option>)}
                        </select>
                        <span style={{ fontSize: '12px', color: theme.textSub, fontWeight: 'bold' }}>VS</span>
                        <select value={selectedEnemyTeam} onChange={e => setSelectedEnemyTeam(e.target.value)} style={selectStyle}>
                            <option value="All">{t.enemyTeamAll}</option>
                            {teamList.map(tm => <option key={tm} value={tm}>{tm}</option>)}
                        </select>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', background: theme.surfaceHighlight, padding: '8px 16px', borderRadius: '8px', border: `1px solid ${theme.border}` }}>
                        <Calendar size={16} color={theme.textSub} />
                        <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} style={{ background: 'transparent', border: 'none', color: theme.text, outline: 'none', fontSize: '13px' }} />
                        <span style={{ color: theme.textSub }}>~</span>
                        <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} style={{ background: 'transparent', border: 'none', color: theme.text, outline: 'none', fontSize: '13px' }} />
                    </div>
                </div>
            </div>

            <div style={{ background: theme.bg, borderRadius: '16px', border: `1px solid ${theme.border}`, overflow: 'hidden', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)' }}>
                <ScrollX isMobile={isMobile} fade={theme.bg}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: isMobile ? 640 : undefined }}>
                    <thead style={{ background: theme.surfaceHighlight }}>
                        <tr>
                            <th style={{ padding: '16px', textAlign: 'center', fontSize: '13px', color: theme.textSub }}>#</th>
                            <th style={{ padding: '16px', textAlign: 'left', fontSize: '13px', color: theme.textSub, cursor:'pointer' }} onClick={() => handleSort('name')}>{t.player} <ArrowUpDown size={12} style={{display:'inline'}}/></th>
                            <th style={{ padding: '16px', textAlign: 'center', fontSize: '13px', color: theme.textSub }}>{t.position}</th>
                            <th style={{ padding: '16px', textAlign: 'right', fontSize: '13px', color: theme.textSub, cursor:'pointer' }} onClick={() => handleSort('totalFights')}>{t.fkColFights} <ArrowUpDown size={12} style={{display:'inline'}}/></th>
                            <th style={{ padding: '16px', textAlign: 'right', fontSize: '13px', color: theme.textSub, cursor:'pointer' }} onClick={() => handleSort('firstKills')}>{t.fkColCount} <ArrowUpDown size={12} style={{display:'inline'}}/></th>
                            <th style={{ padding: '16px', textAlign: 'right', fontSize: '13px', color: SUCCESS_COLOR, cursor:'pointer', fontWeight:'900' }} onClick={() => handleSort('rate')}>{t.fkColRate} <ArrowUpDown size={12} style={{display:'inline'}}/></th>
                            <th style={{ padding: '16px', width: '40px' }}></th>
                        </tr>
                    </thead>
                    <tbody>
                        {sortedData.map((p, idx) => {
                            const rate = p.totalFights > 0 ? (p.firstKills / p.totalFights) * 100 : 0;
                            const isCarry = rate >= 10;
                            const isExpanded = expandedPlayer === p.name;
                            const isOurTeam = p.team === OUR_TEAM;       // 우리 팀 구분 표시
                            const lowSample = p.totalFights < MIN_FIGHTS; // R2: 표본 미달 흐림
                            const rowBg = idx % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)';

                            return (
                                <React.Fragment key={p.name}>
                                    <tr onClick={() => toggleExpand(p.name)} style={{ background: isExpanded ? theme.surfaceHighlight : rowBg, borderBottom: isExpanded ? 'none' : `1px solid ${theme.border}40`, transition: 'background 0.2s', cursor: 'pointer', opacity: lowSample ? 0.5 : 1 }} onMouseOver={e=>e.currentTarget.style.background=theme.surfaceHighlight} onMouseOut={e=>e.currentTarget.style.background=isExpanded ? theme.surfaceHighlight : rowBg}>
                                        <td style={{ padding: '16px', textAlign: 'center', color: theme.textSub, borderLeft: `3px solid ${isOurTeam ? theme.primary : 'transparent'}` }}>{idx + 1}</td>
                                        <td style={{ padding: '16px', fontWeight: 'bold' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                                <img src={getHeroImageSrc(p.hero)} style={{ width: 30, height: 30, borderRadius: 4, background: '#000' }} />
                                                <span style={{ color: isExpanded ? SUCCESS_COLOR : theme.text }}>{p.name}</span>
                                                {isOurTeam && <span style={{ fontSize: '10px', fontWeight: 700, color: theme.primary, background: `${theme.primary}20`, border: `1px solid ${theme.primary}55`, borderRadius: '4px', padding: '1px 6px' }}>{OUR_TEAM}</span>}
                                            </div>
                                        </td>
                                        <td style={{ padding: '16px', textAlign: 'center' }}>
                                            <img src={getRoleIconSrc(p.roleLabel)} style={{ width: 20, height: 20, objectFit: 'contain', filter: 'invert(1)', opacity: 0.6 }} />
                                        </td>
                                        <td style={{ padding: '16px', textAlign: 'right' }}>{p.totalFights.toLocaleString()}{t.timesUnit}</td>
                                        <td style={{ padding: '16px', textAlign: 'right', fontWeight: 'bold' }}>{p.firstKills}{t.timesUnit}</td>
                                        <td style={{ padding: '16px', textAlign: 'right' }}>
                                            <div style={{ position: 'relative', width: '100%', height: '24px', background: theme.surface, borderRadius: '4px', overflow: 'hidden' }}>
                                                <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${Math.min(rate * 2, 100)}%`, background: isCarry ? '#10b98180' : '#10b98140' }} />
                                                <span style={{ position: 'relative', zIndex: 1, paddingRight: '8px', fontWeight: '900', fontSize: '13px', color: isCarry ? SUCCESS_COLOR : theme.text }}>{rate.toFixed(1)}%</span>
                                            </div>
                                        </td>
                                        <td style={{ padding: '16px', textAlign: 'center', color: theme.textSub }}>
                                            {isExpanded ? <ChevronUp size={18}/> : <ChevronDown size={18}/>}
                                        </td>
                                    </tr>
                                    
                                    {isExpanded && (
                                        <tr style={{ background: theme.surfaceHighlight, borderBottom: `2px solid ${theme.border}` }}>
                                            <td colSpan="7" style={{ padding: '0 24px 24px 24px' }}>
                                                <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)', gap: isMobile ? '12px' : '20px', background: theme.bg, padding: isMobile ? '14px' : '20px', borderRadius: '12px', border: `1px solid ${theme.border}40` }}>
                                                    <div>
                                                        <h4 style={{ fontSize: '13px', color: theme.textSub, marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}><Crosshair size={14} color={SUCCESS_COLOR}/> {t.fkTopVictims}</h4>
                                                        {getTopN(p.killLogs, 'targetName', 5).map((target, i) => {
                                                            const pct = p.firstKills > 0 ? (target.count / p.firstKills) * 100 : 0;
                                                            return (
                                                                <div key={i} style={{ position: 'relative', display: 'flex', justifyContent: 'space-between', padding: '6px 8px', marginBottom: '4px', borderRadius: '4px', background: 'rgba(255,255,255,0.03)', overflow: 'hidden' }}>
                                                                    <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${pct}%`, background: `${SUCCESS_COLOR}20`, zIndex: 0 }} />
                                                                    <span style={{ position: 'relative', zIndex: 1, fontSize: '13px' }}>{target.name}</span>
                                                                    <span style={{ position: 'relative', zIndex: 1, fontSize: '13px', fontWeight: 'bold', color: SUCCESS_COLOR }}>{target.count}{t.timesUnit} <span style={{fontSize:'10px', color:theme.textSub, fontWeight:'normal'}}>({pct.toFixed(0)}%)</span></span>
                                                                </div>
                                                            )
                                                        })}
                                                    </div>
                                                    <div>
                                                        <h4 style={{ fontSize: '13px', color: theme.textSub, marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}><Shield size={14} color={SUCCESS_COLOR}/> {t.fkTopHeroes}</h4>
                                                        {getTopN(p.killLogs, 'targetHero', 5).map((hero, i) => {
                                                            const pct = p.firstKills > 0 ? (hero.count / p.firstKills) * 100 : 0;
                                                            return (
                                                                <div key={i} style={{ position: 'relative', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 8px', marginBottom: '4px', borderRadius: '4px', background: 'rgba(255,255,255,0.03)', overflow: 'hidden' }}>
                                                                    <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${pct}%`, background: `${SUCCESS_COLOR}20`, zIndex: 0 }} />
                                                                    <div style={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                                        <img src={getHeroImageSrc(hero.name)} style={{ width: 18, height: 18, borderRadius: 2 }} onError={e=>e.currentTarget.style.display='none'}/>
                                                                        <span style={{ fontSize: '13px' }}>{getDisplayName(hero.name)}</span>
                                                                    </div>
                                                                    <span style={{ position: 'relative', zIndex: 1, fontSize: '13px', fontWeight: 'bold' }}>{hero.count}{t.timesUnit}</span>
                                                                </div>
                                                            )
                                                        })}
                                                    </div>
                                                    <div>
                                                        <h4 style={{ fontSize: '13px', color: theme.textSub, marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}><Sword size={14} color={SUCCESS_COLOR}/> {t.fkKillSkill}</h4>
                                                        {getTopN(p.killLogs, 'detailedSkill', 5).map((log, i) => {
                                                            // 💡 스킬명 ➔ 희생자이름 [희생자영웅아이콘] 파싱
                                                            const [skill, tName, tHero] = log.name.split('|');
                                                            const pct = p.firstKills > 0 ? (log.count / p.firstKills) * 100 : 0;
                                                            return (
                                                                <div key={i} style={{ position: 'relative', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 8px', marginBottom: '4px', borderRadius: '4px', background: 'rgba(255,255,255,0.03)', overflow: 'hidden' }}>
                                                                    <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${pct}%`, background: `${SUCCESS_COLOR}20`, zIndex: 0 }} />
                                                                    <div style={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                                        <span style={{ fontSize: '13px', fontWeight: 'bold', color: theme.text }}>{skill}</span>
                                                                        <span style={{ color: theme.textSub, fontSize: '11px', margin: '0 2px' }}>➔</span>
                                                                        <span style={{ color: theme.textSub, fontSize: '12px' }}>{tName}</span>
                                                                        <img src={getHeroImageSrc(tHero)} style={{ width: 16, height: 16, borderRadius: 2 }} onError={e=>e.currentTarget.style.display='none'}/>
                                                                    </div>
                                                                    <span style={{ position: 'relative', zIndex: 1, fontSize: '13px', fontWeight: 'bold' }}>{log.count}{t.timesUnit}</span>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                            </td>
                                        </tr>
                                    )}
                                </React.Fragment>
                            );
                        })}
                        {sortedData.length === 0 && (
                            <tr>
                                <td colSpan="7" style={{ padding: '60px', textAlign: 'center', color: theme.textSub }}>{t.noFilteredData}</td>
                            </tr>
                        )}
                    </tbody>
                </table>
                </ScrollX>
            </div>
        </div>
    );
}