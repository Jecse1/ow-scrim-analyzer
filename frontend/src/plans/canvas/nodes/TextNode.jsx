// 텍스트 노드: 기본 "표시 모드"(일반 div, 드래그 가능). 더블클릭 → 편집 모드(input·textarea nodrag,
// 자동 포커스, Esc·바깥 클릭·Ctrl+Enter 로 종료). 편집 중이 아니면 노드 어디를 잡아도 이동.
import React, { useEffect, useRef, useState } from "react";
import { useCanvasCtx } from "./ctx";
import { NodeShell } from "./NodeParts";
import { IMEInput, IMETextarea } from "../../IMEInput";

export default function TextNode({ id, data, selected }) {
  const { lang, updateNodeData } = useCanvasCtx();
  const [editing, setEditing] = useState(false);
  const taRef = useRef(null);
  const titleRef = useRef(null);
  const wrapRef = useRef(null);
  const autosize = (el) => { if (el) { el.style.height = "auto"; el.style.height = el.scrollHeight + "px"; } };
  useEffect(() => { autosize(taRef.current); }, [data?.body, editing]);
  // 편집 진입 시 제목 자동 포커스
  useEffect(() => { if (editing) { titleRef.current?.focus(); titleRef.current?.select?.(); } }, [editing]);
  // 바깥 클릭 → 편집 종료
  useEffect(() => {
    if (!editing) return;
    const onDown = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setEditing(false); };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [editing]);

  const endKeys = (e) => {
    if (e.key === "Escape") { e.stopPropagation(); setEditing(false); }
    else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); setEditing(false); }
  };

  const title = data?.title || "";
  const body = data?.body || "";
  return (
    <NodeShell id={id} selected={selected} data={data} minWidth={260}>
      <div className="pl-text" ref={wrapRef} onDoubleClick={() => setEditing(true)}>
        {editing ? (
          <>
            <IMEInput
              ref={titleRef}
              className="pl-text-title nodrag"
              value={title}
              placeholder={lang === "ko" ? "제목" : "Title"}
              onChange={(v) => updateNodeData(id, { title: v })}
              onKeyDown={endKeys}
            />
            <IMETextarea
              ref={taRef}
              className="pl-text-body nodrag"
              value={body}
              placeholder={lang === "ko" ? "내용" : "Body"}
              rows={1}
              onChange={(v, e) => { updateNodeData(id, { body: v }); autosize(e.target); }}
              onKeyDown={endKeys}
            />
          </>
        ) : (
          <>
            <div className={"pl-text-title-view" + (title ? "" : " ph")}>{title || (lang === "ko" ? "제목" : "Title")}</div>
            <div className={"pl-text-body-view" + (body ? "" : " ph")}>{body || (lang === "ko" ? "내용(더블클릭 편집)" : "double-click to edit")}</div>
          </>
        )}
      </div>
    </NodeShell>
  );
}
