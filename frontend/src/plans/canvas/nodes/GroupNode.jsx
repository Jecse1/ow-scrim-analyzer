// 그룹 노드: 제목 있는 반투명 상자 + 리사이즈 핸들. 내부 노드는 parentId 로 소속(그룹 드래그 시 함께 이동).
import React from "react";
import { NodeResizer } from "@xyflow/react";
import { Trash2 } from "lucide-react";
import { useCanvasCtx } from "./ctx";

export default function GroupNode({ id, data, selected }) {
  const { lang, updateNodeData, deleteNode } = useCanvasCtx();
  return (
    <div className="pl-group" style={{ width: "100%", height: "100%" }}>
      <NodeResizer minWidth={160} minHeight={120} isVisible={selected} lineClassName="pl-grp-line" handleClassName="pl-grp-handle" />
      <div className="pl-group-head nodrag">
        <input
          className="pl-group-title"
          value={data?.label || ""}
          placeholder={lang === "ko" ? "그룹" : "Group"}
          onChange={(e) => updateNodeData(id, { label: e.target.value })}
        />
        {selected && <button className="pl-tb-btn danger" title="삭제" onClick={() => deleteNode(id)}><Trash2 size={13} /></button>}
      </div>
    </div>
  );
}
