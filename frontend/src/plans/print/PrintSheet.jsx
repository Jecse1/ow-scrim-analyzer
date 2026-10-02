// PrintSheet.jsx — 대회장 인쇄용 치트시트(view "plan-print"). 그림 전용, 2열.
// 행 = [선픽 조건] → [밴①] → [밴②] → [픽5]. 밴 순서는 computeBanOrder(연결 순서)로 결정, 캔버스와 일치.
// 밴 타일 ①/② 원형 배지, 우리=주황·상대=빨강(색으로 구분). 글자는 상단 보드명+날짜, 맵명뿐(영웅명 토글 기본 OFF).
import React, { useEffect, useMemo, useState } from "react";
import { ChevronLeft, Printer } from "lucide-react";
import { useLanguage } from "../../LanguageContext";
import { useTheme } from "../../ThemeContext";
import { getMapDisplayName, BANPICK_MAPS } from "../../gameData";
import { HeroThumb, MapThumb, RoleIcon } from "../../shared/heroMapAssets";
import { plansApi } from "../api";
import { planT } from "../i18n";
import { SLOT_ROLES } from "../canvas/constants";
import { heroName } from "../canvas/heroUtil";
import { extractSheet } from "./extract";
import "../plans.css";
import "./print.css";

const EMPTY5 = [null, null, null, null, null];
const BADGE = { 1: "1", 2: "2" };

const mapKoName = (mapId) => {
  const bp = BANPICK_MAPS.find((m) => m.id === mapId);
  return getMapDisplayName(bp ? bp.name : mapId, "ko");
};

// A4 가용 높이 ≈ 277mm. 2열 그리드. 타일 상한: 열 폭 92mm, 최대 8타일(선픽1+밴2+픽5) → (92-18)/8.
function estimatePages(blocks, dense) {
  const colw = 92;
  const tile = dense ? 8 : Math.min(14, (colw - 18) / 8);
  const rowGap = dense ? 0.8 : 2;
  const blockOver = dense ? 4 : 5;
  const mapTop = (30 * 9) / 16 + 4;
  const top = 7, gridGap = 2;
  const H = blocks.map((b) => {
    const vr = b.rows.reduce((s, r) => s + 1 + (r.comps && r.comps[1] ? 1 : 0), 0);
    return mapTop + vr * (tile + rowGap) + blockOver;
  });
  let h = top;
  for (let i = 0; i < H.length; i += 2) h += Math.max(H[i], H[i + 1] || 0) + gridGap;
  return Math.max(1, Math.ceil(h / 277));
}

