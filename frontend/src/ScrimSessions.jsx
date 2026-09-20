import React, { useEffect, useState, useMemo } from 'react';
import axios from 'axios';
import { fetchCached, invalidateApiCache } from './utils/apiCache';
import { Calendar, CalendarDays, List, ChevronLeft, ChevronRight, Clock, RefreshCw, Filter, Trash2 } from 'lucide-react';
import { useTheme } from "./ThemeContext";
import { useLanguage } from "./LanguageContext";
import { BASE_TEAM } from "./config";

// 세션명(YYMMDD-TEAM)에서 상대팀 추출 — 첫 하이픈 뒤 전체.
// (실데이터 전수 확인: 전 세션이 하이픈 정확히 1개. 예외 없음.)
const opponentOf = (name) => {
  const s = name || '';
  const i = s.indexOf('-');
  return i >= 0 ? s.slice(i + 1) : (s || '?');
};
const pad2 = (n) => String(n).padStart(2, '0');
const dateKey = (y, m, d) => `${y}-${pad2(m + 1)}-${pad2(d)}`;

// 우리 팀 = 기준 팀(config.js BASE_TEAM, 앱 전반의 "우리 시점"과 동일). 매치 winner(override 반영 최종값)로 세션 전적 산출.
//  - winner === 기준 팀           → 승
//  - winner in (Draw/무승부/빈값) → 무 (판정 불가 포함)
//  - 그 외(상대팀명)             → 패
const OUR_TEAM = BASE_TEAM;
const sessionRecord = (s) => {
  let w = 0, l = 0, d = 0;
  for (const m of (s.matches || [])) {
    const win = (m.winner || '').trim();
    if (win === OUR_TEAM) w++;
    else if (!win || win === 'Draw' || win === '무승부') d++;
    else l++;
  }
  const outcome = w > l ? 'win' : w < l ? 'loss' : 'draw';
  return { w, l, d, outcome };
};

const MONTH_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW_KO = ['일', '월', '화', '수', '목', '금', '토'];
const DOW_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DOW_ZH = ['日', '一', '二', '三', '四', '五', '六'];

