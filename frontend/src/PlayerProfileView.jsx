import React, { useState, useMemo, useEffect } from 'react';
import { Users, Search, Activity, Crosshair, Zap, Sword, PlusCircle } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { useTheme } from "./ThemeContext";
import { useLanguage } from "./LanguageContext";
import { useIsMobile } from "./utils/responsive";
import { getHeroImageSrc, getDisplayName } from "./gameData";

// [STEP3] 이미지 리졸버는 gameData.getHeroImageSrc(SSOT image 필드 기반)로 통합·임포트.

// 💡 스크림 세션 역할군 아이콘 적용
const getRoleIconSrc = (roleLabel) => {
    if (roleLabel === '탱크' || roleLabel === '탱커') return '/roles/tank.png';
    if (roleLabel === '딜러') return '/roles/damage.png';
    if (roleLabel === '지원' || roleLabel === '힐러') return '/roles/support.png';
    return null;
};

export default function PlayerProfileView({ playersData }) {
    const { theme } = useTheme();
    const { t } = useLanguage();
    const isMobile = useIsMobile();
    const roleLabelDisplay = (role) => (role === '탱크' || role === '탱커') ? t.tank : role === '딜러' ? t.dps : (role === '지원' || role === '힐러') ? t.support : role;

    const [searchTerm, setSearchTerm] = useState("");
    const [selectedTeam, setSelectedTeam] = useState("All");
    const [selectedRole, setSelectedRole] = useState("All");
    const [selectedPlayerId, setSelectedPlayerId] = useState(null);

    const filteredPlayers = useMemo(() => {
        if (!playersData) return [];
        return playersData.filter(p => {
            const matchName = p.name.toLowerCase().includes(searchTerm.toLowerCase());
            const matchTeam = selectedTeam === "All" || p.team === selectedTeam;
            const matchRole = selectedRole === "All" || p.role === selectedRole;
            return matchName && matchTeam && matchRole;
        });
    }, [playersData, searchTerm, selectedTeam, selectedRole]);

    useEffect(() => {
        if (filteredPlayers.length > 0) {
            if (!selectedPlayerId || !filteredPlayers.find(p => p.id === selectedPlayerId)) {
                setSelectedPlayerId(filteredPlayers[0].id);
            }
        } else {
            setSelectedPlayerId(null);
        }
    }, [filteredPlayers, selectedPlayerId]);

    const activePlayer = useMemo(() => {
        return playersData?.find(p => p.id === selectedPlayerId) || null;
    }, [playersData, selectedPlayerId]);

    const teamList = useMemo(() => {
        if (!playersData) return ["All"];
        const teams = new Set(playersData.map(p => p.team));
        return ["All", ...Array.from(teams).filter(Boolean)];
    }, [playersData]);

    if (!playersData || playersData.length === 0) {
        return <div style={{ padding: '60px', textAlign: 'center', color: theme.textSub }}>{t.ppNoPlayers}</div>;
    }

    return (
        <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: isMobile ? '16px' : '32px', alignItems: isMobile ? 'stretch' : 'flex-start', width: '100%', maxWidth: '1600px', margin: '0 auto', color: theme.text }}>
            
            {/* ⬅️ 왼쪽 사이드바 (선수단 목록) */}
            <div style={{ width: isMobile ? '100%' : '280px', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <h2 style={{ fontSize: '18px', fontWeight: '900', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Users size={20} /> {t.ppRosterTitle}
                </h2>

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

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', overflowY: 'auto', maxHeight: isMobile ? '42vh' : 'calc(100vh - 280px)', paddingRight: '4px' }}>
                    {filteredPlayers.map(p => {
                        const isActive = p.id === selectedPlayerId;
                        return (
                            <div key={p.id} onClick={() => setSelectedPlayerId(p.id)}
                                style={{ padding: '12px', borderRadius: '12px', cursor: 'pointer', background: isActive ? theme.surfaceHighlight : theme.surface, border: `1px solid ${isActive ? '#3b82f6' : theme.border}`, display: 'flex', alignItems: 'center', gap: '12px', transition: 'all 0.2s' }}>
                                <div style={{ width: 36, height: 36, borderRadius: '50%', background: theme.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', color: isActive ? '#3b82f6' : theme.textSub }}>
                                    <img src={getRoleIconSrc(p.role)} alt={p.role} style={{ width: 20, height: 20, filter: 'invert(1)', opacity: isActive ? 1 : 0.5 }} />
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column' }}>
                                    <span style={{ fontWeight: '900', fontSize: '15px', color: isActive ? '#3b82f6' : theme.text }}>{p.name}</span>
                                    <span style={{ fontSize: '11px', color: theme.textSub }}>{p.team} · {roleLabelDisplay(p.role)}</span>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* ➡️ 오른쪽 메인 컨텐츠 (선수 개인 통계) */}
            {activePlayer ? (
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '24px' }}>
                    
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', paddingBottom: '16px', borderBottom: `1px solid ${theme.border}` }}>
                        <div>
                            <div style={{ fontSize: '13px', color: theme.textSub, fontWeight: 'bold', marginBottom: '4px' }}>{activePlayer.team} · {roleLabelDisplay(activePlayer.role)}</div>
                            <h1 style={{ fontSize: '36px', fontWeight: '900', margin: 0 }}>{activePlayer.name}</h1>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: '13px', color: theme.textSub, fontWeight: 'bold', marginBottom: '4px' }}>{t.avgWinRate}</div>
                            <div style={{ fontSize: '32px', fontWeight: '900', color: activePlayer.overview.winRate >= 50 ? theme.success : theme.danger }}>
                                {activePlayer.overview.winRate}%
                            </div>
                        </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)', gap: isMobile ? '10px' : '16px' }}>
                        <div style={{ background: theme.surface, padding: '20px', borderRadius: '12px', border: `1px solid ${theme.border}` }}>
                            <div style={{ fontSize: '12px', color: theme.textSub, display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}><Crosshair size={14}/> {t.ppOverallKd}</div>
                            <div style={{ fontSize: '24px', fontWeight: '900' }}>{activePlayer.overview.kd.toFixed(2)}</div>
                        </div>
                        <div style={{ background: theme.surface, padding: '20px', borderRadius: '12px', border: `1px solid ${theme.border}` }}>
                            <div style={{ fontSize: '12px', color: theme.textSub, display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}><Sword size={14}/> {t.ppDmgPer10}</div>
                            <div style={{ fontSize: '24px', fontWeight: '900' }}>{activePlayer.overview.damagePer10.toLocaleString()}</div>
                        </div>
                        <div style={{ background: theme.surface, padding: '20px', borderRadius: '12px', border: `1px solid ${theme.border}` }}>
                            <div style={{ fontSize: '12px', color: theme.textSub, display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}><PlusCircle size={14}/> {t.ppHealPer10}</div>
                            <div style={{ fontSize: '24px', fontWeight: '900' }}>{activePlayer.overview.healPer10.toLocaleString()}</div>
                        </div>
                        <div style={{ background: theme.surface, padding: '20px', borderRadius: '12px', border: `1px solid ${theme.border}` }}>
                            <div style={{ fontSize: '12px', color: theme.textSub, display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}><Zap size={14}/> {t.ppUltPerMatch}</div>
                            <div style={{ fontSize: '24px', fontWeight: '900' }}>{activePlayer.overview.ultUsedPerMatch}</div>
                        </div>
                    </div>

                    <div style={{ background: theme.surface, padding: '24px', borderRadius: '16px', border: `1px solid ${theme.border}` }}>
                        <h3 style={{ fontSize: '16px', fontWeight: '900', margin: '0 0 20px 0', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <Activity size={18}/> {t.ppHeroPool}
                        </h3>
                        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                            {activePlayer.heroPool.map((h, i) => (
                                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '12px', background: theme.bg, padding: '12px', borderRadius: '12px', border: `1px solid ${theme.border}`, minWidth: '180px' }}>
                                    <img src={getHeroImageSrc(h.hero)} alt={h.hero} style={{ width: 40, height: 40, borderRadius: '8px', background: '#000' }} onError={e=>e.currentTarget.style.display='none'}/>
                                    <div>
                                        <div style={{ fontWeight: 'bold', fontSize: '14px', marginBottom: '4px' }}>{getDisplayName(h.hero)}</div>
                                        <div style={{ display: 'flex', gap: '12px', fontSize: '11px', color: theme.textSub }}>
                                            <span>{t.winRate} <strong style={{ color: h.winRate >= 50 ? theme.success : theme.danger }}>{h.winRate}%</strong></span>
                                            <span>K/D <strong>{h.kd}</strong></span>
                                        </div>
                                    </div>
                                </div>
                            ))}
                            {activePlayer.heroPool.length === 0 && <div style={{ fontSize: '13px', color: theme.textSub }}>{t.ppNoHeroes}</div>}
                        </div>
                    </div>

                    <div style={{ background: theme.surface, padding: '24px', borderRadius: '16px', border: `1px solid ${theme.border}` }}>
                        <h3 style={{ fontSize: '16px', fontWeight: '900', margin: '0 0 20px 0', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <Activity size={18}/> {t.ppRecentForm}
                        </h3>
                        <div style={{ width: '100%', height: 250 }}>
                            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                                <LineChart data={activePlayer.recentTrend}>
                                    <CartesianGrid strokeDasharray="3 3" stroke={theme.border} vertical={false} />
                                    <XAxis dataKey="match" stroke={theme.textSub} fontSize={11} tickLine={false} axisLine={false} tickFormatter={(val) => val.length > 10 ? val.substring(0, 10)+'...' : val}/>
                                    <YAxis stroke={theme.textSub} fontSize={11} tickLine={false} axisLine={false} width={30} domain={['dataMin - 0.5', 'dataMax + 0.5']}/>
                                    <Tooltip
                                        contentStyle={{ backgroundColor: theme.surface, border: 'none', borderRadius: '8px', color: theme.text, fontSize:'12px' }}
                                        formatter={(value, name, props) => [`${value} (FB ${props?.payload?.fb ?? '-'} / D ${props?.payload?.deaths ?? '-'})`, 'K/D']}
                                    />
                                    <Line type="monotone" dataKey="kd" stroke="#ef4444" strokeWidth={3} dot={{ r: 4, fill: theme.surface, strokeWidth: 2 }} activeDot={{ r: 6 }} animationDuration={1000} />
                                </LineChart>
                            </ResponsiveContainer>
                        </div>
                    </div>

                </div>
            ) : (
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: theme.textSub, background: theme.surface, borderRadius: '16px', border: `1px dashed ${theme.border}` }}>
                    {t.ppSelectPrompt}
                </div>
            )}
        </div>
    );
}