// PrintSheet.jsx — 대회장 인쇄용 치트시트(view "plan-print"). 옵션 패널 + 미리보기(실제 인쇄 CSS 동일) + window.print.
import React, { useEffect, useMemo, useState } from "react";
import { ChevronLeft, Printer } from "lucide-react";
import { useLanguage } from "../../LanguageContext";
import { useTheme } from "../../ThemeContext";
import { getMapDisplayName, BANPICK_MAPS } from "../../gameData";
import { HeroThumb, MapThumb, MapTypeBadge } from "../../shared/heroMapAssets";
import { plansApi } from "../api";
import { planT } from "../i18n";
import { COND_TYPES, SLOT_ROLES } from "../canvas/constants";
import { heroName } from "../canvas/heroUtil";
import { extractSheet } from "./extract";
import "../plans.css";
import "./print.css";

const COND_ABBR = { enemy_ban: "상밴", our_ban: "우밴", enemy_pick: "상픽", our_pick: "우픽", etc: "기타" };
const mapTypeOf = (mapId) => (BANPICK_MAPS.find((m) => m.id === mapId) || {}).type || "Control";

// A4 세로 가용 높이(297 - 여백 20) ≈ 277mm 기준 블록 높이 합으로 페이지 수 근사.
function estimatePages(blocks, density) {
  const rowH = density === "dense" ? 10 : 14;
  const headH = 10, gap = 4, topH = 10;
  let h = topH;
  for (const b of blocks) h += headH + b.rows.length * rowH + gap;
  return Math.max(1, Math.ceil(h / 277));
}

