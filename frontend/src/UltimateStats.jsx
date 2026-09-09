import React, { useMemo, useState, useEffect } from 'react';
import { Zap, Calendar, Target, Activity, Users } from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell, Legend } from 'recharts';
import { useTheme } from "./ThemeContext";
import { useLanguage } from "./LanguageContext";
import { T } from "./FightLabStats";
import { useIsMobile } from "./utils/responsive";
import { getHeroImageSrc } from "./gameData";

// R1 방향색(맵 분석과 동일한 은은한 톤). 원색 네온은 제거.
const GREEN = T.green, RED = T.red;
const winColor = (wr) => wr === 50 ? T.text : wr >= 50 ? GREEN : RED;
// R2: 영웅별 궁극기 가치 랭킹의 최소 표본(궁 사용 횟수). 미만은 흐림 + 하단 분리.
const MIN_ULT_SAMPLE = 5;

// [STEP3] 이미지 리졸버는 gameData.getHeroImageSrc(SSOT image 필드 기반)로 통합·임포트.

export default function UltimateStats({ allScrims }) {
    const { theme } = useTheme();
    const { t } = useLanguage();
    const isMobile = useIsMobile();

    const [startDate, setStartDate] = useState("");
    const [endDate, setEndDate] = useState("");
    const [baseTeam, setBaseTeam] = useState("All");

    const allTeams = useMemo(() => {
        const teams = new Set();
        allScrims.forEach(s => s.matches?.forEach(m => {
            if (m.team_1_name) teams.add(m.team_1_name);
            if (m.team_2_name) teams.add(m.team_2_name);
        }));
        return [...teams].filter(Boolean);
    }, [allScrims]);

    const ultAnalysis = useMemo(() => {
        if (!allScrims || allScrims.length === 0) return { countStats: [], heroStats: [] };

        const countMap = { 0: { wins: 0, total: 0 }, 1: { wins: 0, total: 0 }, 2: { wins: 0, total: 0 }, 3: { wins: 0, total: 0 }, 4: { wins: 0, total: 0 }, 5: { wins: 0, total: 0 } };
        const heroUltMap = {};

        allScrims.forEach(scrim => {
            if (startDate && scrim.date < startDate) return;
            if (endDate && scrim.date > endDate) return;

            (scrim.matches || []).forEach(match => {
                const t1Name = match.team_1_name || "1팀";
                const t2Name = match.team_2_name || "2팀";

                (match.rounds || []).forEach(round => {
                    const events = round.events || [];
                    if (events.length === 0) return;

                    let currentFight = null;
                    const FIGHT_GAP = 20;

                    const processPerspective = (fight, teamName, enemyName) => {
                        let myDeaths = 0, enemyDeaths = 0;
                        let myUltsUsed = 0;
                        const myHeroesUsedUlt = [];

                        fight.events.forEach(ev => {
                            if (ev.event_type === 'kill') {
                                if (ev.target_team === teamName) myDeaths++;
                                else if (ev.target_team === enemyName) enemyDeaths++;
                            }
                            if (ev.event_type === 'ultimate_start') {
                                if (ev.player_team === teamName) {
                                    myUltsUsed++;
                                    myHeroesUsedUlt.push(ev.player_hero);
                                }
                            }
                        });

                        if (myDeaths === 0 && enemyDeaths === 0) return;
                        const isWin = myDeaths < enemyDeaths;

                        const cappedCount = Math.min(myUltsUsed, 5);
                        countMap[cappedCount].total++;
                        if (isWin) countMap[cappedCount].wins++;

                        myHeroesUsedUlt.forEach(hero => {
                            if (!heroUltMap[hero]) heroUltMap[hero] = { uses: 0, wins: 0 };
                            heroUltMap[hero].uses++;
                            if (isWin) heroUltMap[hero].wins++;
                        });
                    };

                    const processFight = (fight) => {
                        if (!fight || fight.events.length === 0) return;
                        if (baseTeam === 'All' || baseTeam === t1Name) processPerspective(fight, t1Name, t2Name);
                        if (baseTeam === 'All' || baseTeam === t2Name) processPerspective(fight, t2Name, t1Name);
                    };

                    events.forEach(ev => {
                        if (ev.event_type !== 'kill' && ev.event_type !== 'ultimate_start') return;
                        if (!currentFight || ev.timestamp > currentFight.endTime) {
                            if (currentFight) processFight(currentFight);
                            currentFight = { endTime: ev.timestamp + FIGHT_GAP, events: [ev] };
                        } else {
                            currentFight.events.push(ev);
                            currentFight.endTime = ev.timestamp + FIGHT_GAP; 
                        }
                    });
                    if (currentFight) processFight(currentFight); 
                });
            });
        });

        const countStats = Object.keys(countMap).map(count => ({
            name: count === '5' ? t.ultFivePlus : `${count}${t.msCountUnit}`,
            uses: countMap[count].total,
            winRate: countMap[count].total > 0 ? Math.round((countMap[count].wins / countMap[count].total) * 100) : 0
        }));

        const heroStats = Object.entries(heroUltMap)
            .map(([hero, data]) => ({ hero, uses: data.uses, winRate: data.uses > 0 ? Math.round((data.wins / data.uses) * 100) : 0 }))
            .filter(h => h.uses >= 1) 
            .sort((a, b) => b.winRate - a.winRate);

        return { countStats, heroStats };
    }, [allScrims, startDate, endDate, baseTeam]);

    // 💡 [버그 픽스] 다크모드 대응 & 데이터 분리를 위한 커스텀 툴팁
    const CustomTooltip = ({ active, payload, label }) => {
        if (active && payload && payload.length) {
            const data = payload[0].payload; 
            return (
                <div style={{ 
                    backgroundColor: theme.surfaceHighlight || '#2A2A2A', 
                    padding: '12px', 
                    borderRadius: '8px', 
                    border: `1px solid ${theme.border || '#444'}`,
                    color: '#ffffff', // 글자색 하얀색 고정
                    boxShadow: '0 4px 6px rgba(0,0,0,0.3)'
                }}>
                    <p style={{ margin: '0 0 8px 0', fontWeight: 'bold', fontSize: '15px' }}>{label}</p>
                    <p style={{ margin: '0 0 4px 0', fontSize: '13px', color: '#cccccc' }}>
                        {t.fightCount} : {data.uses}{t.timesUnit}
                    </p>
                    <p style={{ margin: 0, fontSize: '14px', color: winColor(data.winRate), fontWeight: 'bold' }}>
                        {t.winRate} : {data.winRate}%
                    </p>
                </div>
            );
        }
        return null;
    };

    return (
        <div style={{ padding: isMobile ? "16px 12px" : "40px", maxWidth: 1200, margin: "0 auto", color: theme.text }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems:'center', marginBottom:'24px' }}>
                <h1 style={{ fontSize: 24, fontWeight: 900, margin:0, display:'flex', alignItems:'center', gap:'10px' }}>
                    <Zap size={24} color={GREEN}/> {t.ultStatsTitle}
                </h1>
            </div>

            <div style={{ display: 'flex', flexWrap: isMobile ? 'wrap' : 'nowrap', gap: isMobile ? '10px' : '16px', alignItems: 'center', marginBottom: '24px', background: theme.surface, padding: '16px', borderRadius: '12px', border: `1px solid ${theme.border}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 'bold', color: theme.textSub, whiteSpace: 'nowrap' }}>
                    <Users size={18}/> {t.baseTeam}
                </div>
                <select value={baseTeam} onChange={e => setBaseTeam(e.target.value)} style={{ background: theme.bg, color: theme.text, border: `1px solid ${theme.border}`, padding: '8px 12px', borderRadius: '8px', outline: 'none', fontWeight: 'bold' }}>
                    <option value="All">{t.allTeams}</option>
                    {allTeams.map(team => <option key={team} value={team}>{team}</option>)}
                </select>

                <div style={{ width: '1px', height: '24px', background: theme.border, margin: '0 8px' }}></div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 'bold', color: theme.textSub, whiteSpace: 'nowrap' }}>
                    <Calendar size={18}/> {t.dateFilter}
                </div>
                <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} style={{ background: theme.bg, color: theme.text, border: `1px solid ${theme.border}`, padding: '8px 12px', borderRadius: '8px', colorScheme: theme.mode === 'dark' ? 'dark' : 'light' }} />
                <span style={{ color: theme.textSub }}>~</span>
                <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} style={{ background: theme.bg, color: theme.text, border: `1px solid ${theme.border}`, padding: '8px 12px', borderRadius: '8px', colorScheme: theme.mode === 'dark' ? 'dark' : 'light' }} />
                {(startDate || endDate) && <button onClick={() => { setStartDate(""); setEndDate(""); }} style={{ background: 'transparent', border: 'none', color: theme.danger, cursor: 'pointer', fontWeight: 'bold', marginLeft: 'auto' }}>{t.reset}</button>}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: isMobile ? '16px' : '24px' }}>
                <div style={{ background: theme.surface, borderRadius: '16px', border: `1px solid ${theme.border}`, padding: isMobile ? '16px' : '24px' }}>
                    <h3 style={{fontSize:'18px', fontWeight:'bold', marginBottom:'24px', display:'flex', alignItems:'center', gap:'8px'}}><Activity size={20} color={theme.primary}/> {t.ultCountVsWin}</h3>
                    <div style={{ width: '100%', height: 350 }}>
                        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                            <BarChart data={ultAnalysis.countStats}>
                                <CartesianGrid strokeDasharray="3 3" stroke={theme.border} vertical={false}/>
                                <XAxis dataKey="name" stroke={theme.textSub} fontSize={13} tickLine={false} axisLine={false}/>
                                <YAxis stroke={theme.textSub} fontSize={13} tickLine={false} axisLine={false} domain={[0, 100]} tickFormatter={(v)=>`${v}%`}/>
                                
                                {/* 💡 교체된 툴팁과 범례 */}
                                <Tooltip content={<CustomTooltip />} cursor={{fill: 'transparent'}} />
                                <Legend wrapperStyle={{ color: theme.text }} />
                                
                                <Bar dataKey="winRate" name={t.winRate} radius={[6, 6, 0, 0]} barSize={40}>
                                    {ultAnalysis.countStats.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={entry.winRate >= 50 ? GREEN : RED} />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                <div style={{ background: theme.surface, borderRadius: '16px', border: `1px solid ${theme.border}`, padding: isMobile ? '16px' : '24px', maxHeight: '460px', overflowY: 'auto', overflowX: isMobile ? 'auto' : 'visible' }}>
                    <h3 style={{fontSize:'18px', fontWeight:'bold', marginBottom:'20px', display:'flex', alignItems:'center', gap:'8px'}}><Target size={20} color={theme.warning}/> {t.ultEfficiency}</h3>
                    {ultAnalysis.heroStats.length === 0 ? <div style={{textAlign:'center', color:theme.textSub, marginTop:'40px'}}>{t.noData}</div> : (
                        <table style={{width:'100%', borderCollapse:'collapse', fontSize:'14px', minWidth: isMobile ? 420 : undefined}}>
                            <thead style={{ position: 'sticky', top: isMobile ? '-16px' : '-24px', background: theme.surface, zIndex: 1 }}>
                                <tr style={{borderBottom:`1px solid ${theme.border}`, color: theme.textSub, textAlign:'left'}}>
                                    <th style={{padding:'12px'}}>{t.hero}</th>
                                    <th style={{padding:'12px', textAlign:'center'}}>{t.ultUses} ({t.ultTotal})</th>
                                    <th style={{padding:'12px', textAlign:'right'}}>{t.winRate} ({t.ultValue})</th>
                                </tr>
                            </thead>
                            <tbody>
                                {(() => {
                                    // R2: 표본(궁 사용) 최소치 미만은 흐림 + 하단 분리. 순위는 이어서 매김.
                                    const main = ultAnalysis.heroStats.filter(h => h.uses >= MIN_ULT_SAMPLE);
                                    const low = ultAnalysis.heroStats.filter(h => h.uses < MIN_ULT_SAMPLE);
                                    const renderRow = (h, rank, dim) => (
                                        <tr key={h.hero} style={{ borderBottom: `1px solid ${theme.border}`, opacity: dim ? 0.5 : 1 }}>
                                            <td style={{padding:'12px', display:'flex', alignItems:'center', gap:'12px', fontWeight:'bold'}}>
                                                <span style={{color: theme.textSub, width:'20px'}}>{rank}</span>
                                                <img src={getHeroImageSrc(h.hero)} alt={h.hero} style={{width:'32px', height:'32px', borderRadius:'6px', background:'#000'}}/>
                                                {h.hero}
                                            </td>
                                            <td style={{padding:'12px', textAlign:'center'}}>{h.uses}{t.timesUnit}</td>
                                            <td style={{ padding:'12px', textAlign:'right', color: winColor(h.winRate), fontWeight:'900', fontSize:'16px' }}>{h.winRate}%</td>
                                        </tr>
                                    );
                                    let rank = 0;
                                    return (
                                        <>
                                            {main.map(h => renderRow(h, ++rank, false))}
                                            {low.length > 0 && (
                                                <tr>
                                                    <td colSpan={3} style={{ padding:'8px 12px', fontSize:'11px', color: theme.textSub, background:'rgba(255,255,255,0.02)', borderBottom:`1px solid ${theme.border}` }}>
                                                        {t.ultLowSampleNote}
                                                    </td>
                                                </tr>
                                            )}
                                            {low.map(h => renderRow(h, ++rank, true))}
                                        </>
                                    );
                                })()}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>
        </div>
    );
}