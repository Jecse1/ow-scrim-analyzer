import React, { useEffect, useState, useMemo } from 'react';
import axios from 'axios';
import { Clock, ChevronLeft, Trophy, Zap, Crosshair, Sword, List, BarChart2, Skull, Activity, Target, PlayCircle, User, ChevronDown, AlertOctagon, RefreshCw } from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  BarChart, Bar, AreaChart, Area, ScatterChart, Scatter, ZAxis, Cell, ReferenceLine
} from 'recharts';

import { useTheme } from "./ThemeContext";
import { useLanguage } from "./LanguageContext";
import { buildVideoLink, hasVideo } from "./utils/videoLink";
import { VOD_LEAD_SEC } from "./FightLabStats"; // 궁극기 타임라인 VOD 점프 리드(한타 분석 탭과 동일 상수)
import { getDisplayName, HERO_SKILL_MAP, getHeroImageSrc, TANK_HEROES, SUPPORT_HEROES } from "./gameData";
import NoVideoModal from "./NoVideoModal";
import { computeFights } from './utils/fightAnalysis';
import WinnerOverrideControl from "./WinnerOverrideControl";

// --- 색상 및 상수 ---
const COLOR_TEAM1 = '#60a5fa'; 
const COLOR_TEAM2 = '#f87171'; 
const NEON_GREEN = '#39FF14'; 

const normalizeName = (name) => (name ? name.trim() : "");

const checkIsTeam1 = (teamName, t1Name) => {
    if (!teamName) return false;
    if (teamName === t1Name) return true;
    return teamName === '1팀' || teamName === 'Team 1';
};

const checkIsTeam2 = (teamName, t2Name) => {
    if (!teamName) return false;
    if (teamName === t2Name) return true;
    return teamName === '2팀' || teamName === 'Team 2';
};

const resolveTeamColor = (teamName, t1Name, t2Name) => {
    if (!teamName) return '#9ca3af'; 
    if (checkIsTeam1(teamName, t1Name)) return COLOR_TEAM1;
    if (checkIsTeam2(teamName, t2Name)) return COLOR_TEAM2;
    return '#9ca3af';
};



// [i18n] 표시명은 gameData.getDisplayName(단일 함수)로 통일 — 로컬 별칭맵/헬퍼 제거.

// [STEP3] 이미지 리졸버는 gameData.getHeroImageSrc(SSOT image 필드 기반)로 통합·임포트.

const getRoleInfo = (heroName) => {
    const name = getDisplayName(heroName);
    const tanks = TANK_HEROES;
    const supports = SUPPORT_HEROES;
    
    if (tanks.includes(name) || tanks.includes(heroName)) return { label: 'tank', order: 1 };
    if (supports.includes(name) || supports.includes(heroName)) return { label: 'support', order: 3 };
    return { label: 'dps', order: 2 };
};

const getRoleIconSrc = (roleLabel) => {
    if (roleLabel === 'tank') return '/roles/tank.png';
    if (roleLabel === 'dps') return '/roles/damage.png'; 
    if (roleLabel === 'support') return '/roles/support.png';
    return null;
};

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

// =================================================================================
// [차트용 서브 컴포넌트]
// =================================================================================
const FightSurvivorsChart = ({ fights, team1Name, team2Name, theme, t }) => {
  if (!fights || fights.length === 0) return <div style={{ padding: '40px', textAlign: 'center', color: theme.textSub, fontSize: '13px' }}>{t.noData}</div>;
  const data = fights.map((fight, index) => ({
    name: `${index + 1}`,
    t1Survivors: Math.max(0, 5 - (fight.team1_deaths || 0)),
    t2Survivors: Math.max(0, 5 - (fight.team2_deaths || 0)),
    winner: fight.winner,
    duration: fight.duration_sec ? fight.duration_sec.toFixed(1) : 0
  }));
  const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      const d = payload[0].payload;
      return (
        <div style={{ backgroundColor: theme.surface, border: `1px solid ${theme.border}`, padding: '10px', borderRadius: '8px', fontSize:'12px', color: theme.text }}>
          <p style={{ fontWeight: 'bold', marginBottom: '4px' }}>{t.fight} {label}</p>
          <div style={{ color: COLOR_TEAM1 }}>{team1Name}: {d.t1Survivors}{t.survivors}</div>
          <div style={{ color: COLOR_TEAM2 }}>{team2Name}: {d.t2Survivors}{t.survivors}</div>
          <div style={{ color: theme.textSub, marginTop:'4px' }}>{t.duration}: {d.duration}s</div>
        </div>
      );
    }
    return null;
  };
  return (
    <div style={{ width: '100%', height: 250 }}>
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <BarChart data={data} barGap={2} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={theme.border} vertical={false} />
          <XAxis dataKey="name" stroke={theme.textSub} fontSize={11} tickLine={false} axisLine={false} />
          <YAxis domain={[0, 5]} stroke={theme.textSub} fontSize={11} tickLine={false} axisLine={false} tickCount={6} />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: theme.surfaceHighlight, opacity: 0.4 }} />
          <Bar dataKey="t1Survivors" fill={COLOR_TEAM1} radius={[3, 3, 0, 0]} barSize={12} animationDuration={800} />
          <Bar dataKey="t2Survivors" fill={COLOR_TEAM2} radius={[3, 3, 0, 0]} barSize={12} animationDuration={800} />
          <ReferenceLine y={2.5} stroke={theme.borderHighlight} strokeDasharray="3 3" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
};

