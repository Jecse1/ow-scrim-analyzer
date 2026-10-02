// templates.js — 새 맵 캔버스 템플릿. 빈 캔버스 / 밴 시나리오(상대 밴 3분기 → 조합 + 연결 + 그룹).
import { MarkerType } from "@xyflow/react";
import { planT } from "../i18n";
import { NODE_W } from "./constants";

const uid = () => (crypto?.randomUUID ? crypto.randomUUID() : "n_" + Date.now() + "_" + Math.floor(Math.random() * 1e6));
const EDGE = () => ({ type: "labeled", markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18, color: "#71717a" } });

// 노드 폭(NODE_W)+간격 40 기준으로 좌표 계산, 그룹은 자식 bounds + padding 24 로 자동 크기(겹침 방지).
export function applyTemplate(type, lang) {
  if (type !== "ban") return { nodes: [], edges: [] };
  const t = planT(lang);
  const PAD = 24, TITLE_H = 32, GAP = 40, COND_H = 96, ROW_H = COND_H + GAP; // 제목 높이 + 행 간격
  const condX = PAD, compX = PAD + NODE_W.condition + GAP;
  const gid = uid();
  const nodes = [];
  const edges = [];
  for (let i = 0; i < 3; i++) {
    const y = PAD + TITLE_H + i * ROW_H;
    const cond = { id: uid(), type: "condition", parentId: gid, extent: "parent", position: { x: condX, y }, data: { condType: "enemy_ban", text: t.enemyBanQ } };
    const comp = { id: uid(), type: "comp", parentId: gid, extent: "parent", position: { x: compX, y: y + 6 }, data: { slots: [null, null, null, null, null] } };
    nodes.push(cond, comp);
    edges.push({ ...EDGE(), id: uid(), source: cond.id, target: comp.id });
  }
  const gW = compX + NODE_W.comp + PAD;
  const gH = PAD + TITLE_H + 3 * ROW_H - GAP + PAD; // 제목 + 3행(마지막 GAP 제거) + padding
  const group = { id: gid, type: "group", position: { x: 60, y: 40 }, data: { label: t.respGroup }, style: { width: gW, height: gH }, zIndex: 0 };
  return { nodes: [group, ...nodes], edges };
}

export const TEMPLATE_KINDS = [
  { id: "empty", labelKey: "tplEmpty" },
  { id: "ban", labelKey: "tplBan", descKey: "tplBanDesc" },
];
