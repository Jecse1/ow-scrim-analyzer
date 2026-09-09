import React, { useState, useEffect, useMemo, useRef } from "react";
import axios from "axios";
import {
  LayoutDashboard, History, Users, BarChart3, Moon, Sun, Upload, AlertCircle, Globe, User, Zap, Skull, Crosshair, Swords, Map as MapIcon, ChevronDown, Ban, Menu, X
} from "lucide-react";

import { ThemeProvider, useTheme } from "./ThemeContext";
import { LanguageProvider, useLanguage } from "./LanguageContext";
import { computeFights } from "./utils/fightAnalysis";
import { fetchCached, invalidateApiCache } from "./utils/apiCache";
import { APP_NAME } from "./config";

import ScrimSessions from "./ScrimSessions";
import ScrimDetail from "./ScrimDetail";
import MatchStats from "./MatchStats";
import ScrimModal from "./ScrimModal";
import OverallStats from "./OverallStats";
import PlayerProfileView from "./PlayerProfileView";
import PlayerCompareView from "./PlayerCompareView";
import UltimateStats from "./UltimateStats";
import KillDeathStats from "./KillDeathStats";
import FirstFightStats from "./FirstFightStats";
import FightLabStats from "./FightLabStats";
import UltimateAnalysisStats from "./UltimateAnalysisStats";
import MapAnalysisStats from "./MapAnalysisStats";
import BanpickApp from "./banpick/BanpickApp";
import { FlaskConical } from "lucide-react";
import { TANK_HEROES, SUPPORT_HEROES } from "./gameData";

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) { return { hasError: true, error }; }
  componentDidCatch(error, info) { console.error("❌ UI Runtime Error:", error, info); }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 40, maxWidth: 1000, margin: "0 auto", color: "#ef4444" }}>
          <div style={{ border: "1px solid rgba(239,68,68,0.35)", background: "rgba(239,68,68,0.08)", padding: "14px 16px", borderRadius: 12 }}>
            <div style={{ fontWeight: 900, marginBottom: 6 }}>System Error (Render Failed)</div>
            <div style={{ fontSize: 13, lineHeight: 1.5 }}>{String(this.state.error)}</div>
            <button onClick={() => window.location.reload()} style={{ marginTop: 12, background: "#27272a", border: "1px solid #3f3f46", color: "#fff", padding: "10px 14px", borderRadius: 10, cursor: "pointer", fontWeight: 800 }}>Reload Page</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function MainApp() {
  const { theme, toggleTheme, isDarkMode } = useTheme();
  const { t, toggleLanguage, language } = useLanguage();

  const [currentView, setCurrentView] = useState("home");
  const [activeScrimId, setActiveScrimId] = useState(null);
  const [activeMatchId, setActiveMatchId] = useState(null);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  
  const [allScrims, setAllScrims] = useState([]);

  // 상단 네비 드롭다운 상태 (hover + click)
  //  - navHovered : 현재 마우스가 올라간 메인 키 (hover 열림, 데스크톱 전용)
  //  - navPinned  : 클릭으로 고정 열린 메인 키 (hover 벗어나도 유지, 재클릭/바깥클릭으로 닫힘)
  //  - navHoverItem : 드롭다운 하위 항목 hover 하이라이트용 키
  const [navHovered, setNavHovered] = useState(null);
  const [navPinned, setNavPinned] = useState(null);
  const [navHoverItem, setNavHoverItem] = useState(null);
  const navRef = useRef(null);

  // 모바일 네비(햄버거) 상태 — 인라인 스타일 코드베이스라 matchMedia로 폭 분기(768px 미만=모바일).
  //  - isMobile      : 현재 뷰포트가 모바일인지 (데스크톱은 기존 hover+click 드롭다운 그대로)
  //  - mobileMenuOpen: ☰ 드로어 펼침 여부
  //  - mobileExpanded: 모바일 메뉴에서 아코디언 펼친 그룹 키('stats'|'analysis'|null)
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [mobileExpanded, setMobileExpanded] = useState(null);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const onChange = (e) => {
      setIsMobile(e.matches);
      if (!e.matches) { setMobileMenuOpen(false); setMobileExpanded(null); } // 데스크톱 전환 시 드로어 닫기
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // 바깥 클릭 시 고정 드롭다운 닫기 (mousedown → 다른 클릭 동작보다 먼저 처리)
  useEffect(() => {
    if (!navPinned) return;
    const onDocDown = (e) => {
      if (navRef.current && !navRef.current.contains(e.target)) {
        setNavPinned(null);
        setNavHovered(null);
      }
    };
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, [navPinned]);

  const API_BASE = "";

  // full-events를 실제로 소비하는 탭: 궁극기 통계 / 킬데스 / 개인 통계 / 선수 비교.
  // 그 외 탭에서는 발사하지 않고, fetchCached라 세션당 1회만 네트워크를 탄다.
  const FULL_EVENTS_VIEWS = ["ultimates", "killdeath", "personal", "compare"];
  useEffect(() => {
    if (!FULL_EVENTS_VIEWS.includes(currentView)) return;
    let alive = true;
    fetchCached(`${API_BASE}/api/scrims/full-events`)
      .then((data) => { if (alive) setAllScrims(data || []); })
      .catch((err) => console.error("❌ Failed to fetch all scrims:", err));
    return () => { alive = false; };
  }, [currentView]);

  const dynamicPlayersData = useMemo(() => {
    if (!allScrims || allScrims.length === 0) return [];

    const playerMap = {};

    // 영웅 역할 분류 (역할 판정 + 궁당 킬 집계 방식 분기에 공용 사용)
    // [STEP2] TANK_HEROES/SUPPORT_HEROES 는 gameData(SSOT) 파생값(역할별 roleForms). 판정 로직 보존.
    const heroRole = (h) => TANK_HEROES.includes(h) ? '탱크' : SUPPORT_HEROES.includes(h) ? '지원' : '딜러';

    // 궁 사용 후 이 시간(초) 내의 결정타를 '궁극기로 만들어낸 결정타'로 간주 (힐러용)
    const ULT_KILL_WINDOW = 10;
    // 궁극기 한타 분석 (이벤트 기반): playerName -> heroName -> { uses, ultKillsAbility, ultKillsWindow, fights, fightWins }
    //  - uses           : ultimate_start 이벤트 수 (궁 사용 횟수)
    //  - ultKillsAbility : 궁 스킬(ability='Ultimate')로 직접 처치한 결정타 수 (딜러/탱커용)
    //  - ultKillsWindow  : 궁 사용 후 ULT_KILL_WINDOW초 내에 그 선수가 만든 결정타 수 (힐러용)
    //  - fights          : 그 선수가 궁을 쓴 한타 수 (무승부 제외)
    //  - fightWins       : 그 중 승리한 한타 수
    const ultEventMap = {};
    const getUE = (pn, hn) => {
      if (!ultEventMap[pn]) ultEventMap[pn] = {};
      if (!ultEventMap[pn][hn]) ultEventMap[pn][hn] = { uses: 0, ultKillsAbility: 0, ultKillsWindow: 0, fights: 0, fightWins: 0 };
      return ultEventMap[pn][hn];
    };

    // /api/scrims/full-events 는 최신순(date DESC)으로 내려오므로, 시간순(오래된→최신)으로
    // 뒤집어서 집계한다. 이래야 recentTrend가 시간순으로 쌓이고(차트 왼→오 = 과거→현재),
    // team 덮어쓰기도 가장 최근 스크림 기준이 된다.
    const chronologicalScrims = [...allScrims].sort((a, b) => {
      const dc = (a.date || "").localeCompare(b.date || "");
      return dc !== 0 ? dc : (a.id || "").localeCompare(b.id || "");
    });

    chronologicalScrims.forEach(scrim => {
      const scrimName = scrim.scrim_name || scrim.date;
      
      scrim.matches?.forEach(match => {
        match.stats?.forEach(stat => {
          const pName = stat.player_name;
          if (!pName || pName === "Unknown") return;

          if (!playerMap[pName]) {
            const role = heroRole(stat.hero_name);

            playerMap[pName] = {
              id: pName, name: pName, role: role, 
              team: stat.team_name, // 동적 팀 필터링
              _raw: { elims: 0, deaths: 0, fb: 0, heroDmg: 0, heal: 0, mitigated: 0, ultUsed: 0, playTime: 0, matchCount: 0, wins: 0 },
              overview: { kd: 0, damagePer10: 0, healPer10: 0, mitigatedPer10: 0, fbPer10: 0, ultUsedPerMatch: 0, winRate: 0 },
              heroPool: {}, recentTrend: [] 
            };
          } else {
             playerMap[pName].team = stat.team_name; 
          }

          const p = playerMap[pName];
          const playTimeSec = Number(stat.hero_time_played) || 0;
          const deaths = Number(stat.deaths) || 0;
          const fb = Number(stat.final_blows) || 0;
          
          p._raw.elims += Number(stat.eliminations) || 0;
          p._raw.fb += fb;
          p._raw.deaths += deaths;
          p._raw.heroDmg += Number(stat.hero_damage_dealt) || 0;
          p._raw.heal += Number(stat.healing_dealt) || 0;
          p._raw.mitigated += Number(stat.damage_blocked) || 0;
          p._raw.ultUsed += Number(stat.ultimates_used) || 0;
          p._raw.playTime += playTimeSec;
          
          if (!p._processedMatches) p._processedMatches = new Set();
          if (!p._processedMatches.has(match.id)) {
             p._raw.matchCount += 1;
             if (match.winner === stat.team_name) p._raw.wins += 1;
             p._processedMatches.add(match.id);
             
             // K/D = FB / max(1, D) — 0데스도 나눗셈 생략 없이 동일 공식(값은 같지만 규칙 일관).
             // 라벨에 세트 번호를 붙여 같은 세션의 세트들이 x축·툴팁에서 구분되게 한다.
             const matchKd = fb / Math.max(1, deaths);
             p.recentTrend.push({
               match: `${scrimName} · ${match.match_index != null ? match.match_index : '?'}세트`,
               kd: Number(matchKd.toFixed(2)), fb, deaths,
             });
          }

          const hName = stat.hero_name;
          if (!p.heroPool[hName]) {
            p.heroPool[hName] = { hero: hName, playTime: 0, wins: 0, matches: 0, fb: 0, deaths: 0, elims: 0, ultEarned: 0 };
          }
          p.heroPool[hName].playTime += playTimeSec;
          p.heroPool[hName].fb += fb;
          p.heroPool[hName].deaths += deaths;
          p.heroPool[hName].elims += Number(stat.eliminations) || 0;
          p.heroPool[hName].ultEarned += Number(stat.ultimates_earned) || 0;
          p.heroPool[hName].matches += 1;
          if (match.winner === stat.team_name) p.heroPool[hName].wins += 1;
        });

        // 궁극기 한타 분석 (라운드별): (선수,영웅)별로 궁 사용수 · 궁으로 만들어낸 결정타 · 한타 승패 집계
        const t1 = match.team1_name || match.team_1_name || "1팀";
        const t2 = match.team2_name || match.team_2_name || "2팀";
        const isT1 = (tn) => tn === t1 || tn === "1팀" || tn === "Team 1";
        const isT2 = (tn) => tn === t2 || tn === "2팀" || tn === "Team 2";
        const sideOf = (tn) => isT1(tn) ? 1 : isT2(tn) ? 2 : 0;

        (match.rounds || []).forEach(rnd => {
          const evs = rnd.events || [];

          // (1) 궁 사용수 + 궁당 킬 (두 방식 모두 집계, 표시는 영웅 역할로 선택)
          //     - ultKillsAbility: 궁 스킬로 직접 처치 (딜러/탱커)
          //     - ultKillsWindow : 궁 사용 후 ULT_KILL_WINDOW초 내 그 선수의 결정타 (힐러)
          const ultStarts = {}; // "player|hero" -> [timestamp...]
          evs.forEach(ev => {
            if (ev.event_type === 'ultimate_start' && ev.player_name && ev.player_hero) {
              getUE(ev.player_name, ev.player_hero).uses += 1;
              const key = ev.player_name + '|' + ev.player_hero;
              if (!ultStarts[key]) ultStarts[key] = [];
              ultStarts[key].push(ev.timestamp);
            }
          });
          evs.forEach(ev => {
            if (ev.event_type !== 'kill') return;
            const pn = ev.player_name, hn = ev.player_hero;
            if (!pn || !hn) return;
            const m = getUE(pn, hn);
            if (ev.ability === 'Ultimate') m.ultKillsAbility += 1;
            const starts = ultStarts[pn + '|' + hn];
            if (starts && starts.some(s => ev.timestamp >= s && ev.timestamp <= s + ULT_KILL_WINDOW)) {
              m.ultKillsWindow += 1;
            }
          });

          // (2) 궁 사용 한타 승률: 그 선수가 궁을 쓴 한타 중 승리 비율 (무승부 제외)
          computeFights(evs, t1, t2).forEach(f => {
            const winSide = sideOf(f.winner); // 1 / 2 / 0(무승부)
            if (winSide === 0) return;
            const usedSide = {}; // "player|hero" -> side (한타당 1회만)
            (f.events || []).forEach(ev => {
              if (ev.event_type === 'ultimate_start' && ev.player_name && ev.player_hero) {
                const key = ev.player_name + '|' + ev.player_hero;
                if (!(key in usedSide)) usedSide[key] = sideOf(ev.player_team);
              }
            });
            Object.entries(usedSide).forEach(([key, pside]) => {
              if (pside === 0) return;
              const sep = key.lastIndexOf('|');
              const m = getUE(key.slice(0, sep), key.slice(sep + 1));
              m.fights += 1;
              if (pside === winSide) m.fightWins += 1;
            });
          });
        });
      });
    });

    const result = Object.values(playerMap).map(p => {
      const minutes = p._raw.playTime / 60;
      const per10 = (val) => minutes > 0 ? (val / minutes) * 10 : 0;
      
      p.overview.kd = p._raw.fb / Math.max(1, p._raw.deaths);
      p.overview.damagePer10 = Math.round(per10(p._raw.heroDmg));
      p.overview.healPer10 = Math.round(per10(p._raw.heal));
      p.overview.mitigatedPer10 = Math.round(per10(p._raw.mitigated));
      p.overview.fbPer10 = Number(per10(p._raw.fb).toFixed(1));
      p.overview.ultUsedPerMatch = p._raw.matchCount > 0 ? (p._raw.ultUsed / p._raw.matchCount).toFixed(1) : 0;
      p.overview.winRate = p._raw.matchCount > 0 ? Math.round((p._raw.wins / p._raw.matchCount) * 100) : 0;

      p.heroPool = Object.values(p.heroPool)
        .map(h => {
          const hMin = h.playTime / 60;
          const uf = (ultEventMap[p.name] && ultEventMap[p.name][h.hero]) || null;
          // 궁당 킬: 딜러/탱커는 궁 스킬 직접 처치만, 힐러는 궁 사용 후 윈도우 내 결정타
          const ultKills = uf ? (heroRole(h.hero) === '지원' ? uf.ultKillsWindow : uf.ultKillsAbility) : 0;
          return {
            hero: h.hero, playTime: h.playTime,
            winRate: h.matches > 0 ? Math.round((h.wins / h.matches) * 100) : 0,
            kd: (h.fb / Math.max(1, h.deaths)).toFixed(2),
            // 궁극기 효율: 궁 1회당 궁당 킬 (역할별 집계 방식)
            ultEff: uf && uf.uses > 0 ? Number((ultKills / uf.uses).toFixed(2)) : null,
            ultUses: uf ? uf.uses : 0,
            ultKills,
            // 궁 사용 한타 승률: 그 선수가 궁을 쓴 한타 중 승리 비율 (무승부 제외, 표본 없으면 null)
            ultWinRate: uf && uf.fights > 0 ? Math.round((uf.fightWins / uf.fights) * 100) : null,
            ultFights: uf ? uf.fights : 0,
            // 평균 궁 충전 시간(초): 플레이 시간 ÷ 충전한 궁 수
            ultChargeSec: h.ultEarned > 0 ? Math.round(h.playTime / h.ultEarned) : null,
            ultEarned: h.ultEarned,
            // 영향력: 10분당 처치 관여(eliminations)
            impactPer10: hMin > 0 ? Number(((h.elims / hMin) * 10).toFixed(1)) : 0,
          };
        })
        .sort((a, b) => b.playTime - a.playTime)
        .slice(0, 5);

      // 최근 5경기로 자르지 않고 전체 경기를 시간순으로 유지한다.
      return p;
    });

    return result.sort((a, b) => a.name.localeCompare(b.name)); 
  }, [allScrims]);

  const goHome = () => { setCurrentView("home"); setActiveScrimId(null); setActiveMatchId(null); };
  const goSessions = () => { setCurrentView("sessions"); setActiveScrimId(null); setActiveMatchId(null); };
  const goOverall = () => { setCurrentView("overall"); setActiveScrimId(null); setActiveMatchId(null); };
  const goUltimates = () => { setCurrentView("ultimates"); setActiveScrimId(null); setActiveMatchId(null); };
  const goKillDeath = () => { setCurrentView("killdeath"); setActiveScrimId(null); setActiveMatchId(null); };
  const goFirstFight = () => { setCurrentView("firstfight"); setActiveScrimId(null); setActiveMatchId(null); };
  const goUltAnalysis = () => { setCurrentView("ultanalysis"); setActiveScrimId(null); setActiveMatchId(null); };
  const goFightLab = () => { setCurrentView("fightlab"); setActiveScrimId(null); setActiveMatchId(null); };
  const goMapAnalysis = () => { setCurrentView("mapanalysis"); setActiveScrimId(null); setActiveMatchId(null); };
  const goPersonal = () => { setCurrentView("personal"); setActiveScrimId(null); setActiveMatchId(null); };
  const goBanpick = () => { setCurrentView("banpick"); setActiveScrimId(null); setActiveMatchId(null); };
  const goCompare = () => { setCurrentView("compare"); setActiveScrimId(null); setActiveMatchId(null); };

  const goToScrim = (scrimId) => { setActiveScrimId(scrimId); setCurrentView("scrim"); };
  const goToMatch = (matchId) => { setActiveMatchId(matchId); setCurrentView("match"); };

  const handleScrimSubmit = async (scrimData) => {
    setIsModalOpen(false);
    setUploading(true);
    setError(null);
    try {
      const payload = {
        scrimName: scrimData.scrimName || "이름 없는 스크림",
        date: scrimData.date,
        startHour: scrimData.startHour || "00",
        endHour: scrimData.endHour || "00",
        matches: scrimData.matches.map((m) => ({
          map_name: m.map_name,
          videoUrl: m.videoUrl || "",
          team1Name: m.team1Name || "1팀",
          team2Name: m.team2Name || "2팀",
          start_time: m.start_time,
          end_time: m.end_time,
          result: m.result || "Unknown",
          hasPause: m.has_pause,
          pauses: m.pauses || [],
          // 승패 보정 — 등록자가 모달에서 수동 선택(맵 종류 무관). 미보정 = 빈값(서버에서 null 저장)
          winnerOverride: m.winner_override || ""
        })),
        files: []
      };

      const createRes = await axios.post(`${API_BASE}/api/scrim/manual-register`, payload);
      const newScrimId = createRes.data.scrim_id;

      if (scrimData.files && scrimData.files.length > 0) {
        for (let i = 0; i < scrimData.files.length; i++) {
          const file = scrimData.files[i];
          if (!file) continue;
          const formData = new FormData();
          formData.append("scrim_id", newScrimId);
          formData.append("match_index", i + 1);
          formData.append("file", file);
          await axios.post(`${API_BASE}/api/matches/upload`, formData, {
            headers: { "Content-Type": "multipart/form-data" },
          });
        }
      }
      invalidateApiCache(); // 등록 성공 → 공유 fetch 캐시 무효화 (다음 접근부터 재요청)
      setAllScrims([]); // 이미 로드된 full-events 상태도 초기화 (소비 탭 재진입 시 새로 로드)
      alert(t.success);
      goSessions();
    } catch (err) {
      let errMsg = err.message;
      if (err.response?.data?.detail) errMsg = JSON.stringify(err.response.data.detail, null, 2);
      setError(`Upload Failed: ${errMsg}`);
    } finally { setUploading(false); }
  };

  const navButtonStyle = (isActive) => ({
    background: isActive ? theme.surfaceHighlight : "transparent",
    color: isActive ? theme.text : theme.textSub,
    border: "none", padding: "8px 12px", borderRadius: "6px", cursor: "pointer",
    display: "flex", alignItems: "center", gap: "8px", transition: "all 0.2s",
    fontWeight: isActive ? 600 : 500,
  });

  // 4개 메인 + 드롭다운 구조. 하위 항목 순서는 확정 분류 그대로.
  const NAV_ITEMS = [
    { key: "dashboard", label: t.dashboard, Icon: LayoutDashboard, onSelect: goHome, activeViews: ["home"] },
    { key: "sessions", label: t.sessions, Icon: History, onSelect: goSessions, activeViews: ["sessions", "scrim", "match"] },
    {
      key: "stats", label: t.navGroupStats, Icon: BarChart3, children: [
        { key: "overall", label: t.overall, Icon: BarChart3, onSelect: goOverall },
        { key: "personal", label: t.navPersonal, Icon: User, onSelect: goPersonal },
        { key: "killdeath", label: t.navKillDeath, Icon: Skull, onSelect: goKillDeath },
        { key: "ultimates", label: t.navUltimateStats, Icon: Zap, onSelect: goUltimates },
        { key: "compare", label: t.navCompare, Icon: Users, onSelect: goCompare },
        { key: "firstfight", label: t.navFirstFight, Icon: Swords, onSelect: goFirstFight },
      ],
    },
    {
      key: "analysis", label: t.navGroupAnalysis, Icon: FlaskConical, children: [
        { key: "mapanalysis", label: t.navMapAnalysis, Icon: MapIcon, onSelect: goMapAnalysis },
        { key: "fightlab", label: t.navFightLab, Icon: FlaskConical, onSelect: goFightLab },
        { key: "ultanalysis", label: t.navUltAnalysis, Icon: Crosshair, onSelect: goUltAnalysis },
      ],
    },
    { key: "banpick", label: t.navBanpick, Icon: Ban, onSelect: goBanpick, activeViews: ["banpick"] },
  ];

  const groupOf = (k) => NAV_ITEMS.find((i) => i.key === k);
  const isGroupActive = (item) =>
    item.children ? item.children.some((c) => c.key === currentView) : item.activeViews.includes(currentView);
  // hover가 있으면 hover 우선(다른 메인으로 즉시 전환), 없으면 클릭 고정(pinned) 유지.
  // hover한 메인에 드롭다운이 없으면(대시보드/세션) 열린 드롭다운은 닫힌다.
  const effectiveOpen = navHovered != null ? (groupOf(navHovered)?.children ? navHovered : null) : navPinned;

  // 바깥 래퍼: 버튼에 딱 붙여(top:100%) 배치하고 6px 간격을 투명 paddingTop 으로 채운다.
  //  → 버튼→드롭다운 이동 중 마우스가 항상 이 요소(=nav의 자식) 위에 있어 hover가 끊기지 않음.
  const dropdownStyle = (open) => ({
    position: "absolute", top: "100%", left: 0, minWidth: "184px", paddingTop: "6px", zIndex: 1000,
    opacity: open ? 1 : 0, visibility: open ? "visible" : "hidden",
    transform: open ? "translateY(0)" : "translateY(-4px)",
    transition: "opacity 0.13s ease, transform 0.13s ease, visibility 0.13s ease",
  });
  // 안쪽 카드: 실제 보이는 드롭다운 박스.
  const dropdownCardStyle = {
    background: theme.surface, border: `1px solid ${theme.border}`, borderRadius: "10px",
    padding: "6px", boxShadow: "0 10px 28px rgba(0,0,0,0.30)",
    display: "flex", flexDirection: "column", gap: "2px",
  };

  const itemStyle = (childKey) => {
    const active = currentView === childKey;
    const hot = navHoverItem === childKey;
    return {
      background: active || hot ? theme.surfaceHighlight : "transparent",
      color: active ? theme.text : theme.textSub,
      border: "none", padding: "8px 12px", borderRadius: "6px", cursor: "pointer",
      display: "flex", alignItems: "center", gap: "8px", transition: "all 0.15s",
      fontWeight: active ? 600 : 500, fontSize: "14px", whiteSpace: "nowrap",
      textAlign: "left", width: "100%",
    };
  };

  // 모바일 드로어 메뉴 항목/하위항목 스타일 (터치 44px 이상)
  const mobileItemStyle = (active) => ({
    display: "flex", alignItems: "center", gap: "12px", width: "100%", minHeight: "48px",
    padding: "10px 16px", background: active ? theme.surfaceHighlight : "transparent",
    color: active ? theme.text : theme.textSub, border: "none", borderRadius: "8px",
    cursor: "pointer", fontSize: "15px", fontWeight: active ? 600 : 500, textAlign: "left",
  });
  const mobileSubItemStyle = (active) => ({
    ...mobileItemStyle(active), minHeight: "44px", paddingLeft: "44px", fontSize: "14px",
  });
  const closeMobileMenu = () => { setMobileMenuOpen(false); setMobileExpanded(null); };

  const Navbar = () => (
    <>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: isMobile ? "0 16px" : "0 32px", height: "64px", borderBottom: `1px solid ${theme.border}`, backgroundColor: theme.surface, position: "sticky", top: 0, zIndex: 50 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "40px" }}>
          <div onClick={goHome} style={{ fontSize: "18px", fontWeight: "800", cursor: "pointer", background: "linear-gradient(to right, #3b82f6, #8b5cf6)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
          {APP_NAME}
          </div>
          {/* 데스크톱: 기존 hover+click 드롭다운 네비 (모바일에서는 숨김 → 햄버거로 대체) */}
          {!isMobile && (
          <nav
            ref={navRef}
            onMouseLeave={() => setNavHovered(null)}
            onKeyDown={(e) => { if (e.key === "Escape") { setNavPinned(null); setNavHovered(null); } }}
            style={{ display: "flex", gap: "8px", fontSize: "14px", fontWeight: 500 }}
          >
            {NAV_ITEMS.map((item) => {
              const open = !!item.children && effectiveOpen === item.key;
              const active = isGroupActive(item);
              return (
                <div key={item.key} style={{ position: "relative" }} onMouseEnter={() => setNavHovered(item.key)}>
                  <button
                    onClick={item.children
                      ? () => { setNavHovered(null); setNavPinned((p) => (p === item.key ? null : item.key)); }
                      : () => { item.onSelect(); setNavPinned(null); setNavHovered(null); }}
                    aria-haspopup={item.children ? "true" : undefined}
                    aria-expanded={item.children ? open : undefined}
                    style={navButtonStyle(active || open)}
                  >
                    <item.Icon size={16} /> {item.label}
                    {item.children && (
                      <ChevronDown size={14} style={{ marginLeft: "-2px", transition: "transform 0.15s ease", transform: open ? "rotate(180deg)" : "none" }} />
                    )}
                  </button>
                  {item.children && (
                    <div role="menu" style={dropdownStyle(open)}>
                      <div style={dropdownCardStyle}>
                        {item.children.map((c) => (
                          <button
                            key={c.key}
                            role="menuitem"
                            tabIndex={open ? 0 : -1}
                            onClick={() => { c.onSelect(); setNavPinned(null); setNavHovered(null); setNavHoverItem(null); }}
                            onMouseEnter={() => setNavHoverItem(c.key)}
                            onMouseLeave={() => setNavHoverItem(null)}
                            style={itemStyle(c.key)}
                          >
                            <c.Icon size={16} /> {c.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </nav>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <button onClick={toggleLanguage} style={{ background: theme.surfaceHighlight, border: "none", padding: "8px 12px", cursor: "pointer", borderRadius: "8px", display: "flex", alignItems: "center", gap: "6px", color: theme.text, fontSize: "13px", fontWeight: "bold" }}><Globe size={18} /> {language.toUpperCase()}</button>
          <button onClick={toggleTheme} style={{ background: theme.surfaceHighlight, border: "none", padding: "8px", cursor: "pointer", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center" }}>{isDarkMode ? <Moon size={20} color={theme.textSub} /> : <Sun size={20} color="#f59e0b" />}</button>
          {/* 모바일: 햄버거 토글 (☰ ↔ ✕) */}
          {isMobile && (
            <button
              onClick={() => setMobileMenuOpen((o) => !o)}
              aria-label={mobileMenuOpen ? "메뉴 닫기" : "메뉴 열기"}
              aria-expanded={mobileMenuOpen}
              style={{ background: theme.surfaceHighlight, border: "none", padding: "8px", cursor: "pointer", borderRadius: "8px", display: "flex", alignItems: "center", justifyContent: "center", minWidth: "44px", minHeight: "44px", color: theme.text }}
            >
              {mobileMenuOpen ? <X size={22} /> : <Menu size={22} />}
            </button>
          )}
        </div>
      </header>

      {/* 모바일 드로어: 헤더 아래 전체 폭 세로 메뉴 + 바깥(백드롭) 탭으로 닫기 */}
      {isMobile && mobileMenuOpen && (
        <>
          <div
            onClick={closeMobileMenu}
            style={{ position: "fixed", top: "64px", left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.45)", zIndex: 45 }}
          />
          <nav
            aria-label="모바일 메뉴"
            style={{ position: "fixed", top: "64px", left: 0, right: 0, zIndex: 46, background: theme.surface, borderBottom: `1px solid ${theme.border}`, boxShadow: "0 12px 28px rgba(0,0,0,0.30)", padding: "8px", display: "flex", flexDirection: "column", gap: "2px", maxHeight: "calc(100vh - 64px)", overflowY: "auto" }}
          >
            {NAV_ITEMS.map((item) => {
              if (!item.children) {
                const active = isGroupActive(item);
                return (
                  <button key={item.key} onClick={() => { item.onSelect(); closeMobileMenu(); }} style={mobileItemStyle(active)}>
                    <item.Icon size={18} /> {item.label}
                  </button>
                );
              }
              const expanded = mobileExpanded === item.key;
              const groupActive = isGroupActive(item);
              return (
                <div key={item.key}>
                  <button
                    onClick={() => setMobileExpanded((k) => (k === item.key ? null : item.key))}
                    aria-expanded={expanded}
                    style={mobileItemStyle(groupActive)}
                  >
                    <item.Icon size={18} /> {item.label}
                    <ChevronDown size={16} style={{ marginLeft: "auto", transition: "transform 0.15s ease", transform: expanded ? "rotate(180deg)" : "none" }} />
                  </button>
                  {expanded && item.children.map((c) => (
                    <button key={c.key} onClick={() => { c.onSelect(); closeMobileMenu(); }} style={mobileSubItemStyle(currentView === c.key)}>
                      <c.Icon size={16} /> {c.label}
                    </button>
                  ))}
                </div>
              );
            })}
          </nav>
        </>
      )}
    </>
  );

  const renderView = () => {
    if (currentView === "home") {
        return (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "calc(100vh - 64px)" }}>
              <div style={{ textAlign: "center", maxWidth: "600px", padding: "0 20px" }}>
                <h2 style={{ marginBottom: "16px", fontSize: "32px", fontWeight: "800", color: theme.text }}>{t.title}</h2>
                <p style={{ color: theme.textSub, marginBottom: "40px", fontSize: "16px", lineHeight: "1.6" }}>{t.desc}<br />{t.desc2}</p>
                <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", gap: isMobile ? "12px" : "16px", justifyContent: "center", alignItems: "center" }}>
                  <button onClick={() => setIsModalOpen(true)} disabled={uploading} style={{ background: isDarkMode ? "#fff" : "#09090b", color: isDarkMode ? "#09090b" : "#fff", border: "none", padding: "14px 32px", borderRadius: "8px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "10px", fontSize: "15px", fontWeight: "700", width: isMobile ? "100%" : "auto" }}>
                    {uploading ? t.uploading : <><Upload size={20} /> {t.createScrim}</>}
                  </button>
                  <button onClick={goSessions} style={{ background: theme.surfaceHighlight, color: theme.text, border: `1px solid ${theme.borderHighlight}`, padding: "14px 32px", borderRadius: "8px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "10px", fontSize: "15px", fontWeight: "600", width: isMobile ? "100%" : "auto" }}>
                    <History size={20} /> {t.viewHistory}
                  </button>
                </div>
                {error && <div style={{ marginTop: "32px", color: theme.danger, background: isDarkMode ? "rgba(239, 68, 68, 0.1)" : "#fee2e2", padding: "12px 20px", borderRadius: "8px", display: "inline-flex", alignItems: "center", gap: "8px", fontSize: "14px" }}><AlertCircle size={16} /> {error}</div>}
              </div>
            </div>
          );
    }
    if (currentView === "sessions") return <ScrimSessions onSelectScrim={goToScrim} />;
    if (currentView === "scrim") return <ScrimDetail scrimId={activeScrimId} onSelectMatch={goToMatch} onBack={goSessions} onGoOverall={goOverall} />;
    if (currentView === "match") return <MatchStats matchId={activeMatchId} onBack={() => goToScrim(activeScrimId)} />;
    if (currentView === "overall") return <OverallStats onBack={goHome} onGoSessions={goSessions} />;
    if (currentView === "ultimates") return <UltimateStats allScrims={allScrims} />;
    if (currentView === "killdeath") return <KillDeathStats allScrims={allScrims} />;
    if (currentView === "firstfight") return <FirstFightStats />;
    if (currentView === "fightlab") return <FightLabStats />;
    if (currentView === "ultanalysis") return <UltimateAnalysisStats />;
    if (currentView === "mapanalysis") return <MapAnalysisStats onGoSession={goToScrim} />;
    if (currentView === "banpick") return <BanpickApp />;
    if (currentView === "personal") return <div style={{ padding: '24px' }}><PlayerProfileView playersData={dynamicPlayersData} /></div>;
    if (currentView === "compare") return <div style={{ padding: '24px' }}><PlayerCompareView playersData={dynamicPlayersData} /></div>;

    return <div>404 Not Found</div>;
  };

  return (
    <div style={{ minHeight: "100vh", backgroundColor: theme.bg, color: theme.text, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}>
      <Navbar />
      <ErrorBoundary>{renderView()}</ErrorBoundary>
      <ScrimModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} onSubmit={handleScrimSubmit} />
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <LanguageProvider>
        <MainApp />
      </LanguageProvider>
    </ThemeProvider>
  );
}