// templates.js — 새 맵 캔버스 템플릿. 빈 캔버스 / 밴 시나리오(상대 밴 3분기 → 조합 + 연결 + 그룹).
import { MarkerType } from "@xyflow/react";
import { planT } from "../i18n";
import { NODE_W } from "./constants";

const uid = () => (crypto?.randomUUID ? crypto.randomUUID() : "n_" + Date.now() + "_" + Math.floor(Math.random() * 1e6));
const EDGE = () => ({ type: "labeled", markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18, color: "#71717a" } });

// 밴 선후 순서 예시: 상대 선밴(상대→우리→조합)·우리 선밴(우리→상대→조합)·단순 밴(상대→조합).
// 3열(밴1·밴2·조합) 기준 좌표. 그룹은 자식 bounds + padding 으로 자동 크기(겹침 방지).
export function applyTemplate(type, lang) {
  if (type !== "ban") return { nodes: [], edges: [] };
  const t = planT(lang);
  const PAD = 24, TITLE_H = 32, GAP = 40, COND_H = 96, ROW_H = COND_H + GAP;
  const col1 = PAD, col2 = PAD + NODE_W.condition + GAP, col3 = col2 + NODE_W.condition + GAP;
  const gid = uid();
  const nodes = [], edges = [];
  const link = (s, tg) => edges.push({ ...EDGE(), id: uid(), source: s, target: tg });
  const cnode = (x, y, condType, text) => { const id = uid(); nodes.push({ id, type: "condition", parentId: gid, extent: "parent", position: { x, y }, data: { condType, text } }); return id; };
  const mnode = (y) => { const id = uid(); nodes.push({ id, type: "comp", parentId: gid, extent: "parent", position: { x: col3, y: y + 6 }, data: { slots: [null, null, null, null, null] } }); return id; };
  const y0 = PAD + TITLE_H;

  // 행1: 상대 선밴 — 상대 밴 → 우리 밴 → 조합
  let y = y0, a = cnode(col1, y, "enemy_ban", t.enemyBanQ), b = cnode(col2, y, "our_ban", t.ourBanQ), m = mnode(y);
  link(a, b); link(b, m);
  // 행2: 우리 선밴 — 우리 밴 → 상대 밴 → 조합
  y = y0 + ROW_H; a = cnode(col1, y, "our_ban", t.ourBanQ); b = cnode(col2, y, "enemy_ban", t.enemyBanQ); m = mnode(y);
  link(a, b); link(b, m);
  // 행3: 단순 상대 밴 → 조합
  y = y0 + 2 * ROW_H; a = cnode(col1, y, "enemy_ban", t.enemyBanQ); m = mnode(y);
  link(a, m);

  const gW = col3 + NODE_W.comp + PAD;
  const gH = PAD + TITLE_H + 3 * ROW_H - GAP + PAD;
  const group = { id: gid, type: "group", position: { x: 60, y: 40 }, data: { label: t.respGroup }, style: { width: gW, height: gH }, zIndex: 0 };
  return { nodes: [group, ...nodes], edges };
}

export const TEMPLATE_KINDS = [
  { id: "empty", labelKey: "tplEmpty" },
  { id: "ban", labelKey: "tplBan", descKey: "tplBanDesc" },
];
