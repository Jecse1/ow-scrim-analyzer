// 스킬 분석 탭 — 선수 → 영웅 → 스킬을 고르면 그 스킬을 쓴 장면 전부를 VOD 링크로 보여 준다(장면 찾기 전용).
// 효율·적중·연계 지표는 만들지 않는다. 상단 숫자는 사용 횟수·10분당 사용 수 두 개뿐.
// 데이터: /api/abilities/options(선택지, fetchCached 공유) · /api/abilities/scenes(장면 100행 페이지, 브라우저 ETag 재검증).
// VOD 링크는 기존 buildVideoLink 그대로(utils/skillScenes.sceneVodUrl) — 리드 보정 추가 없음.
import React, { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { Calendar, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Info, PlayCircle, SlidersHorizontal, Sparkles } from "lucide-react";
import { useTheme } from "./ThemeContext";
import { useLanguage } from "./LanguageContext";
import { useIsMobile, ScrollX } from "./utils/responsive";
import { fetchCached } from "./utils/apiCache";
import { useVod, vodClickProps } from "./VodPlayerContext";
import { getDisplayName, getMapDisplayName, canonicalMapName, getHeroImageSrc } from "./gameData";
import { tpl } from "./FightLabStats";
import { scenesQuery, skillLabel, fmtClock, fmtPlayTime, sceneVodUrl, splitPlayers, pickStep, currentStep, activeFilterCount, visibleHeroes, withMatchHeads } from "./utils/skillScenes";

const API_BASE = "";

export default function SkillScenesStats() {
  const { theme } = useTheme();
  const { t, language } = useLanguage();
  const { openVod } = useVod();
  const isMobile = useIsMobile();

  const [options, setOptions] = useState(null);
  const [optError, setOptError] = useState(false);
  const [scrims, setScrims] = useState([]);
  const [f, setF] = useState({ player: "", hero: "", slot: "", dateFrom: "", dateTo: "", opponent: "", map: "", group: false, sort: "date_desc", page: 1 });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);   // 모바일 보조 필터 접기(데스크톱은 항상 펼침)
  const [heroesExpanded, setHeroesExpanded] = useState(false);   // 1분 미만 영웅 카드 펼침
  const reqSeq = useRef(0);

  useEffect(() => {
    let alive = true;
    fetchCached(`${API_BASE}/api/abilities/options`).then((d) => { if (alive) setOptions(d); }).catch(() => { if (alive) setOptError(true); });
    fetchCached(`${API_BASE}/api/scrims`).then((d) => { if (alive) setScrims(d || []); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  const playerEntry = useMemo(() => (options?.players || []).find((p) => p.name === f.player) || null, [options, f.player]);
  const { ours, others } = useMemo(() => splitPlayers(options?.players), [options]);

  // 상대팀·맵 선택지 — /api/scrims(경량, 다른 탭과 공유)에서
  const { teams, maps } = useMemo(() => {
    const ts = new Set(), ms = new Set();
    for (const s of scrims) for (const m of s.matches || []) {
      if (m.team1_name) ts.add(m.team1_name);
      if (m.team2_name) ts.add(m.team2_name);
      if (m.map_name) ms.add(canonicalMapName(m.map_name));
    }
    return { teams: [...ts].sort((a, b) => a.localeCompare(b)), maps: [...ms].sort((a, b) => getMapDisplayName(a).localeCompare(getMapDisplayName(b))) };
  }, [scrims]);

  const set = (patch) => setF((prev) => ({ ...prev, page: 1, ...patch }));
  // 선수 → 최다 플레이 영웅 + 스킬1, 영웅 → 스킬1 자동 선택(utils/skillScenes pickStep)
  const pick = (key, value) => {
    const top = key === "player" ? (options?.players || []).find((x) => x.name === value)?.heroes?.[0]?.hero : undefined;
    if (key === "player") setHeroesExpanded(false);
    setF((prev) => pickStep(prev, key, value, top));
  };

  const ready = f.player && f.hero && f.slot;
  useEffect(() => {
    if (!ready) { setData(null); return; }
    const seq = ++reqSeq.current;
    setLoading(true);
    axios.get(`${API_BASE}/api/abilities/scenes?${scenesQuery(f)}`)
      .then((r) => { if (seq === reqSeq.current) setData(r.data); })
      .catch(() => { if (seq === reqSeq.current) setData(null); })
      .finally(() => { if (seq === reqSeq.current) setLoading(false); });
  }, [ready, f]);

  const heroSkills = options?.hero_skills || {};
  const card = { background: theme.surface, border: `1px solid ${theme.border}`, borderRadius: 14, padding: isMobile ? 14 : 18 };
  const ctl = { background: theme.bg, color: theme.text, border: `1px solid ${theme.border}`, padding: "8px 10px", borderRadius: 8, minHeight: 38, colorScheme: theme.mode === "dark" ? "dark" : "light" };
  const cellPad = isMobile ? "8px 6px" : "8px 12px";
  const label = { fontSize: 12, fontWeight: 700, color: theme.textSub, marginBottom: 4 };
  // 1단(주 선택) — 크게
  const section = (lbl, node) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}><span style={{ ...label, marginBottom: 0 }}>{lbl}</span>{node}</div>
  );
  const hint = { fontSize: 13, color: theme.textSub, padding: "10px 12px", border: `1px dashed ${theme.border}`, borderRadius: 10, background: theme.bg };
  const choice = (on, enabled = true) => ({
    background: on ? theme.surfaceHighlight : theme.bg, color: theme.text, border: `2px solid ${on ? theme.primary : theme.border}`,
    borderRadius: 10, cursor: enabled ? "pointer" : "default", opacity: enabled ? 1 : 0.45,
  });
  // 2단(보조 필터) — 작게 한 줄, 라벨·컨트롤 높이 통일
  const ctlSm = { ...ctl, padding: "4px 8px", minHeight: 32, height: 32, fontSize: 12, boxSizing: "border-box" };
  const small = (lbl, node) => (
    <label style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 32, fontSize: 12, fontWeight: 700, color: theme.textSub }}>
      <span style={{ whiteSpace: "nowrap", display: "inline-flex", alignItems: "center", gap: 4 }}>{lbl}</span>{node}
    </label>
  );

  if (optError) return <div style={{ padding: 40, textAlign: "center", color: theme.textSub }}>{t.skLoadFail}</div>;
  if (!options) return <div style={{ padding: 40, textAlign: "center", color: theme.textSub }}>{t.loading}</div>;

  const summary = data?.summary;
  const nCols = f.group ? 4 : 3;   // 라운드 · 게임 시간 · (횟수) · VOD
  const rows = data?.rows || [];
  const meta = data?.meta;

  return (
    <div style={{ maxWidth: 1400, margin: "0 auto", padding: isMobile ? 16 : 24, color: theme.text, display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 900, display: "flex", alignItems: "center", gap: 8 }}><Sparkles size={20} /> {t.navSkillScenes}</h2>
        <p style={{ margin: "6px 0 0", fontSize: 13, color: theme.textSub }}>{t.skIntro}</p>
      </div>

      <div style={{ ...card, display: "flex", flexDirection: "column", gap: 16 }}>
        {section(t.skPlayer, (
          <select value={f.player} onChange={(e) => pick("player", e.target.value)} aria-label={t.skPlayer}
            style={{ ...ctl, fontSize: 15, minHeight: 44, width: isMobile ? "100%" : 420, maxWidth: "100%" }}>
            <option value="">{t.skPickPlayer}</option>
            {ours.length > 0 && <optgroup label={t.skOurs}>{ours.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}</optgroup>}
            {others.length > 0 && <optgroup label={t.skOthers}>{others.map((p) => <option key={p.name} value={p.name}>{p.name}{p.teams.length ? ` · ${p.teams.join("/")}` : ""}</option>)}</optgroup>}
          </select>))}

        {section(t.skHero, !playerEntry ? (
          <div style={hint}>{t.skPickPlayerFirst}</div>
        ) : (
          <ScrollX isMobile={isMobile} fade={theme.surface}>
            {/* 영웅 카드: 서버 options 순서 = 플레이 시간 내림차순 */}
            <div role="group" aria-label={t.skHero} style={{ display: "flex", gap: 8, flexWrap: isMobile ? "nowrap" : "wrap", paddingBottom: isMobile ? 4 : 0 }}>
              {(() => {
                const { shown, hidden } = visibleHeroes(playerEntry.heroes, f.hero, heroesExpanded);
                const more = hidden > 0 || heroesExpanded;
                return [...shown.map((h) => {
                const on = f.hero === h.hero;
                return (
                  <button key={h.hero} type="button" aria-pressed={on} onClick={() => pick("hero", h.hero)} title={getDisplayName(h.hero)}
                    style={{ ...choice(on), width: 88, flexShrink: 0, padding: "8px 6px", display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                    <span style={{ width: 52, height: 52, borderRadius: 8, overflow: "hidden", background: theme.surfaceHighlight, display: "block" }}>
                      <img src={getHeroImageSrc(h.hero)} alt="" width={52} height={52} style={{ display: "block", objectFit: "cover" }} onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} />
                    </span>
                    <span style={{ fontSize: 12, fontWeight: 700, maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{getDisplayName(h.hero)}</span>
                    <span style={{ fontSize: 11, color: theme.textSub, fontVariantNumeric: "tabular-nums" }}>{fmtPlayTime(h.seconds)}</span>
                  </button>
                );
                }), more && (
                  <button key="__more" type="button" aria-expanded={heroesExpanded} onClick={() => setHeroesExpanded((v) => !v)}
                    style={{ ...choice(false), width: 88, flexShrink: 0, padding: "8px 6px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, borderStyle: "dashed" }}>
                    <span style={{ fontSize: 16, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{heroesExpanded ? <ChevronUp size={18} /> : `+${hidden}`}</span>
                    <span style={{ fontSize: 11, color: theme.textSub }}>{heroesExpanded ? t.skCollapse : t.skHeroUnder1m}</span>
                  </button>
                )];
              })()}
            </div>
          </ScrollX>
        ))}

        {section(t.skSkill, (
          <div role="group" aria-label={t.skSkill} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {[1, 2].map((s) => {
              const he = playerEntry?.heroes?.find((h) => h.hero === f.hero);
              const on = !!he && f.slot === s;
              return (
                <button key={s} type="button" aria-pressed={on} disabled={!he} onClick={() => pick("slot", s)}
                  style={{ ...choice(on, !!he), minHeight: 44, padding: "8px 16px", fontSize: 14, fontWeight: 700, flex: isMobile ? "1 1 0" : "0 0 auto", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                  <span>{skillLabel(heroSkills, f.hero, s, language, t)}</span>
                  {he && <span style={{ fontSize: 11, fontWeight: 600, color: theme.textSub, fontVariantNumeric: "tabular-nums" }}>{tpl(t.skUsesTpl, { n: (s === 1 ? he.uses1 : he.uses2).toLocaleString() })}</span>}
                </button>
              );
            })}
          </div>
        ))}

        <div style={{ borderTop: `1px solid ${theme.border}`, paddingTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
          {isMobile && (
            <button type="button" aria-label={t.skFilters} aria-expanded={filtersOpen} onClick={() => setFiltersOpen((v) => !v)}
              style={{ ...ctlSm, alignSelf: "flex-start", display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer", fontWeight: 700 }}>
              <SlidersHorizontal size={14} /> {t.skFilters}
              {activeFilterCount(f) > 0 && <span style={{ color: theme.primary }}>{activeFilterCount(f)}</span>}
              {filtersOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
          )}
          {(!isMobile || filtersOpen) && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: isMobile ? 8 : "8px 16px", alignItems: "center" }}>
              {small(<><Calendar size={12} /> {t.dateFilter}</>, (
                <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
                  <input type="date" value={f.dateFrom} onChange={(e) => set({ dateFrom: e.target.value })} style={{ ...ctlSm, width: 132 }} aria-label={t.startDate} />
                  <span>~</span>
                  <input type="date" value={f.dateTo} onChange={(e) => set({ dateTo: e.target.value })} style={{ ...ctlSm, width: 132 }} aria-label={t.endDate} />
                </span>))}
              {small(t.skOpponent, (
                <select value={f.opponent} onChange={(e) => set({ opponent: e.target.value })} style={ctlSm}>
                  <option value="">{t.skAll}</option>
                  {teams.map((tm) => <option key={tm} value={tm}>{tm}</option>)}
                </select>))}
              {small(t.skMap, (
                <select value={f.map} onChange={(e) => set({ map: e.target.value })} style={ctlSm}>
                  <option value="">{t.skAll}</option>
                  {maps.map((m) => <option key={m} value={m}>{getMapDisplayName(m)}</option>)}
                </select>))}
              {small(t.skSort, (
                <select value={f.sort} onChange={(e) => set({ sort: e.target.value })} style={ctlSm}>
                  <option value="date_desc">{t.skSortNewest}</option>
                  <option value="date_asc">{t.skSortOldest}</option>
                </select>))}
              <label style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 32, fontSize: 12, fontWeight: 700, color: theme.text, cursor: "pointer" }}>
                <input type="checkbox" checked={f.group} onChange={(e) => set({ group: e.target.checked })} /> {t.skGroupToggle}
              </label>
            </div>
          )}
        </div>
      </div>

      {!ready ? (
        <div style={{ ...card, padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, fontSize: 13, color: theme.textSub, flexWrap: "wrap" }}>
          {!options.players.length ? t.skNoData : (() => {
            // 단계 안내: 1. 선수 › 2. 영웅 › 3. 스킬 — 지금 단계 강조
            const cur = currentStep(f);
            const steps = [["player", t.skPlayer], ["hero", t.skHero], ["slot", t.skSkill]];
            const curIdx = steps.findIndex(([k]) => k === cur);
            const msg = { player: t.skPickPlayer, hero: t.skPickHeroNext, slot: t.skPickSkillNext }[cur];
            return (
              <>
                {steps.map(([k, lbl], i) => (
                  <React.Fragment key={k}>
                    {i > 0 && <ChevronRight size={12} />}
                    <span style={{ fontWeight: i === curIdx ? 800 : 600, color: i === curIdx ? theme.primary : i < curIdx ? theme.text : theme.textSub }}>{`${i + 1}. ${lbl}`}</span>
                  </React.Fragment>
                ))}
                <span style={{ marginLeft: 6 }}>— {msg}</span>
              </>
            );
          })()}
        </div>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(2, minmax(0, 220px))", gap: 10 }}>
            <div style={{ ...card, padding: "10px 14px" }}>
              <div style={label}>{t.skUses}</div>
              <div style={{ fontSize: 20, fontWeight: 900, fontVariantNumeric: "tabular-nums" }}>{summary ? summary.uses.toLocaleString() : "-"}</div>
            </div>
            <div style={{ ...card, padding: "10px 14px" }}>
              <div style={label}>{t.skPer10}</div>
              <div style={{ fontSize: 20, fontWeight: 900, fontVariantNumeric: "tabular-nums" }}>{summary?.per10 != null ? summary.per10.toFixed(1) : "-"}</div>
              {summary?.hero_seconds != null && <div style={{ fontSize: 11, color: theme.textSub, marginTop: 2 }}>{tpl(t.skPlayTimeNote, { time: fmtPlayTime(summary.hero_seconds) })}</div>}
            </div>
          </div>
          {summary?.no_log_matches > 0 && (
            <div style={{ fontSize: 12, color: theme.textSub }}>{tpl(t.skNoLog, { n: summary.no_log_matches })}</div>
          )}

          <div style={{ ...card, padding: 0, overflow: "hidden" }}>
            <ScrollX isMobile={isMobile} fade={theme.surface}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: isMobile ? 12 : 13, minWidth: isMobile ? 0 : 640 }}>
                <thead>
                  <tr style={{ background: theme.surfaceHighlight, color: theme.textSub, textAlign: "left" }}>
                    {[t.skColRound, t.skColTime, ...(f.group ? [t.skColCount] : []), t.skColVod].map((h) => (
                      <th key={h} style={{ padding: cellPad, fontWeight: 700, whiteSpace: "nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 && (
                    <tr><td colSpan={nCols} style={{ padding: 32, textAlign: "center", color: theme.textSub }}>{loading ? t.loading : t.skEmpty}</td></tr>
                  )}
                  {withMatchHeads(rows).map((x) => {
                    if (x.head) {
                      // 매치 머리줄: 날짜 · 세션 · 맵 #n — 이 매치 사용 수(서버 matches[id].uses, 페이지·묶기와 무관)
                      const m = data.matches[x.match_id] || {};
                      return (
                        <tr key={x.key} style={{ borderTop: `1px solid ${theme.border}`, background: theme.bg }}>
                          <td colSpan={nCols} style={{ padding: cellPad }}>
                            <span style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                              <span style={{ fontWeight: 800 }}>{[m.date, m.scrim_name, `${getMapDisplayName(m.map_name)} #${m.match_index}`].filter(Boolean).join(" · ")}</span>
                              {m.uses != null && <span style={{ fontSize: 12, color: theme.textSub, fontVariantNumeric: "tabular-nums" }}>{t.skUses} {m.uses.toLocaleString()}</span>}
                            </span>
                          </td>
                        </tr>
                      );
                    }
                    const { row: r, i } = x;
                    const m = data.matches[r.match_id] || {};
                    const url = sceneVodUrl(m, r);
                    const mapLabel = `${getMapDisplayName(m.map_name)} #${m.match_index}`;
                    return (
                      <tr key={`${r.match_id}-${r.game_time}-${i}`} style={{ borderTop: `1px solid ${theme.border}` }}>
                        <td style={{ padding: cellPad, whiteSpace: "nowrap" }}>{r.round_no ? tpl(t.skRoundTpl, { n: r.round_no }) : "-"}</td>
                        <td style={{ padding: cellPad, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
                          {fmtClock(r.game_time)}{r.count > 1 ? ` ~ ${fmtClock(r.last_game_time)}` : ""}
                          {r.is_setup && <span style={{ marginLeft: 6, fontSize: 11, padding: "1px 6px", borderRadius: 6, border: `1px solid ${theme.borderHighlight}`, color: theme.textSub }}>{t.skSetup}</span>}
                        </td>
                        {f.group && <td style={{ padding: cellPad, fontWeight: 700 }}>×{r.count}</td>}
                        <td style={{ padding: cellPad, whiteSpace: "nowrap" }}>
                          {url ? (
                            <a href={url} target="_blank" rel="noopener noreferrer" {...vodClickProps(openVod, url, `${mapLabel} · ${fmtClock(r.game_time)}`)}
                              style={{ color: theme.primary, fontWeight: 700, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4 }}>
                              <PlayCircle size={14} /> VOD
                            </a>
                          ) : <span style={{ color: theme.textSub }}>{t.skNoVideo}</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </ScrollX>
          </div>

          {meta && meta.pages > 1 && (
            <div style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "center" }}>
              <button disabled={f.page <= 1} onClick={() => setF((p) => ({ ...p, page: p.page - 1 }))} style={{ ...ctl, cursor: f.page <= 1 ? "default" : "pointer", opacity: f.page <= 1 ? 0.5 : 1 }} aria-label={t.skPrev}><ChevronLeft size={16} /></button>
              <span style={{ fontSize: 13, color: theme.textSub }}>{tpl(t.skPageTpl, { page: meta.page, pages: meta.pages, total: meta.total_rows.toLocaleString() })}</span>
              <button disabled={f.page >= meta.pages} onClick={() => setF((p) => ({ ...p, page: p.page + 1 }))} style={{ ...ctl, cursor: f.page >= meta.pages ? "default" : "pointer", opacity: f.page >= meta.pages ? 0.5 : 1 }} aria-label={t.skNext}><ChevronRight size={16} /></button>
            </div>
          )}
        </>
      )}

      <div style={{ fontSize: 12, color: theme.textSub, display: "flex", gap: 6, alignItems: "flex-start" }}>
        <Info size={14} style={{ flexShrink: 0, marginTop: 1 }} /> <span>{t.skKeyHint}</span>
      </div>
    </div>
  );
}
