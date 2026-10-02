// NodeParts.jsx — 공용 핸들(4변 source+target) + 노드 셸(테두리 색 태그 + 선택 시 미니 툴바).
import React from "react";
import { Handle, Position } from "@xyflow/react";
import { Copy, Trash2 } from "lucide-react";
import { COLOR_TAG_ORDER, COLOR_TAGS, tagBorder } from "../constants";
import { useCanvasCtx } from "./ctx";

const SIDES = [
  { pos: Position.Top, key: "t" },
  { pos: Position.Right, key: "r" },
  { pos: Position.Bottom, key: "b" },
  { pos: Position.Left, key: "l" },
];

// 각 변에 source+target 핸들을 겹쳐 둬서 어느 변에서든 연결 시작/도착 가능. 평소 숨김, hover/선택 시 "+".
export function NodeHandles() {
  return (
    <>
      {SIDES.map((s) => (
        <React.Fragment key={s.key}>
          <Handle type="target" position={s.pos} id={`${s.key}-t`} className="pl-handle" />
          <Handle type="source" position={s.pos} id={`${s.key}-s`} className="pl-handle" />
        </React.Fragment>
      ))}
    </>
  );
}

export function NodeShell({ id, selected, data, children, minWidth }) {
  const { lang, updateNodeData, duplicateNode, deleteNode } = useCanvasCtx();
  const border = tagBorder(data);
  return (
    <div
      className={"pl-node" + (selected ? " selected" : "")}
      style={{ minWidth, borderColor: border, boxShadow: border ? `0 0 0 1px ${border}` : undefined }}
    >
      {selected && (
        <div className="pl-node-toolbar" onMouseDown={(e) => e.stopPropagation()}>
          {COLOR_TAG_ORDER.map((tg) => (
            <button
              key={tg}
              className={"pl-tag-dot" + (data?.tag === tg ? " on" : "")}
              style={{ background: COLOR_TAGS[tg].color }}
              title={COLOR_TAGS[tg].label[lang]}
              onClick={() => updateNodeData(id, { tag: data?.tag === tg ? null : tg })}
            />
          ))}
          <span className="pl-tb-sep" />
          <button className="pl-tb-btn" title="복제" onClick={() => duplicateNode(id)}><Copy size={13} /></button>
          <button className="pl-tb-btn danger" title="삭제" onClick={() => deleteNode(id)}><Trash2 size={13} /></button>
        </div>
      )}
      <NodeHandles />
      {children}
    </div>
  );
}
