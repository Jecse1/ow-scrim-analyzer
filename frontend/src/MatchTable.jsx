import React from 'react';
import { Shield, Sword, Heart } from 'lucide-react';
// [중요] ThemeContext와 LanguageContext 가져오기
import { useTheme } from "./ThemeContext";
import { useLanguage } from "./LanguageContext";
import { TANK_HEROES, SUPPORT_HEROES } from "./gameData";

const MatchTable = ({ stats }) => {
  const { theme } = useTheme(); // [테마 훅]
  const { t } = useLanguage();  // [언어 훅]

  // [안전장치] stats가 없거나 배열이 아니면 빈 배열로 초기화
  const safeStats = Array.isArray(stats) ? stats : [];

  if (safeStats.length === 0) {
    return (
      <div style={{ padding: '60px', textAlign: 'center', color: theme.textSub, border: `1px dashed ${theme.border}`, borderRadius: '12px', background: theme.surface }}>
        <p>{t.noData}</p>
      </div>
    );
  }

  // 역할 구분
  // [STEP3B] 역할 목록을 gameData(SSOT)에서 파생(역할별 roleForms = 한/영 표기 모두 포함).
  //   기존 로컬 목록은 영문 위주·일부 누락(도미나/미즈키/제트팩캣)이었으나, SSOT 파생으로 보정된다.
  //   (주: 이 컴포넌트는 현재 어디에서도 import 되지 않는 미사용 코드 — MatchStats 는 자체 SafeMatchTable 사용.)
  const getRole = (hero) => {
    if (!hero) return 'dps';
    if (TANK_HEROES.includes(hero)) return 'tank';
    if (SUPPORT_HEROES.includes(hero)) return 'support';
    return 'dps';
  };

  const getRoleIcon = (role) => {
    // 아이콘 색상은 테마의 보조 텍스트 색상 사용
    if (role === 'tank') return <Shield size={14} color={theme.textSub}/>;
    if (role === 'support') return <Heart size={14} color={theme.textSub}/>;
    return <Sword size={14} color={theme.textSub}/>;
  };

  const roleOrder = { tank: 1, dps: 2, support: 3 };

  // 정렬 (try-catch로 보호)
  let sortedStats = [...safeStats];
  try {
    sortedStats.sort((a, b) => {
      const teamA = a?.team_name || "";
      const teamB = b?.team_name || "";
      if (teamA !== teamB) return teamA.localeCompare(teamB);
      
      const roleA = getRole(a?.hero_name);
      const roleB = getRole(b?.hero_name);
      return (roleOrder[roleA] || 2) - (roleOrder[roleB] || 2);
    });
  } catch (e) { console.error("Sort error", e); }

  const fmt = (val) => (val !== undefined && val !== null && !isNaN(val)) ? Math.round(val).toLocaleString() : '0';

  // [테마 적용 스타일]
  const thStyle = {
    padding: '14px 8px', textAlign: 'center', fontSize: '12px', fontWeight: '700', 
    color: theme.textSub, // 보조 텍스트 색상
    borderBottom: `1px solid ${theme.border}`, // 테두리 색상
    whiteSpace: 'nowrap', 
    background: theme.bg, // 배경색 (헤더 고정 시 겹침 방지)
    position: 'sticky', top: 0, zIndex: 10
  };
  
  const tdStyle = {
    padding: '14px 8px', textAlign: 'center', fontSize: '13px', 
    color: theme.text, // 기본 텍스트 색상
    borderBottom: `1px solid ${theme.border}`, // 테두리 색상
    whiteSpace: 'nowrap'
  };

  return (
    <div style={{ overflowX: 'auto', background: theme.bg, borderRadius: '12px', border: `1px solid ${theme.border}` }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '1200px' }}>
        <thead>
          <tr>
            <th style={{...thStyle, width: '50px'}}>#</th>
            <th style={{...thStyle, textAlign: 'left', paddingLeft: '20px'}}>{t.player}</th>
            <th style={thStyle}>{t.role}</th>
            {/* 영웅 헤더는 t.hero가 없으면 'Hero'로 표시 */}
            <th style={thStyle}>{t.hero || "Hero"}</th> 
            <th style={thStyle}>{t.playTime}</th>
            <th style={thStyle}>{t.elims}</th>
            <th style={thStyle}>{t.finalBlows}</th>
            <th style={thStyle}>{t.deaths}</th>
            <th style={thStyle}>K/D</th>
            <th style={thStyle}>{t.heroDmg}</th>
            <th style={thStyle}>{t.dmgTaken}</th>
            <th style={thStyle}>{t.healing}</th>
            <th style={thStyle}>{t.healRcvd}</th>
            <th style={thStyle}>{t.ults}</th>
          </tr>
        </thead>
        <tbody>
          {sortedStats.map((row, idx) => {
            if (!row) return null;

            const role = getRole(row.hero_name);
            const elims = row.eliminations || 0;
            const deaths = row.deaths || 0;
            const kd = deaths > 0 ? (elims / deaths).toFixed(2) : elims;
            
            const isTeamChange = idx > 0 && (row.team_name || "") !== (sortedStats[idx-1]?.team_name || "");

            // 팀 색상 (파랑/빨강)은 테마와 무관하게 고정 (게임 관습)
            const teamColor = row.team_name === (sortedStats[0]?.team_name) ? '#60a5fa' : '#f87171';

            return (
              <React.Fragment key={idx}>
                {isTeamChange && <tr><td colSpan="14" style={{borderBottom: `2px solid ${theme.borderHighlight}`}}></td></tr>}
                <tr 
                    style={{ background: 'transparent', transition: 'background 0.2s' }} 
                    onMouseOver={e => e.currentTarget.style.background = theme.surfaceHighlight} 
                    onMouseOut={e => e.currentTarget.style.background = 'transparent'}
                >
                  <td style={{...tdStyle, color: theme.textDim}}>{idx + 1}</td>
                  
                  <td style={{...tdStyle, textAlign: 'left', paddingLeft: '20px'}}>
                    <div style={{fontWeight: 'bold', color: teamColor}}>
                      {row.player_name || "Unknown"}
                    </div>
                    <div style={{fontSize: '11px', color: theme.textSub}}>{row.team_name || "-"}</div>
                  </td>
                  
                  <td style={tdStyle}>{getRoleIcon(role)}</td>
                  <td style={{...tdStyle, fontWeight: '500'}}>{row.hero_name || "-"}</td>
                  
                  <td style={tdStyle}>
                    {Math.floor((row.hero_time_played || 0) / 60)}m {Math.floor((row.hero_time_played || 0) % 60)}s
                  </td>

                  <td style={{...tdStyle, fontWeight: 'bold'}}>{elims}</td>
                  <td style={tdStyle}>{row.final_blows || 0}</td>
                  <td style={{...tdStyle, color: theme.danger}}>{deaths}</td>
                  <td style={{...tdStyle, color: kd >= 3 ? theme.success : theme.textSub, fontWeight: kd >= 3 ? 'bold' : 'normal'}}>{kd}</td>

                  <td style={tdStyle}>{fmt(row.hero_damage_dealt)}</td>
                  <td style={tdStyle}>{fmt(row.damage_taken)}</td>
                  <td style={{...tdStyle, color: (row.healing_dealt || 0) > 0 ? theme.success : theme.textDim}}>
                    {(row.healing_dealt || 0) > 0 ? fmt(row.healing_dealt) : '-'}
                  </td>
                  <td style={tdStyle}>{fmt(row.healing_received)}</td>

                  <td style={tdStyle}>{row.ultimates_used || 0} / {row.ultimates_earned || 0}</td>
                </tr>
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

export default MatchTable;