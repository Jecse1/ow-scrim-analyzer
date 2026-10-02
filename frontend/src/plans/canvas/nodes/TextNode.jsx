// 텍스트 노드: 제목 1줄 굵게 + 본문 textarea(자동 높이). 더블클릭 시 편집 포커스.
import React, { useEffect, useRef } from "react";
import { useCanvasCtx } from "./ctx";
import { NodeShell } from "./NodeParts";

export default function TextNode({ id, data, selected }) {
  const { lang, updateNodeData } = useCanvasCtx();
  const taRef = useRef(null);
  const autosize = (el) => { if (el) { el.style.height = "auto"; el.style.height = el.scrollHeight + "px"; } };
  useEffect(() => { autosize(taRef.current); }, [data?.body]);
  return (
    <NodeShell id={id} selected={selected} data={data} minWidth={260}>
      <div className="pl-text nodrag">
        <input
          className="pl-text-title"
          value={data?.title || ""}
          placeholder={lang === "ko" ? "제목" : "Title"}
          onChange={(e) => updateNodeData(id, { title: e.target.value })}
        />
        <textarea
          ref={taRef}
          className="pl-text-body"
          value={data?.body || ""}
          placeholder={lang === "ko" ? "내용" : "Body"}
          rows={1}
          onChange={(e) => { updateNodeData(id, { body: e.target.value }); autosize(e.target); }}
        />
      </div>
    </NodeShell>
  );
}
