// TopBar.jsx — 캔버스 상단 바: ← 보드명 / 맵 이미지+맵명 / 저장 상태 / 실행취소·다시실행 / 스냅 토글 / (PNG=②).
import React, { useEffect, useState } from "react";
import { ChevronLeft, Undo2, Redo2, Grid3x3, Download, Check, AlertCircle, Loader } from "lucide-react";
import { getMapDisplayName } from "../../gameData";
import { MapThumb } from "../../shared/heroMapAssets";
import { planT } from "../i18n";

function SaveStatus({ status, savedAt, onRetry, lang }) {
  const t = planT(lang);
  const [, tick] = useState(0);
  useEffect(() => { const id = setInterval(() => tick((x) => x + 1), 2000); return () => clearInterval(id); }, []);
  if (status === "saving") return <span className="pl-save saving"><Loader size={13} className="pl-spin" /> {t.saving}</span>;
  if (status === "error") return <button className="pl-save error" onClick={onRetry}><AlertCircle size={13} /> {t.saveFailed}</button>;
  if (status === "saved") {
    const sec = savedAt ? Math.floor((Date.now() - savedAt) / 1000) : 0;
    const when = sec < 3 ? t.justNow : sec < 60 ? t.savedAgo(sec) : t.savedAgo(sec); // 60s+ 도 초 표기(간단)
    return <span className="pl-save ok"><Check size={13} /> {t.saved} · {when}</span>;
  }
  return null;
}

export default function TopBar({ boardName, mapRow, onBack, saveStatus, savedAt, onRetry, undo, redo, canUndo, canRedo, snap, setSnap, onExport, lang }) {
  const t = planT(lang);
  return (
    <div className="plan-canvas-topbar">
      <button className="plan-back" onClick={onBack}><ChevronLeft size={16} />{boardName || t.back}</button>
      <div className="plan-topbar-map">
        <div className="plan-topbar-thumb">{mapRow && <MapThumb id={mapRow.map_id} />}</div>
        <span className="plan-topbar-name">{mapRow ? getMapDisplayName(mapRow.map_id, lang) : ""}</span>
      </div>
      <div className="pl-topbar-right">
        <SaveStatus status={saveStatus} savedAt={savedAt} onRetry={onRetry} lang={lang} />
        <span className="pl-tb-sep" />
        <button className="pl-tbtn" disabled={!canUndo} title={t.undo} onClick={undo}><Undo2 size={16} /></button>
        <button className="pl-tbtn" disabled={!canRedo} title={t.redo} onClick={redo}><Redo2 size={16} /></button>
        <button className={"pl-tbtn" + (snap ? " on" : "")} title={t.snap} onClick={() => setSnap((v) => !v)}><Grid3x3 size={16} /></button>
        {onExport && <button className="pl-tbtn" title={t.exportPng} onClick={onExport}><Download size={16} /></button>}
      </div>
    </div>
  );
}