const ScrimSessions = ({ onSelectScrim }) => {
  const { theme } = useTheme();
  const { t, language } = useLanguage();

  const [scrims, setScrims] = useState([]);
  const [loading, setLoading] = useState(true);
  const [rebuilding, setRebuilding] = useState(false);

  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [deleting, setDeleting] = useState(false);

  // 달력/리스트 뷰 (기본: 달력)
  const [viewMode, setViewMode] = useState('calendar');
  // 달력이 보는 연/월 (기본: 이번 달)
  const [cal, setCal] = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() }; });
  const todayKey = useMemo(() => { const d = new Date(); return dateKey(d.getFullYear(), d.getMonth(), d.getDate()); }, []);

  // 모바일 폭 분기 — App 네비와 동일 기준(matchMedia 767px 미만=모바일). 표시 레이어만, 데스크톱 무변경.
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches);
  // 모바일 달력: 칸의 세션은 점(dot)으로 표시하고, 탭하면 상세 팝오버.
  //  popover = { sessions, rect } | null  (rect = 탭한 셀의 화면 좌표 — 가장자리 잘림 보정용)
  const [popover, setPopover] = useState(null);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const onChange = (e) => { setIsMobile(e.matches); if (!e.matches) setPopover(null); };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  // 팝오버 바깥 탭 시 닫기
  useEffect(() => {
    if (!popover) return;
    const onDown = (e) => { if (!e.target.closest?.('.ssc-popover')) setPopover(null); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [popover]);

  const fetchScrims = async () => {
    try {
      const data = await fetchCached('/api/scrims');
      setScrims(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchScrims(); }, []);

  const handleRebuildDB = async (e) => {
    e.stopPropagation();
    if (!window.confirm(t.ssRebuildConfirm)) return;
    setRebuilding(true);
    try {
      const res = await axios.post('/api/admin/rebuild-db');
      invalidateApiCache(); // DB 재구축 성공 → 공유 캐시 무효화 후 재조회
      alert(`Done! ${res.data.count} scrims restored.`);
      fetchScrims();
    } catch (err) {
      console.error(err);
      alert("Error: Check backend logs.");
    } finally {
      setRebuilding(false);
    }
  };

  const filteredScrims = useMemo(() => {
    return scrims.filter(s => {
      if (startDate && s.date < startDate) return false;
      if (endDate && s.date > endDate) return false;
      return true;
    });
  }, [scrims, startDate, endDate]);

  // 날짜(YYYY-MM-DD) -> 그 날 세션 목록
  const sessionsByDate = useMemo(() => {
    const map = {};
    for (const s of scrims) { (map[s.date] || (map[s.date] = [])).push(s); }
    return map;
  }, [scrims]);

  // 달력 셀 배열 (앞뒤 달 날짜 포함, 주 단위로 꽉 채움)
  const cells = useMemo(() => {
    const { y, m } = cal;
    const first = new Date(y, m, 1).getDay();      // 1일의 요일 (0=일)
    const dim = new Date(y, m + 1, 0).getDate();   // 이번 달 말일
    const prevDim = new Date(y, m, 0).getDate();   // 지난 달 말일
    const total = Math.ceil((first + dim) / 7) * 7;
    const arr = [];
    for (let i = 0; i < total; i++) {
      const off = i - first + 1;
      if (off < 1) arr.push({ inMonth: false, day: prevDim + off });
      else if (off > dim) arr.push({ inMonth: false, day: off - dim });
      else arr.push({ inMonth: true, day: off, key: dateKey(y, m, off) });
    }
    return arr;
  }, [cal]);

  // 그 달 요약 (세션 수 · 세션 단위 승/패 전적)
  const monthStats = useMemo(() => {
    const prefix = `${cal.y}-${pad2(cal.m + 1)}`;
    const inMonth = scrims.filter(s => (s.date || '').startsWith(prefix));
    let won = 0, lost = 0, drew = 0;
    for (const s of inMonth) {
      const o = sessionRecord(s).outcome;
      if (o === 'win') won++; else if (o === 'loss') lost++; else drew++;
    }
    const teams = new Set(inMonth.map(s => opponentOf(s.scrim_name))).size;
    return { n: inMonth.length, teams, won, lost, drew };
  }, [scrims, cal]);

  const shiftMonth = (delta) => setCal(({ y, m }) => {
    const nm = m + delta;
    return { y: y + Math.floor(nm / 12), m: ((nm % 12) + 12) % 12 };
  });
  const goThisMonth = () => { const d = new Date(); setCal({ y: d.getFullYear(), m: d.getMonth() }); };

  const monthTitle = language === 'ko' ? `${cal.y}년 ${cal.m + 1}월`
    : language === 'zh' ? `${cal.y}年${cal.m + 1}月`
    : `${MONTH_EN[cal.m]} ${cal.y}`;
  const monthSummary = language === 'ko'
    ? `${cal.m + 1}월: ${monthStats.n}세션 · 상대 ${monthStats.teams}팀 · ${monthStats.won}승 ${monthStats.lost}패 ${monthStats.drew}무`
    : language === 'zh'
    ? `${cal.m + 1}月: ${monthStats.n}场次 · 对手${monthStats.teams}队 · ${monthStats.won}胜 ${monthStats.lost}负 ${monthStats.drew}平`
    : `${MONTH_EN[cal.m]}: ${monthStats.n} sessions · ${monthStats.teams} teams · ${monthStats.won}W ${monthStats.lost}L ${monthStats.drew}D`;
  const DOW = language === 'ko' ? DOW_KO : language === 'zh' ? DOW_ZH : DOW_EN;

  // 승/패/무 칩 색 — 은은한 톤(다크·라이트 모두 가독). 원색 금지.
  const outcomeChip = (outcome) => {
    const dark = theme.mode === 'dark';
    if (outcome === 'win') return { bg: 'rgba(34,197,94,0.14)', bd: 'rgba(34,197,94,0.42)', fg: dark ? '#4ade80' : '#15803d' };
    if (outcome === 'loss') return { bg: 'rgba(239,68,68,0.13)', bd: 'rgba(239,68,68,0.40)', fg: dark ? '#f87171' : '#b91c1c' };
    return { bg: theme.surfaceHighlight, bd: theme.border, fg: theme.textSub }; // 무/판정불가 = 중립
  };

  const enterSelectMode = () => {
    setViewMode('list'); // 선택 삭제는 리스트에서 (체크박스 UX)
    setIsSelectMode(true);
    setSelectedIds(new Set());
  };

  const exitSelectMode = () => {
    setIsSelectMode(false);
    setSelectedIds(new Set());
  };

  const toggleSelect = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredScrims.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredScrims.map(s => s.id)));
    }
  };

  const handleDeleteSelected = async () => {
    if (selectedIds.size === 0) return;
    const ids = [...selectedIds];
    const totalMatches = scrims
      .filter(s => ids.includes(s.id))
      .reduce((sum, s) => sum + (s.matches?.length || 0), 0);

    const msg = `${t.deleteConfirmPre}${ids.length}${t.ssDeleteSessionMid}${totalMatches}${t.ssDeleteSessionPost}\n${t.sdIrreversible}`;
    if (!window.confirm(msg)) return;

    setDeleting(true);
    try {
      const res = await axios.post('/api/sessions/delete-batch', { ids });
      invalidateApiCache(); // 삭제 성공 → 공유 캐시 무효화 후 재조회
      if (res.data.warnings?.length > 0) {
        alert(`${t.sdDeleteDone} (${res.data.deleted_count}${t.msCountUnit})\n${t.sdWarnings}\n${res.data.warnings.join('\n')}`);
      }
      if (res.data.failed_ids?.length > 0) {
        alert(`${t.sdPartialFail}${res.data.failed_ids.join(', ')}`);
      }
      await fetchScrims();
      exitSelectMode();
    } catch (err) {
      alert(`${t.sdDeleteFail}${err.response?.data?.detail || err.message}`);
    } finally {
      setDeleting(false);
    }
  };

  if (loading) return <div style={{ padding: '40px', color: theme.textSub, textAlign: 'center' }}>{t.loading}</div>;

  const allSelected = filteredScrims.length > 0 && selectedIds.size === filteredScrims.length;

  // 뷰 토글 세그먼트 버튼
  const segBtn = (mode, label, Icon) => (
    <button
      onClick={() => setViewMode(mode)}
      style={{
        background: viewMode === mode ? theme.surfaceHighlight : 'transparent',
        color: viewMode === mode ? theme.text : theme.textSub,
        border: 'none', padding: '7px 12px', borderRadius: '7px', cursor: 'pointer',
        display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px',
        fontWeight: viewMode === mode ? 700 : 500, transition: 'all 0.15s',
      }}
    >
      <Icon size={15} /> {label}
    </button>
  );

  return (
    <div style={{ padding: isMobile ? '16px 12px' : '40px', maxWidth: '1200px', margin: '0 auto', color: theme.text, '--ssc-bh': theme.borderHighlight, '--ssc-primary': theme.primary }}>

      <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', justifyContent: 'space-between', alignItems: isMobile ? 'stretch' : 'center', gap: isMobile ? '12px' : 0, marginBottom: isMobile ? '16px' : '24px' }}>
        <div>
          <h2 style={{ fontSize: isMobile ? '20px' : '24px', fontWeight: '800', margin: 0 }}>{t.sessions}</h2>
          <p style={{ color: theme.textSub, fontSize: '14px', marginTop: '4px' }}>{t.viewHistory}</p>
        </div>

        <div style={{ display: 'flex', flexWrap: isMobile ? 'wrap' : 'nowrap', gap: '8px', alignItems: 'center' }}>
          {/* 달력 / 리스트 토글 (선택 모드에선 숨김) */}
          {!isSelectMode && (
            <div style={{ display: 'flex', gap: '2px', background: theme.surface, border: `1px solid ${theme.border}`, borderRadius: '9px', padding: '3px' }}>
              {segBtn('calendar', t.ssCalendar, CalendarDays)}
              {segBtn('list', t.ssList, List)}
            </div>
          )}
          {isSelectMode ? (
            <button
              onClick={exitSelectMode}
              style={{ background: theme.surface, border: `1px solid ${theme.border}`, color: theme.textSub, padding: '10px 16px', borderRadius: '8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', fontWeight: '600' }}
            >
              {t.cancelSelection}
            </button>
          ) : (
            <>
              <button
                onClick={enterSelectMode}
                style={{ background: theme.surface, border: `1px solid ${theme.border}`, color: theme.danger || '#ef4444', padding: '10px 16px', borderRadius: '8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', fontWeight: '600' }}
              >
                <Trash2 size={15} /> {t.delete}
              </button>
              <button
                onClick={handleRebuildDB}
                disabled={rebuilding}
                style={{ background: theme.surface, border: `1px solid ${theme.border}`, color: theme.textSub, padding: '10px 16px', borderRadius: '8px', cursor: rebuilding ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', fontWeight: '600' }}
              >
                <RefreshCw size={16} className={rebuilding ? "spin-anim" : ""} />
                {rebuilding ? "Rebuilding..." : "Rebuild DB"}
              </button>
            </>
          )}
        </div>
      </div>

      {/* 선택 모드 액션 바 */}
      {isSelectMode && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px', background: theme.surface, border: `1px solid ${theme.border}`, borderRadius: '10px', padding: '12px 16px' }}>
          <span style={{ fontSize: '14px', fontWeight: '600', color: theme.text, flex: 1 }}>
            {selectedIds.size}{t.msCountUnit} {t.selectedCount}
          </span>
          <button
            onClick={toggleSelectAll}
            style={{ background: 'transparent', border: `1px solid ${theme.border}`, color: theme.textSub, padding: '6px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}
          >
            {allSelected ? t.deselectAll : t.selectAll}
          </button>
          <button
            onClick={handleDeleteSelected}
            disabled={selectedIds.size === 0 || deleting}
            style={{ background: selectedIds.size > 0 ? (theme.danger || '#ef4444') : theme.surfaceHighlight, border: 'none', color: selectedIds.size > 0 ? '#fff' : theme.textSub, padding: '6px 16px', borderRadius: '6px', cursor: selectedIds.size > 0 ? 'pointer' : 'not-allowed', fontSize: '13px', fontWeight: '700', opacity: deleting ? 0.6 : 1 }}
          >
            {deleting ? t.deleting : t.deleteSelected}
          </button>
        </div>
      )}

      {/* ===== 달력 뷰 ===== */}
      {viewMode === 'calendar' && !isSelectMode && (
        <div>
          {/* 월 이동 + 요약: [◀] [2026년 N월] [▶] ····· [요약] [오늘]
              모바일: 2줄 허용(월 이동 줄 / 요약·오늘 줄) — flexWrap으로 긴 요약이 다음 줄로 내려감. */}
          <div style={{ display: 'flex', flexWrap: isMobile ? 'wrap' : 'nowrap', alignItems: 'center', gap: '8px', marginBottom: '18px', background: theme.surface, padding: isMobile ? '10px 12px' : '12px 16px', borderRadius: '12px', border: `1px solid ${theme.border}` }}>
            <button
              className="ssc-navbtn" onClick={() => shiftMonth(-1)} aria-label="prev month"
              style={{ background: theme.surfaceHighlight, border: `1px solid ${theme.border}`, width: '36px', height: '36px', borderRadius: '8px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, flexShrink: 0 }}
            >
              <ChevronLeft size={18} color={theme.text} />
            </button>
            <div style={{ fontSize: '18px', fontWeight: '800', textAlign: 'center', minWidth: '132px' }}>{monthTitle}</div>
            <button
              className="ssc-navbtn" onClick={() => shiftMonth(1)} aria-label="next month"
              style={{ background: theme.surfaceHighlight, border: `1px solid ${theme.border}`, width: '36px', height: '36px', borderRadius: '8px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, flexShrink: 0 }}
            >
              <ChevronRight size={18} color={theme.text} />
            </button>
            {/* 모바일: 강제 줄바꿈 스페이서 → 요약·오늘이 항상 둘째 줄로 */}
            {isMobile && <div style={{ flexBasis: '100%', height: 0 }} />}
            <div style={{ marginLeft: isMobile ? 0 : 'auto', color: theme.textSub, fontSize: '13px', fontWeight: 600, whiteSpace: 'nowrap' }}>{monthSummary}</div>
            <button
              onClick={goThisMonth}
              style={{ background: 'transparent', border: `1px solid ${theme.border}`, color: theme.textSub, height: '36px', padding: '0 14px', borderRadius: '8px', cursor: 'pointer', fontSize: '12px', fontWeight: 600, flexShrink: 0, marginLeft: isMobile ? 'auto' : 0 }}
            >
              {language === 'ko' ? '오늘' : language === 'zh' ? '今天' : 'Today'}
            </button>
          </div>

          {/* 요일 헤더 */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: isMobile ? '4px' : '8px', marginBottom: '8px' }}>
            {DOW.map((w, i) => (
              <div key={w} style={{ textAlign: 'center', fontSize: '12px', fontWeight: 700, letterSpacing: '0.04em', color: i === 0 ? (theme.danger || '#ef4444') : theme.textSub }}>{w}</div>
            ))}
          </div>

          {/* 날짜 그리드 (7열 유지 — 모바일은 gap·패딩 축소) */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: isMobile ? '4px' : '8px' }}>
            {cells.map((c, i) => {
              const isToday = c.inMonth && c.key === todayKey;
              const daySessions = c.inMonth ? (sessionsByDate[c.key] || []) : [];
              // 모바일: 셀 전체를 탭 타깃으로 → 그 날 세션 팝오버 오픈(셀 화면좌표를 넘겨 가장자리 보정)
              const openPopover = (isMobile && daySessions.length > 0)
                ? (e) => {
                    e.stopPropagation();
                    const r = e.currentTarget.getBoundingClientRect();
                    setPopover({ sessions: daySessions, rect: { left: r.left, top: r.top, bottom: r.bottom } });
                  }
                : undefined;
              return (
                <div
                  key={i}
                  className={'ssc-cell' + (c.inMonth ? ' in' : '')}
                  onClick={openPopover}
                  style={{
                    background: c.inMonth ? theme.surface : 'transparent',
                    border: `1px solid ${c.inMonth ? theme.border : 'transparent'}`,
                    borderRadius: '10px', padding: isMobile ? '4px 3px' : '6px 7px',
                    minHeight: isMobile ? '58px' : '92px', minWidth: 0,
                    display: 'flex', flexDirection: 'column', gap: isMobile ? '3px' : '4px',
                    opacity: c.inMonth ? 1 : 0.35,
                    cursor: openPopover ? 'pointer' : 'default',
                  }}
                >
                  {/* 오늘: 숫자에만 작은 하이라이트 (칸 전체 칠하지 않음) */}
                  {isToday ? (
                    <div style={{ display: 'flex' }}>
                      <span style={{ fontSize: '12px', fontWeight: 700, color: '#fff', background: theme.primary, minWidth: '20px', height: '20px', borderRadius: '999px', padding: '0 6px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{c.day}</span>
                    </div>
                  ) : (
                    <div style={{ fontSize: '13px', fontWeight: 600, color: theme.textSub }}>{c.day}</div>
                  )}
                  {isMobile ? (
                    // 모바일: 세션당 점(dot) — 승패 색 유지, 복수 세션이면 여러 점.
                    daySessions.length > 0 && (
                      // dot 정렬: flex 한 줄 수평 · 중앙 정렬 · 균일 gap. span은 block+원형 고정크기라
                      // 인라인 baseline/line-height 오프셋으로 인한 세로 어긋남 제거.
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '3px', marginTop: '2px', lineHeight: 0 }}>
                        {daySessions.map((s) => {
                          const col = outcomeChip(sessionRecord(s).outcome);
                          return <span key={s.id} style={{ display: 'block', width: 8, height: 8, borderRadius: '50%', background: col.fg, border: `1px solid ${col.bd}`, flexShrink: 0 }} />;
                        })}
                      </div>
                    )
                  ) : (
                    daySessions.map((s) => {
                      const rec = sessionRecord(s);
                      const col = outcomeChip(rec.outcome);
                      const opp = opponentOf(s.scrim_name);
                      return (
                        <div
                          key={s.id}
                          className="ssc-chip"
                          title={`${s.scrim_name} · ${rec.w}${language === 'ko' ? '승 ' : language === 'zh' ? '胜 ' : 'W '}${rec.l}${language === 'ko' ? '패' : language === 'zh' ? '负' : 'L'}${rec.d ? (language === 'ko' ? ` ${rec.d}무` : language === 'zh' ? ` ${rec.d}平` : ` ${rec.d}D`) : ''} · ${t.matchCount.replace('{n}', s.matches?.length || 0)}`}
                          onClick={(e) => { e.stopPropagation(); onSelectScrim(s.id); }}
                          style={{
                            background: col.bg, color: col.fg, border: `1px solid ${col.bd}`, borderRadius: '6px',
                            padding: '2px 6px', fontSize: '11px', fontWeight: 700, lineHeight: 1.3,
                            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                            gap: '4px', whiteSpace: 'nowrap', overflow: 'hidden',
                          }}
                        >
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{opp}</span>
                          <span style={{ fontWeight: 700, fontSize: '10.5px', flexShrink: 0, letterSpacing: '0.02em' }}>{rec.w}-{rec.l}</span>
                        </div>
                      );
                    })
                  )}
                </div>
              );
            })}
          </div>

          {/* 모바일 세션 팝오버 — 탭한 날의 세션 목록. 화면 가장자리에서 잘리지 않게 좌우 클램프 + 위/아래 자동. */}
          {isMobile && popover && (() => {
            const POPW = Math.min(252, window.innerWidth - 16);
            const left = Math.max(8, Math.min(popover.rect.left, window.innerWidth - POPW - 8));
            const below = popover.rect.top < window.innerHeight / 2;
            const vstyle = below ? { top: popover.rect.bottom + 6 } : { bottom: window.innerHeight - popover.rect.top + 6 };
            return (
              <div className="ssc-popover" style={{ position: 'fixed', left, width: POPW, boxSizing: 'border-box', ...vstyle, zIndex: 60, background: theme.surface, border: `1px solid ${theme.borderHighlight}`, borderRadius: '12px', boxShadow: '0 10px 30px rgba(0,0,0,0.4)', padding: '6px', maxHeight: '52vh', overflowY: 'auto' }}>
                {popover.sessions.map((s) => {
                  const rec = sessionRecord(s);
                  const col = outcomeChip(rec.outcome);
                  return (
                    <button
                      key={s.id}
                      className="ssc-poprow"
                      onClick={(e) => { e.stopPropagation(); onSelectScrim(s.id); setPopover(null); }}
                      style={{ display: 'flex', alignItems: 'center', gap: '9px', width: '100%', textAlign: 'left', background: 'transparent', border: 'none', borderRadius: '8px', padding: '10px 8px', cursor: 'pointer', color: theme.text, minHeight: '44px' }}
                    >
                      <span style={{ width: 9, height: 9, borderRadius: '999px', background: col.fg, flexShrink: 0 }} />
                      <span style={{ flex: 1, minWidth: 0, fontSize: '13px', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.scrim_name}</span>
                      <span style={{ flexShrink: 0, fontSize: '12px', fontWeight: 700, color: col.fg }}>{rec.w}-{rec.l}{rec.d ? `-${rec.d}` : ''}</span>
                    </button>
                  );
                })}
              </div>
            );
          })()}
        </div>
      )}

      {/* ===== 리스트 뷰 ===== */}
      {(viewMode === 'list' || isSelectMode) && (
        <>
          {/* 날짜 필터 바 */}
          <div style={{ display: 'flex', gap: '16px', alignItems: 'center', marginBottom: '24px', background: theme.surface, padding: '16px', borderRadius: '12px', border: `1px solid ${theme.border}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 'bold', color: theme.textSub }}>
              <Filter size={18} /> {t.dateFilter}
            </div>
            <input
              type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
              style={{ background: theme.bg, color: theme.text, border: `1px solid ${theme.border}`, padding: '8px 12px', borderRadius: '8px', colorScheme: theme.mode === 'dark' ? 'dark' : 'light' }}
            />
            <span style={{ color: theme.textSub }}>~</span>
            <input
              type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
              style={{ background: theme.bg, color: theme.text, border: `1px solid ${theme.border}`, padding: '8px 12px', borderRadius: '8px', colorScheme: theme.mode === 'dark' ? 'dark' : 'light' }}
            />
            {(startDate || endDate) && (
              <button onClick={() => { setStartDate(""); setEndDate(""); }} style={{ background: 'transparent', border: 'none', color: theme.danger, cursor: 'pointer', fontWeight: 'bold', marginLeft: 'auto' }}>
                {t.reset}
              </button>
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {filteredScrims.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '60px', background: theme.surface, borderRadius: '12px', border: `1px dashed ${theme.border}`, color: theme.textSub }}>
                <p>{t.noData}</p>
              </div>
            ) : (
              filteredScrims.map((scrim) => {
                const isChecked = selectedIds.has(scrim.id);
                return (
                  <div
                    key={scrim.id}
                    onClick={() => isSelectMode ? toggleSelect(scrim.id) : onSelectScrim(scrim.id)}
                    style={{
                      background: isChecked ? `${theme.danger || '#ef4444'}12` : theme.surface,
                      border: `1px solid ${isChecked ? (theme.danger || '#ef4444') : theme.border}`,
                      borderRadius: '12px', padding: '24px', cursor: 'pointer',
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      transition: 'background 0.15s, border-color 0.15s',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                      {isSelectMode && (
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleSelect(scrim.id)}
                          onClick={e => e.stopPropagation()}
                          style={{ width: '18px', height: '18px', accentColor: theme.danger || '#ef4444', cursor: 'pointer', flexShrink: 0 }}
                        />
                      )}
                      <div>
                        <h3 style={{ fontSize: '18px', fontWeight: '700', marginBottom: '8px', color: theme.text }}>{scrim.scrim_name}</h3>
                        <div style={{ display: 'flex', gap: '16px', color: theme.textSub, fontSize: '13px' }}>
                          <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><Calendar size={14} /> {scrim.date}</span>
                          <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><Clock size={14} /> {t.matchCount.replace('{n}', scrim.matches ? scrim.matches.length : 0)}</span>
                        </div>
                      </div>
                    </div>
                    {!isSelectMode && <ChevronRight size={20} color={theme.textSub} />}
                  </div>
                );
              })
            )}
          </div>
        </>
      )}

      <style>{`
        .spin-anim { animation: spin 1s linear infinite; }
        @keyframes spin { 100% { transform: rotate(360deg); } }
        .ssc-cell { transition: border-color .13s, transform .13s, background .13s; }
        .ssc-cell.in:hover { border-color: var(--ssc-bh); transform: translateY(-1px); }
        .ssc-navbtn { transition: background .13s, border-color .13s; }
        .ssc-navbtn:hover { background: var(--ssc-bh); border-color: var(--ssc-bh); }
        .ssc-chip { transition: filter .13s; }
        .ssc-chip:hover { filter: brightness(1.18); }
        .ssc-poprow { transition: background .12s; }
        .ssc-poprow:hover, .ssc-poprow:active { background: var(--ssc-bh); }
      `}</style>
    </div>
  );
};

export default ScrimSessions;
