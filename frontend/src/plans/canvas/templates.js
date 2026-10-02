// templates.js — 새 맵 캔버스 템플릿. 빈 캔버스 / 밴 시나리오(상대 밴 3분기 → 조합 + 연결 + 그룹).
import { MarkerType } from "@xyflow/react";
import { planT } from "../i18n";

const uid = () => (crypto?.randomUUID ? crypto.randomUUID() : "n_" + Date.now() + "_" + Math.floor(Math.random() * 1e6));
const EDGE = () => ({ type: "labeled", markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18, color: "#71717a" } });

export function applyTemplate(type, lang) {
  if (type !== "ban") return { nodes: [], edges: [] };
  const t = planT(lang);
  const gid = uid();
  const group = { id: gid, type: "group", position: { x: 60, y: 40 }, data: { label: t.respGroup }, style: { width: 640, height: 540 }, zIndex: 0 };
  const nodes = [group];
  const edges = [];
  const ys = [40, 210, 380];
  for (const y of ys) {
    const cond = { id: uid(), type: "condition", parentId: gid, extent: "parent", position: { x: 28, y }, data: { condType: "enemy_ban", text: t.enemyBanQ } };
    const comp = { id: uid(), type: "comp", parentId: gid, extent: "parent", position: { x: 250, y: y - 4 }, data: { slots: [null, null, null, null, null] } };
    nodes.push(cond, comp);
    edges.push({ ...EDGE(), id: uid(), source: cond.id, target: comp.id });
  }
  return { nodes, edges };
}

export const TEMPLATE_KINDS = [
  { id: "empty", labelKey: "tplEmpty" },
  { id: "ban", labelKey: "tplBan", descKey: "tplBanDesc" },
];