export default function PrintSheet({ boardId, onBack }) {
  const { language } = useLanguage();
  const { isDarkMode: dark } = useTheme();
  const t = planT(language);
  const [board, setBoard] = useState(null);
  const [blocks, setBlocks] = useState([]); // [{mapRow, rows, excludedCount}]
  const [opts, setOpts] = useState({ maps: null, density: "normal", portraits: true, memo: true, mono: false, team: "" });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const boards = await plansApi.listBoards();
      const b = boards.find((x) => x.id === boardId) || null;
      if (!alive) return;
      setBoard(b);
      const maps = (b && b.maps) || [];
      const data = [];
      for (const m of maps) {
        try {
          const cv = await plansApi.getCanvas(m.id);
          const ex = extractSheet(cv.canvas || {});
          data.push({ mapRow: m, rows: ex.rows, excludedCount: ex.excludedCount });
        } catch { data.push({ mapRow: m, rows: [], excludedCount: 0 }); }
      }
      if (!alive) return;
      setBlocks(data);
      setOpts((o) => ({ ...o, maps: Object.fromEntries(maps.map((m) => [m.id, true])) }));
      setLoaded(true);
    })();
    return () => { alive = false; };
  }, [boardId]);

  const selected = useMemo(() => blocks.filter((b) => opts.maps && opts.maps[b.mapRow.id]), [blocks, opts.maps]);
  const mono = opts.mono, showPortrait = opts.portraits, dense = opts.density === "dense";
  const today = useMemo(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }, []);
  const pages = useMemo(() => estimatePages(selected, opts.density), [selected, opts.density]);

  const Portrait = ({ heroId, ban }) => (
    <span className="pp-port">
      {showPortrait ? <span className="pp-port-img"><HeroThumb id={heroId} />{ban && (mono ? <span className="pp-x">✕</span> : <span className="pp-ban" />)}</span> : null}
      <span className="pp-port-name">{heroName(heroId, language)}</span>
    </span>
  );

  const CondCell = ({ row }) => {
    if (row.kind === "base") return <span className="pp-cond"><b>{t.basePlan || "기본안"}</b></span>;
    const ct = COND_TYPES[row.condType] || COND_TYPES.etc;
    return (
      <span className="pp-cond">
        {mono ? <span className="pp-tag">[{COND_ABBR[row.condType] || "기타"}]</span> : <span className="pp-strip" style={{ background: ct.color }} />}
        <span className="pp-cond-body">
          {!mono && <span className="pp-cond-type" style={{ color: ct.color }}>{ct.label[language]}</span>}
          {row.heroId ? <Portrait heroId={row.heroId} /> : <span className="pp-text">{row.text}</span>}
        </span>
      </span>
    );
  };

  return (
    <div className={"plan-root plan-print-root " + (dark ? "" : "light")}>
      <div className="pp-toolbar noprint">
        <button className="pp-back" onClick={onBack}><ChevronLeft size={16} />{board ? board.name : (t.back || "")}</button>
        <button className="pp-print" onClick={() => window.print()}><Printer size={15} /> {t.print || "인쇄"}</button>
      </div>

      <div className="pp-options noprint">
        <div className="pp-opt-group">
          <span className="pp-opt-label">{t.maps}</span>
          {blocks.map((b) => (
            <label key={b.mapRow.id} className="pp-check"><input type="checkbox" checked={!!(opts.maps && opts.maps[b.mapRow.id])} onChange={(e) => setOpts((o) => ({ ...o, maps: { ...o.maps, [b.mapRow.id]: e.target.checked } }))} /> {getMapDisplayName(b.mapRow.map_id, language)}</label>
          ))}
        </div>
        <div className="pp-opt-group">
          <span className="pp-opt-label">{t.density || "밀도"}</span>
          <label className="pp-check"><input type="radio" name="den" checked={!dense} onChange={() => setOpts((o) => ({ ...o, density: "normal" }))} /> {t.normal || "보통"}</label>
          <label className="pp-check"><input type="radio" name="den" checked={dense} onChange={() => setOpts((o) => ({ ...o, density: "dense" }))} /> {t.dense || "조밀"}</label>
        </div>
        <div className="pp-opt-group">
          <label className="pp-check"><input type="checkbox" checked={showPortrait} onChange={(e) => setOpts((o) => ({ ...o, portraits: e.target.checked }))} /> {t.portraits || "초상화"}</label>
          <label className="pp-check"><input type="checkbox" checked={opts.memo} onChange={(e) => setOpts((o) => ({ ...o, memo: e.target.checked }))} /> {t.memoCol || "메모"}</label>
          <label className="pp-check"><input type="checkbox" checked={mono} onChange={(e) => setOpts((o) => ({ ...o, mono: e.target.checked }))} /> {t.mono || "흑백 친화"}</label>
        </div>
        <div className="pp-opt-group">
          <span className="pp-opt-label">{t.team || "팀"}</span>
          <input className="pp-team-input" value={opts.team} placeholder={t.team || "팀"} onChange={(e) => setOpts((o) => ({ ...o, team: e.target.value }))} />
        </div>
      </div>

      {loaded && pages > 2 && <div className="pp-warn noprint">{(t.pageWarn ? t.pageWarn(pages) : `${pages}장`)} — {t.pageWarnHint || "조밀 모드 또는 맵 수 줄이기"}</div>}

      <div className={"pp-sheet" + (dense ? " dense" : "") + (mono ? " mono" : "")}>
        <div className="pp-top">{[board && board.name, opts.team, today].filter(Boolean).join(" · ")}</div>
        {selected.map((b) => (
          <div className="pp-mapblock" key={b.mapRow.id}>
            <div className="pp-maphead">
              {!mono && <span className="pp-maphead-thumb"><MapThumb id={b.mapRow.map_id} /></span>}
              <MapTypeBadge type={mapTypeOf(b.mapRow.map_id)} lang={language} />
              <b>{getMapDisplayName(b.mapRow.map_id, language)}</b>
            </div>
            <table className="pp-table">
              <colgroup><col style={{ width: "22%" }} /><col style={{ width: "18%" }} /><col style={{ width: "40%" }} />{opts.memo && <col style={{ width: "20%" }} />}</colgroup>
              <thead><tr><th>{t.colCond || "조건"}</th><th>{t.colOurBan || "우리 밴"}</th><th>{t.colComp || "조합"}</th>{opts.memo && <th>{t.colMemo || "메모"}</th>}</tr></thead>
              <tbody>
                {b.rows.map((row, i) => (
                  <tr key={i}>
                    <td><CondCell row={row} /></td>
                    <td>{row.ourBans.map((x, k) => <span key={k} className="pp-ourban">{x.heroId ? <Portrait heroId={x.heroId} ban /> : <span className="pp-text">{x.text}</span>}</span>)}</td>
                    <td>
                      {row.comps.map((c, k) => (
                        <div key={k} className="pp-comp">
                          <span className="pp-comp-mark">{c.tag === "priority" ? (mono ? "★" : <span className="pp-dot" style={{ background: "#22c55e" }} />) : c.alt ? (mono ? "○" : <span className="pp-dot" style={{ background: "#3b82f6" }} />) : ""}{c.alt && (t.altLabel || "대안")}</span>
                          <span className="pp-comp-slots">{c.slots.map((hid, s) => <span key={s} className="pp-slot">{hid ? <Portrait heroId={hid} /> : <span className="pp-slot-empty">{SLOT_ROLES[s][0]}</span>}</span>)}</span>
                        </div>
                      ))}
                    </td>
                    {opts.memo && <td>{row.memos.map((m, k) => <div key={k} className="pp-memo"><b>{m.title}</b>{m.body && <div className="pp-memo-body">{m.body}</div>}</div>)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
            {b.excludedCount > 0 && <div className="pp-excluded noprint">{t.excluded ? t.excluded(b.excludedCount) : `미포함 ${b.excludedCount}개`}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
