// LabeledEdge.jsx — 베지어 엣지 + 끝 화살표 + 선택 시 중앙 라벨 입력 칩.
import React from "react";
import { BaseEdge, EdgeLabelRenderer, getBezierPath } from "@xyflow/react";
import { useCanvasCtx } from "../nodes/ctx";

export default function LabeledEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, selected, data }) {
  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  const { updateEdgeData, lang } = useCanvasCtx();
  const label = data?.label || "";
  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={{ stroke: selected ? "#3b82f6" : "#71717a", strokeWidth: selected ? 2.5 : 1.8 }} />
      {(selected || label) && (
        <EdgeLabelRenderer>
          <div
            className="pl-edge-label nodrag nopan"
            style={{ transform: `translate(-50%,-50%) translate(${labelX}px,${labelY}px)`, pointerEvents: "all" }}
          >
            {selected ? (
              <input
                className="pl-edge-input"
                value={label}
                placeholder={lang === "ko" ? "라벨" : "label"}
                onChange={(e) => updateEdgeData(id, { label: e.target.value })}
                onMouseDown={(e) => e.stopPropagation()}
              />
            ) : (
              <span className="pl-edge-text">{label}</span>
            )}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