const AverageSurvivorsChart = ({ fights, team1Name, team2Name, theme, t }) => {
    if (!fights || fights.length === 0) return null;
    const t1Total = fights.reduce((acc, f) => acc + Math.max(0, 5 - (f.team1_deaths || 0)), 0);
    const t2Total = fights.reduce((acc, f) => acc + Math.max(0, 5 - (f.team2_deaths || 0)), 0);
    const count = fights.length;
    const data = [
        { name: team1Name, avg: parseFloat((t1Total / count).toFixed(2)), fill: COLOR_TEAM1 },
        { name: team2Name, avg: parseFloat((t2Total / count).toFixed(2)), fill: COLOR_TEAM2 }
    ];
    const CustomTooltip = ({ active, payload }) => {
        if (active && payload && payload.length) {
            return (
                <div style={{ backgroundColor: theme.surface, border: `1px solid ${theme.border}`, padding: '8px', borderRadius: '6px', fontSize:'11px', color: theme.text }}>
                    {payload[0].payload.name}: {payload[0].value} (avg)
                </div>
            );
        }
        return null;
    };
    return (
        <div style={{ width: '100%', height: 250, display:'flex', flexDirection:'column', alignItems:'center' }}>
            <div style={{ fontSize:'12px', color: theme.textSub, marginBottom:'10px' }}>{t.avgSurvivors}</div>
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                <BarChart data={data} margin={{ top: 10, right: 0, left: -25, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={theme.border} vertical={false} />
                    <XAxis dataKey="name" stroke={theme.textSub} fontSize={10} tickLine={false} axisLine={false} interval={0} tickFormatter={(val) => val.length > 5 ? val.substring(0,5)+'..' : val} />
                    <YAxis domain={[0, 5]} stroke={theme.textSub} fontSize={10} tickLine={false} axisLine={false} tickCount={6}/>
                    <Tooltip content={<CustomTooltip />} cursor={{ fill: 'transparent' }} />
                    <Bar dataKey="avg" radius={[4, 4, 0, 0]} barSize={24} label={{ position: 'top', fill: theme.text, fontSize: 11 }}>
                        {data.map((entry, index) => <Cell key={`cell-${index}`} fill={entry.fill} />)}
                    </Bar>
                </BarChart>
            </ResponsiveContainer>
        </div>
    );
};

// =================================================================================
// [1] StatsView
// =================================================================================
const StatsView = ({ activeRoundTab, setActiveRoundTab, displayStats, rounds, t1Name, t2Name }) => {
  const { theme } = useTheme();
  const { t } = useLanguage();

  const SafeMatchTable = ({ stats }) => {
    const [sortConfig, setSortConfig] = useState({ key: 'default', direction: 'asc' });

    if (!stats || !Array.isArray(stats) || stats.length === 0) {
      return <div style={{ padding: '60px', textAlign: 'center', color: theme.textSub, border: `1px dashed ${theme.border}`, borderRadius: '16px', background: theme.surface, fontSize: '14px' }}>{t.noData}</div>;
    }

    const handleSort = (key) => {
      let direction = 'desc';
      if (['player_name', 'team_name', 'role_order', 'default'].includes(key)) direction = 'asc';
      if (sortConfig.key === key && sortConfig.direction === direction) {
        direction = direction === 'asc' ? 'desc' : 'asc';
      }
      setSortConfig({ key, direction });
    };

    const fmt = (val) => (typeof val === 'number' ? Math.round(val).toLocaleString() : '0');
    const fmtDec = (val) => (typeof val === 'number' ? val.toFixed(2) : '0.00');

    let processedStats = stats.map(row => {
        if (!row) return null;
        const finalBlows = Number(row.final_blows) || 0;
        const elims = Number(row.eliminations) || 0;
        const deaths = Number(row.deaths) || 0;
        const assists = (Number(row.offensive_assists) || 0) + (Number(row.defensive_assists) || 0);
        const heroDmg = Number(row.hero_damage_dealt) || 0;
        const healingReceived = Number(row.healing_received) || 0;
        const dhRatio = healingReceived > 0 ? (heroDmg / healingReceived) : heroDmg > 0 ? 999 : 0;
        
        return {
            ...row,
            role_label: getRoleInfo(row.hero_name).label,
            role_order: getRoleInfo(row.hero_name).order,
            eliminations: elims,
            kd: deaths > 0 ? (finalBlows / deaths) : finalBlows, 
            kda: deaths > 0 ? ((finalBlows + assists) / deaths) : (finalBlows + assists),
            assists: assists,
            dh_ratio: dhRatio
        };
    }).filter(x => x !== null);

    processedStats.sort((a, b) => {
        if (sortConfig.key === 'default') {
             const teamA = a.team_name || "";
             const teamB = b.team_name || "";
             if (teamA !== teamB) return teamA.localeCompare(teamB);
             if (a.role_order !== b.role_order) return a.role_order - b.role_order;
             return (Number(b.hero_damage_dealt) || 0) - (Number(a.hero_damage_dealt) || 0);
        }
        const aVal = a[sortConfig.key];
        const bVal = b[sortConfig.key];
        if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
        if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
    });

    const thStyle = { padding: '10px 4px', textAlign: 'right', fontSize: '12px', fontWeight: 'bold', color: theme.textSub, borderBottom: `1px solid ${theme.border}`, whiteSpace: 'nowrap', background: theme.bg, cursor: 'pointer', userSelect: 'none', position: 'sticky', top: 0, zIndex: 20 };
    const thStyleLeft = { ...thStyle, textAlign: 'left', position: 'sticky', left: 0, zIndex: 30, background: theme.bg, boxShadow: '2px 0 5px -2px rgba(0,0,0,0.1)' }; 
    const thStyleCenter = { ...thStyle, textAlign: 'center' };
    const tdStyle = { padding: '8px 4px', textAlign: 'right', fontSize: '12px', color: theme.text, borderBottom: `1px solid ${theme.border}`, whiteSpace: 'nowrap', verticalAlign: 'middle' };
    const tdStyleLeft = { ...tdStyle, textAlign: 'left', fontWeight: 'bold', position: 'sticky', left: 0, zIndex: 10, background: theme.bg, boxShadow: '2px 0 5px -2px rgba(0,0,0,0.1)', fontSize: '12px' };
    const tdStyleCenter = { ...tdStyle, textAlign: 'center' };
    const renderSortIcon = (key) => (sortConfig.key !== key && sortConfig.key !== 'default' ? <span style={{opacity:0.2, fontSize:'10px'}}> ↕</span> : (sortConfig.direction === 'asc' ? ' ▲' : ' ▼'));

    return (
      <div style={{ width: '100%', overflowX: 'auto', background: theme.bg, borderRadius: '16px', border: `1px solid ${theme.border}`, boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '100%' }}> 
          <thead>
            <tr>
              <th style={{...thStyleCenter, width:'30px'}} onClick={()=>handleSort('default')}>#</th>
              <th style={{...thStyleCenter, width:'40px'}} onClick={()=>handleSort('role_order')}>{t.role}{renderSortIcon('role_order')}</th>
              <th style={thStyleLeft} onClick={()=>handleSort('player_name')}>{t.player}{renderSortIcon('player_name')}</th>
              <th style={thStyleCenter} onClick={()=>handleSort('team_name')}>{t.team}{renderSortIcon('team_name')}</th>
              <th style={thStyleCenter} onClick={()=>handleSort('hero_time_played')}>{t.playTime}{renderSortIcon('hero_time_played')}</th>
              <th style={{...thStyle, color: theme.text}} onClick={()=>handleSort('eliminations')}>{t.elims}{renderSortIcon('eliminations')}</th>
              <th style={thStyle} onClick={()=>handleSort('final_blows')}>{t.finalBlows}{renderSortIcon('final_blows')}</th> 
              <th style={thStyle} onClick={()=>handleSort('deaths')}>{t.deaths}{renderSortIcon('deaths')}</th>
              <th style={thStyle} onClick={()=>handleSort('kd')}>K/D{renderSortIcon('kd')}</th>
              <th style={thStyle} onClick={()=>handleSort('assists')}>{t.assists}{renderSortIcon('assists')}</th>
              <th style={thStyle} onClick={()=>handleSort('hero_damage_dealt')}>{t.heroDmg}{renderSortIcon('hero_damage_dealt')}</th>
              <th style={{...thStyle, color: theme.textSub}} onClick={()=>handleSort('barrier_damage_dealt')}>{t.barrierDmg}{renderSortIcon('barrier_damage_dealt')}</th>
              <th style={thStyle} onClick={()=>handleSort('healing_received')}>{t.healRcvd}{renderSortIcon('healing_received')}</th>
              <th style={{...thStyle, color: theme.textSub, minWidth:'80px'}} onClick={()=>handleSort('dh_ratio')}>{t.dhRatio}{renderSortIcon('dh_ratio')}</th>
              <th style={thStyle} onClick={()=>handleSort('healing_dealt')}>{t.healing}{renderSortIcon('healing_dealt')}</th>
              <th style={thStyle} onClick={()=>handleSort('damage_taken')}>{t.dmgTaken}{renderSortIcon('damage_taken')}</th>
              <th style={{...thStyle, paddingRight:'16px'}} onClick={()=>handleSort('ultimates_used')}>{t.ults}{renderSortIcon('ultimates_used')}</th>
            </tr>
          </thead>
          <tbody>
            {processedStats.map((row, idx) => {
              const teamColor = resolveTeamColor(row.team_name, t1Name, t2Name);
              const isTeamChange = sortConfig.key === 'default' && idx > 0 && (row.team_name || "") !== (processedStats[idx-1]?.team_name || "");
              const roleIconSrc = getRoleIconSrc(row.role_label);
              let dhColor = theme.textSub;
              if (row.dh_ratio >= 1.5) dhColor = theme.success;
              else if (row.dh_ratio > 0 && row.dh_ratio <= 0.8) dhColor = theme.danger;
              
              return (
                <React.Fragment key={idx}>
                  {isTeamChange && (<tr><td colSpan="18" style={{borderBottom: `2px solid ${theme.borderHighlight}`}}></td></tr>)}
                  <tr style={{ background: 'transparent' }} onMouseOver={e=>e.currentTarget.style.background=theme.surfaceHighlight} onMouseOut={e=>e.currentTarget.style.background='transparent'}>
                    <td style={{...tdStyleCenter, color: theme.textDim}}>{idx + 1}</td>
                    <td style={{...tdStyleCenter, padding:'4px'}}>
                        <div style={{display:'flex', justifyContent:'center', alignItems:'center'}}>
                            {roleIconSrc && (
                                <img src={roleIconSrc} alt={row.role_label} style={{width:'20px', height:'20px', objectFit:'contain', filter:'invert(1)', opacity:0.7}} onError={(e) => {e.currentTarget.style.display = 'none';}} />
                            )}
                        </div>
                    </td>
                    <td style={{...tdStyleLeft, color: theme.text}}>
                        <span>{row.player_name}</span>
                    </td>
                    <td style={{...tdStyleCenter, color: teamColor, fontWeight: 'bold'}}>{row.team_name}</td>
                    <td style={tdStyleCenter}>{Math.floor((row.hero_time_played || 0) / 60)}m {Math.floor((row.hero_time_played || 0) % 60)}s</td>
                    <td style={{...tdStyle, fontWeight:'bold', color: theme.text}}>{row.eliminations}</td>
                    <td style={{...tdStyle, color: theme.textSub}}>{row.final_blows}</td>
                    <td style={{...tdStyle, color: theme.danger}}>{row.deaths}</td>
                    <td style={{...tdStyle, color: row.kd >= 3 ? NEON_GREEN : theme.textSub, fontWeight: row.kd >= 3 ? 'bold' : 'normal', textShadow: row.kd >= 3 ? `0 0 8px ${NEON_GREEN}40` : 'none'}}>{fmtDec(row.kd)}</td>
                    <td style={tdStyle}>{row.assists}</td>
                    <td style={tdStyle}>{fmt(row.hero_damage_dealt)}</td>
                    <td style={{...tdStyle, color: theme.textSub}}>{fmt(row.barrier_damage_dealt)}</td>
                    <td style={tdStyle}>{fmt(row.healing_received)}</td>
                    <td style={{...tdStyle, color: dhColor, fontWeight:'bold'}}>{fmtDec(row.dh_ratio)}</td>
                    <td style={tdStyle}>{fmt(row.healing_dealt)}</td>
                    <td style={tdStyle}>{fmt(row.damage_taken)}</td>
                    <td style={{...tdStyle, paddingRight:'16px'}}>{row.ultimates_used}</td>
                  </tr>
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <>
      <SafeMatchTable stats={displayStats} />
    </>
  );
};

// =================================================================================
// [2] KillLogView
// =================================================================================
const KillLogView = ({ fights, activeRoundTab, t1Name, t2Name }) => {
  const { theme } = useTheme();
  const { t } = useLanguage();

  const formatTime = (sec) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}m ${s}s`;
  };

  const filteredFights = useMemo(() => {
    let targetFights = fights;
    if (activeRoundTab !== 'overview') {
        targetFights = fights.filter(f => true);
    }
    return targetFights.map(fight => {
        const uniqueEvents = [];
        const seen = new Set();
        fight.events.forEach(ev => {
            const key = `${Math.floor(ev.timestamp)}-${ev.player_name}-${ev.target_name}-${ev.ability}`;
            if (!seen.has(key)) {
                seen.add(key);
                uniqueEvents.push(ev);
            }
        });
        return { ...fight, events: uniqueEvents };
    });
  }, [fights, activeRoundTab]);

  const KillerDisplay = ({ heroName, heroImage, playerName, teamColor }) => {
    const imgSrc = getHeroImageSrc(heroName);
    const displayName = getDisplayName(heroName); 
    return (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '8px', minWidth: 0 }}>
        <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', minWidth: 0 }}>
            <span style={{ color: theme.text, fontWeight: '700', fontSize: '14px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{displayName}</span>
            <span style={{ color: teamColor, fontSize: '12px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{playerName}</span>
        </div>
        {imgSrc && (
            <img src={imgSrc} alt={displayName} style={{ width: '36px', height: '36px', borderRadius: '6px', border: `2px solid ${teamColor}`, backgroundColor: theme.surfaceHighlight, flexShrink: 0 }} onError={(e) => { e.currentTarget.style.display = 'none'; }} />
        )}
        </div>
    );
  };

  const VictimDisplay = ({ heroName, heroImage, playerName, teamColor }) => {
    const imgSrc = getHeroImageSrc(heroName);
    const displayName = getDisplayName(heroName); 
    return (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: '8px', minWidth: 0 }}>
        {imgSrc && (
            <img src={imgSrc} alt={displayName} style={{ width: '36px', height: '36px', borderRadius: '6px', border: `2px solid ${teamColor}`, backgroundColor: theme.surfaceHighlight, flexShrink: 0 }} onError={(e) => { e.currentTarget.style.display = 'none'; }} />
        )}
        <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-start', minWidth: 0 }}>
            <span style={{ color: theme.text, fontWeight: '700', fontSize: '14px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{displayName}</span>
            <span style={{ color: teamColor, fontSize: '12px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{playerName}</span>
        </div>
        </div>
    );
  };

  return (
    <div style={{ width: '100%' }}>
      {filteredFights.length === 0 ? (
        <div style={{padding:'60px', textAlign:'center', color: theme.textSub, fontSize:'14px'}}>{t.msNoFights}</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {filteredFights.map((fight, fIdx) => (
            <div key={fIdx} style={{ background: theme.bg, borderRadius: '16px', border: `1px solid ${theme.border}`, overflow: 'hidden', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 24px', background: theme.surface, borderBottom: `1px solid ${theme.border}` }}>
                <div style={{ display:'flex', gap:'12px', alignItems:'center' }}>
                  <span style={{ fontSize: '15px', fontWeight: 'bold', color: theme.text }}>{t.fight} {fIdx + 1}</span>
                  <span style={{ fontSize: '13px', color: theme.textSub }}>{formatTime(fight.startTime)} - {formatTime(fight.fixedEndTime)}</span>
                </div>
                <div style={{ fontSize: '14px' }}>
                  <span style={{ color: theme.textSub }}>{t.win}: </span>
                  <span style={{ color: resolveTeamColor(fight.winner, t1Name, t2Name), fontWeight: 'bold' }}>
                    {fight.winner} ({fight.t1Kills} vs {fight.t2Kills})
                  </span>
                </div>
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <tbody>
                  {fight.events.map((ev, idx) => {
                      if (ev.event_type !== 'kill') return null;
                      const killerTeamColor = checkIsTeam1(ev.player_team, t1Name) ? COLOR_TEAM1 : COLOR_TEAM2;
                      const victimTeamColor = checkIsTeam1(ev.target_team, t1Name) ? COLOR_TEAM1 : COLOR_TEAM2;
                      return (
                          <tr key={idx} style={{ borderBottom: idx !== fight.events.length - 1 ? `1px solid ${theme.border}` : 'none' }}>
                            <td style={{ padding: '12px 24px', color: theme.textSub, fontSize: '13px', width: '80px', whiteSpace: 'nowrap' }}>{formatTime(ev.timestamp)}</td>
                            <td style={{ padding: '8px', width: '35%' }}>
                                <KillerDisplay heroName={ev.player_hero} heroImage={ev.player_hero_img} playerName={ev.player_name} teamColor={killerTeamColor} />
                            </td>
                            <td style={{ padding: '0', textAlign: 'center', color: theme.textSub, width: '40px' }}><Sword size={18} strokeWidth={1.5}/></td>
                            <td style={{ padding: '8px', width: '35%' }}>
                                <VictimDisplay heroName={ev.target_hero} heroImage={ev.target_hero_img} playerName={ev.target_name} teamColor={victimTeamColor} />
                            </td>
                            <td style={{ padding: '16px 32px', color: theme.textSub, fontSize: '14px', textAlign: 'right', width: '120px' }}>
                                {getAbilityName(ev.player_hero, ev.ability)}
                            </td>
                          </tr>
                      );
                  })}
                  </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};


// =================================================================================
// [3] ChartView (상세 분석 차트) 
// =================================================================================
const ChartView = ({ matchData, rounds, fights, t1Name, t2Name }) => { 
  const { theme } = useTheme();
  const { t } = useLanguage();

  const team1Name = t1Name;
  const team2Name = t2Name;

  // 💡 [기존 추가] 패배 한타 저항력 계산 (Resistance in Lost Fights)
  const lostFightData = useMemo(() => {
      if (!fights || fights.length === 0) return { t1LostFights: 0, t1KillsWhenLost: 0, t1Avg: 0, t1Pct: 0, t2LostFights: 0, t2KillsWhenLost: 0, t2Avg: 0, t2Pct: 0 };
      
      let t1LostFights = 0, t1KillsWhenLost = 0;
      let t2LostFights = 0, t2KillsWhenLost = 0;

      fights.forEach(f => {
          if (f.winner === t2Name) {
              t1LostFights++; 
              t1KillsWhenLost += f.t1Kills; 
          } else if (f.winner === t1Name) {
              t2LostFights++; 
              t2KillsWhenLost += f.t2Kills; 
          }
      });

      return {
          t1LostFights, t1KillsWhenLost,
          t1Avg: t1LostFights > 0 ? (t1KillsWhenLost / t1LostFights).toFixed(1) : "0.0",
          t1Pct: t1LostFights > 0 ? ((t1KillsWhenLost / (t1LostFights * 5)) * 100).toFixed(1) : "0.0",
          t2LostFights, t2KillsWhenLost,
          t2Avg: t2LostFights > 0 ? (t2KillsWhenLost / t2LostFights).toFixed(1) : "0.0",
          t2Pct: t2LostFights > 0 ? ((t2KillsWhenLost / (t2LostFights * 5)) * 100).toFixed(1) : "0.0"
      };
  }, [fights, t1Name, t2Name]);

  // 💡 [신규 추가] 연속 한타 승률 및 모멘텀 계산 (Momentum & Turnovers)
  const momentumData = useMemo(() => {
      if (!fights || fights.length < 2) return {
          t1AfterWinWon: 0, t1AfterWinTotal: 0, t1AfterWinPct: "0.0",
          t1AfterLossWon: 0, t1AfterLossTotal: 0, t1AfterLossPct: "0.0",
          t2AfterWinWon: 0, t2AfterWinTotal: 0, t2AfterWinPct: "0.0",
          t2AfterLossWon: 0, t2AfterLossTotal: 0, t2AfterLossPct: "0.0"
      };

      let t1AfterWinWon = 0, t1AfterWinTotal = 0;
      let t1AfterLossWon = 0, t1AfterLossTotal = 0;

      let t2AfterWinWon = 0, t2AfterWinTotal = 0;
      let t2AfterLossWon = 0, t2AfterLossTotal = 0;

      for (let i = 1; i < fights.length; i++) {
          const prevFight = fights[i - 1];
          const currFight = fights[i];

          // 1팀 관점
          if (prevFight.winner === t1Name) {
              t1AfterWinTotal++;
              if (currFight.winner === t1Name) t1AfterWinWon++;
          } else if (prevFight.winner === t2Name) {
              t1AfterLossTotal++;
              if (currFight.winner === t1Name) t1AfterLossWon++;
          }

          // 2팀 관점
          if (prevFight.winner === t2Name) {
              t2AfterWinTotal++;
              if (currFight.winner === t2Name) t2AfterWinWon++;
          } else if (prevFight.winner === t1Name) {
              t2AfterLossTotal++;
              if (currFight.winner === t2Name) t2AfterLossWon++;
          }
      }

      return {
          t1AfterWinWon, t1AfterWinTotal,
          t1AfterWinPct: t1AfterWinTotal > 0 ? ((t1AfterWinWon / t1AfterWinTotal) * 100).toFixed(1) : "0.0",
          t1AfterLossWon, t1AfterLossTotal,
          t1AfterLossPct: t1AfterLossTotal > 0 ? ((t1AfterLossWon / t1AfterLossTotal) * 100).toFixed(1) : "0.0",

          t2AfterWinWon, t2AfterWinTotal,
          t2AfterWinPct: t2AfterWinTotal > 0 ? ((t2AfterWinWon / t2AfterWinTotal) * 100).toFixed(1) : "0.0",
          t2AfterLossWon, t2AfterLossTotal,
          t2AfterLossPct: t2AfterLossTotal > 0 ? ((t2AfterLossWon / t2AfterLossTotal) * 100).toFixed(1) : "0.0"
      };
  }, [fights, t1Name, t2Name]);

  // 💡 1. 선취점 분석 (First Deaths) 데이터 생성
  const firstDeathData = useMemo(() => {
      if (!fights || fights.length === 0) return { firstKillsT1: 0, firstKillsT2: 0, t1Players: [], t2Players: [], t1Causes: [], t2Causes: [] };
      
      let firstKillsT1 = 0;
      let firstKillsT2 = 0;
      
      const pMapT1Deaths = new Map(); 
      const pMapT2Deaths = new Map(); 
      
      const t1CausesMap = new Map(); 
      const t2CausesMap = new Map(); 

      (matchData?.stats || []).forEach(p => {
          if (checkIsTeam1(p.team_name, t1Name)) {
              if(!pMapT1Deaths.has(p.player_name)) pMapT1Deaths.set(p.player_name, { name: p.player_name, hero: p.hero_name, count: 0 });
          } else if (checkIsTeam2(p.team_name, t2Name)) {
              if(!pMapT2Deaths.has(p.player_name)) pMapT2Deaths.set(p.player_name, { name: p.player_name, hero: p.hero_name, count: 0 });
          }
      });

      fights.forEach(f => {
          const victimTeam = f.first_pick_team; 
          
          if (checkIsTeam1(victimTeam, t1Name)) {
              firstKillsT2++; 
              if (f.first_pick_event) {
                  const ev = f.first_pick_event;
                  const victimName = normalizeName(ev.target_name);
                  
                  if (pMapT1Deaths.has(victimName)) pMapT1Deaths.get(victimName).count++;
                  else pMapT1Deaths.set(victimName, { name: victimName, hero: ev.target_hero, count: 1 });
                  
                  const skillName = getAbilityName(ev.player_hero, ev.ability);
                  const causeKey = `${ev.player_hero}|${normalizeName(ev.player_name)}|${skillName}`;
                  t1CausesMap.set(causeKey, (t1CausesMap.get(causeKey) || 0) + 1);
              }
          } 
          else if (checkIsTeam2(victimTeam, t2Name)) {
              firstKillsT1++; 
              if (f.first_pick_event) {
                  const ev = f.first_pick_event;
                  const victimName = normalizeName(ev.target_name);
                  
                  if (pMapT2Deaths.has(victimName)) pMapT2Deaths.get(victimName).count++;
                  else pMapT2Deaths.set(victimName, { name: victimName, hero: ev.target_hero, count: 1 });
                  
                  const skillName = getAbilityName(ev.player_hero, ev.ability);
                  const causeKey = `${ev.player_hero}|${normalizeName(ev.player_name)}|${skillName}`;
                  t2CausesMap.set(causeKey, (t2CausesMap.get(causeKey) || 0) + 1);
              }
          }
      });

      return { 
          firstKillsT1, firstKillsT2, 
          t1Players: Array.from(pMapT1Deaths.values()).sort((a,b) => b.count - a.count), 
          t2Players: Array.from(pMapT2Deaths.values()).sort((a,b) => b.count - a.count),
          t1Causes: Array.from(t1CausesMap.entries()).map(([k, v]) => ({ name: k, count: v })).sort((a,b) => b.count - a.count),
          t2Causes: Array.from(t2CausesMap.entries()).map(([k, v]) => ({ name: k, count: v })).sort((a,b) => b.count - a.count)
      };
  }, [fights, matchData, t1Name, t2Name]);

  const maxT1Death = Math.max(...firstDeathData.t1Players.map(p => p.count), 1);
  const maxT2Death = Math.max(...firstDeathData.t2Players.map(p => p.count), 1);

  const ultSummary = useMemo(() => {
      let t1Total = 0, t2Total = 0;
      let t1First = 0, t2First = 0;
      fights.forEach(f => {
          const ults = f.events.filter(e => e.event_type === 'ultimate_start').sort((a,b) => a.timestamp - b.timestamp);
          if (ults.length > 0) {
              if (checkIsTeam1(ults[0].player_team, t1Name)) t1First++;
              else if (checkIsTeam2(ults[0].player_team, t2Name)) t2First++;
          }
          ults.forEach(u => {
              if (checkIsTeam1(u.player_team, t1Name)) t1Total++;
              else if (checkIsTeam2(u.player_team, t2Name)) t2Total++;
          });
      });
      return { t1Total, t2Total, t1First, t2First };
  }, [fights, t1Name, t2Name]);

  const timingData = useMemo(() => {
      const result = { t1: { init: 0, mid: 0, late: 0 }, t2: { init: 0, mid: 0, late: 0 } };
      fights.forEach(f => {
          const start = f.startTime;
          const end = f.fixedEndTime || (f.startTime + 20);
          const duration = end - start;
          f.events.forEach(e => {
              if (e.event_type === 'ultimate_start') {
                  const progress = (e.timestamp - start) / duration;
                  const team = checkIsTeam1(e.player_team, t1Name) ? 't1' : 't2';
                  if (progress <= 0.33) result[team].init++;
                  else if (progress <= 0.66) result[team].mid++;
                  else result[team].late++;
              }
          });
      });
      return result;
  }, [fights, t1Name, t2Name]);

  const efficiency = useMemo(() => {
      const res = { 
          t1: { wonFights: 0, lostFights: 0, wonUlts: 0, lostUlts: 0, wonWithFewerUlts: 0, lostWithFewerUlts: 0, overInvestFights: 0 },
          t2: { wonFights: 0, lostFights: 0, wonUlts: 0, lostUlts: 0, wonWithFewerUlts: 0, lostWithFewerUlts: 0, overInvestFights: 0 }
      };
      fights.forEach(f => {
          const t1Ults = f.events.filter(e => e.event_type === 'ultimate_start' && checkIsTeam1(e.player_team, t1Name)).length;
          const t2Ults = f.events.filter(e => e.event_type === 'ultimate_start' && checkIsTeam2(e.player_team, t2Name)).length;
          
          if (f.winner === t1Name) { 
              res.t1.wonFights++; res.t1.wonUlts += t1Ults; 
              res.t2.lostFights++; res.t2.lostUlts += t2Ults;
              if (t1Ults < t2Ults) res.t1.wonWithFewerUlts++; 
              if (t2Ults < t1Ults) res.t2.lostWithFewerUlts++; 
          }
          else if (f.winner === t2Name) { 
              res.t2.wonFights++; res.t2.wonUlts += t2Ults; 
              res.t1.lostFights++; res.t1.lostUlts += t1Ults;
              if (t2Ults < t1Ults) res.t2.wonWithFewerUlts++; 
              if (t1Ults < t2Ults) res.t1.lostWithFewerUlts++;
          }
          
          if (t1Ults - t2Ults >= 2) res.t1.overInvestFights++;
          if (t2Ults - t1Ults >= 2) res.t2.overInvestFights++;
      });
      return res;
  }, [fights, t1Name, t2Name]);

  const ultExchangeData = [
      { name: t.msUltEffWin, t1: efficiency.t1.wonWithFewerUlts, t2: efficiency.t2.wonWithFewerUlts },
      { name: t.msUltSaveLoss, t1: efficiency.t1.lostWithFewerUlts, t2: efficiency.t2.lostWithFewerUlts },
      { name: t.msUltOverInvest, t1: efficiency.t1.overInvestFights, t2: efficiency.t2.overInvestFights }
  ];

  const roleFinalBlowsData = useMemo(() => {
    if (!matchData || !matchData.stats) return [];
    const data = [{ role: '탱크', t1: 0, t2: 0 }, { role: '딜러', t1: 0, t2: 0 }, { role: '지원', t1: 0, t2: 0 }];
    (matchData.stats || []).forEach(stat => {
        const role = getRoleInfo(stat.hero_name).label;
        const entry = data.find(d => d.role === t[role] || d.role === role) || data.find(d => d.role === '탱크' && role === 'tank') || data.find(d => d.role === '딜러' && role === 'dps') || data.find(d => d.role === '지원' && role === 'support');
        if (entry) { if (checkIsTeam1(stat.team_name, t1Name)) entry.t1 += (stat.final_blows || 0); else entry.t2 += (stat.final_blows || 0); }
    });
    return data.map(d => ({ ...d, roleDisplay: d.role === '탱크' ? t.tank : (d.role === '딜러' ? t.dps : t.support) }));
  }, [matchData, t, t1Name, t2Name]);

  const cumulativeDamageData = useMemo(() => {
    if (!matchData || !matchData.rounds) return [];
    return matchData.rounds.map((round, idx) => {
        let t1RoundDmg = 0; let t2RoundDmg = 0;
        (round.stats || []).forEach(stat => { 
            if(checkIsTeam1(stat.team_name, t1Name)) t1RoundDmg += Math.round(Number(stat.hero_damage_dealt) || 0); 
            else t2RoundDmg += Math.round(Number(stat.hero_damage_dealt) || 0); 
        });
        return { name: `${t.round} ${idx + 1}`, t1: t1RoundDmg, t2: t2RoundDmg };
    });
  }, [matchData, t, t1Name, t2Name]);

  const scatterData = useMemo(() => {
    if (!matchData || !matchData.stats) return [];
    const sourceData = matchData.stats.filter(item => { 
        const dmg = Number(item.hero_damage_dealt) || 0;
        const heal = Number(item.healing_dealt) || 0;
        return !(dmg === 0 && heal === 0);
    });
    const processed = [];
    sourceData.forEach((item, index) => {
        processed.push({
            x: Math.round(Number(item.hero_damage_dealt) || 0),
            y: Number(item.final_blows) || 0,
            name: normalizeName(item.player_name),
            hero: item.hero_name,
            hero_image: item.hero_image,
            fill: resolveTeamColor(item.team_name, t1Name, t2Name) 
        });
    });
    return processed;
  }, [matchData, t1Name, t2Name]);

  const ScatterTooltip = ({ active, payload }) => {
    if (active && payload && payload.length) {
        const data = payload[0].payload;
        return (
            <div style={{ backgroundColor: theme.surface, border: `2px solid ${data.fill}`, padding: '12px', borderRadius: '8px' }}>
                <div style={{ display:'flex', alignItems:'center', gap:'8px', marginBottom:'4px' }}>
                    <img src={getHeroImageSrc(data.hero)} width="24" height="24" style={{borderRadius:'4px', background:'#000'}}/>
                    <span style={{color: theme.text, fontWeight:'bold'}}>{data.name}</span>
                </div>
                <div style={{ fontSize: '12px', color: theme.textSub }}>
                    <p>Dmg: {data.x.toLocaleString()}</p>
                    <p>{t.msFinalBlows}: {data.y}</p>
                </div>
            </div>
        );
    } return null;
  };
   
  const cardStyle = { background: theme.surface, border: `1px solid ${theme.border}`, borderRadius: '16px', padding: '24px', marginBottom: '24px' };
  const titleStyle = { color: theme.text, fontSize: '16px', fontWeight: 'bold', marginBottom: '20px', display:'flex', alignItems:'center', gap:'10px' };

  const ProgressBar = ({ label, leftVal, rightVal, leftColor, rightColor }) => {
      const total = leftVal + rightVal || 1;
      const leftPct = (leftVal / total) * 100;
      return (
          <div style={{ marginBottom: '20px' }}>
              <div style={{ display:'flex', justifyContent:'space-between', fontSize:'12px', fontWeight:'bold', marginBottom:'6px' }}>
                  <span style={{ color: leftColor }}>{leftVal}</span>
                  <span style={{ color: theme.textSub }}>{label}</span>
                  <span style={{ color: rightColor }}>{rightVal}</span>
              </div>
              <div style={{ height:'24px', background: theme.surfaceHighlight, borderRadius:'6px', overflow:'hidden', display:'flex' }}>
                  <div style={{ width: `${leftPct}%`, background: leftColor, transition: 'width 0.5s' }} />
                  <div style={{ flex: 1, background: rightColor, transition: 'width 0.5s' }} />
              </div>
          </div>
      );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', width: '100%' }}>
        
        {/* 💡 [기존] 패배 한타 저항력 (Kill Exchange in Lost Fights) */}
        <div style={cardStyle}>
            <div style={titleStyle}><AlertOctagon size={18} color={theme.warning || '#f59e0b'}/> {t.msLostFightTitle}</div>
            
            {/* 상단 요약 바 */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', marginBottom: '24px' }}>
                <div style={{ background: theme.bg, padding: '16px', borderRadius: '8px', border: `1px solid ${COLOR_TEAM1}40` }}>
                    <div style={{ fontSize: '13px', color: COLOR_TEAM1, fontWeight: 'bold', marginBottom: '8px' }}>{team1Name} {t.msAvgKillRateOnLoss}</div>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
                        <span style={{ fontSize: '28px', fontWeight: '900', color: theme.text }}>{lostFightData.t1Pct}%</span>
                        <span style={{ fontSize: '12px', color: theme.textSub }}>({t.msAvgWord}{lostFightData.t1Avg}{t.msKillsUnit} / {lostFightData.t1LostFights}{t.msLossUnit})</span>
                    </div>
                </div>
                <div style={{ background: theme.bg, padding: '16px', borderRadius: '8px', border: `1px solid ${COLOR_TEAM2}40` }}>
                    <div style={{ fontSize: '13px', color: COLOR_TEAM2, fontWeight: 'bold', marginBottom: '8px' }}>{team2Name} {t.msAvgKillRateOnLoss}</div>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
                        <span style={{ fontSize: '28px', fontWeight: '900', color: theme.text }}>{lostFightData.t2Pct}%</span>
                        <span style={{ fontSize: '12px', color: theme.textSub }}>({t.msAvgWord}{lostFightData.t2Avg}{t.msKillsUnit} / {lostFightData.t2LostFights}{t.msLossUnit})</span>
                    </div>
                </div>
            </div>

            {/* Fight-by-Fight 시각화 */}
            <div style={{ fontSize: '11px', color: theme.textSub, fontWeight: 'bold', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>FIGHT-BY-FIGHT LOST MOMENTUM ({t.msResistKills})</div>
            <div style={{ display: 'flex', gap: '4px', overflowX: 'auto', paddingBottom: '8px' }}>
                {fights.map((f, idx) => {
                    const isT1Win = f.winner === team1Name;
                    const isT2Win = f.winner === team2Name;
                    const isDraw = !isT1Win && !isT2Win;
                    
                    let bgColor = theme.surfaceHighlight;
                    let bottomColor = theme.textSub;
                    let bottomText = "-";

                    if (isT1Win) {
                        bgColor = COLOR_TEAM1; bottomColor = COLOR_TEAM2; bottomText = `${f.t2Kills}K`; 
                    } else if (isT2Win) {
                        bgColor = COLOR_TEAM2; bottomColor = COLOR_TEAM1; bottomText = `${f.t1Kills}K`; 
                    }

                    return (
                        <div key={idx} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: '40px', flex: 1 }}>
                            <div style={{ width: '100%', height: '24px', background: bgColor, display: 'flex', justifyContent: 'center', alignItems: 'center', fontSize: '12px', fontWeight: 'bold', color: isDraw ? theme.textSub : '#fff', borderRadius: '4px 4px 0 0' }}>{idx + 1}</div>
                            <div style={{ width: '100%', height: '22px', background: isDraw ? theme.bg : `${bottomColor}15`, display: 'flex', justifyContent: 'center', alignItems: 'center', fontSize: '11px', fontWeight: 'bold', color: bottomColor, border: `1px solid ${isDraw ? theme.border : `${bottomColor}40`}`, borderTop: 'none', borderRadius: '0 0 4px 4px' }}>{isDraw ? 'Draw' : bottomText}</div>
                        </div>
                    );
                })}
            </div>
        </div>

        {/* 💡 [신규] 연속 한타 승률 및 모멘텀 (Momentum & Turnovers) */}
        <div style={cardStyle}>
            <div style={titleStyle}><RefreshCw size={18} color={theme.primary} /> {t.msMomentumTitle}</div>
            
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
                {/* 1팀 */}
                <div style={{ background: theme.bg, padding: '20px', borderRadius: '12px', border: `1px solid ${COLOR_TEAM1}40` }}>
                    <div style={{ fontSize: '15px', color: COLOR_TEAM1, fontWeight: '900', marginBottom: '16px', textAlign: 'center' }}>{team1Name}</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div>
                                <div style={{ fontSize: '13px', fontWeight: 'bold', color: theme.text, display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: theme.success || '#10b981' }}></div>
                                    {t.msWinRateAfterWin} <span style={{ color: theme.textSub, fontWeight: 'normal', fontSize: '11px' }}>{t.msWinToWin}</span>
                                </div>
                                <div style={{ fontSize: '11px', color: theme.textSub, marginTop: '4px', marginLeft: '14px' }}>{t.msSnowball} ({momentumData.t1AfterWinWon}/{momentumData.t1AfterWinTotal}{t.timesUnit})</div>
                            </div>
                            <div style={{ fontSize: '24px', fontWeight: '900', color: theme.text }}>{momentumData.t1AfterWinPct}%</div>
                        </div>
                        <div style={{ height: '1px', background: theme.borderHighlight }}></div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div>
                                <div style={{ fontSize: '13px', fontWeight: 'bold', color: theme.text, display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: theme.danger || '#ef4444' }}></div>
                                    {t.msWinRateAfterLoss} <span style={{ color: theme.textSub, fontWeight: 'normal', fontSize: '11px' }}>{t.msLossToWin}</span>
                                </div>
                                <div style={{ fontSize: '11px', color: theme.textSub, marginTop: '4px', marginLeft: '14px' }}>{t.msComeback} ({momentumData.t1AfterLossWon}/{momentumData.t1AfterLossTotal}{t.timesUnit})</div>
                            </div>
                            <div style={{ fontSize: '24px', fontWeight: '900', color: theme.text }}>{momentumData.t1AfterLossPct}%</div>
                        </div>
                    </div>
                </div>

                {/* 2팀 */}
                <div style={{ background: theme.bg, padding: '20px', borderRadius: '12px', border: `1px solid ${COLOR_TEAM2}40` }}>
                    <div style={{ fontSize: '15px', color: COLOR_TEAM2, fontWeight: '900', marginBottom: '16px', textAlign: 'center' }}>{team2Name}</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div>
                                <div style={{ fontSize: '13px', fontWeight: 'bold', color: theme.text, display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: theme.success || '#10b981' }}></div>
                                    {t.msWinRateAfterWin} <span style={{ color: theme.textSub, fontWeight: 'normal', fontSize: '11px' }}>{t.msWinToWin}</span>
                                </div>
                                <div style={{ fontSize: '11px', color: theme.textSub, marginTop: '4px', marginLeft: '14px' }}>{t.msSnowball} ({momentumData.t2AfterWinWon}/{momentumData.t2AfterWinTotal}{t.timesUnit})</div>
                            </div>
                            <div style={{ fontSize: '24px', fontWeight: '900', color: theme.text }}>{momentumData.t2AfterWinPct}%</div>
                        </div>
                        <div style={{ height: '1px', background: theme.borderHighlight }}></div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div>
                                <div style={{ fontSize: '13px', fontWeight: 'bold', color: theme.text, display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: theme.danger || '#ef4444' }}></div>
                                    {t.msWinRateAfterLoss} <span style={{ color: theme.textSub, fontWeight: 'normal', fontSize: '11px' }}>{t.msLossToWin}</span>
                                </div>
                                <div style={{ fontSize: '11px', color: theme.textSub, marginTop: '4px', marginLeft: '14px' }}>{t.msComeback} ({momentumData.t2AfterLossWon}/{momentumData.t2AfterLossTotal}{t.timesUnit})</div>
                            </div>
                            <div style={{ fontSize: '24px', fontWeight: '900', color: theme.text }}>{momentumData.t2AfterLossPct}%</div>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        {/* 1. 선취점 분석 (First Deaths) + 개인별 순위표 */}
        <div style={cardStyle}>
            <div style={titleStyle}><Skull size={18} color={theme.danger}/> {t.msFirstDeathAnalysis}</div>
            <ProgressBar label={t.msFirstKillCountTeam} leftVal={firstDeathData.firstKillsT1} rightVal={firstDeathData.firstKillsT2} leftColor={COLOR_TEAM1} rightColor={COLOR_TEAM2} />
            
            <div style={{ display: 'flex', gap: '24px', marginTop: '24px', flexWrap: 'wrap' }}>
                {/* 1팀 표 */}
                <div style={{ flex: 1, minWidth: '300px' }}>
                    <div style={{ fontSize: '13px', fontWeight: 'bold', color: COLOR_TEAM1, marginBottom: '8px' }}>{team1Name} {t.msFirstDeathRank}</div>
                    <div style={{ background: theme.bg, borderRadius: '8px', border: `1px solid ${COLOR_TEAM1}40`, overflow: 'hidden' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                            <thead style={{ background: theme.surfaceHighlight, borderBottom: `1px solid ${theme.border}` }}>
                                <tr>
                                    <th style={{ padding: '8px 12px', fontSize: '11px', color: theme.textSub }}>{t.msPlayerHero}</th>
                                    <th style={{ padding: '8px 12px', fontSize: '11px', color: theme.textSub, textAlign: 'right', width: '80px' }}>{t.msFirstBloodDeaths}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {firstDeathData.t1Players.map((p, idx) => (
                                    <tr key={idx} style={{ borderBottom: idx !== firstDeathData.t1Players.length -1 ? `1px solid ${theme.border}` : 'none' }}>
                                        <td style={{ padding: '8px 12px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                            {p.hero && <img src={getHeroImageSrc(p.hero)} alt={p.hero} style={{ width: 22, height: 22, borderRadius: 4, background: '#000' }} />}
                                            <span style={{ color: theme.text, fontWeight: 'bold' }}>{p.name}</span>
                                        </td>
                                        <td style={{ position: 'relative', padding: '8px 12px', fontSize: '13px', textAlign: 'right', fontWeight: 'bold', color: p.count > 0 ? theme.danger : theme.textSub }}>
                                            {p.count > 0 && (
                                                <div style={{ position: 'absolute', top: 4, bottom: 4, right: 12, width: `${(p.count / maxT1Death) * 100}%`, background: `${theme.danger}30`, borderRadius: '4px', zIndex: 0, transition: 'width 0.5s' }}></div>
                                            )}
                                            <span style={{ position: 'relative', zIndex: 1 }}>{p.count}</span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    {/* 1팀 주요 데스 원인 */}
                    <div style={{ marginTop: '12px', background: theme.bg, borderRadius: '8px', border: `1px solid ${COLOR_TEAM1}40`, padding: '12px' }}>
                        <div style={{ fontSize: '12px', color: theme.textSub, marginBottom: '8px', fontWeight: 'bold' }}>{t.msDeathCause}</div>
                        {firstDeathData.t1Causes.slice(0, 3).map((cause, idx) => {
                            const [kHero, kName, skill] = cause.name.split('|');
                            return (
                                <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px', fontSize: '12px' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1, minWidth: 0 }}>
                                        <img src={getHeroImageSrc(kHero)} style={{ width: 16, height: 16, borderRadius: 2, flexShrink: 0 }} onError={e=>e.currentTarget.style.display='none'}/>
                                        <span style={{ color: theme.textSub, fontSize: '11px', overflow: 'hidden', textOverflow: 'ellipsis' }}>{kName}</span>
                                        <span style={{ color: theme.textSub, fontSize: '11px', margin: '0 2px', flexShrink: 0 }}>➔</span>
                                        <span style={{ fontWeight: 'bold', color: theme.text, overflow: 'hidden', textOverflow: 'ellipsis' }}>{skill}</span>
                                    </div>
                                    <span style={{ fontWeight: 'bold', color: theme.danger, marginLeft: '8px', flexShrink: 0 }}>{cause.count}{t.timesUnit}</span>
                                </div>
                            )
                        })}
                        {firstDeathData.t1Causes.length === 0 && <div style={{ fontSize:'11px', color:theme.textSub }}>{t.msNoDataShort}</div>}
                    </div>
                </div>

                {/* 2팀 표 */}
                <div style={{ flex: 1, minWidth: '300px' }}>
                    <div style={{ fontSize: '13px', fontWeight: 'bold', color: COLOR_TEAM2, marginBottom: '8px' }}>{team2Name} {t.msFirstDeathRank}</div>
                    <div style={{ background: theme.bg, borderRadius: '8px', border: `1px solid ${COLOR_TEAM2}40`, overflow: 'hidden' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                            <thead style={{ background: theme.surfaceHighlight, borderBottom: `1px solid ${theme.border}` }}>
                                <tr>
                                    <th style={{ padding: '8px 12px', fontSize: '11px', color: theme.textSub }}>{t.msPlayerHero}</th>
                                    <th style={{ padding: '8px 12px', fontSize: '11px', color: theme.textSub, textAlign: 'right', width: '80px' }}>{t.msFirstBloodDeaths}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {firstDeathData.t2Players.map((p, idx) => (
                                    <tr key={idx} style={{ borderBottom: idx !== firstDeathData.t2Players.length -1 ? `1px solid ${theme.border}` : 'none' }}>
                                        <td style={{ padding: '8px 12px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                            {p.hero && <img src={getHeroImageSrc(p.hero)} alt={p.hero} style={{ width: 22, height: 22, borderRadius: 4, background: '#000' }} />}
                                            <span style={{ color: theme.text, fontWeight: 'bold' }}>{p.name}</span>
                                        </td>
                                        <td style={{ position: 'relative', padding: '8px 12px', fontSize: '13px', textAlign: 'right', fontWeight: 'bold', color: p.count > 0 ? theme.danger : theme.textSub }}>
                                            {p.count > 0 && (
                                                <div style={{ position: 'absolute', top: 4, bottom: 4, right: 12, width: `${(p.count / maxT2Death) * 100}%`, background: `${theme.danger}30`, borderRadius: '4px', zIndex: 0, transition: 'width 0.5s' }}></div>
                                            )}
                                            <span style={{ position: 'relative', zIndex: 1 }}>{p.count}</span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    {/* 2팀 주요 데스 원인 */}
                    <div style={{ marginTop: '12px', background: theme.bg, borderRadius: '8px', border: `1px solid ${COLOR_TEAM2}40`, padding: '12px' }}>
                        <div style={{ fontSize: '12px', color: theme.textSub, marginBottom: '8px', fontWeight: 'bold' }}>{t.msDeathCause}</div>
                        {firstDeathData.t2Causes.slice(0, 3).map((cause, idx) => {
                            const [kHero, kName, skill] = cause.name.split('|');
                            return (
                                <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px', fontSize: '12px' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1, minWidth: 0 }}>
                                        <img src={getHeroImageSrc(kHero)} style={{ width: 16, height: 16, borderRadius: 2, flexShrink: 0 }} onError={e=>e.currentTarget.style.display='none'}/>
                                        <span style={{ color: theme.textSub, fontSize: '11px', overflow: 'hidden', textOverflow: 'ellipsis' }}>{kName}</span>
                                        <span style={{ color: theme.textSub, fontSize: '11px', margin: '0 2px', flexShrink: 0 }}>➔</span>
                                        <span style={{ fontWeight: 'bold', color: theme.text, overflow: 'hidden', textOverflow: 'ellipsis' }}>{skill}</span>
                                    </div>
                                    <span style={{ fontWeight: 'bold', color: theme.danger, marginLeft: '8px', flexShrink: 0 }}>{cause.count}{t.timesUnit}</span>
                                </div>
                            )
                        })}
                        {firstDeathData.t2Causes.length === 0 && <div style={{ fontSize:'11px', color:theme.textSub }}>{t.msNoDataShort}</div>}
                    </div>
                </div>
            </div>
        </div>

        {/* 2. 궁극기 종합 (Ultimates) */}
        <div style={cardStyle}>
            <div style={titleStyle}><Zap size={18} color={NEON_GREEN}/> {t.msUltSummary}</div>
            <ProgressBar label={t.msTotalUlts} leftVal={ultSummary.t1Total} rightVal={ultSummary.t2Total} leftColor={COLOR_TEAM1} rightColor={COLOR_TEAM2} />
            <ProgressBar label={t.msFirstUltInFight} leftVal={ultSummary.t1First} rightVal={ultSummary.t2First} leftColor={COLOR_TEAM1} rightColor={COLOR_TEAM2} />
        </div>

        {/* 3 & 4. 궁극기 타이밍 & 가성비 */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(400px, 1fr))', gap:'24px' }}>
            {/* 3. 타이밍 */}
            <div style={{...cardStyle, marginBottom: 0}}>
                <div style={titleStyle}><Clock size={18} color={theme.primary}/> {t.msUltTiming}</div>
                <div style={{ display:'flex', flexDirection:'column', gap:'16px' }}>
                    {[t1Name, t2Name].map((name, idx) => {
                        const data = idx === 0 ? timingData.t1 : timingData.t2;
                        const total = data.init + data.mid + data.late || 1;
                        return (
                            <div key={idx}>
                                <div style={{ fontSize:'13px', fontWeight:'bold', marginBottom:'6px', color: idx === 0 ? COLOR_TEAM1 : COLOR_TEAM2 }}>{name}</div>
                                <div style={{ height:'30px', background: theme.surfaceHighlight, borderRadius:'6px', overflow:'hidden', display:'flex' }}>
                                    <div style={{ width: `${(data.init/total)*100}%`, background: '#4ade80' }} title={t.msPhaseEarly}/>
                                    <div style={{ width: `${(data.mid/total)*100}%`, background: '#fbbf24' }} title={t.msPhaseMid}/>
                                    <div style={{ width: `${(data.late/total)*100}%`, background: '#f87171' }} title={t.msPhaseLate}/>
                                </div>
                            </div>
                        );
                    })}
                    <div style={{ display:'flex', gap:'12px', fontSize:'11px', color: theme.textSub, marginTop:'8px' }}>
                        <span style={{display:'flex', alignItems:'center', gap:'4px'}}><div style={{width:8, height:8, background:'#4ade80'}}/> {t.msPhaseEarly}</span>
                        <span style={{display:'flex', alignItems:'center', gap:'4px'}}><div style={{width:8, height:8, background:'#fbbf24'}}/> {t.msPhaseMid}</span>
                        <span style={{display:'flex', alignItems:'center', gap:'4px'}}><div style={{width:8, height:8, background:'#f87171'}}/> {t.msPhaseLate}</span>
                    </div>
                </div>
            </div>

            {/* 4. 가성비 및 교환비 */}
            <div style={{...cardStyle, marginBottom: 0}}>
                <div style={titleStyle}><Target size={18} color={theme.success}/> {t.msUltExchange}</div>
                <div style={{ display:'flex', flexDirection:'column', gap:'16px' }}>
                    
                    {/* 상단 텍스트 요약 */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                        {[t1Name, t2Name].map((name, idx) => {
                            const data = idx === 0 ? efficiency.t1 : efficiency.t2;
                            const avgWon = data.wonFights > 0 ? (data.wonUlts / data.wonFights).toFixed(1) : "0.0";
                            const avgLost = data.lostFights > 0 ? (data.lostUlts / data.lostFights).toFixed(1) : "0.0";
                            return (
                                <div key={idx} style={{ padding:'12px', background: theme.bg, borderRadius:'8px', border:`1px solid ${idx === 0 ? COLOR_TEAM1 : COLOR_TEAM2}40` }}>
                                    <div style={{ fontWeight:'bold', color: idx === 0 ? COLOR_TEAM1 : COLOR_TEAM2, marginBottom:'12px', fontSize: '13px' }}>{name} {t.msAvgConsumed}</div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                        <div style={{ fontSize:'11px', color: theme.textSub, display: 'flex', justifyContent: 'space-between' }}><span>{t.msWonFight}</span> <strong style={{color: theme.success, fontSize:'13px'}}>{avgWon}{t.msCountUnit}</strong></div>
                                        <div style={{ fontSize:'11px', color: theme.textSub, display: 'flex', justifyContent: 'space-between' }}><span>{t.msLostFightLabel}</span> <strong style={{color: theme.danger, fontSize:'13px'}}>{avgLost}{t.msCountUnit}</strong></div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    {/* 하단 바 차트 (교환비 & 과투자) */}
                    <div style={{ width: '100%', height: 180, marginTop: '8px' }}>
                        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                            <BarChart data={ultExchangeData} layout="vertical" margin={{ top: 0, right: 10, left: 10, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke={theme.border} horizontal={false} />
                                <XAxis type="number" stroke={theme.textSub} fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
                                <YAxis type="category" dataKey="name" stroke={theme.textSub} fontSize={10} tickLine={false} axisLine={false} width={160} tick={{ fill: theme.textSub }} />
                                <Tooltip cursor={{fill: theme.surfaceHighlight, opacity: 0.4}} contentStyle={{ backgroundColor: theme.surface, border: 'none', borderRadius: '8px', color: theme.text, fontSize:'12px' }} />
                                <Legend verticalAlign="top" height={30} wrapperStyle={{fontSize:'11px'}}/>
                                <Bar dataKey="t1" name={t1Name} fill={COLOR_TEAM1} radius={[0, 4, 4, 0]} barSize={12} animationDuration={1000} />
                                <Bar dataKey="t2" name={t2Name} fill={COLOR_TEAM2} radius={[0, 4, 4, 0]} barSize={12} animationDuration={1000} />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>

                </div>
            </div>
        </div>

        {/* 생존 인원 차트 */}
        <div style={cardStyle}>
            <div style={titleStyle}><Activity size={18}/> {t.fightSurvivors}</div>
            <div style={{ display: 'grid', gridTemplateColumns: '3fr 1fr', gap: '24px' }}>
                <div style={{ minWidth: 0 }}>
                    <FightSurvivorsChart fights={fights} team1Name={team1Name} team2Name={team2Name} theme={theme} t={t} />
                </div>
                <div style={{ borderLeft: `1px solid ${theme.border}`, paddingLeft: '24px', minWidth: 0 }}>
                    <AverageSurvivorsChart fights={fights} team1Name={team1Name} team2Name={team2Name} theme={theme} t={t} />
                </div>
            </div>
        </div>

        {/* 역할별 결정타 차트 */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '24px' }}>
            <div style={{ ...cardStyle, marginBottom: 0 }}>
                <div style={titleStyle}><Crosshair size={18}/> {t.fbByRole}</div>
                <div style={{ width: '100%', height: 300 }}>
                    <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                        <BarChart data={roleFinalBlowsData}>
                            <CartesianGrid strokeDasharray="3 3" stroke={theme.border} vertical={false} />
                            <XAxis dataKey="roleDisplay" stroke={theme.textSub} fontSize={12} tickLine={false} axisLine={false} />
                            <YAxis stroke={theme.textSub} fontSize={12} tickLine={false} axisLine={false} width={30}/>
                            <Tooltip cursor={{fill: 'transparent'}} contentStyle={{ backgroundColor: theme.surface, border: 'none', borderRadius: '8px', color: theme.text, fontSize:'13px' }} />
                            <Legend verticalAlign="top" height={36} wrapperStyle={{fontSize:'12px'}}/>
                            <Bar dataKey="t1" name={team1Name} fill={NEON_GREEN} radius={[4, 4, 0, 0]} barSize={36} />
                            <Bar dataKey="t2" name={team2Name} fill={COLOR_TEAM2} radius={[4, 4, 0, 0]} barSize={36} />
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            </div>

            {/* 누적 딜량 차트 */}
            <div style={{ ...cardStyle, marginBottom: 0 }}>
                <div style={titleStyle}><Zap size={18}/> {t.cumulativeDmg}</div>
                <div style={{ width: '100%', height: 280 }}>
                    <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                        <AreaChart data={cumulativeDamageData}>
                            <defs>
                                <linearGradient id="colorTeam1" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor={NEON_GREEN} stopOpacity={0.3}/>
                                    <stop offset="95%" stopColor={NEON_GREEN} stopOpacity={0}/>
                                </linearGradient>
                                <linearGradient id="colorTeam2" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor={COLOR_TEAM2} stopOpacity={0.3}/>
                                    <stop offset="95%" stopColor={COLOR_TEAM2} stopOpacity={0}/>
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke={theme.border} vertical={false} />
                            <XAxis dataKey="name" stroke={theme.textSub} fontSize={12} tickLine={false} axisLine={false} />
                            <YAxis stroke={theme.textSub} fontSize={12} tickLine={false} axisLine={false} width={40}/>
                            <Tooltip contentStyle={{ backgroundColor: theme.surface, border: 'none', borderRadius: '8px', color: theme.text, fontSize:'13px' }} />
                            <Legend verticalAlign="top" height={36} wrapperStyle={{fontSize:'12px'}}/>
                            <Area type="monotone" dataKey="t1" name={team1Name} stroke={NEON_GREEN} fillOpacity={1} fill="url(#colorTeam1)" />
                            <Area type="monotone" dataKey="t2" name={team2Name} stroke={COLOR_TEAM2} fillOpacity={1} fill="url(#colorTeam2)" />
                        </AreaChart>
                    </ResponsiveContainer>
                </div>
            </div>
        </div>

        {/* 딜링 효율성 산점도 */}
        <div style={cardStyle}>
            <div style={titleStyle}><Crosshair size={18}/> {t.dmgEfficiency}</div>
            <div style={{ width: '100%', height: 350 }}>
                <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                    <ScatterChart margin={{ top: 20, right: 20, bottom: 50, left: 20 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke={theme.border} />
                        <XAxis type="number" dataKey="x" name={t.heroDmg} stroke={theme.textSub} fontSize={12} label={{ value: t.heroDmgDealt, position: 'insideBottom', offset: -30, fill: theme.textSub }} />
                        <YAxis type="number" dataKey="y" name={t.finalBlows} stroke={theme.textSub} fontSize={12} label={{ value: t.finalBlows, angle: -90, position: 'insideLeft', fill: theme.textSub }} />
                        <ZAxis type="number" dataKey="z" range={[60, 60]} />
                        <Tooltip content={<ScatterTooltip />} cursor={{ strokeDasharray: '3 3' }} />
                        <Scatter name="Players" data={scatterData}>
                            {scatterData.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={entry.fill} />
                            ))}
                        </Scatter>
                        <Legend verticalAlign="top" height={36} content={() => (
                                <div style={{display:'flex', justifyContent:'center', gap:'16px', fontSize:'12px', color: theme.textSub}}>
                                    <span style={{display:'flex', alignItems:'center', gap:'4px'}}><span style={{width:10, height:10, borderRadius:'50%', background:COLOR_TEAM1}}></span>{team1Name}</span>
                                    <span style={{display:'flex', alignItems:'center', gap:'4px'}}><span style={{width:10, height:10, borderRadius:'50%', background:COLOR_TEAM2}}></span>{team2Name}</span>
                                </div>
                            )}
                        />
                    </ScatterChart>
                </ResponsiveContainer>
            </div>
            <div style={{ display:'flex', justifyContent:'space-between', fontSize:'12px', color: theme.textSub, marginTop:'8px', padding:'0 40px' }}>
                <span>◀ {t.battery}</span>
                <span>{t.carry} ▶</span>
            </div>
        </div>
    </div>
  );
};

// =================================================================================
// [4] 이벤트 뷰 (EventsView)
// =================================================================================
const EventsView = ({ matchData, t1Name, t2Name }) => {
  const { theme } = useTheme();
  const { t } = useLanguage();
  const [noVideoModal, setNoVideoModal] = useState(false);
  const videoExists = hasVideo(matchData?.video_url);

  const formatTime = (sec) => {
    const isNegative = sec < 0;
    const absoluteSec = Math.abs(sec);
    const m = Math.floor(absoluteSec / 60);
    const s = Math.floor(absoluteSec % 60);
    return `${isNegative ? '-' : ''}${m}m ${s}s`;
  };

  const setupStartTime = useMemo(() => {
    if (!matchData?.rounds) return 0;
    const allEvents = matchData.rounds.flatMap(r => r.events || []);
    const setupEvent = allEvents.find(e => 
      e.event_type === 'setup_complete' || 
      (e.event_type && e.event_type.includes('setup_complete'))
    );
    return setupEvent ? setupEvent.timestamp : 0;
  }, [matchData]);

  const getYouTubeLink = (eventTimestamp) => {
      return buildVideoLink(matchData.video_url, eventTimestamp, matchData);
  };

  const processedEvents = useMemo(() => {
    if (!matchData) return { general: [], ultimates: [] };
    
    const allEvents = (matchData.rounds || []).flatMap(r => r.events || []).sort((a, b) => a.timestamp - b.timestamp);
    
    const finalGeneral = [];
    const killsBuffer = []; 

    const setupEvent = allEvents.find(e => e.event_type === 'setup_complete');
    if (setupEvent) {
        finalGeneral.push({
            ...setupEvent,
            displayTime: 0,
            realTimestamp: setupEvent.timestamp,
            label: t.round,
            desc: `${t.round} 1 ${t.matchStart}`,
            color: theme.text
        });
    }

    allEvents.forEach((ev) => {
        const displayTime = ev.timestamp - setupStartTime;

        if (ev.event_type === 'round_start') {
            if (ev.round_number > 1) {
                 finalGeneral.push({ 
                     ...ev, 
                     displayTime, 
                     realTimestamp: ev.timestamp,
                     label: t.round, 
                     desc: `${t.round} ${ev.round_number} ${t.matchStart}` 
                 });
            }
            return; 
        } 
        
        if (ev.event_type === 'setup_complete') return;

        if (ev.event_type === 'round_end') {
            finalGeneral.push({ ...ev, displayTime, realTimestamp: ev.timestamp, label: t.round, desc: `${t.round} ${ev.round_number || '?'} ${t.matchEnd}` });
        } else if (ev.event_type === 'objective_captured') {
            const team = String(ev.capturing_team || ev.player_team || 'Unknown Team').trim();
            finalGeneral.push({ ...ev, displayTime, realTimestamp: ev.timestamp, label: t.objectiveCaptured || t.events, desc: `${team}: ${t.objectiveCaptured || t.events}`, color: resolveTeamColor(team, t1Name, t2Name) });
        }
        
        if (ev.event_type === 'kill') {
            killsBuffer.push(ev);
            while(killsBuffer.length > 0 && ev.timestamp - killsBuffer[0].timestamp > 10) {
                killsBuffer.shift();
            }
            const killerName = ev.player_name;
            const recentKills = killsBuffer.filter(k => k.player_name === killerName);
            if (recentKills.length === 3) {
                 finalGeneral.push({ ...ev, displayTime, realTimestamp: ev.timestamp, label: t.msMultiKill, desc: `${killerName} 3${t.msKillsUnit}`, color: resolveTeamColor(ev.player_team, t1Name, t2Name), hero: ev.player_hero });
            }
            if (recentKills.length === 4) {
                 finalGeneral.push({ ...ev, displayTime, realTimestamp: ev.timestamp, label: t.msMultiKill, desc: `${killerName} 4${t.msKillsUnit}`, color: resolveTeamColor(ev.player_team, t1Name, t2Name), hero: ev.player_hero });
            }
            if (recentKills.length >= 5) {
                 finalGeneral.push({ ...ev, displayTime, realTimestamp: ev.timestamp, label: t.msTeamKill, desc: `${killerName} ${recentKills.length}${t.msKillsUnit}`, color: resolveTeamColor(ev.player_team, t1Name, t2Name), hero: ev.player_hero });
            }
        }
    });

    finalGeneral.sort((a, b) => a.displayTime - b.displayTime);

    const ultimates = allEvents.filter(e => e.event_type === 'ultimate_start').map(ev => ({
        ...ev,
        displayTime: ev.timestamp - setupStartTime,
        realTimestamp: ev.timestamp,
        desc: `${ev.player_name} (${getDisplayName(ev.player_hero)})`
    }));

    return { general: finalGeneral, ultimates };
  }, [matchData, setupStartTime, theme, t, t1Name, t2Name]);

  const EventItem = ({ time, displayTime, label, desc, color, hero, url }) => {
    const handleClick = () => {
      if (url) {
        window.open(url, '_blank', 'noopener,noreferrer');
      } else {
        setNoVideoModal(true);
      }
    };
    return (
      <div
          onClick={handleClick}
          style={{ display: 'flex', alignItems: 'flex-start', padding: '12px 0', borderBottom: `1px solid ${theme.border}`, cursor: 'pointer', transition: 'background 0.2s' }}
          onMouseOver={e => e.currentTarget.style.background = theme.surfaceHighlight}
          onMouseOut={e => e.currentTarget.style.background = 'transparent'}
      >
          <div style={{ width: '80px', flexShrink: 0, fontSize: '13px', color: theme.text, fontWeight: 'bold', fontFamily: 'monospace' }}>
              {formatTime(displayTime)}
          </div>
          <div style={{ flexGrow: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '2px' }}>
                  {hero && <img src={getHeroImageSrc(hero)} alt={hero} style={{width:'20px', height:'20px', borderRadius:'4px', background:'#000'}}/>}
                  <span style={{ fontSize: '14px', fontWeight: 'bold', color: color || theme.text }}>
                       {label && <span style={{marginRight:'6px'}}>{label} -</span>}
                       <span style={{fontWeight:'normal', color: theme.textSub}}>{desc}</span>
                  </span>
              </div>
          </div>
          <PlayCircle size={16} color={url ? theme.textSub : theme.border} style={{marginTop:'4px', flexShrink:0}}/>
      </div>
    );
  };

  return (
    <>
    <NoVideoModal open={noVideoModal} onClose={() => setNoVideoModal(false)} />
    {!videoExists && (
      <div style={{ display:'flex', alignItems:'center', gap:'8px', padding:'12px 16px', marginBottom:'16px', background: theme.surface, border:`1px solid ${theme.border}`, borderRadius:'10px', color: theme.textSub, fontSize:'14px' }}>
        <span>📹</span>
        <span>{t.msNoVideo}</span>
      </div>
    )}
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '24px', width: '100%' }}>
        <div style={{ background: theme.surface, border: `1px solid ${theme.border}`, borderRadius: '16px', padding: '24px', maxHeight:'600px', overflowY:'auto' }}>
            <div style={{ fontSize: '16px', fontWeight: 'bold', color: theme.text, marginBottom: '8px', display:'flex', alignItems:'center', gap:'8px' }}>
                <Activity size={18}/> {t.events}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
                {processedEvents.general.length > 0 ? processedEvents.general.map((ev, idx) => (
                    <EventItem 
                        key={idx} 
                        time={ev.timestamp} 
                        displayTime={ev.displayTime}
                        label={ev.label} 
                        desc={ev.desc} 
                        color={ev.color} 
                        hero={ev.hero} 
                        url={getYouTubeLink(ev.realTimestamp)}
                    />
                )) : <div style={{padding:'20px', textAlign:'center', color: theme.textSub}}>{t.noEvents}</div>}
            </div>
        </div>

        <div style={{ background: theme.surface, border: `1px solid ${theme.border}`, borderRadius: '16px', padding: '24px', maxHeight:'600px', overflowY:'auto' }}>
            <div style={{ fontSize: '16px', fontWeight: 'bold', color: theme.text, marginBottom: '8px', display:'flex', alignItems:'center', gap:'8px' }}>
                <Zap size={18}/> {t.ultimatesUsed}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
                {processedEvents.ultimates.length > 0 ? processedEvents.ultimates.map((ev, idx) => (
                    <EventItem 
                        key={idx} 
                        time={ev.timestamp} 
                        displayTime={ev.displayTime}
                        desc={ev.desc} 
                        color={resolveTeamColor(ev.player_team, t1Name, t2Name)} 
                        hero={ev.player_hero} 
                        url={getYouTubeLink(ev.realTimestamp)}
                    />
                )) : <div style={{padding:'20px', textAlign:'center', color: theme.textSub}}>{t.noUlts}</div>}
            </div>
        </div>
    </div>
    </>
  );
};

// =================================================================================
// [4.5] 궁극기 타임라인 뷰 (UltTimelineView)
// 현재 보는 매치/라운드 범위(dataSummary.fights — 킬 로그와 동일 computeFights 결과)의
// 한타별 궁 흐름 뷰어. 계산 로직 신규 없음: 이미 계산된 fights를 그대로 표시.
// VOD 점프 = buildVideoLink(한타 시작 - VOD_LEAD_SEC) — 한타 분석 탭과 동일 계산(영상상 약 12초 전).
// =================================================================================
const UltTimelineView = ({ fights, matchData, t1Name, t2Name }) => {
  const { theme } = useTheme();
  const { t } = useLanguage();
  const [noVideoModal, setNoVideoModal] = useState(false);
  const videoExists = hasVideo(matchData?.video_url);

  // EventsView와 동일한 기준 시각(첫 setup_complete) — 표시용 매치 시계
  const setupStartTime = useMemo(() => {
    if (!matchData?.rounds) return 0;
    const allEvents = matchData.rounds.flatMap(r => r.events || []);
    const setupEvent = allEvents.find(e =>
      e.event_type === 'setup_complete' ||
      (e.event_type && e.event_type.includes('setup_complete'))
    );
    return setupEvent ? setupEvent.timestamp : 0;
  }, [matchData]);

  const fmtClock = (sec) => {
    const neg = sec < 0;
    const s = Math.floor(Math.abs(sec));
    return `${neg ? '-' : ''}${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };

  const openVod = (f) => {
    if (!videoExists) { setNoVideoModal(true); return; }
    const url = buildVideoLink(matchData.video_url, Math.max(0, f.startTime - VOD_LEAD_SEC), matchData);
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <>
      <NoVideoModal open={noVideoModal} onClose={() => setNoVideoModal(false)} />
      <p style={{ color: theme.textSub, fontSize: '13px', margin: '0 0 16px' }}>{t.msUltTlNote}</p>
      {fights.length === 0 && (
        <div style={{ padding: '40px', textAlign: 'center', color: theme.textSub }}>{t.msNoFights}</div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        {fights.map((f, i) => {
          const ults = (f.events || []).filter(e => e.event_type === 'ultimate_start');
          const firstTs = ults.length > 0 ? ults[0].timestamp : null;
          const winnerNode = f.winner === 'Draw'
            ? <span style={{ color: theme.textSub }}>{t.msUltTlDraw}</span>
            : <span style={{ color: resolveTeamColor(f.winner, t1Name, t2Name), fontWeight: 800 }}>{f.winner}</span>;
          return (
            <div key={i} style={{ background: theme.surface, border: `1px solid ${theme.border}`, borderRadius: '12px', padding: '14px 18px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginBottom: ults.length > 0 ? '10px' : 0 }}>
                <span style={{ fontWeight: 800, color: theme.text }}>{t.msUltTlFight} {i + 1}</span>
                <span style={{ color: theme.textSub, fontSize: '13px', fontFamily: 'monospace' }}>{fmtClock(f.startTime - setupStartTime)}</span>
                <span style={{ fontSize: '13px', color: theme.textSub }}>{t.msUltTlWinner}: {winnerNode}</span>
                <button onClick={() => openVod(f)}
                  style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: '6px', background: 'transparent', border: 'none', cursor: 'pointer', color: videoExists ? theme.textSub : theme.border, fontSize: '13px' }}>
                  <PlayCircle size={16} /> {videoExists ? t.ffWatch : t.ffNoVideo}
                </button>
              </div>
              {ults.length === 0 ? (
                <div style={{ color: theme.textSub, fontSize: '13px' }}>{t.msUltTlNoUlt}</div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '6px', fontSize: '13px' }}>
                  {ults.map((u, j) => (
                    <React.Fragment key={j}>
                      {j > 0 && <span style={{ color: theme.textSub }}>→</span>}
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: '5px',
                        background: theme.surfaceHighlight, border: `1px solid ${theme.border}`,
                        borderRadius: '8px', padding: '3px 9px', whiteSpace: 'nowrap',
                      }}>
                        <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: resolveTeamColor(u.player_team, t1Name, t2Name), flexShrink: 0 }} />
                        <span style={{ color: theme.text, fontWeight: 600 }}>{u.player_name}</span>
                        <span style={{ color: theme.textSub }}>({getDisplayName(u.player_hero)})</span>
                        <span style={{ color: theme.textSub, fontFamily: 'monospace' }}>+{(u.timestamp - firstTs).toFixed(1)}s</span>
                      </span>
                    </React.Fragment>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
};

// =================================================================================
// [5] 플레이어 통계 뷰 (PlayerStatsView)
// =================================================================================
const PlayerStatsView = ({ matchData, t1Name, t2Name }) => {
    const { theme } = useTheme();
    const { t } = useLanguage();

    const [selP1, setSelP1] = useState(normalizeName(matchData?.stats?.filter(p => checkIsTeam1(p.team_name, t1Name))[0]?.player_name));
    const [selP2, setSelP2] = useState(normalizeName(matchData?.stats?.filter(p => checkIsTeam2(p.team_name, t2Name))[0]?.player_name));

    const getPlayerHeroStats = (playerName, teamCheckFn) => {
        const heroMap = {};
        (matchData.rounds || []).forEach(r => {
            const entry = r.stats.find(s => normalizeName(s.player_name) === playerName && teamCheckFn(s.team_name));
            if (entry) {
                const h = entry.hero_name;
                if (!heroMap[h]) heroMap[h] = { ...entry };
                else {
                    heroMap[h].eliminations += entry.eliminations;
                    heroMap[h].hero_damage_dealt += entry.hero_damage_dealt;
                    heroMap[h].deaths += entry.deaths;
                    heroMap[h].final_blows += entry.final_blows;
                    heroMap[h].ultimates_used += entry.ultimates_used;
                    heroMap[h].hero_time_played += entry.hero_time_played;
                    heroMap[h].solo_kills = (heroMap[h].solo_kills || 0) + (entry.solo_kills || 0);
                }
            }
        });
        return Object.values(heroMap).sort((a,b) => b.hero_time_played - a.hero_time_played);
    };

    const PlayerSection = ({ teamLabel, teamColor, selPlayerName, setSelPlayerName, players, teamCheckFn }) => {
        const heroStats = getPlayerHeroStats(selPlayerName, teamCheckFn);
        const [selHeroIdx, setSelHeroIdx] = useState(0);
        useEffect(() => { setSelHeroIdx(0); }, [selPlayerName]);

        const curHero = heroStats[selHeroIdx] || heroStats[0];
        const getP10 = (v, t) => (!t || t === 0) ? "0.00" : ((v / t) * 600).toFixed(2);
        const gameDur = matchData?.timeline?.duration_sec || 1;

        const StatBox = ({ label, value, subValue, subLabel }) => (
            <div style={{ 
                background: theme.surfaceHighlight, 
                padding: '12px', 
                borderRadius: '8px', 
                border: `1px solid ${theme.border}`, 
                display:'flex', 
                flexDirection:'column', 
                justifyContent:'space-between',
                height: '84px' 
            }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'4px' }}>
                    <span style={{ fontSize: '11px', color: theme.textSub, fontWeight: '600', textTransform:'uppercase', letterSpacing:'0.5px' }}>{label}</span>
                </div>
                <div>
                    <div style={{ fontSize: '20px', fontWeight: '800', color: theme.text, lineHeight:'1.2' }}>{value}</div>
                    <div style={{ fontSize: '10px', color: theme.textSub, marginTop:'2px' }}>{subValue} {subLabel}</div>
                </div>
            </div>
        );

        return (
            <div style={{ flex: 1, display:'flex', flexDirection:'column' }}>
                <div style={{ display:'flex', alignItems:'center', gap:'8px', marginBottom:'16px', paddingLeft:'4px' }}>
                      <div style={{ width:'8px', height:'8px', borderRadius:'50%', background: teamColor, boxShadow:`0 0 8px ${teamColor}` }}></div>
                      <div style={{ fontSize:'14px', fontWeight:'800', color: theme.text, letterSpacing:'0.5px' }}>{teamLabel}</div>
                </div>

                <div style={{ display:'flex', gap:'6px', marginBottom:'24px', flexWrap:'wrap' }}>
                    {players.map(p => (
                        <button key={p.player_name} onClick={() => setSelPlayerName(normalizeName(p.player_name))} 
                            style={{ 
                                padding: '6px 14px', 
                                borderRadius: '20px', 
                                background: selPlayerName === normalizeName(p.player_name) ? teamColor : theme.surface, 
                                border: '1px solid',
                                borderColor: selPlayerName === normalizeName(p.player_name) ? teamColor : theme.border,
                                color: selPlayerName === normalizeName(p.player_name) ? '#fff' : theme.textSub, 
                                cursor: 'pointer', 
                                fontWeight: '700', 
                                fontSize:'11px',
                                transition: 'all 0.2s'
                            }}>
                            {p.player_name}
                        </button>
                    ))}
                </div>

                <div style={{ background: theme.surface, borderRadius: '16px', border: `1px solid ${theme.border}`, padding: '24px', flexGrow: 1, boxShadow:'0 10px 15px -3px rgba(0, 0, 0, 0.05)' }}>
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'20px' }}>
                        <div style={{ display:'flex', alignItems:'center', gap:'12px' }}>
                            <h2 style={{ fontSize: '32px', fontWeight: '900', margin: 0, color: theme.text, letterSpacing:'-0.5px' }}>{getDisplayName(curHero?.hero_name)}</h2>
                            {heroStats.length > 1 && (
                                <div style={{ position:'relative' }}>
                                    <select 
                                        value={selHeroIdx} 
                                        onChange={(e) => setSelHeroIdx(Number(e.target.value))}
                                        style={{ 
                                            appearance: 'none', 
                                            padding: '6px 28px 6px 12px', 
                                            borderRadius: '6px', 
                                            background: theme.surfaceHighlight, 
                                            color: theme.text, 
                                            border: `1px solid ${theme.borderHighlight}`, 
                                            fontSize: '11px', 
                                            cursor: 'pointer', 
                                            outline: 'none',
                                            fontWeight: '700'
                                        }}
                                    >
                                        {heroStats.map((hs, i) => (
                                            <option key={i} value={i}>{getDisplayName(hs.hero_name)} ({Math.round(hs.hero_time_played/60)}m)</option>
                                        ))}
                                    </select>
                                    <ChevronDown size={12} style={{ position:'absolute', right:'8px', top:'50%', transform:'translateY(-50%)', pointerEvents:'none', color: theme.textSub }} />
                                </div>
                            )}
                        </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: '20px' }}>
                        <div style={{ display:'flex', flexDirection:'column', gap:'12px' }}>
                            <div style={{ position:'relative', borderRadius:'12px', overflow:'hidden', border: `1px solid ${teamColor}40` }}>
                                <img src={getHeroImageSrc(curHero?.hero_name)} alt="hero" style={{ width: '100%', aspectRatio:'1/1', objectFit:'cover', background: theme.surfaceHighlight, display:'block' }} />
                                <div style={{ position:'absolute', inset:0, background: `linear-gradient(to top, ${teamColor}20, transparent)` }}></div>
                            </div>
                            
                            <div style={{ background: theme.bg, borderRadius:'8px', padding:'12px', border:`1px solid ${teamColor}40`, display:'flex', flexDirection:'column', justifyContent:'center', alignItems:'center' }}>
                                <div style={{ fontSize: '10px', color: theme.textSub, marginBottom:'4px', display:'flex', alignItems:'center', gap:'4px' }}>
                                    <Zap size={10} fill={teamColor} stroke={teamColor}/> <span>{t.ultUsage}</span>
                                </div>
                                <div style={{ fontSize: '24px', fontWeight: '900', color: teamColor, lineHeight:'1' }}>{curHero?.ultimates_used || 0}</div>
                                <div style={{ fontSize: '9px', color: theme.textSub, marginTop:'4px' }}>{getP10(curHero?.ultimates_used || 0, curHero?.hero_time_played)} {t.per10}</div>
                            </div>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
                            <StatBox label={t.playTime} value={`${Math.floor((curHero?.hero_time_played || 0) / 60)}m ${Math.round((curHero?.hero_time_played || 0) % 60)}s`} subValue={`${(((curHero?.hero_time_played || 0)/gameDur)*100).toFixed(1)}%`} subLabel={t.pickRate} />
                            <StatBox label={t.elims} value={`${curHero?.eliminations || 0}`} subValue={getP10(curHero?.eliminations || 0, curHero?.hero_time_played)} subLabel={t.per10} />
                            <StatBox label={t.deaths} value={`${curHero?.deaths || 0}`} subValue={getP10(curHero?.deaths || 0, curHero?.hero_time_played)} subLabel={t.per10} />
                            <StatBox label={t.heroDmg} value={Math.round(curHero?.hero_damage_dealt || 0).toLocaleString()} subValue={getP10(curHero?.hero_damage_dealt || 0, curHero?.hero_time_played)} subLabel={t.per10} />
                            <StatBox label={t.finalBlows} value={`${curHero?.final_blows || 0}`} subValue={getP10(curHero?.final_blows || 0, curHero?.hero_time_played)} subLabel={t.per10} />
                            <StatBox label={t.soloKills} value={`${curHero?.solo_kills || 0}`} subValue={getP10(curHero?.solo_kills || 0, curHero?.hero_time_played)} subLabel={t.per10} />
                        </div>
                    </div>
                </div>
            </div>
        );
    };

    const getUniquePlayers = (teamFn) => {
        const pMap = new Map();
        (matchData.stats || []).filter(p => teamFn(p.team_name)).forEach(p => {
            if (!pMap.has(normalizeName(p.player_name))) pMap.set(normalizeName(p.player_name), p);
        });
        return Array.from(pMap.values()).sort((a,b) => getRoleInfo(a.hero_name).order - getRoleInfo(b.hero_name).order);
    };

    const t1Players = getUniquePlayers((name) => checkIsTeam1(name, t1Name));
    const t2Players = getUniquePlayers((name) => checkIsTeam2(name, t2Name));

    return (
        <div style={{ display: 'flex', gap: '32px', width: '100%', paddingBottom: '60px' }}>
            <PlayerSection teamLabel={t1Name} teamColor={COLOR_TEAM1} selPlayerName={selP1} setSelPlayerName={setSelP1} players={t1Players} teamCheckFn={(name) => checkIsTeam1(name, t1Name)} />
            <PlayerSection teamLabel={t2Name} teamColor={COLOR_TEAM2} selPlayerName={selP2} setSelPlayerName={setSelP2} players={t2Players} teamCheckFn={(name) => checkIsTeam2(name, t2Name)} />
        </div>
    );
};

// =================================================================================
// [MatchStats Main] (메인 컴포넌트)
// =================================================================================
const MatchStats = ({ matchId, onBack, matchData: initialMatchData }) => { 
  const { theme } = useTheme();
  const { t } = useLanguage();

  const [activeMainTab, setActiveMainTab] = useState('stats'); 
  const [activeRoundTab, setActiveRoundTab] = useState('overview'); 
  const [loading, setLoading] = useState(true);
  
  const [fetchedMatchData, setFetchedMatchData] = useState(initialMatchData);

  useEffect(() => {
    if (initialMatchData) { setFetchedMatchData(initialMatchData); setLoading(false); return; }
    if (matchId) {
        axios.get(`/api/matches/${matchId}`)
            .then(res => setFetchedMatchData(res.data))
            .finally(() => setLoading(false));
    }
  }, [matchId, initialMatchData]);

  // 사후 승패 보정 후 서버 최신값 재조회(유효 winner·result 반영)
  const refetchMatch = () => {
    const id = matchId || fetchedMatchData?.id;
    if (!id) return;
    axios.get(`/api/matches/${id}`).then(res => setFetchedMatchData(res.data)).catch(() => {});
  };

  const dataSummary = useMemo(() => {
    if (!fetchedMatchData) return null;
    const rounds = fetchedMatchData.rounds || [];
    
    const t1Name = fetchedMatchData.team_1_name || "1팀";
    const t2Name = fetchedMatchData.team_2_name || "2팀";

    const isControl = fetchedMatchData.game_mode === 'Control' || fetchedMatchData.game_mode === '쟁탈';
    
    let t1Score = isControl ? rounds.filter(r => r.winner === t1Name).length : (fetchedMatchData.score_t1 || 0);
    let t2Score = isControl ? rounds.filter(r => r.winner === t2Name).length : (fetchedMatchData.score_t2 || 0);

    const displayStats = activeRoundTab === 'overview' ? (fetchedMatchData.stats || []) : (rounds.find(r => r.round_number.toString() === activeRoundTab)?.stats || []);
    
    const targetEvents = activeRoundTab === 'overview' ? rounds.flatMap(r => r.events || []) : (rounds.find(r => r.round_number.toString() === activeRoundTab)?.events || []);
    
    const fights = computeFights(targetEvents, t1Name, t2Name);

    return { t1Score, t2Score, displayStats, rounds, fights, t1Name, t2Name };
  }, [fetchedMatchData, activeRoundTab]);

  if (loading || !dataSummary) return <div style={{ padding: '60px', color: theme.textSub, textAlign: 'center' }}>{t.loading}</div>;

  const btnStyle = (isActive) => ({ padding: '12px 24px', background: 'transparent', border: 'none', borderBottom: isActive ? `3px solid ${NEON_GREEN}` : '3px solid transparent', color: isActive ? theme.text : theme.textSub, fontWeight: isActive ? 800 : 600, fontSize: '14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', whiteSpace: 'nowrap', transition:'all 0.2s' });

  const summaryCardStyle = { background: theme.surface, padding: '24px', borderRadius: '16px', border: `1px solid ${theme.border}`, display: 'flex', flexDirection: 'column', gap: '12px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)' };

  return (
    <div style={{ padding: '24px', maxWidth: '1600px', margin: '0 auto', color: theme.text, boxSizing: 'border-box' }}>
      <button onClick={onBack} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'none', border: 'none', color: theme.textSub, cursor: 'pointer', marginBottom: '24px', fontWeight:'600' }}><ChevronLeft size={16} /> {t.msBackToOverview}</button>
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap', marginBottom: '32px' }}>
        <h1 style={{ fontSize: '36px', fontWeight: '900', margin: 0, letterSpacing:'-0.5px' }}>{fetchedMatchData.map_name}</h1>
        <WinnerOverrideControl match={fetchedMatchData} onChanged={refetchMatch} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '16px', marginBottom: '40px' }}>
          <div style={summaryCardStyle}>
              <div style={{ fontSize: '13px', color: theme.textSub, fontWeight:'bold', display:'flex', alignItems:'center', gap:'6px' }}><Clock size={16}/> {t.msTotalTime}</div>
              <div style={{ fontSize: '32px', fontWeight: '900' }}>{Math.floor(fetchedMatchData.timeline.duration_sec/60)}m {Math.floor(fetchedMatchData.timeline.duration_sec%60)}s</div>
          </div>
          <div style={summaryCardStyle}>
              <div style={{ fontSize: '13px', color: theme.textSub, fontWeight:'bold', display:'flex', alignItems:'center', gap:'6px' }}><Trophy size={16}/> {t.msScoreLabel}</div>
              <div style={{ fontSize: '32px', fontWeight: '900' }}>
                  <span style={{ color: COLOR_TEAM1 }}>{dataSummary.t1Score}</span> <span style={{color:theme.textSub, fontSize:'24px'}}>-</span> <span style={{ color: COLOR_TEAM2 }}>{dataSummary.t2Score}</span>
              </div>
              <div style={{ fontSize: '12px', color: theme.textSub }}>
                  {t.msWinnerLabel}: {(() => {
                      // 스코어 비교가 기본. 동점이면 유효 winner(winner_override 반영된 직렬화 값)로 폴백 —
                      // 스코어 미기록(0:0) 상태로 승패만 보정된 밀기 매치가 Draw로 뜨지 않게.
                      const w = dataSummary.t1Score > dataSummary.t2Score ? dataSummary.t1Name
                          : dataSummary.t2Score > dataSummary.t1Score ? dataSummary.t2Name
                          : (fetchedMatchData.winner === dataSummary.t1Name || fetchedMatchData.winner === dataSummary.t2Name) ? fetchedMatchData.winner
                          : null;
                      if (!w) return t.draw;
                      const c = w === dataSummary.t1Name ? COLOR_TEAM1 : COLOR_TEAM2;
                      return <span style={{color:c, fontWeight:'bold', background:`${c}20`, padding:'2px 6px', borderRadius:4}}>{w}</span>;
                  })()}
              </div>
          </div>
          <div style={summaryCardStyle}>
              <div style={{ fontSize: '13px', color: theme.textSub, fontWeight:'bold', display:'flex', alignItems:'center', gap:'6px' }}><Skull size={16}/> {t.msFinalBlows}</div>
              <div style={{ fontSize: '32px', fontWeight: '900' }}>
                  <span style={{color:COLOR_TEAM1}}>{fetchedMatchData.total_final_blows_t1}</span> <span style={{color: theme.textSub, fontSize:'24px'}}>-</span> <span style={{color:COLOR_TEAM2}}>{fetchedMatchData.total_final_blows_t2}</span>
              </div>
          </div>
          <div style={summaryCardStyle}>
              <div style={{ fontSize: '13px', color: theme.textSub, fontWeight:'bold', display:'flex', alignItems:'center', gap:'6px' }}><Sword size={16}/> {t.msFightWins}</div>
              <div style={{ fontSize: '32px', fontWeight: '900' }}>
                  <span style={{color:COLOR_TEAM1}}>{dataSummary.fights.filter(f=>f.winner===dataSummary.t1Name).length}</span> <span style={{color: theme.textSub, fontSize:'24px'}}>-</span> <span style={{color:COLOR_TEAM2}}>{dataSummary.fights.filter(f=>f.winner===dataSummary.t2Name).length}</span>
              </div>
          </div>
          <div style={summaryCardStyle}>
              <div style={{ fontSize: '13px', color: theme.textSub, fontWeight:'bold', display:'flex', alignItems:'center', gap:'6px' }}><Zap size={16}/> {t.msUltEconomy}</div>
              <div style={{ fontSize: '32px', fontWeight: '900' }}>
                  <span style={{color:COLOR_TEAM1}}>{(dataSummary.fights.filter(f=>f.winner===dataSummary.t1Name).length ? ((fetchedMatchData.stats?.reduce((acc,s)=>acc+(checkIsTeam1(s.team_name, dataSummary.t1Name)?s.ultimates_used:0),0) || 0) / dataSummary.fights.filter(f=>f.winner===dataSummary.t1Name).length).toFixed(2) : "0.00")}</span>
                  <span style={{color: theme.textSub, fontSize:'24px'}}>-</span>
                  <span style={{color:COLOR_TEAM2}}>{(dataSummary.fights.filter(f=>f.winner===dataSummary.t2Name).length ? ((fetchedMatchData.stats?.reduce((acc,s)=>acc+(checkIsTeam2(s.team_name, dataSummary.t2Name)?s.ultimates_used:0),0) || 0) / dataSummary.fights.filter(f=>f.winner===dataSummary.t2Name).length).toFixed(2) : "0.00")}</span>
              </div>
          </div>
      </div>

      <div style={{ marginBottom: '24px', display:'flex', gap:'8px', background: theme.surface, padding:'8px', borderRadius:'12px', width:'fit-content', border:`1px solid ${theme.border}` }}>
          <button onClick={() => setActiveRoundTab('overview')} style={{ padding: '8px 20px', borderRadius: '8px', border: 'none', background: activeRoundTab === 'overview' ? theme.surfaceHighlight : 'transparent', color: activeRoundTab === 'overview' ? theme.text : theme.textSub, fontWeight: 'bold', cursor: 'pointer' }}>{t.msOverview}</button>
          {dataSummary.rounds.map(r => ( <button key={r.round_number} onClick={() => setActiveRoundTab(r.round_number.toString())} style={{ padding: '8px 20px', borderRadius: '8px', border: 'none', background: activeRoundTab === r.round_number.toString() ? theme.surfaceHighlight : 'transparent', color: activeRoundTab === r.round_number.toString() ? theme.text : theme.textSub, fontWeight: 'bold', cursor: 'pointer' }}>{t.msRoundLabel.replace('{n}', r.round_number)}</button> ))}
      </div>

      <div style={{ borderBottom: `1px solid ${theme.border}`, display: 'flex', gap: '16px', overflowX: 'auto', marginBottom: '32px' }}>
        <button onClick={() => setActiveMainTab('stats')} style={btnStyle(activeMainTab === 'stats')}><List size={18}/> {t.msTabStats}</button>
        <button onClick={() => setActiveMainTab('kill')} style={btnStyle(activeMainTab === 'kill')}><Skull size={18}/> {t.msTabKill}</button>
        <button onClick={() => setActiveMainTab('chart')} style={btnStyle(activeMainTab === 'chart')}><BarChart2 size={18}/> {t.msTabChart}</button>
        <button onClick={() => setActiveMainTab('event')} style={btnStyle(activeMainTab === 'event')}><Activity size={18}/> {t.msTabTimeline}</button>
        <button onClick={() => setActiveMainTab('ulttl')} style={btnStyle(activeMainTab === 'ulttl')}><Zap size={18}/> {t.msTabUltTl}</button>
        <button onClick={() => setActiveMainTab('compare')} style={btnStyle(activeMainTab === 'compare')}><User size={18}/> {t.msTabCompare}</button>
      </div>

      <div style={{ animation: 'fadeIn 0.3s ease-in-out' }}>
          {activeMainTab === 'stats' && <StatsView activeRoundTab={activeRoundTab} setActiveRoundTab={setActiveRoundTab} displayStats={dataSummary.displayStats} rounds={dataSummary.rounds} t1Name={dataSummary.t1Name} t2Name={dataSummary.t2Name} />}
          {activeMainTab === 'kill' && <KillLogView fights={dataSummary.fights} activeRoundTab={activeRoundTab} t1Name={dataSummary.t1Name} t2Name={dataSummary.t2Name} />}
          {activeMainTab === 'chart' && <ChartView matchData={fetchedMatchData} rounds={dataSummary.rounds} fights={dataSummary.fights} t1Name={dataSummary.t1Name} t2Name={dataSummary.t2Name} />}
          {activeMainTab === 'event' && <EventsView matchData={fetchedMatchData} t1Name={dataSummary.t1Name} t2Name={dataSummary.t2Name} />}
          {activeMainTab === 'ulttl' && <UltTimelineView fights={dataSummary.fights} matchData={fetchedMatchData} t1Name={dataSummary.t1Name} t2Name={dataSummary.t2Name} />}
          {activeMainTab === 'compare' && <PlayerStatsView matchData={fetchedMatchData} t1Name={dataSummary.t1Name} t2Name={dataSummary.t2Name} />}
      </div>
    </div>
  );
};

export default MatchStats;