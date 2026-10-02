// 영웅 노드: 초상화 72px + 이름. 클릭 → HeroPicker.
import React from "react";
import { HeroThumb } from "../../../shared/heroMapAssets";
import { heroName } from "../heroUtil";
import { useCanvasCtx } from "./ctx";
import { NodeShell } from "./NodeParts";

export default function HeroNode({ id, data, selected }) {
  const { lang, openHeroPicker } = useCanvasCtx();
  return (
    <NodeShell id={id} selected={selected} data={data} minWidth={120}>
      <div className="pl-hero" onClick={() => openHeroPicker(id, {})}>
        <div className="pl-hero-thumb">
          {data?.heroId ? <HeroThumb id={data.heroId} /> : <span className="pl-hero-empty">+</span>}
        </div>
        <div className="pl-hero-name">{data?.heroId ? heroName(data.heroId, lang) : (lang === "ko" ? "영웅 선택" : "Pick hero")}</div>
      </div>
    </NodeShell>
  );
}
