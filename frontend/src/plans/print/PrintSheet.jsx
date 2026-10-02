// PrintSheet.jsx — 대회장 인쇄용 치트시트(view "plan-print"). 그림 전용: 조건·밴·픽 타일만.
// 글자는 두 곳뿐(상단 보드명+날짜, 맵 이미지 아래 맵명). 영웅명은 토글(기본 OFF).
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

const COND_KIND = { enemy_ban: "pp-c-eban", our_ban: "pp-c-oban", enemy_pick: "pp-c-epick", our_pick: "pp-c-opick", etc: "pp-c-etc" };
const COND_BAN = { enemy_ban: "red", our_ban: "orange" };
const EMPTY5 = [null, null, null, null, null];

// 맵 id(밴픽 id) → 정본 ko 맵명. resolveMapEntry 가 id 를 직접 인식하지 못하므로
// BANPICK_MAPS 의 ko 표기(name)를 거쳐 getMapDisplayName(ko)로 통일.
const mapKoName = (mapId) => {
  const bp = BANPICK_MAPS.find((m) => m.id === mapId);
  return getMapDisplayName(bp ? bp.name : mapId, "ko");
};

// A4 가용 높이 ≈ 277mm. 2열 그리드 — 블록을 2개씩 묶어 그리드 행 높이(둘 중 큰 값) 합으로 근사.
// 한 열 폭 92mm 에 조건행(타일 7개=조건+밴+픽5)이 들어가도록 타일 상한 min(14/10mm, (92-14)/7).
function estimatePages(blocks, dense) {
  const colw = 92;
  const tile = Math.min(dense ? 10 : 14, (colw - 14) / 7);
  const rowGap = dense ? 0.8 : 2;
  const blockOver = dense ? 4 : 5;        // margin+padding
  const mapTop = (30 * 9) / 16 + 4;       // 이미지(30mm 폭)+맵명 ≈ 20.9mm
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
  const [blocks, setBlocks] = useState([]); // [{mapRow, rows}]
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

  // 파일명 <보드명>_<YYMMDD>: 인쇄 시 브라우저 저장 기본값에 반영
  const printSheet = () => {
    const prev = document.title;
    if (board) { const d = new Date(); const yy = String(d.getFullYear()).slice(2); document.title = `${board.name}_${yy}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`; }
    window.print();
    setTimeout(() => { document.title = prev; }, 500);
  };

  // 영웅/빈칸 타일
  const Tile = ({ heroId, kindClass, ban, q, roleIdx }) => (
    <span className={"pp-tile" + (kindClass ? " " + kindClass : "") + (heroId ? "" : " empty")}>
      {heroId ? <HeroThumb id={heroId} /> : q ? <span className="pp-q">?</span> : roleIdx != null ? <span className="pp-roleicon"><RoleIcon role={SLOT_ROLES[roleIdx]} lang={language} /></span> : null}
      {ban && (mono ? <span className="pp-xmark">✕</span> : <span className={"pp-slash " + ban} />)}
    </span>
  );

  // 픽 타일(영웅명 토글 시 아래 이름)
  const Pick = ({ heroId, roleIdx }) => (
    names
      ? <span className="pp-cell"><Tile heroId={heroId} roleIdx={roleIdx} />{heroId && <span className="pp-name">{heroName(heroId, language)}</span>}</span>
      : <Tile heroId={heroId} roleIdx={roleIdx} />
  );

  const Arrow = () => (
    <span className="pp-arrow" aria-hidden="true">
      <svg viewBox="0 0 60 16" preserveAspectRatio="none"><line x1="2" y1="8" x2="50" y2="8" stroke="currentColor" strokeWidth="1.2" /><polyline points="46,4 52,8 46,12" fill="none" stroke="currentColor" strokeWidth="1.2" /></svg>
    </span>
  );

  const Picks = ({ slots }) => <span className="pp-picks">{(slots || EMPTY5).map((h, i) => <Pick key={i} heroId={h} roleIdx={i} />)}</span>;

  const Row = ({ row }) => {
    const primary = row.comps && row.comps[0];
    const alt = row.comps && row.comps[1];
    if (row.kind === "base") {
      return (
        <div className="pp-row">
          <span className="pp-lead-cond" /><Arrow />
          <Picks slots={primary && primary.slots} />
        </div>
      );
    }
    const kindClass = COND_KIND[row.condType] || COND_KIND.etc;
    const condBan = COND_BAN[row.condType] || null;
    const ourBan = row.ourBans && row.ourBans[0];
    return (
      <>
        <div className="pp-row">
          <Tile heroId={row.heroId} kindClass={kindClass} ban={condBan} q={!row.heroId} />
          <Arrow />
          {ourBan ? <Tile heroId={ourBan.heroId} kindClass="pp-c-oban" ban="orange" q={!ourBan.heroId} /> : <span className="pp-blank" />}
          <Arrow />
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

      {loaded && (
        <div className="pp-pageinfo noprint">{t.estPages ? t.estPages(pages) : `예상 ${pages}장`}</div>
      )}
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
