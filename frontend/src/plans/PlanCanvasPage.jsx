// PlanCanvasPage.jsx — 맵 캔버스 화면. 상단 바(PlanCanvas 내부) + 맵 스트립 + ReactFlow 캔버스.
import React, { useEffect, useMemo, useState } from "react";
import { useLanguage } from "../LanguageContext";
import { useTheme } from "../ThemeContext";
import { getMapDisplayName } from "../gameData";
import { MapThumb } from "../shared/heroMapAssets";
import { plansApi } from "./api";
import PlanCanvas from "./canvas/PlanCanvas";
import "./plans.css";

export default function PlanCanvasPage({ planMapId, onBack, onOpenMap }) {
  const { language } = useLanguage();
  const { isDarkMode: dark } = useTheme();
  const [boards, setBoards] = useState([]);

  useEffect(() => { plansApi.listBoards().then(setBoards).catch(() => setBoards([])); }, []);

  const { board, mapRow } = useMemo(() => {
    for (const b of boards) {
      const mr = (b.maps || []).find((m) => m.id === planMapId);
      if (mr) return { board: b, mapRow: mr };
    }
    return { board: null, mapRow: null };
  }, [boards, planMapId]);

  const strip = board && (board.maps || []).length > 1 ? (
    <div className="plan-mapstrip">
      {board.maps.map((m) => (
        <button key={m.id} className={"plan-strip-card" + (m.id === planMapId ? " active" : "")}
          onClick={() => m.id !== planMapId && onOpenMap(m.id)} title={getMapDisplayName(m.map_id, language)}>
          <div className="plan-strip-thumb"><MapThumb id={m.map_id} /></div>
          <div className="plan-strip-name">{getMapDisplayName(m.map_id, language)}</div>
        </button>
      ))}
    </div>
  ) : null;

  return (
    <div className={"plan-root pl-canvas-root " + (dark ? "" : "light")}>
      <PlanCanvas
        key={planMapId}
        planMapId={planMapId}
        boardName={board ? board.name : null}
        mapRow={mapRow}
        onBack={onBack}
        strip={strip}
      />
    </div>
  );
}