export default function PrintSheet({ boardId, onBack }) {
  const { language } = useLanguage();
  const { isDarkMode: dark } = useTheme();
  const t = planT(language);
  const [board, setBoard] = useState(null);
  const [blocks, setBlocks] = useState([]);
  const [opts, setOpts] = useState({ maps: null, density: "normal", names: false, mono: false });
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
          data.push({ mapRow: m, rows: ex.rows });
        } catch { data.push({ mapRow: m, rows: [] }); }
      }
      if (!alive) return;
      setBlocks(data);
      setOpts((o) => ({ ...o, maps: Object.fromEntries(maps.map((m) => [m.id, true])) }));
      setLoaded(true);
    })();
    return () => { alive = false; };
  }, [boardId]);

  const selected = useMemo(() => blocks.filter((b) => opts.maps && opts.maps[b.mapRow.id]), [blocks, opts.maps]);
  const { names, mono } = opts, dense = opts.density === "dense";
  const today = useMemo(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }, []);
  const pages = useMemo(() => estimatePages(selected, dense), [selected, dense]);

  const printSheet = () => {
    const prev = document.title;
    if (board) { const d = new Date(); const yy = String(d.getFullYear()).slice(2); document.title = `${board.name}_${yy}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`; }
    window.print();
    setTimeout(() => { document.title = prev; }, 500);
  };

  // ── 타일들 ──
  const Portrait = ({ heroId, roleIdx }) => (
    heroId ? <HeroThumb id={heroId} /> : (roleIdx != null ? <span className="pp-roleicon"><RoleIcon role={SLOT_ROLES[roleIdx]} lang={language} /></span> : <span className="pp-q">?</span>)
  );
  const BanTile = ({ ban }) => (
    <span className={"pp-tile " + (ban.side === "ours" ? "pp-c-oban" : "pp-c-eban")}>
      {ban.hero ? <HeroThumb id={ban.hero} /> : <span className="pp-q">?</span>}
      {mono ? <span className="pp-xmark">✕</span> : <span className={"pp-slash " + (ban.side === "ours" ? "orange" : "red")} />}
      <span className="pp-badge">{BADGE[ban.order] || ban.order}</span>
    </span>
  );
  const PickCondTile = ({ pc }) => (
    <span className={"pp-tile " + (pc.side === "ours" ? "pp-c-opick" : "pp-c-epick")}>
      {pc.hero ? <HeroThumb id={pc.hero} /> : <span className="pp-q">?</span>}
    </span>
  );
  const Pick = ({ heroId, roleIdx }) => (
    names
      ? <span className="pp-cell"><span className="pp-tile">{<Portrait heroId={heroId} roleIdx={roleIdx} />}</span>{heroId && <span className="pp-name">{heroName(heroId, language)}</span>}</span>
      : <span className="pp-tile">{<Portrait heroId={heroId} roleIdx={roleIdx} />}</span>
  );
  const Picks = ({ slots }) => <span className="pp-picks">{(slots || EMPTY5).map((h, i) => <Pick key={i} heroId={h} roleIdx={i} />)}</span>;
  const Arrow = ({ on }) => on
    ? <span className="pp-arrow" aria-hidden="true"><svg viewBox="0 0 60 16" preserveAspectRatio="none"><line x1="2" y1="8" x2="50" y2="8" stroke="currentColor" strokeWidth="1.2" /><polyline points="46,4 52,8 46,12" fill="none" stroke="currentColor" strokeWidth="1.2" /></svg></span>
    : <span className="pp-arrow-blank" />;

  const Row = ({ row }) => {
    const primary = row.comps && row.comps[0];
    const alt = row.comps && row.comps[1];
    const pc = row.pickCond;
    const ban1 = row.bans && row.bans.find((b) => b.order === 1);
    const ban2 = row.bans && row.bans.find((b) => b.order === 2);
    const anyLead = !!(pc || ban1 || ban2);
    return (
      <>
        <div className="pp-row">
          {pc ? <PickCondTile pc={pc} /> : <span className="pp-blank" />}
          <Arrow on={!!(pc && ban1)} />
          {ban1 ? <BanTile ban={ban1} /> : <span className="pp-blank" />}
          <Arrow on={!!(ban1 && ban2)} />
          {ban2 ? <BanTile ban={ban2} /> : <span className="pp-blank" />}
          <Arrow on={anyLead} />
          <Picks slots={primary && primary.slots} />
        </div>
        {alt && (
          <div className="pp-row pp-altrow">
            <span className="pp-lead-full" />
            <Picks slots={alt.slots} />
          </div>
        )}
      </>
    );
  };

  return (
    <div className={"plan-root plan-print-root " + (dark ? "" : "light")}>
      <div className="pp-toolbar noprint">
        <button className="pp-back" onClick={onBack}><ChevronLeft size={16} />{board ? board.name : (t.back || "")}</button>
        <button className="pp-print" onClick={printSheet}><Printer size={15} /> {t.print || "인쇄"}</button>
      </div>

      <div className="pp-options noprint">
        <div className="pp-opt-group">
          <span className="pp-opt-label">{t.maps}</span>
          {blocks.map((b) => (
            <label key={b.mapRow.id} className="pp-check"><input type="checkbox" checked={!!(opts.maps && opts.maps[b.mapRow.id])} onChange={(e) => setOpts((o) => ({ ...o, maps: { ...o.maps, [b.mapRow.id]: e.target.checked } }))} /> {mapKoName(b.mapRow.map_id)}</label>
          ))}
        </div>
        <div className="pp-opt-group">
          <span className="pp-opt-label">{t.density || "밀도"}</span>
          <label className="pp-check"><input type="radio" name="den" checked={!dense} onChange={() => setOpts((o) => ({ ...o, density: "normal" }))} /> {t.normal || "보통"}</label>
          <label className="pp-check"><input type="radio" name="den" checked={dense} onChange={() => setOpts((o) => ({ ...o, density: "dense" }))} /> {t.dense || "조밀"}</label>
        </div>
        <div className="pp-opt-group">
          <label className="pp-check"><input type="checkbox" checked={names} onChange={(e) => setOpts((o) => ({ ...o, names: e.target.checked }))} /> {t.heroNames || "영웅명"}</label>
          <label className="pp-check"><input type="checkbox" checked={mono} onChange={(e) => setOpts((o) => ({ ...o, mono: e.target.checked }))} /> {t.mono || "흑백 친화"}</label>
        </div>
      </div>

      {loaded && (<div className="pp-pageinfo noprint">{t.estPages ? t.estPages(pages) : `예상 ${pages}장`}</div>)}
      {loaded && pages > 2 && <div className="pp-warn noprint">{(t.pageWarn ? t.pageWarn(pages) : `${pages}장`)} — {t.pageWarnHint || "조밀 모드 또는 맵 수 줄이기"}</div>}

      <div className={"pp-sheet" + (dense ? " dense" : "") + (mono ? " mono" : "")}>
        <div className="pp-top">
          <span className="pp-top-name">{board ? board.name : ""}</span>
          <span className="pp-top-date">{today}</span>
        </div>
        <div className="pp-blocks">
          {selected.map((b) => (
            <div className="pp-block" key={b.mapRow.id}>
              <div className="pp-mapcol">
                <div className="pp-maptile"><MapThumb id={b.mapRow.map_id} /></div>
                <div className="pp-mapname">{mapKoName(b.mapRow.map_id)}</div>
              </div>
              <div className="pp-rows">
                {b.rows.map((row, i) => <Row key={i} row={row} />)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
