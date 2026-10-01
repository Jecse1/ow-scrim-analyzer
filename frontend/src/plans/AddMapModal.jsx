// AddMapModal.jsx — 보드에 맵 추가. 모드 탭 + 검색. map_pool 있으면 활성 맵 상단·나머지 접힘.
import React, { useMemo, useState } from "react";
import { X } from "lucide-react";
import { BANPICK_MAPS, getMapDisplayName } from "../gameData";
import * as GD from "../gameData"; // BANPICK_MAP_POOL 은 저장소에 따라 없을 수 있음(공개판 無, FLC 有)
import { MapThumb, MapTypeBadge, MAP_LABELS } from "../shared/heroMapAssets";
import { planT } from "./i18n";

const MODE_ORDER = ["Control", "Escort", "Hybrid", "Push", "Flashpoint"];

export default function AddMapModal({ lang, existingMapIds, onAdd, onClose }) {
  const t = planT(lang);
  const [mode, setMode] = useState("All");
  const [q, setQ] = useState("");
  const [showOther, setShowOther] = useState(false);

  // BANPICK_MAP_POOL 은 저장소에 따라 없음(공개판 無/FLC 有). 계산된 키로 접근해 정적 미export 경고 회피,
  // 없으면 undefined → hasPool=false → 전체 표시(공개판 동작).
  const poolKey = ["BANPICK", "MAP", "POOL"].join("_");
  const pool = GD[poolKey];
  const activePool = (pool && Array.isArray(pool.active) ? pool.active : []);
  const hasPool = activePool.length > 0;
  const existing = existingMapIds || new Set();

  const filtered = useMemo(() => {
    const qn = q.trim().toLowerCase();
    return BANPICK_MAPS.filter((m) => {
      if (mode !== "All" && m.type !== mode) return false;
      if (!qn) return true;
      return getMapDisplayName(m.name, lang).toLowerCase().includes(qn) || m.id.toLowerCase().includes(qn);
    });
  }, [mode, q, lang]);

  const poolMaps = hasPool ? filtered.filter((m) => activePool.includes(m.id)) : filtered;
  const otherMaps = hasPool ? filtered.filter((m) => !activePool.includes(m.id)) : [];

  const MapItem = ({ m }) => (
    <button className="plan-mapitem" onClick={() => onAdd(m.id)} title={getMapDisplayName(m.name, lang)}>
      {existing.has(m.id) && <span className="plan-mapitem-in">{t.inBoard}</span>}
      <div className="plan-mapitem-thumb"><MapThumb id={m.id} /></div>
      <div className="plan-mapitem-name">
        <MapTypeBadge type={m.type} lang={lang} className="shrink-0" />
        <span>{getMapDisplayName(m.name, lang)}</span>
      </div>
    </button>
  );

  return (
    <div className="plan-modal-backdrop" onClick={onClose}>
      <div className="plan-modal" onClick={(e) => e.stopPropagation()}>
        <div className="plan-modal-head">
          {t.addMap}
          <button className="plan-modal-close" onClick={onClose} aria-label="닫기"><X size={18} /></button>
        </div>
        <div className="plan-modal-body">
          <input className="plan-search" placeholder={t.search} value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
          <div className="plan-modetabs">
            <button className={"plan-modetab" + (mode === "All" ? " active" : "")} onClick={() => setMode("All")}>{t.allModes}</button>
            {MODE_ORDER.map((mt) => (
              <button key={mt} className={"plan-modetab" + (mode === mt ? " active" : "")} onClick={() => setMode(mt)}>{MAP_LABELS[lang][mt]}</button>
            ))}
          </div>

          {hasPool ? (
            <>
              <div className="plan-pool-head">{t.poolActive} ({poolMaps.length})</div>
              <div className="plan-mapgrid-modal">{poolMaps.map((m) => <MapItem key={m.id} m={m} />)}</div>
              {otherMaps.length > 0 && (
                <>
                  <div className="plan-pool-head">
                    {t.poolOther} ({otherMaps.length})
                    <button className="plan-pool-toggle" onClick={() => setShowOther((v) => !v)}>{showOther ? t.collapse : t.expand}</button>
                  </div>
                  {showOther && <div className="plan-mapgrid-modal">{otherMaps.map((m) => <MapItem key={m.id} m={m} />)}</div>}
                </>
              )}
            </>
          ) : (
            <div className="plan-mapgrid-modal">{poolMaps.map((m) => <MapItem key={m.id} m={m} />)}</div>
          )}
        </div>
        <div className="plan-modal-foot">
          <button className="plan-btn primary" onClick={onClose}>{t.done}</button>
        </div>
      </div>
    </div>
  );
}
