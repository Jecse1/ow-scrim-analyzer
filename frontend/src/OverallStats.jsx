import React, { useEffect, useMemo, useState } from "react";
import { fetchCached, invalidateApiCache } from "./utils/apiCache";
import { ChevronLeft, RefreshCw, Search, X, Youtube, Zap, Skull, Trophy, Map as MapIcon, User, Filter, Calendar, Users, Sword, AlertOctagon, TrendingUp, TrendingDown, Minus, ChevronRight } from "lucide-react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid, Cell } from "recharts";
import { useTheme } from "./ThemeContext";
import { useLanguage } from "./LanguageContext";
import { useIsMobile, ScrollX } from "./utils/responsive";
import { tpl } from "./FightLabStats";
import { computeFights } from './utils/fightAnalysis';
import { buildMapSummary, manualToPseudoRecords } from './utils/mapSummary';
import { buildVideoLink, hasVideo } from './utils/videoLink';
import { getHeroImageSrc, getHeroByName, getDisplayName, getMapDisplayName } from './gameData';
import { BASE_TEAM } from './config';

const API_BASE = import.meta.env.PROD ? "" : "";

const KEYWORD_TYPES = { MAP: "MAP", HERO: "HERO", EVENT: "EVENT", RESULT: "RESULT", PLAYER: "PLAYER" };
const EVENT_KEYWORDS = { "궁극기": "ultimate_start", "궁": "ultimate_start", "ult": "ultimate_start", "처치": "kill", "킬": "kill", "kill": "kill", "죽음": "death", "데스": "death", "death": "death" };
const RESULT_KEYWORDS = { "승리": "win", "승": "win", "win": "win", "패배": "loss", "패": "loss", "loss": "loss", "lose": "loss", "무승부": "draw", "무": "draw", "draw": "draw" };
const KNOWN_MAPS = [ "왕의길", "왕의 길", "눔바니", "미드타운", "블리자드월드", "블리자드 월드", "아이헨발데", "파라이수", "할리우드", "도라도", "리알토", "서킷로얄", "서킷 로얄", "쓰레기촌", "66번국도", "66번 국도", "지브롤터", "샴발리", "샴발리수도원", "샴발리 수도원", "하바나", "네팔", "리장", "리장타워", "부산", "오아시스", "일리오스", "남극", "남극기지", "사모아", "뉴퀸스트리트", "뉴 퀸 스트리트", "콜로세오", "에스페란사", "루나사피", "뉴정크시티", "뉴 정크 시티", "수라바사", "하나오카", "아누비스" ];
const KNOWN_HEROES = [ '디바', '둠피스트', '정커퀸', '마우가', '오리사', '라마트라', '라인하르트', '로드호그', '시그마', '윈스턴', '레킹볼', '자리야', '해저드', '애쉬', '바스티온', '캐서디', '에코', '겐지', '한조', '정크랫', '메이', '파라', '리퍼', '소전', '솔저76', '솜브라', '시메트라', '토르비욘', '트레이서', '위도우메이커', '벤처', '벤데타', '프레야', '시온', '아나', '바티스트', '브리기테', '일리아리', '주노', '키리코', '라이프위버', '루시우', '메르시', '모이라', '젠야타', '우양', '제트팩 캣', '미즈키', '엠레', '디몬', 'D.Mon' ];

const COLOR_TEAM1 = '#60a5fa';
const COLOR_TEAM2 = '#f87171';

// 하이라이트 카드 렌더 상한. 이벤트가 1만+개면 전량 렌더 시 DOM이 폭발해
// 필터 타이핑 리렌더마다 탭이 메모리 초과로 죽는다. 상위 N개만 그린다.
const MAX_MOMENTS_RENDERED = 300;
const MOMENTS_PAGE_SIZE = 50; // 하이라이트 기본 표시 개수(+더보기로 확장, MAX까지)

// 요약 탭 상단 카드 = 우리 팀(기준 팀) 관점. 기본 우리 팀은 config.js 에서 설정(BASE_TEAM).
// (baseTeam이 특정 팀이면 그 팀 관점으로 fetch — /api/fight-records?base_team=)
const OUR_TEAM = BASE_TEAM;

const normalize = (str) => (str || "").replace(/\s+/g, "").toLowerCase();
// 영웅명 비교 키: SSOT 정본(logName)으로 해석 — '디바'/'D.Va'/'솔저76'/'솔저: 76' 등 어떤 표기든 동일 키
const heroKey = (name) => getHeroByName(name)?.logName || normalize(name);
const isSameHero = (a, b) => heroKey(a) === heroKey(b);

// 'YYYY-MM-DD' 하루 가감 (요약 추세의 이전 기간 산출용, UTC 산술)
const addDaysStr = (s, n) => {
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
};
const pct0 = (v) => (v == null ? '-' : `${Math.round(v * 100)}%`);

// [STEP3] 이미지 리졸버는 gameData.getHeroImageSrc(SSOT image 필드 기반)로 통합·임포트.

const getYouTubeLink = (videoUrl, offset, timestamp, pauses = [], gameSetupSec = null) => {
    const matchLike = { video_url: videoUrl, video_offset: offset, game_setup_sec: gameSetupSec, pauses };
    return buildVideoLink(videoUrl, timestamp, matchLike) || "#";
};

