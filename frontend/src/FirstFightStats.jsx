import React, { useState, useMemo, useEffect } from 'react';
import { fetchCached } from './utils/apiCache';
import { getMapDisplayName } from './gameData';
import { Swords, Youtube, Map as MapIcon, Users, Clock } from 'lucide-react';
import { useTheme } from "./ThemeContext";
import { useLanguage } from "./LanguageContext";
import { buildVideoLink, hasVideo } from "./utils/videoLink";
import { useVod, vodClickProps } from "./VodPlayerContext";
import { BASE_TEAM } from "./config";

const API_BASE = "";

// 우리 팀(기준 팀). 매치마다 team1/team2 중 한쪽이 기준 팀이고, 나머지가 상대팀이다.
const OUR_TEAM = BASE_TEAM;
const opponentOf = (it) => (it.team1_name === OUR_TEAM ? it.team2_name : it.team1_name);


const fmtClock = (sec) => {
    const s = Math.max(0, Math.floor(Number(sec) || 0));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${String(r).padStart(2, '0')}`;
};

export default function FirstFightStats() {
    const { theme } = useTheme();
    const { t } = useLanguage();
    const { openVod } = useVod();

    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [selectedOpponent, setSelectedOpponent] = useState('All');
    const [selectedMap, setSelectedMap] = useState('All');

    // 모바일 폭 분기 — App 네비와 동일 기준(matchMedia 767px). 표시 레이어만, 데스크톱 무변경.
    const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches);
    useEffect(() => {
        const mq = window.matchMedia("(max-width: 767px)");
        const onChange = (e) => setIsMobile(e.matches);
        mq.addEventListener("change", onChange);
        return () => mq.removeEventListener("change", onChange);
    }, []);

    useEffect(() => {
        let alive = true;
        (async () => {
            try {
                const d = await fetchCached(`${API_BASE}/api/first-fights`);
                if (alive) setItems(d || []);
            } catch (err) {
                console.error("❌ Failed to fetch first-fights:", err);
                if (alive) setError(err);
            } finally {
                if (alive) setLoading(false);
            }
        })();
        return () => { alive = false; };
    }, []);

    const opponentList = useMemo(() => {
        const teams = new Set();
        items.forEach(it => { const o = opponentOf(it); if (o) teams.add(o); });
        return Array.from(teams).sort();
    }, [items]);

    const mapList = useMemo(() => {
        const maps = new Set();
        items.forEach(it => { if (it.map_name) maps.add(it.map_name); });
        return Array.from(maps).sort();
    }, [items]);

    const filtered = useMemo(() => {
        return items.filter(it => {
            if (selectedOpponent !== 'All' && opponentOf(it) !== selectedOpponent) return false;
            if (selectedMap !== 'All' && it.map_name !== selectedMap) return false;
            return true;
        });
    }, [items, selectedOpponent, selectedMap]);

    const ACCENT = "#f59e0b";
    const selectStyle = { background: theme.bg, color: theme.text, border: `1px solid ${theme.borderHighlight}`, padding: '8px 12px', borderRadius: '8px', outline: 'none', fontSize: '13px', fontWeight: 'bold', cursor: 'pointer', width: isMobile ? '100%' : 'auto', flex: isMobile ? 1 : 'none', minWidth: 0 };
    const filterBoxStyle = { display: 'flex', alignItems: 'center', gap: '8px', background: theme.surfaceHighlight, padding: '8px 12px', borderRadius: '8px', border: `1px solid ${theme.border}`, flex: isMobile ? 1 : 'none', minWidth: 0 };
    // 셀 패딩: 모바일 축소. 그래도 폭 초과 시 카드에 가로 스크롤 폴백(아래 minWidth).
    const cellPad = isMobile ? '11px 8px' : '16px';
    const grpPad = isMobile ? '8px 8px' : '10px 16px';

    return (
        <div style={{ padding: isMobile ? '20px 12px' : '40px', maxWidth: '1200px', margin: '0 auto', color: theme.text }}>
            <div style={{ marginBottom: isMobile ? '20px' : '32px' }}>
                <h1 style={{ fontSize: isMobile ? '24px' : '32px', fontWeight: '900', display: 'flex', alignItems: 'center', gap: isMobile ? '10px' : '12px' }}>
                    <Swords size={isMobile ? 26 : 36} color={ACCENT} /> {t.ffTitle}
                </h1>
                <p style={{ color: theme.textSub, marginTop: '8px', fontSize: isMobile ? '13px' : undefined }}>{t.ffDesc}</p>
            </div>

            <div style={{ display: 'flex', justifyContent: isMobile ? 'stretch' : 'flex-end', alignItems: 'center', marginBottom: isMobile ? '16px' : '24px', flexWrap: 'wrap', gap: isMobile ? '10px' : '16px' }}>
                <div style={filterBoxStyle}>
                    <Users size={16} color={theme.textSub} />
                    <select value={selectedOpponent} onChange={e => setSelectedOpponent(e.target.value)} style={selectStyle}>
                        <option value="All">{t.ffAllOpponents}</option>
                        {opponentList.map(tm => <option key={tm} value={tm}>{tm}</option>)}
                    </select>
                </div>
                <div style={filterBoxStyle}>
                    <MapIcon size={16} color={theme.textSub} />
                    <select value={selectedMap} onChange={e => setSelectedMap(e.target.value)} style={selectStyle}>
                        <option value="All">{t.ffAllMaps}</option>
                        {mapList.map(mp => <option key={mp} value={mp}>{mp}</option>)}
                    </select>
                </div>
            </div>

            <div style={{ background: theme.bg, borderRadius: '16px', border: `1px solid ${theme.border}`, overflow: isMobile ? 'auto' : 'hidden', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead style={{ background: theme.surfaceHighlight }}>
                        <tr>
                            <th style={{ padding: cellPad, textAlign: 'left', fontSize: '13px', color: theme.textSub }}>{t.ffColMap}</th>
                            <th style={{ padding: cellPad, textAlign: 'center', fontSize: '13px', color: theme.textSub }}>{t.ffColRound}</th>
                            <th style={{ padding: cellPad, textAlign: 'left', fontSize: '13px', color: theme.textSub }}>{t.ffColMatchup}</th>
                            <th style={{ padding: cellPad, textAlign: 'right', fontSize: '13px', color: theme.textSub }}>{t.ffColTime}</th>
                            <th style={{ padding: cellPad, textAlign: 'center', fontSize: '13px', color: theme.textSub }}>{t.ffColLink}</th>
                        </tr>
                    </thead>
                    <tbody>
                        {(() => {
                            // 날짜별 그룹핑(등장 순서 유지) — 행마다 반복되던 날짜를 그룹 헤더로 승격해 시각 소음 제거.
                            // filtered(정렬·필터 반영)를 그대로 순회하므로 기존 정렬/필터 동작은 불변.
                            const groups = [];
                            let cur = null;
                            filtered.forEach((it, idx) => {
                                const d = it.session_date || '-';
                                if (!cur || cur.date !== d) { cur = { date: d, rows: [] }; groups.push(cur); }
                                cur.rows.push({ it, idx });
                            });
                            return groups.map(g => (
                                <React.Fragment key={g.date}>
                                    <tr>
                                        <td colSpan="5" style={{ padding: grpPad, background: theme.surfaceHighlight, borderBottom: `1px solid ${theme.border}` }}>
                                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', fontWeight: 700, fontSize: '13px', color: theme.text }}>
                                                <Clock size={14} color={ACCENT} /> {g.date}
                                                <span style={{ color: theme.textSub, fontWeight: 400, fontSize: '12px' }}>({g.rows.length})</span>
                                            </span>
                                        </td>
                                    </tr>
                                    {g.rows.map(({ it, idx }) => {
                                        const rowBg = idx % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)';
                                        const videoUrl = it.video_url || "";
                                        const match = { video_url: videoUrl, video_offset: it.video_offset, game_setup_sec: it.game_setup_sec, pauses: it.pauses || [] };
                                        // 첫한타 시작 시점으로 점프 (stored 좌표 — 파서 -2초 리드 포함)
                                        const jumpTs = Math.max(0, Number(it.start_timestamp) || 0);
                                        const link = hasVideo(videoUrl) ? buildVideoLink(videoUrl, jumpTs, match, undefined, it.effective_delta || 0) : null;
                                        return (
                                            <tr key={`${it.match_id}-${it.round_number ?? 'm'}-${idx}`} style={{ background: rowBg, borderBottom: `1px solid ${theme.border}40` }}>
                                                <td style={{ padding: cellPad, fontWeight: 'bold', whiteSpace: 'nowrap' }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                        <MapIcon size={16} color={ACCENT} style={{ flexShrink: 0 }} /> {getMapDisplayName(it.map_name)}
                                                    </div>
                                                </td>
                                                <td style={{ padding: cellPad, textAlign: 'center', color: theme.textSub }}>
                                                    {it.round_number != null ? `R${it.round_number}` : '-'}
                                                </td>
                                                <td style={{ padding: cellPad, whiteSpace: 'nowrap' }}>
                                                    <span style={{ fontWeight: 'bold', color: ACCENT }}>{OUR_TEAM}</span>
                                                    <span style={{ color: theme.textSub, margin: '0 6px', fontSize: '12px' }}>vs</span>
                                                    <span style={{ fontWeight: 'bold' }}>{opponentOf(it)}</span>
                                                </td>
                                                <td style={{ padding: cellPad, textAlign: 'right', color: theme.textSub, whiteSpace: 'nowrap' }}>
                                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                                        <Clock size={13} /> {fmtClock(it.start_game_timestamp)}
                                                    </span>
                                                </td>
                                                <td style={{ padding: cellPad, textAlign: 'center', whiteSpace: 'nowrap' }}>
                                                    {link ? (
                                                        <a href={link} target="_blank" rel="noopener noreferrer"
                                                            {...vodClickProps(openVod, link, `${getMapDisplayName(it.map_name)} · ${t.ffWatch}`)}
                                                            style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '6px', padding: isMobile ? '10px 14px' : '6px 12px', minHeight: isMobile ? '44px' : undefined, borderRadius: '8px', background: `${theme.danger}20`, color: theme.danger, textDecoration: 'none', fontWeight: 'bold', fontSize: '13px' }}>
                                                            <Youtube size={16} /> {t.ffWatch}
                                                        </a>
                                                    ) : (
                                                        <span style={{ color: theme.textSub, fontSize: '12px' }}>{t.ffNoVideo}</span>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </React.Fragment>
                            ));
                        })()}
                        {!loading && filtered.length === 0 && (
                            <tr>
                                <td colSpan="5" style={{ padding: '60px', textAlign: 'center', color: theme.textSub }}>
                                    {error ? t.ffError : t.noFilteredData}
                                </td>
                            </tr>
                        )}
                        {loading && (
                            <tr>
                                <td colSpan="5" style={{ padding: '60px', textAlign: 'center', color: theme.textSub }}>{t.ffLoading}</td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
