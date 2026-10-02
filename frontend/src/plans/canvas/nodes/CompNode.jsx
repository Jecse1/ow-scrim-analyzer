// 조합 노드: 탱-딜-딜-힐-힐 5칸(역할 아이콘). 빈 칸 흐림. 칸 클릭 → HeroPicker(해당 역할 탭).
import React from "react";
import { HeroThumb, RoleIcon } from "../../../shared/heroMapAssets";
import { SLOT_ROLES } from "../constants";
import { heroRole } from "../heroUtil";
import { useCanvasCtx } from "./ctx";
import { NodeShell } from "./NodeParts";

export default function CompNode({ id, data, selected }) {
  const { lang, openHeroPicker } = useCanvasCtx();
  const slots = data?.slots || [null, null, null, null, null];
  return (
    <NodeShell id={id} selected={selected} data={data} minWidth={300}>
      <div className="pl-comp">
        {SLOT_ROLES.map((role, i) => {
          const hid = slots[i];
          const r = hid ? (heroRole(hid) || role) : role;
          return (
            <button key={i} className={"pl-comp-slot" + (hid ? "" : " empty")} onClick={() => openHeroPicker(id, { slotIndex: i, role })}>
              <div className="pl-comp-thumb">
                {hid ? <HeroThumb id={hid} /> : <RoleIcon role={r} lang={lang} className="pl-comp-roleicon" />}
              </div>
            </button>
          );
        })}
      </div>
    </NodeShell>
  );
}