// 요약 탭 — "요즘 우리 어떤가"에 답하는 첫 화면.
// ① 상단 요약 카드(맵 분석 상단 카드 구성·스타일 재사용): 맵 승률(승/패/무)·한타 승률·추세·최강/최약 맵타입
// ② 영웅별/맵별 통계 진입점  ③ 하단 부가 지표(평균 처치/데스/딜량)
function SummaryTab({ theme, t, tpl, pct0, summary, summaryTeam, stats, topHero, topMap, onGoHeroes, onGoMaps }) {
  // 방향색: 50% 기준. 정확히 50%는 중립.
  const dir = (win) => (win == null || Math.abs(win - 0.5) < 0.005) ? theme.text : win > 0.5 ? theme.success : theme.danger;

  const SummaryCard = ({ label, value, valueColor, sub }) => (
    <div style={{ background: theme.surface, border: `1px solid ${theme.border}`, borderRadius: 14, padding: '16px 18px', display: 'flex', flexDirection: 'column', justifyContent: 'center', minHeight: 92 }}>
      <div style={{ fontSize: 11, color: theme.textSub, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.02em', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 900, color: valueColor || theme.text, lineHeight: 1.15 }}>{value}</div>
      {sub != null && <div style={{ fontSize: 11, color: theme.textSub, marginTop: 5 }}>{sub}</div>}
    </div>
  );

  const EntryCard = ({ label, teaser, onClick }) => (
    <button onClick={onClick} style={{ textAlign: 'left', background: theme.bg, border: `1px solid ${theme.border}`, borderRadius: 14, padding: '18px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, transition: 'border-color 0.2s' }}
      onMouseOver={e => { e.currentTarget.style.borderColor = theme.borderHighlight; }} onMouseOut={e => { e.currentTarget.style.borderColor = theme.border; }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: theme.text }}>{label}</div>
        {teaser && <div style={{ fontSize: 12, color: theme.textSub, marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{teaser}</div>}
      </div>
      <span style={{ fontSize: 12, color: theme.primary, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>{t.osSummaryEntryHint}</span>
    </button>
  );

  if (!summary) {
    return <div style={{ background: theme.surface, borderRadius: 16, border: `1px solid ${theme.border}`, padding: 60, textAlign: 'center', color: theme.textSub }}>{t.osSummaryNoData}</div>;
  }

  const ms = summary.overallMs;
  const wld = tpl(t.maWlDrawTpl, { w: ms.wins, l: ms.losses, d: ms.draws });

  // 추세 표시
  let trendVal, trendColor, trendSub;
  if (summary.trend == null) {
    trendVal = <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Minus size={18} color={theme.textSub} />—</span>;
    trendColor = theme.textSub;
    trendSub = summary.prevSample > 0 ? tpl(t.osTrendPrevTpl, { p: pct0(summary.prevFightWin), n: summary.prevSample }) : t.osTrendHint;
  } else {
    const r = Math.round(summary.trend);
    const Icon = r > 0 ? TrendingUp : r < 0 ? TrendingDown : Minus;
    trendColor = r > 0 ? theme.success : r < 0 ? theme.danger : theme.textSub;
    trendVal = <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Icon size={18} color={trendColor} />{r > 0 ? '+' : ''}{r}{t.flUnitPp}</span>;
    trendSub = tpl(t.osTrendPrevTpl, { p: pct0(summary.prevFightWin), n: summary.prevSample });
  }

  return (
    <div>
      <div style={{ fontSize: 12, color: theme.textSub, fontWeight: 700, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
        <Users size={14} /> {tpl(t.osSummaryBasisTpl, { team: summaryTeam })}
      </div>

      {/* ① 상단 요약 카드 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 28 }}>
        <SummaryCard label={t.osMapWinCard} value={pct0(ms.win)} valueColor={dir(ms.win)} sub={ms.denom > 0 ? wld : null} />
        <SummaryCard label={t.maColFightWin} value={pct0(summary.fightWin)} valueColor={dir(summary.fightWin)} sub={summary.fightSample > 0 ? tpl(t.osFightSampleTpl, { w: summary.fightWins, n: summary.fightSample }) : null} />
        <SummaryCard label={t.osTrendCard} value={trendVal} valueColor={trendColor} sub={trendSub} />
        <SummaryCard label={t.maSummaryBest}
          value={summary.best ? <span>{summary.best.type} <span style={{ color: theme.success }}>{pct0(summary.best.win)}</span></span> : <span style={{ fontSize: 14, color: theme.textSub }}>{t.maSummaryNone}</span>}
          sub={summary.best ? tpl(t.maCellWinTpl, { p: pct0(summary.best.win), w: summary.best.wins }) : null} />
        <SummaryCard label={t.maSummaryWorst}
          value={summary.worst ? <span>{summary.worst.type} <span style={{ color: theme.danger }}>{pct0(summary.worst.win)}</span></span> : <span style={{ fontSize: 14, color: theme.textSub }}>{t.maSummaryNone}</span>}
          sub={summary.worst ? tpl(t.maCellWinTpl, { p: pct0(summary.worst.win), w: summary.worst.wins }) : null} />
      </div>

      {/* ② 상세 통계 진입점 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12, marginBottom: 28 }}>
        <EntryCard label={t.osSummaryEntryHeroes} teaser={topHero ? tpl(t.osTopHeroTpl, { hero: topHero }) : null} onClick={onGoHeroes} />
        <EntryCard label={t.osSummaryEntryMaps} teaser={topMap ? tpl(t.osTopMapTpl, { map: topMap }) : null} onClick={onGoMaps} />
      </div>

      {/* ③ 하단 부가 지표 (주 정보 아님) */}
      <div style={{ fontSize: 12, color: theme.textSub, fontWeight: 700, marginBottom: 10 }}>{t.osSecondaryMetrics}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
        <SummaryCard label={t.searchedGames} value={`${stats?.totalGames || 0} ${t.gamesPlayed}`} />
        <SummaryCard label={t.avgKills} value={stats?.avgKills ?? 0} />
        <SummaryCard label={t.avgDeaths} value={stats?.avgDeaths ?? 0} />
        <SummaryCard label={t.avgDmg} value={Number(stats?.avgDmg || 0).toLocaleString()} />
      </div>
    </div>
  );
}

export default function OverallStats({ onBack, onGoSessions }) {
  const { theme } = useTheme();
  const { t } = useLanguage();
  const isMobile = useIsMobile();

  const [loading, setLoading] = useState(true);
  const [reloading, setReloading] = useState(false);
  const [matches, setMatches] = useState([]);
  const [fightRecords, setFightRecords] = useState([]); // /api/fight-records — 요약 카드(맵 분석과 동일 소스)
  const [inputText, setInputText] = useState("");
  const [activeTags, setActiveTags] = useState([]);
  const [activeTab, setActiveTab] = useState("summary");
  const [momentsVisible, setMomentsVisible] = useState(MOMENTS_PAGE_SIZE);

  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  
  // 💡 기준 팀(Base Team) 기본값을 "All"로 설정
  const [baseTeam, setBaseTeam] = useState("All");

  // 요약 카드 관점 팀: 'All'이면 우리 팀(기준 팀), 특정 팀 선택 시 그 팀.
  const summaryTeam = baseTeam === 'All' ? OUR_TEAM : baseTeam;

  // fight-records 로드 — 기준 팀은 맵 분석 탭과 같은 URL(무파라미터)이라 캐시를 공유한다.
  async function loadFightRecords(team) {
    const url = team === OUR_TEAM
      ? `${API_BASE}/api/fight-records`
      : `${API_BASE}/api/fight-records?base_team=${encodeURIComponent(team)}`;
    try {
      const d = await fetchCached(url);
      // 수기 매치는 의사 레코드로 병합 — 맵 승률(매치 단위)에 포함, 한타 지표에서는 자동 제외
      setFightRecords([...(d?.records || []), ...manualToPseudoRecords(d?.match_summaries)]);
    } catch (e) {
      console.error(e);
      setFightRecords([]);
    }
  }

  async function loadAll() {
    setLoading(true);
    try {
      // 매치별 개별 호출(N+1) 대신 벌크 2발:
      //  - /api/scrims            : 경량 메타 (result/winner/영상/퍼즈/스코어)
      //  - /api/scrims/full-events: stats(매치 합산) + rounds(events + 라운드별 stats)
      // 두 응답 모두 fetchCached라 다른 탭과 공유되고 세션당 1회만 네트워크를 탄다.
      const [scrims, fullEvents] = await Promise.all([
        fetchCached(`${API_BASE}/api/scrims`),
        fetchCached(`${API_BASE}/api/scrims/full-events`),
      ]);

      const feById = {};
      for (const s of fullEvents || []) {
        for (const m of s.matches || []) feById[m.id] = m;
      }

      // 순회 순서는 기존과 동일하게 /api/scrims 기준 (세션 최신순 → 매치 순)
      const out = [];
      for (const s of scrims || []) {
        for (const m of s.matches || []) {
          const fe = feById[m.id];
          if (!fe) continue;
          // fe(stats/rounds/winner)가 경량 메타를 덮어씀 — winner 규칙은 두 응답이 동일.
          // result/video_url/video_offset/game_setup_sec/pauses는 fe에 없으므로 m 값 유지.
          out.push({ ...m, ...fe, video_url: m.video_url || s.video_url, scrim_date: s.date });
        }
      }
      setMatches(out);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
      setReloading(false);
    }
  }

  useEffect(() => { loadAll(); }, []);
  useEffect(() => { loadFightRecords(summaryTeam); }, [summaryTeam]);
  // 새로고침 버튼 = 명시적 최신화 요청이므로 공유 캐시를 비우고 다시 받는다.
  const handleReload = () => { setReloading(true); invalidateApiCache(); loadAll(); loadFightRecords(summaryTeam); };

  // 존재하는 모든 팀 추출
  const allTeams = useMemo(() => {
      const teams = new Set();
      matches.forEach(m => {
          if (m.team_1_name) teams.add(m.team_1_name);
          if (m.team_2_name) teams.add(m.team_2_name);
      });
      return [...teams].filter(Boolean);
  }, [matches]);

  const addTag = (text) => {
    const cleanText = text.trim();
    if (!cleanText) return;
    if (activeTags.some(t => t.label === cleanText)) { setInputText(""); return; }

    let type = KEYWORD_TYPES.PLAYER;
    let value = cleanText;
    let label = cleanText;

    const heroHit = getHeroByName(cleanText);
    if (KNOWN_MAPS.some(m => cleanText.includes(m) || m.includes(cleanText))) type = KEYWORD_TYPES.MAP;
    else if (heroHit || KNOWN_HEROES.some(h => normalize(cleanText) === normalize(h))) {
        type = KEYWORD_TYPES.HERO;
        // 영웅 태그는 정본(logName)으로 저장하고 표시명으로 라벨링 — "솔저"/"d.va" 등 어떤 표기든 같은 태그
        if (heroHit) { value = heroHit.logName; label = getDisplayName(heroHit.logName); }
        if (activeTags.some(t => t.type === KEYWORD_TYPES.HERO && isSameHero(t.label, label))) { setInputText(""); return; }
    }
    else if (EVENT_KEYWORDS[cleanText]) { type = KEYWORD_TYPES.EVENT; value = EVENT_KEYWORDS[cleanText]; }
    else if (RESULT_KEYWORDS[cleanText]) { type = KEYWORD_TYPES.RESULT; value = RESULT_KEYWORDS[cleanText]; }

    setActiveTags([...activeTags, { type, value, label }]);
    setInputText("");
  };

  const removeTag = (index) => {
    const newTags = [...activeTags];
    newTags.splice(index, 1);
    setActiveTags(newTags);
  };
  const handleKeyDown = (e) => { if (e.key === 'Enter') addTag(inputText); };

  // 매치별 fights 캐싱 — matches가 바뀔 때만 재계산
  const matchFightsMap = useMemo(() => {
    const map = {};
    matches.forEach(m => {
      const allEvents = (m.rounds || []).flatMap(r => r.events || []);
      map[m.id] = computeFights(allEvents, m.team_1_name || '1팀', m.team_2_name || '2팀');
    });
    return map;
  }, [matches]);

  // 한타 통계 탭용 집계 (date+map 필터 적용, result 태그 무관)
  const overallFightStats = useMemo(() => {
    let fMatches = matches.filter(m => {
      if (startDate && m.scrim_date < startDate) return false;
      if (endDate && m.scrim_date > endDate) return false;
      return true;
    });
    const mapTag = activeTags.find(tg => tg.type === KEYWORD_TYPES.MAP);
    if (mapTag) fMatches = fMatches.filter(m => m.map_name.includes(mapTag.label));
    if (baseTeam !== 'All') fMatches = fMatches.filter(m => m.team_1_name === baseTeam || m.team_2_name === baseTeam);

    if (fMatches.length === 0) return null;

    let lostFights = 0, killsWhenLost = 0;
    let afterWinWon = 0, afterWinTotal = 0;
    let afterLossWon = 0, afterLossTotal = 0;
    // playerName -> { kills, fightSet(Set), heroKillMap, teamName }
    const carryMap = {};
    // playerName -> { count, heroMap, teamName }
    const firstDeathMap = {};

    fMatches.forEach(m => {
      const fights = matchFightsMap[m.id] || [];
      const t1Name = m.team_1_name || '1팀';
      const t2Name = m.team_2_name || '2팀';

      fights.forEach((f, fIdx) => {
        if (f.winner === 'Draw') return;

        const losingTeam = f.winner === t1Name ? t2Name : t1Name;
        const fightId = `${m.id}-${fIdx}`;

        // 패배 한타 저항력
        if (baseTeam === 'All') {
          killsWhenLost += f.winner === t1Name ? f.t2Kills : f.t1Kills;
          lostFights++;
        } else if (f.winner !== baseTeam) {
          killsWhenLost += m.team_1_name === baseTeam ? f.t1Kills : f.t2Kills;
          lostFights++;
        }

        // 퍼스트 데스 순위 (패배팀 첫 사망자)
        if (f.first_pick_player && f.first_pick_team) {
          const shouldCount = baseTeam === 'All' || f.first_pick_team === baseTeam;
          if (shouldCount) {
            const pName = f.first_pick_player;
            if (!firstDeathMap[pName]) firstDeathMap[pName] = { count: 0, heroMap: {}, teamName: f.first_pick_team };
            firstDeathMap[pName].count++;
            const h = f.first_pick_hero || 'Unknown';
            firstDeathMap[pName].heroMap[h] = (firstDeathMap[pName].heroMap[h] || 0) + 1;
          }
        }

        // 패배 한타 캐리 순위 (패배팀 선수의 킬 집계)
        const trackTeam = baseTeam === 'All' ? losingTeam : baseTeam;
        const isBaseLost = baseTeam === 'All' || f.winner !== baseTeam;
        if (isBaseLost) {
          f.events.forEach(ev => {
            if (ev.event_type !== 'kill' || ev.player_team !== trackTeam) return;
            const pName = ev.player_name;
            if (!carryMap[pName]) carryMap[pName] = { kills: 0, fightSet: new Set(), heroKillMap: {}, teamName: ev.player_team };
            carryMap[pName].kills++;
            carryMap[pName].fightSet.add(fightId);
            const hero = ev.player_hero || 'Unknown';
            carryMap[pName].heroKillMap[hero] = (carryMap[pName].heroKillMap[hero] || 0) + 1;
          });
        }
      });

      // 모멘텀 (매치 경계 분리)
      for (let i = 1; i < fights.length; i++) {
        const prev = fights[i - 1];
        const curr = fights[i];
        if (prev.winner === 'Draw' || curr.winner === 'Draw') continue;

        if (baseTeam === 'All') {
          afterWinTotal++;
          if (curr.winner === prev.winner) afterWinWon++;
          const prevLoser = prev.winner === t1Name ? t2Name : t1Name;
          afterLossTotal++;
          if (curr.winner === prevLoser) afterLossWon++;
        } else {
          const prevWon = prev.winner === baseTeam;
          const currWon = curr.winner === baseTeam;
          if (prevWon) { afterWinTotal++; if (currWon) afterWinWon++; }
          else { afterLossTotal++; if (currWon) afterLossWon++; }
        }
      }
    });

    const MIN_LOST_FIGHTS = 10;
    const carryRanking = Object.entries(carryMap)
      .map(([name, data]) => {
        const cnt = data.fightSet.size;
        const avg = cnt > 0 ? data.kills / cnt : 0;
        const topHero = Object.entries(data.heroKillMap).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
        return { name, kills: data.kills, lostFightCount: cnt, avgKills: parseFloat(avg.toFixed(2)), topHero, teamName: data.teamName };
      })
      .filter(p => p.lostFightCount >= MIN_LOST_FIGHTS)
      .sort((a, b) => b.avgKills - a.avgKills)
      .slice(0, 10);

    const firstDeathRanking = Object.entries(firstDeathMap)
      .map(([name, data]) => {
        const topHero = Object.entries(data.heroMap).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
        return { name, count: data.count, hero: topHero, teamName: data.teamName };
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return {
      matchCount: fMatches.length,
      lostFights,
      avgKills: lostFights > 0 ? (killsWhenLost / lostFights).toFixed(1) : '0.0',
      resistancePct: lostFights > 0 ? ((killsWhenLost / (lostFights * 5)) * 100).toFixed(1) : '0.0',
      afterWinWon, afterWinTotal,
      afterWinPct: afterWinTotal > 0 ? ((afterWinWon / afterWinTotal) * 100).toFixed(1) : '0.0',
      afterLossWon, afterLossTotal,
      afterLossPct: afterLossTotal > 0 ? ((afterLossWon / afterLossTotal) * 100).toFixed(1) : '0.0',
      carryRanking,
      firstDeathRanking,
    };
  }, [matches, activeTags, startDate, endDate, baseTeam, matchFightsMap]);

  const filteredData = useMemo(() => {
    if (!matches.length) return { stats: null, moments: [], heroStats: [], mapStats: [] };

    let targetMatches = matches.filter(m => {
        if (!startDate && !endDate) return true;
        if (startDate && m.scrim_date < startDate) return false;
        if (endDate && m.scrim_date > endDate) return false;
        return true;
    });

    const mapTag = activeTags.find(t => t.type === KEYWORD_TYPES.MAP);
    const resultTag = activeTags.find(t => t.type === KEYWORD_TYPES.RESULT);
    const heroTag = activeTags.find(t => t.type === KEYWORD_TYPES.HERO);
    const playerTag = activeTags.find(t => t.type === KEYWORD_TYPES.PLAYER);

    if (mapTag) targetMatches = targetMatches.filter(m => m.map_name.includes(mapTag.label));

    // baseMatches: date+map 필터만 적용, resultTag 미적용 (moments에서 fight 레벨로 필터)
    const baseMatches = targetMatches;

    if (resultTag) {
        targetMatches = targetMatches.filter(m => {
            if (resultTag.value === 'draw') return m.result && m.result.includes('무');
            if (baseTeam === 'All') return true;
            const isWin = m.winner === baseTeam;
            if (resultTag.value === 'win') return isWin;
            if (resultTag.value === 'loss') return !isWin && !(m.result && m.result.includes('무'));
            return true;
        });
    }

    let totalWins = 0, totalGames = 0, totalKills = 0, totalDeaths = 0, totalDmg = 0;
    const heroMap = {}; 
    const mapMap = {};  

    targetMatches.forEach(m => {
        if (playerTag) {
            const playerInGame = m.stats.some(s => s.player_name.toLowerCase().includes(playerTag.label.toLowerCase()));
            if (!playerInGame) return;
        }

        if (heroTag) {
            // 보조 영웅도 검색되도록 라운드별 실제 출전 영웅 기준으로 체크
            const heroPlayed = (m.rounds || []).some(r => r.stats.some(s => {
                const isHeroMatch = isSameHero(s.hero_name, heroTag.label);
                if (playerTag) return isHeroMatch && s.player_name.toLowerCase().includes(playerTag.label.toLowerCase());
                return isHeroMatch;
            }));
            if (!heroPlayed) return;
        }

        const isWin = baseTeam === 'All' ? false : (m.winner === baseTeam);
        const baseTeamPlayed = baseTeam === 'All' || m.team_1_name === baseTeam || m.team_2_name === baseTeam;
        if (baseTeamPlayed) {
            totalGames++;
            if (isWin) totalWins++;

            if (!mapMap[m.map_name]) mapMap[m.map_name] = { games: 0, wins: 0 };
            mapMap[m.map_name].games++;
            if (isWin) mapMap[m.map_name].wins++;
        }

        // 매치 합산 킬/뎃/뎀은 aggregate stats 사용 (선수별 정확한 합산값)
        const targetStats = m.stats.filter(s => {
            if (baseTeam !== 'All' && s.team_name !== baseTeam) return false;
            if (playerTag && !s.player_name.toLowerCase().includes(playerTag.label.toLowerCase())) return false;
            return true;
        });
        targetStats.forEach(s => {
            totalKills += s.eliminations;
            totalDeaths += s.deaths;
            totalDmg += s.hero_damage_dealt;
        });

        // 영웅별 stats: 라운드 단위로 순회해 보조 영웅 누락 방지
        (m.rounds || []).forEach(r => {
            r.stats.forEach(s => {
                if (baseTeam !== 'All' && s.team_name !== baseTeam) return;
                if (playerTag && !s.player_name.toLowerCase().includes(playerTag.label.toLowerCase())) return;
                const hName = s.hero_name;
                if (!heroMap[hName]) heroMap[hName] = { games: 0, wins: 0, kills: 0, deaths: 0, dmg: 0, playTime: 0 };
                heroMap[hName].playTime += s.hero_time_played;
                heroMap[hName].kills += s.eliminations;
                heroMap[hName].deaths += s.deaths;
                heroMap[hName].dmg += s.hero_damage_dealt;
            });
        });

        // 영웅별 게임 수/승률: 라운드 출전 영웅 전부 수집 (보조 영웅 포함)
        const team1Heroes = new Set();
        const team2Heroes = new Set();
        (m.rounds || []).forEach(r => {
            r.stats.forEach(s => {
                if (s.team_name === m.team_1_name) team1Heroes.add(s.hero_name);
                else if (s.team_name === m.team_2_name) team2Heroes.add(s.hero_name);
            });
        });

        if (baseTeam === 'All' || baseTeam === m.team_1_name) {
            team1Heroes.forEach(hName => {
                if (heroMap[hName]) {
                    heroMap[hName].games++;
                    if (m.winner === m.team_1_name) heroMap[hName].wins++;
                }
            });
        }
        if (baseTeam === 'All' || baseTeam === m.team_2_name) {
            team2Heroes.forEach(hName => {
                if (heroMap[hName]) {
                    heroMap[hName].games++;
                    if (m.winner === m.team_2_name) heroMap[hName].wins++;
                }
            });
        }
    });

    const heroStatsArr = Object.entries(heroMap).map(([name, data]) => ({
        name, games: data.games,
        winRate: data.games > 0 ? Math.round((data.wins / data.games) * 100) : 0,
        kda: data.deaths > 0 ? (data.kills / data.deaths).toFixed(2) : data.kills.toFixed(2),
        avgDmg: data.games > 0 ? Math.round(data.dmg / data.games) : 0,
        playTime: data.playTime
    })).sort((a, b) => b.games - a.games);

    const mapStatsArr = Object.entries(mapMap).map(([name, data]) => ({
        name: getMapDisplayName(name), games: data.games,
        winRate: data.games > 0 ? Math.round((data.wins / data.games) * 100) : 0
    })).sort((a, b) => b.games - a.games);

    const eventTag = activeTags.find(t => t.type === KEYWORD_TYPES.EVENT);
    const moments = [];
    // baseMatches 기준으로 순회: fight 레벨 result는 moment 단위로 판정
    // 하이라이트는 영상 있는 매치만 (통계/한타는 영향 없음)
    baseMatches.filter(m => hasVideo(m.video_url)).forEach(m => {
        const mFights = matchFightsMap[m.id] || [];
        const mt1Name = m.team_1_name || '1팀';
        const mt2Name = m.team_2_name || '2팀';

        (m.rounds || []).forEach(r => {
            (r.events || []).forEach(ev => {
                let isMatch = true;

                if (baseTeam !== 'All' && ev.player_team !== baseTeam) isMatch = false;

                if (eventTag && eventTag.value === 'death') {
                    // 죽음/데스: death 이벤트(player_name) 또는 kill 이벤트에서 피해자(target_name) 검색
                    if (playerTag) {
                        const isDeath = ev.event_type === 'death' && ev.player_name && ev.player_name.toLowerCase().includes(playerTag.label.toLowerCase());
                        const isVictim = ev.event_type === 'kill' && ev.target_name && ev.target_name.toLowerCase().includes(playerTag.label.toLowerCase());
                        if (!isDeath && !isVictim) isMatch = false;
                    } else {
                        if (ev.event_type !== 'death') isMatch = false;
                    }
                    if (heroTag) {
                        const evHero = ev.player_hero || ev.hero;
                        if (!evHero || !isSameHero(evHero, heroTag.label)) isMatch = false;
                    }
                } else {
                    if (playerTag && (!ev.player_name || !ev.player_name.toLowerCase().includes(playerTag.label.toLowerCase()))) isMatch = false;
                    if (heroTag) {
                        const evHero = ev.player_hero || ev.hero;
                        if (!evHero || !isSameHero(evHero, heroTag.label)) isMatch = false;
                    }
                    if (eventTag) {
                        if (eventTag.value === 'ultimate_start' && ev.event_type !== 'ultimate_start') isMatch = false;
                        if (eventTag.value === 'kill' && ev.event_type !== 'kill') isMatch = false;
                    } else {
                        if (ev.event_type !== 'ultimate_start' && ev.event_type !== 'kill') isMatch = false;
                    }
                }

                if (isMatch) {
                    // 이 이벤트가 속한 한타를 찾아 승패 판정
                    const fight = mFights.find(f => f.startTime <= ev.timestamp && ev.timestamp <= f.fixedEndTime);
                    let result = 'neutral';
                    if (fight) {
                        const pTeam = ev.player_team;
                        const isT1 = pTeam === mt1Name || pTeam === '1팀' || pTeam === 'Team 1';
                        const isT2 = pTeam === mt2Name || pTeam === '2팀' || pTeam === 'Team 2';
                        if (fight.winner === 'Draw') {
                            result = 'draw';
                        } else if ((isT1 && fight.winner === mt1Name) || (isT2 && fight.winner === mt2Name)) {
                            result = 'win';
                        } else if (isT1 || isT2) {
                            result = 'loss';
                        }
                    }

                    const deathDesc = ev.event_type === 'death'
                        ? `${ev.player_name} ${t.osEliminated}`
                        : ev.event_type === 'kill' && eventTag && eventTag.value === 'death'
                            ? `${ev.player_name} ${t.osKill} ➜ ${ev.target_name} (${ev.target_name} ${t.osEliminated})`
                            : null;
                    moments.push({
                        id: m.id + ev.timestamp + ev.player_name,
                        matchName: m.map_name,
                        desc: ev.desc || deathDesc || (ev.event_type === 'kill' ? `${ev.player_name} ${t.osKill} ➜ ${ev.target_name}` : `${ev.player_name} ${t.ults}`),
                        hero: ev.player_hero || ev.hero,
                        timestamp: ev.timestamp,
                        videoUrl: m.video_url, videoOffset: m.video_offset, gameSetupSec: m.game_setup_sec, pauses: m.pauses,
                        type: ev.event_type,
                        player_team: ev.player_team,
                        result
                    });
                }
            });
        });
    });

    // fight 레벨 result로 moments 필터 (매치 레벨 필터와 독립)
    const filteredMoments = resultTag ? moments.filter(mo => mo.result === resultTag.value) : moments;

    // 💡 평균 K/D/A를 계산할 때 한 팀 기준(5명)인지 전체(10명)인지 분류
    let statDivisor = 0;
    if (playerTag) statDivisor = totalGames; // 개인 검색 시
    else if (baseTeam === 'All') statDivisor = totalGames * 10; // 전체 팀
    else statDivisor = totalGames * 5; // 한 팀 기준
    
    return {
        stats: {
            totalGames,
            winRate: totalGames > 0 ? ((totalWins / totalGames) * 100).toFixed(1) : 0,
            avgKills: statDivisor > 0 ? (totalKills / statDivisor).toFixed(1) : 0,
            avgDeaths: statDivisor > 0 ? (totalDeaths / statDivisor).toFixed(1) : 0,
            avgDmg: statDivisor > 0 ? (totalDmg / statDivisor).toFixed(0) : 0,
        },
        heroStats: heroStatsArr, mapStats: mapStatsArr, moments: filteredMoments
    };
  }, [matches, activeTags, startDate, endDate, baseTeam, matchFightsMap]);

  // 요약 탭 상단 카드 — 맵 분석 탭과 동일 소스(fight-records)·정의로 계산해 승률 정합 보장.
  // 기간: OverallStats 날짜 필터 사용. 추세: 시작일이 있으면 그 이전 전체를 이전 기간으로 비교.
  const mapSummary = useMemo(() => {
    if (!fightRecords.length) return null;
    const rangeA = [startDate || '', endDate || ''];
    const rangePrev = startDate ? ['', addDaysStr(startDate, -1)] : null;
    return buildMapSummary(fightRecords, rangeA, rangePrev);
  }, [fightRecords, startDate, endDate]);

  // 하이라이트 필터/기간 변경 시 표시 개수 초기화
  useEffect(() => { setMomentsVisible(MOMENTS_PAGE_SIZE); }, [activeTags, startDate, endDate, baseTeam]);

  const tagColor = (type) => {
      switch(type) {
          case KEYWORD_TYPES.MAP: return theme.success;
          case KEYWORD_TYPES.HERO: return theme.primary;
          case KEYWORD_TYPES.EVENT: return theme.warning;
          case KEYWORD_TYPES.RESULT: return theme.danger;
          case KEYWORD_TYPES.PLAYER: return '#8b5cf6';
          default: return theme.textSub;
      }
  };

  const TabButton = ({ id, label, icon: Icon }) => (
    <button onClick={() => setActiveTab(id)} style={{ flex: isMobile ? '0 0 auto' : 1, whiteSpace: 'nowrap', minHeight: isMobile ? 44 : undefined, padding: '12px', background: activeTab === id ? theme.surfaceHighlight : 'transparent', border: 'none', borderBottom: activeTab === id ? `2px solid ${theme.primary}` : `2px solid ${theme.border}`, color: activeTab === id ? theme.text : theme.textSub, fontWeight: 'bold', cursor: 'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:'8px', transition: 'all 0.2s' }}>
        <Icon size={16}/> {label}
    </button>
  );

  const Card = ({ title, value, color }) => (
    <div style={{ border: `1px solid ${theme.border}`, background: theme.surface, borderRadius: 14, padding: 16, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
      <div style={{ color: theme.textSub, fontSize: 12, fontWeight: 700, textTransform: 'uppercase' }}>{title}</div>
      <div style={{ fontSize: 28, fontWeight: 900, marginTop: 4, color: color || theme.text }}>{value}</div>
    </div>
  );

  return (
    <div style={{ padding: isMobile ? "16px 12px" : "40px", maxWidth: 1200, margin: "0 auto", color: theme.text }}>
      <div style={{ display: "flex", flexWrap: isMobile ? 'wrap' : 'nowrap', gap: isMobile ? 10 : 0, justifyContent: "space-between", alignItems:'center', marginBottom:'24px' }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <button onClick={onBack} style={{ background: theme.surface, border: `1px solid ${theme.border}`, color: theme.text, borderRadius: 10, padding: "10px 12px", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 8 }}><ChevronLeft size={16} /> {t.back}</button>
          <h1 style={{ fontSize: 24, fontWeight: 900, margin:0 }}>{t.overall} & {t.osAnalysis}</h1>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={onGoSessions} style={{ background: theme.surfaceHighlight, border: `1px solid ${theme.borderHighlight}`, color: theme.text, padding: "10px 14px", borderRadius: 10, cursor: "pointer", fontWeight: 700 }}>{t.sessions}</button>
          <button onClick={handleReload} disabled={reloading} style={{ background: theme.surfaceHighlight, border: `1px solid ${theme.borderHighlight}`, color: theme.text, padding: "10px 14px", borderRadius: 10, cursor: reloading ? "wait" : "pointer", fontWeight: 900, display: "inline-flex", gap: 8, alignItems: "center", opacity: reloading ? 0.7 : 1 }}><RefreshCw size={16} className={reloading ? "spin" : ""} /> {t.reload}</button>
        </div>
      </div>

      <div style={{ display: 'flex', flexWrap: isMobile ? 'wrap' : 'nowrap', gap: isMobile ? '10px' : '16px', alignItems: 'center', marginBottom: '16px', background: theme.surface, padding: '16px', borderRadius: '12px', border: `1px solid ${theme.border}` }}>
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

      <div style={{ background: theme.surface, padding: '20px', borderRadius: '16px', border: `1px solid ${theme.border}`, marginBottom: '24px', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', background: theme.bg, padding: '12px 16px', borderRadius: '12px', border: `1px solid ${theme.border}` }}>
            <Search size={20} color={theme.textSub} />
            <input type="text" placeholder={t.filterPlaceholder} style={{ background: 'transparent', border: 'none', color: theme.text, fontSize: '16px', flex: 1, outline: 'none' }} value={inputText} onChange={(e) => setInputText(e.target.value)} onKeyDown={handleKeyDown} />
            {inputText && <button onClick={() => addTag(inputText)} style={{background: theme.primary, color:'#fff', border:'none', borderRadius:'6px', padding:'4px 12px', cursor:'pointer', fontWeight:'bold'}}>{t.add}</button>}
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '12px' }}>
            {activeTags.length === 0 && <span style={{fontSize:'13px', color: theme.textSub, paddingLeft:'4px', display:'flex', alignItems:'center', gap:'6px'}}><Filter size={12}/> {t.filterTip}</span>}
            {activeTags.map((tag, idx) => (
                <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: `${tagColor(tag.type)}20`, border: `1px solid ${tagColor(tag.type)}`, padding: '6px 12px', borderRadius: '20px', fontSize: '13px', color: tagColor(tag.type), fontWeight: 'bold' }}>
                    {tag.type === KEYWORD_TYPES.MAP && <MapIcon size={12}/>}{tag.type === KEYWORD_TYPES.HERO && <Zap size={12}/>}{tag.type === KEYWORD_TYPES.PLAYER && <User size={12}/>}{tag.type === KEYWORD_TYPES.RESULT && <Trophy size={12}/>}
                    <span>{tag.label}</span>
                    <button onClick={() => removeTag(idx)} style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', display:'flex', alignItems:'center' }}><X size={14} /></button>
                </div>
            ))}
        </div>
      </div>

      {loading ? ( <div style={{ color: theme.textSub, textAlign:'center', padding:'40px' }}>{t.loading}</div> ) : (
        <>
            <div style={{ display: 'flex', overflowX: isMobile ? 'auto' : 'visible', borderBottom: `1px solid ${theme.border}`, marginBottom: '24px' }}>
                <TabButton id="summary" label={t.osTabSummary} icon={Trophy} />
                <TabButton id="heroes" label={t.tabHeroes} icon={User} />
                <TabButton id="maps" label={t.tabMaps} icon={MapIcon} />
                <TabButton id="fights" label={t.osTabFights} icon={Sword} />
                <TabButton id="dashboard" label={t.highlights} icon={Youtube} />
            </div>

            {activeTab === 'summary' && (
                <SummaryTab
                    theme={theme} t={t} tpl={tpl} pct0={pct0}
                    summary={mapSummary} summaryTeam={summaryTeam}
                    stats={filteredData.stats}
                    topHero={filteredData.heroStats?.[0]?.name}
                    topMap={filteredData.mapStats?.[0]?.name}
                    onGoHeroes={() => setActiveTab('heroes')}
                    onGoMaps={() => setActiveTab('maps')}
                />
            )}

            {activeTab === 'dashboard' && (
                <div style={{ background: theme.surface, borderRadius: '16px', border: `1px solid ${theme.border}`, padding: '24px' }}>
                    <div style={{ fontSize: '18px', fontWeight: '900', marginBottom: '16px', display:'flex', alignItems:'center', gap:'8px' }}><Youtube size={20} color={theme.danger} />{t.highlights} ({filteredData.moments.length.toLocaleString()})</div>
                    {filteredData.moments.length > MAX_MOMENTS_RENDERED && (
                        <div style={{ fontSize: '12px', color: theme.textSub, marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <Filter size={12}/> {filteredData.moments.length.toLocaleString()}개 중 상위 {MAX_MOMENTS_RENDERED}개까지 표시합니다. 검색 필터로 범위를 좁혀 주세요.
                        </div>
                    )}
                    {filteredData.moments.length === 0 ? (
                        <div style={{ textAlign: 'center', color: theme.textSub, padding: '40px' }}>{t.noMoments}</div>
                    ) : (() => {
                        const cap = Math.min(filteredData.moments.length, MAX_MOMENTS_RENDERED);
                        const shown = Math.min(momentsVisible, cap);
                        return (
                        <>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '12px' }}>
                            {filteredData.moments.slice(0, shown).map((moment, idx) => (
                                <a key={idx} href={getYouTubeLink(moment.videoUrl, moment.videoOffset, moment.timestamp, moment.pauses, moment.gameSetupSec)} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none', background: theme.bg, border: `1px solid ${theme.border}`, borderRadius: '12px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '8px', transition: 'transform 0.2s, border-color 0.2s' }} onMouseOver={e => { e.currentTarget.style.borderColor = theme.borderHighlight; e.currentTarget.style.transform = 'translateY(-2px)'; }} onMouseOut={e => { e.currentTarget.style.borderColor = theme.border; e.currentTarget.style.transform = 'translateY(0)'; }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <div style={{ fontSize: '12px', color: theme.textSub, display:'flex', alignItems:'center', gap:'4px' }}><MapIcon size={12}/> {moment.matchName}</div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                            <div style={{ fontSize: '11px', color: theme.text, fontWeight: 600, fontFamily:'monospace' }}>{Math.floor(moment.timestamp/60)}:{Math.floor(moment.timestamp%60).toString().padStart(2,'0')}</div>
                                            {moment.result === 'win' && (
                                                <span style={{ fontSize: '10px', background: '#60a5fa', color: '#fff', padding: '2px 6px', borderRadius: '4px', fontWeight: 'bold', lineHeight: '1.4' }}>{t.osWinBadge}</span>
                                            )}
                                            {moment.result === 'loss' && (
                                                <span style={{ fontSize: '10px', background: theme.danger, color: '#fff', padding: '2px 6px', borderRadius: '4px', fontWeight: 'bold', lineHeight: '1.4' }}>{t.osLossBadge}</span>
                                            )}
                                        </div>
                                    </div>
                                    <div style={{ fontSize: '14px', fontWeight: 'bold', color: theme.text, display:'flex', alignItems:'center', gap:'6px' }}>
                                        {moment.type === 'ultimate_start' && <Zap size={14} color={theme.warning}/>}{moment.type === 'kill' && <Skull size={14} color={theme.danger}/>}{moment.desc}
                                    </div>
                                </a>
                            ))}
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '12px', marginTop: '20px' }}>
                            <span style={{ fontSize: '12px', color: theme.textSub }}>{tpl(t.osShowingCountTpl, { shown, total: filteredData.moments.length.toLocaleString() })}</span>
                            {shown < cap && (
                                <button onClick={() => setMomentsVisible(v => Math.min(v + MOMENTS_PAGE_SIZE, cap))}
                                    style={{ background: theme.surfaceHighlight, border: `1px solid ${theme.borderHighlight}`, color: theme.text, padding: '8px 20px', borderRadius: '10px', cursor: 'pointer', fontWeight: 700 }}>
                                    {t.osShowMore} (+{Math.min(MOMENTS_PAGE_SIZE, cap - shown)})
                                </button>
                            )}
                        </div>
                        </>
                        );
                    })()}
                </div>
            )}

            {activeTab === 'heroes' && (
                <div style={{ background: theme.surface, borderRadius: '16px', border: `1px solid ${theme.border}`, padding: '24px' }}>
                    <h3 style={{fontSize:'18px', fontWeight:'bold', marginBottom:'20px'}}>{t.heroStatsTitle}</h3>
                    {filteredData.heroStats.length > 0 ? (
                        <>
                            <div style={{ width: '100%', height: 300, marginBottom: '30px' }}>
                                <ResponsiveContainer>
                                    <BarChart data={filteredData.heroStats.slice(0, 10)}>
                                        <CartesianGrid strokeDasharray="3 3" stroke={theme.border} vertical={false}/>
                                        <XAxis dataKey="name" stroke={theme.textSub} fontSize={12} tickLine={false} axisLine={false}/>
                                        <YAxis stroke={theme.textSub} fontSize={12} tickLine={false} axisLine={false} />
                                        <Tooltip cursor={{fill: 'transparent'}} contentStyle={{ backgroundColor: theme.surface, border: 'none', borderRadius: '8px', color: theme.text, fontSize:'13px' }}/>
                                        <Legend />
                                        <Bar dataKey="winRate" name={t.winRate} fill={theme.primary} radius={[4, 4, 0, 0]} barSize={30} />
                                        <Bar dataKey="games" name={t.gamesPlayed} fill={theme.borderHighlight} radius={[4, 4, 0, 0]} barSize={30} />
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                            <ScrollX isMobile={isMobile} fade={theme.surface}>
                            <table style={{width:'100%', borderCollapse:'collapse', fontSize:'14px', minWidth: isMobile ? 480 : undefined}}>
                                <thead>
                                    <tr style={{borderBottom:`1px solid ${theme.border}`, color: theme.textSub, textAlign:'left'}}>
                                        <th style={{padding:'12px', whiteSpace:'nowrap'}}>{t.hero}</th>
                                        <th style={{padding:'12px', whiteSpace:'nowrap'}}>{t.gamesPlayed}</th>
                                        <th style={{padding:'12px', whiteSpace:'nowrap'}}>{t.winRate}</th>
                                        <th style={{padding:'12px', whiteSpace:'nowrap'}}>{t.avgDmg}</th>
                                        <th style={{padding:'12px', whiteSpace:'nowrap'}}>{t.kda}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredData.heroStats.map((h, i) => (
                                        <tr key={i} style={{borderBottom:`1px solid ${theme.border}`}}>
                                            <td style={{padding:'12px', fontWeight:'bold', whiteSpace:'nowrap'}}>{getDisplayName(h.name)}</td>
                                            <td style={{padding:'12px'}}>{h.games}</td>
                                            <td style={{padding:'12px', color: h.winRate >= 50 ? theme.success : theme.danger}}>{h.winRate}%</td>
                                            <td style={{padding:'12px'}}>{h.avgDmg.toLocaleString()}</td>
                                            <td style={{padding:'12px'}}>{h.kda}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            </ScrollX>
                        </>
                    ) : <div style={{padding:'40px', textAlign:'center', color: theme.textSub}}>{t.noData}</div>}
                </div>
            )}

            {activeTab === 'maps' && (
                <div style={{ background: theme.surface, borderRadius: '16px', border: `1px solid ${theme.border}`, padding: '24px' }}>
                    <h3 style={{fontSize:'18px', fontWeight:'bold', marginBottom:'20px'}}>{t.mapStatsTitle}</h3>
                    {filteredData.mapStats.length > 0 ? (
                        <>
                            <div style={{ width: '100%', height: 300, marginBottom: '30px' }}>
                                <ResponsiveContainer>
                                    <BarChart data={filteredData.mapStats.slice(0, 10)} layout="vertical" margin={{ right: 40 }}>
                                        <CartesianGrid strokeDasharray="3 3" stroke={theme.border} opacity={0.5} horizontal={false}/>
                                        <XAxis type="number" stroke={theme.textSub} fontSize={12} tickLine={false} axisLine={false}/>
                                        <YAxis dataKey="name" type="category" stroke={theme.textSub} fontSize={12} tickLine={false} axisLine={false} width={100}/>
                                        <Tooltip cursor={{fill: `${theme.border}40`}} contentStyle={{ backgroundColor: theme.surface, border: `1px solid ${theme.border}`, borderRadius: '8px', color: theme.text, fontSize:'13px' }}/>
                                        <Bar dataKey="winRate" name={t.winRate} radius={[0, 4, 4, 0]} barSize={20} label={{ position: 'right', fill: theme.text, fontSize: 11, formatter: (v) => `${v}%` }}>
                                            {filteredData.mapStats.slice(0, 10).map((entry, idx) => (
                                                <Cell key={idx} fill={
                                                    entry.winRate >= 70 ? (theme.success || '#10b981') :
                                                    entry.winRate >= 40 ? '#60a5fa' :
                                                    (theme.danger || '#ef4444')
                                                } />
                                            ))}
                                        </Bar>
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                            <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(200px, 1fr))', gap:'12px'}}>
                                {filteredData.mapStats.map((m, i) => (
                                    <div key={i} style={{background: theme.bg, padding:'16px', borderRadius:'12px', border: `1px solid ${theme.border}`}}>
                                        <div style={{fontSize:'14px', fontWeight:'bold', marginBottom:'4px'}}>{m.name}</div>
                                        <div style={{display:'flex', justifyContent:'space-between', fontSize:'13px'}}>
                                            <span style={{color: theme.textSub}}>{m.games} {t.gamesPlayed}</span>
                                            <span style={{color: baseTeam === 'All' ? theme.textSub : (m.winRate>=50 ? theme.success : theme.danger), fontWeight:'bold'}}>{baseTeam === 'All' ? 'N/A' : `${m.winRate}%`}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </>
                    ) : <div style={{padding:'40px', textAlign:'center', color: theme.textSub}}>{t.noData}</div>}
                </div>
            )}
            {activeTab === 'fights' && (() => {
                const fs = overallFightStats;
                const cardStyle = { background: theme.surface, border: `1px solid ${theme.border}`, borderRadius: '16px', padding: '24px', marginBottom: '24px' };
                const titleStyle = { color: theme.text, fontSize: '16px', fontWeight: 'bold', marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '10px' };
                const teamLabel = baseTeam === 'All' ? t.osAllAvg : baseTeam;
                const accentColor = baseTeam === 'All' ? (theme.primary || '#a78bfa') : COLOR_TEAM1;

                if (!fs) {
                    return (
                        <div style={{ background: theme.surface, borderRadius: '16px', border: `1px solid ${theme.border}`, padding: '60px', textAlign: 'center', color: theme.textSub }}>
                            {baseTeam !== 'All' ? `${t.osNoMatchDataPre}${baseTeam}${t.osNoMatchDataPost}` : t.osNoFightData}
                        </div>
                    );
                }

                return (
                    <div>
                        {/* A. 패배 한타 저항력 — 통합 카드 */}
                        {(() => {
                            const maxFD = fs.firstDeathRanking[0]?.count || 1;
                            const maxCarry = fs.carryRanking[0]?.avgKills || 1;
                            const rankBadgeColor = (i) => i === 0 ? '#fbbf24' : i === 1 ? '#9ca3af' : i === 2 ? '#cd7c2f' : theme.textSub;
                            const RankRow = ({ idx, hero, name, teamName, mainVal, mainSuffix, subVal, barPct, barColor }) => (
                                <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: '8px', padding: '7px 10px', borderRadius: '8px', overflow: 'hidden', marginBottom: '4px' }}>
                                    <div style={{ position: 'absolute', inset: 0, width: `${barPct}%`, background: `${barColor}18`, borderRadius: '8px', pointerEvents: 'none' }} />
                                    <span style={{ position: 'relative', zIndex: 1, fontSize: '11px', fontWeight: 'bold', color: rankBadgeColor(idx), minWidth: '14px', textAlign: 'center' }}>{idx + 1}</span>
                                    {hero && <img src={getHeroImageSrc(hero)} alt={hero} style={{ position: 'relative', zIndex: 1, width: '24px', height: '24px', borderRadius: '4px', flexShrink: 0 }} onError={e => { e.currentTarget.style.display = 'none'; }} />}
                                    <div style={{ position: 'relative', zIndex: 1, flex: 1, minWidth: 0 }}>
                                        <div style={{ fontSize: '12px', fontWeight: 'bold', color: theme.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
                                        <div style={{ fontSize: '10px', color: theme.textSub }}>{teamName}</div>
                                    </div>
                                    <div style={{ position: 'relative', zIndex: 1, textAlign: 'right', flexShrink: 0 }}>
                                        <div style={{ fontSize: '16px', fontWeight: '900', color: theme.text, lineHeight: 1 }}>{mainVal}<span style={{ fontSize: '10px', color: theme.textSub, fontWeight: 'normal', marginLeft: '2px' }}>{mainSuffix}</span></div>
                                        <div style={{ fontSize: '10px', color: theme.textSub, marginTop: '2px' }}>{subVal}</div>
                                    </div>
                                </div>
                            );
                            return (
                                <div style={cardStyle}>
                                    <div style={titleStyle}>
                                        <AlertOctagon size={18} color={theme.warning || '#f59e0b'} />
                                        {t.msLostFightTitle}
                                    </div>
                                    <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1.2fr 1.2fr', gap: isMobile ? '16px' : '0' }}>
                                        {/* 좌: % 요약 */}
                                        <div style={{ paddingRight: isMobile ? 0 : '24px', paddingBottom: isMobile ? '16px' : 0, borderRight: isMobile ? 'none' : `1px solid ${theme.border}`, borderBottom: isMobile ? `1px solid ${theme.border}` : 'none' }}>
                                            <div style={{ fontSize: '13px', color: accentColor, fontWeight: 'bold', marginBottom: '10px' }}>
                                                {teamLabel} — {t.msAvgKillRateOnLoss}
                                            </div>
                                            <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '10px' }}>
                                                <span style={{ fontSize: '36px', fontWeight: '900', color: theme.text }}>{fs.resistancePct}%</span>
                                            </div>
                                            <div style={{ fontSize: '12px', color: theme.textSub, lineHeight: '1.6' }}>
                                                {t.msAvgWord}{fs.avgKills}{t.msKillsUnit}<br/>{fs.lostFights}{t.osLostFightsSuffix}
                                            </div>
                                            <div style={{ marginTop: '12px', fontSize: '11px', color: theme.textSub, lineHeight: '1.6' }}>
                                                {t.osResistDescPre}{fs.avgKills}{t.osResistDescMid}{fs.resistancePct}{t.osResistDescPost}
                                            </div>
                                        </div>

                                        {/* 중: 퍼스트 데스 TOP 3 */}
                                        <div style={{ padding: isMobile ? '0 0 16px' : '0 24px', borderRight: isMobile ? 'none' : `1px solid ${theme.border}`, borderBottom: isMobile ? `1px solid ${theme.border}` : 'none' }}>
                                            <div style={{ fontSize: '13px', fontWeight: 'bold', color: theme.danger, marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                <Skull size={14} color={theme.danger} /> {t.osFirstDeathTop3}
                                            </div>
                                            {fs.firstDeathRanking.length === 0
                                                ? <div style={{ fontSize: '13px', color: theme.textSub }}>{t.msNoDataShort}</div>
                                                : fs.firstDeathRanking.slice(0, 3).map((p, i) => (
                                                    <RankRow key={i} idx={i} hero={p.hero} name={p.name} teamName={p.teamName}
                                                        mainVal={p.count} mainSuffix={t.timesUnit}
                                                        subVal={t.osFirstDeathLabel}
                                                        barPct={(p.count / maxFD) * 100} barColor={theme.danger} />
                                                ))
                                            }
                                        </div>

                                        {/* 우: 패배 한타 캐리 TOP 3 */}
                                        <div style={{ paddingLeft: isMobile ? 0 : '24px' }}>
                                            <div style={{ fontSize: '13px', fontWeight: 'bold', color: '#60a5fa', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                <Zap size={14} color="#60a5fa" /> {t.osLostFightCarryTop3}
                                            </div>
                                            {fs.carryRanking.length === 0
                                                ? <div style={{ fontSize: '13px', color: theme.textSub }}>{t.osNoMin10}</div>
                                                : fs.carryRanking.slice(0, 3).map((p, i) => (
                                                    <RankRow key={i} idx={i} hero={p.topHero} name={p.name} teamName={p.teamName}
                                                        mainVal={p.avgKills.toFixed(1)} mainSuffix={t.osKillsPerFight}
                                                        subVal={`(${t.osTotalWord}${p.kills}${t.osKillUnit} / ${p.lostFightCount}${t.timesUnit})`}
                                                        barPct={(p.avgKills / maxCarry) * 100} barColor="#60a5fa" />
                                                ))
                                            }
                                            <div style={{ fontSize: '10px', color: theme.textSub, marginTop: '8px' }}>{t.osMin10Note}</div>
                                        </div>
                                    </div>
                                </div>
                            );
                        })()}

                        {/* B. 한타 모멘텀 */}
                        <div style={cardStyle}>
                            <div style={titleStyle}>
                                <Sword size={18} color={theme.primary || '#a78bfa'} />
                                {t.msMomentumTitle}
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: isMobile ? '12px' : '24px' }}>
                                {/* 승리 후 승률 */}
                                <div style={{ background: theme.bg, padding: '20px', borderRadius: '12px', border: `1px solid ${theme.success || '#10b981'}40` }}>
                                    <div style={{ fontSize: '13px', fontWeight: 'bold', color: theme.text, display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                                        <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: theme.success || '#10b981', flexShrink: 0 }} />
                                        {t.msWinRateAfterWin}
                                        <span style={{ color: theme.textSub, fontWeight: 'normal', fontSize: '11px' }}>{t.msWinToWin}</span>
                                    </div>
                                    <div style={{ fontSize: '11px', color: theme.textSub, marginBottom: '16px', paddingLeft: '14px' }}>
                                        {t.msSnowball}
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px' }}>
                                        <span style={{ fontSize: '36px', fontWeight: '900', color: theme.text }}>{fs.afterWinPct}%</span>
                                        <span style={{ fontSize: '12px', color: theme.textSub }}>({fs.afterWinWon}/{fs.afterWinTotal}{t.timesUnit})</span>
                                    </div>
                                </div>

                                {/* 패배 후 역전 승률 */}
                                <div style={{ background: theme.bg, padding: '20px', borderRadius: '12px', border: `1px solid ${theme.danger || '#ef4444'}40` }}>
                                    <div style={{ fontSize: '13px', fontWeight: 'bold', color: theme.text, display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                                        <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: theme.danger || '#ef4444', flexShrink: 0 }} />
                                        {t.msWinRateAfterLoss}
                                        <span style={{ color: theme.textSub, fontWeight: 'normal', fontSize: '11px' }}>{t.msLossToWin}</span>
                                    </div>
                                    <div style={{ fontSize: '11px', color: theme.textSub, marginBottom: '16px', paddingLeft: '14px' }}>
                                        {t.msComeback}
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px' }}>
                                        <span style={{ fontSize: '36px', fontWeight: '900', color: theme.text }}>{fs.afterLossPct}%</span>
                                        <span style={{ fontSize: '12px', color: theme.textSub }}>({fs.afterLossWon}/{fs.afterLossTotal}{t.timesUnit})</span>
                                    </div>
                                </div>
                            </div>
                            <div style={{ marginTop: '12px', fontSize: '12px', color: theme.textSub }}>
                                {t.osMomentumNotePre}{fs.matchCount}{t.osMomentumNotePost}
                            </div>
                        </div>

                    </div>
                );
            })()}
        </>
      )}
      <style>{`.spin { animation: spin 1s linear infinite; } @keyframes spin { 100% { transform: rotate(360deg); } }`}</style>
    </div>
  );
}