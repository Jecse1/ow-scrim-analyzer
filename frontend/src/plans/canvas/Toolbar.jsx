// Toolbar.jsx — 좌측 세로 툴바(선택·손·조건·영웅·조합·텍스트·그룹). 활성 도구 표시.
import React from "react";
import { MousePointer2, Hand, Diamond, User, Users, Type, SquareDashed } from "lucide-react";
import { planT } from "../i18n";

const TOOLS = [
  { id: "select", Icon: MousePointer2, k: "toolSelect" },
  { id: "hand", Icon: Hand, k: "toolHand" },
  { sep: true },
  { id: "condition", Icon: Diamond, k: "condition" },
  { id: "hero", Icon: User, k: "hero" },
  { id: "comp", Icon: Users, k: "comp" },
  { id: "text", Icon: Type, k: "text" },
  { id: "group", Icon: SquareDashed, k: "toolGroup" },
];

export default function Toolbar({ tool, setTool, lang }) {
  const t = planT(lang);
  return (
    <div className="pl-toolbar">
      {TOOLS.map((x, i) => x.sep ? <span key={i} className="pl-tool-sep" /> : (
        <button key={x.id} className={"pl-tool" + (tool === x.id ? " active" : "")} title={t[x.k]} onClick={() => setTool(x.id)}>
          <x.Icon size={18} />
        </button>
      ))}
    </div>
  );
}
