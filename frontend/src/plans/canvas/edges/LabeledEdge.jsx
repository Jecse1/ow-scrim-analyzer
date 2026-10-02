// LabeledEdge.jsx — 베지어 엣지 + 끝 화살표 + 선택 시 중앙 라벨 입력 칩 + 호버/선택 시 × 삭제.
import React from "react";
import { BaseEdge, EdgeLabelRenderer, getBezierPath } from "@xyflow/react";
import { X } from "lucide-react";
import { useCanvasCtx } from "../nodes/ctx";

export default function LabeledEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, selected, data }) {
  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  const { updateEdgeData, deleteEdge, hoveredEdgeId, lang } = useCanvasCtx();
  const label = data?.label || "";
  const hovered = hoveredEdgeId === id;
  const del = (e) => { e.stopPropagation(); deleteEdge(id); };
  return (
    <>
      <BaseEdge
        id={id} path={path} markerEnd={markerEnd}
        interactionWidth={20}
        style={{ stroke: selected ? "#3b82f6" : "#71717a", strokeWidth: selected ? 2.8 : 1.8 }}
      />
      {(selected || label || hovered) && (
        <EdgeLabelRenderer>
          <div
            className="pl-edge-label nodrag nopan"
            style={{ transform: `translate(-50%,-50%) translate(${labelX}px,${labelY}px)`, pointerEvents: "all" }}
          >
            {selected ? (
              <>
                <input
                  className="pl-edge-input"
                  value={label}
                  placeholder={lang === "ko" ? "라벨" : "label"}
                  onChange={(e) => updateEdgeData(id, { label: e.target.value })}
                  onMouseDown={(e) => e.stopPropagation()}
                />
                <button className="pl-edge-del" title={lang === "ko" ? "연결 삭제" : "Delete edge"} onMouseDown={(e) => e.stopPropagation()} onClick={del}><X size={12} /></button>
              </>
            ) : hovered ? (
              <>
                {label && <span className="pl-edge-text">{label}</span>}
                <button className="pl-edge-del" title={lang === "ko" ? "연결 삭제" : "Delete edge"} onMouseDown={(e) => e.stopPropagation()} onClick={del}><X size={12} /></button>
              </>
            ) : (
              <span className="pl-edge-text">{label}</span>
            )}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
