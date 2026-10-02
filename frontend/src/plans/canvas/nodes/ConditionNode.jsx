// 조건 노드: 좌측 색 띠(유형) + 영웅 초상화(밴 유형은 사선) 또는 텍스트. 더블클릭 → 편집 팝오버.
import React from "react";
import { HeroThumb, BanSlashOverlay } from "../../../shared/heroMapAssets";
import { COND_TYPES } from "../constants";
import { heroName } from "../heroUtil";
import { useCanvasCtx } from "./ctx";
import { NodeShell } from "./NodeParts";

export default function ConditionNode({ id, data, selected }) {
  const { lang, openCondEdit } = useCanvasCtx();
  const ct = COND_TYPES[data?.condType] || COND_TYPES.etc;
  return (
    <NodeShell id={id} selected={selected} data={data} minWidth={150}>
      <div className="pl-cond" onDoubleClick={() => openCondEdit(id)}>
        <span className="pl-cond-strip" style={{ background: ct.color }} />
        <div className="pl-cond-body">
          <div className="pl-cond-type" style={{ color: ct.color }}>{ct.label[lang]}</div>
          {data?.heroId ? (
            <div className="pl-cond-hero">
              <div className="pl-cond-thumb">
                <HeroThumb id={data.heroId} />
                {ct.isBan && <BanSlashOverlay />}
              </div>
              <span className="pl-cond-name">{heroName(data.heroId, lang)}</span>
            </div>
          ) : (
            <div className="pl-cond-text">{data?.text || (lang === "ko" ? "내용 입력(더블클릭)" : "double-click")}</div>
          )}
        </div>
      </div>
    </NodeShell>
  );
}
