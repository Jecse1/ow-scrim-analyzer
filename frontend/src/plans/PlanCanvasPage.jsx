// PlanCanvasPage.jsx — 맵 캔버스 화면(STEP2: 상단 바 + 맵 스트립 + 빈 캔버스 자리).
// 캔버스 편집(노드/엣지/저장 등)은 STEP3에서 구현. planMapId = plan_maps 행 id.
import React, { useEffect, useMemo, useState } from "react";
import { ChevronLeft } from "lucide-react";
import { useLanguage } from "../LanguageContext";
import { useTheme } from "../ThemeContext";
import { getMapDisplayName } from "../gameData";
import { MapThumb } from "../shared/heroMapAssets";
import { plansApi } from "./api";
import { planT } from "./i18n";
import "./plans.css";

export default function PlanCanvasPage({ planMapId, onBack, onOpenMap }) {
  const { language } = useLanguage();
  const { isDarkMode: dark } = useTheme();
  const t = planT(language);
  const [boards, setBoards] = useState([]);

  useEffect(() => { plansApi.listBoards().then(setBoards).catch(() => setBoards([])); }, []);

  const { board, mapRow } = useMemo(() => {
    for (const b of boards) {
      const mr = (b.maps || []).find((m) => m.id === planMapId);
      if (mr) return { board: b, mapRow: mr };
    }
    return { board: null, mapRow: null };
  }, [boards, planMapId]);

  return (
    <div className={"plan-root " + (dark ? "" : "light")}>
      <div className="plan-canvas-topbar">
        <button className="plan-back" onClick={onBack}><ChevronLeft size={16} />{board ? board.name : t.back}</button>
        <div className="plan-topbar-map">
          <div className="plan-topbar-thumb">{mapRow && <MapThumb id={mapRow.map_id} />}</div>
          <span className="plan-topbar-name">{mapRow ? getMapDisplayName(mapRow.map_id, language) : ""}</span>
        </div>
      </div>

      {board && (board.maps || []).length > 0 && (
        <div className="plan-mapstrip">
          {board.maps.map((m) => (
            <button
              key={m.id}
              className={"plan-strip-card" + (m.id === planMapId ? " active" : "")}
              onClick={() => m.id !== planMapId && onOpenMap(m.id)}
              title={getMapDisplayName(m.map_id, language)}
            >
              <div className="plan-strip-thumb"><MapThumb id={m.map_id} /></div>
              <div className="plan-strip-name">{getMapDisplayName(m.map_id, language)}</div>
            </button>
          ))}
        </div>
      )}

      <div className="plan-canvas-empty">{t.canvasSoon}</div>
    </div>
  );
}
