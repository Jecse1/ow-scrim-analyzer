// extract.js — 캔버스 그래프 → 인쇄 치트시트 행 추출(순수 함수). 밴 선후 순서는 computeBanOrder 공용 로직 사용.
// 행(chain) = 선픽 조건 + 순서 매긴 밴(최대 2) + 조합(우선→대안 최대 2). 기본안(base) = 어떤 체인에도 안 걸린 조합.
import { computeBanOrder } from "../banOrder.js";

const tagRank = (t) => (t === "priority" ? 0 : t === "alt" ? 1 : 2);

export function extractSheet(canvas) {
  const nodes = (canvas && canvas.nodes) || [];
  const edges = (canvas && canvas.edges) || [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const { chains } = computeBanOrder(nodes, edges);

  const absY = (n) => {
    let y = (n && n.position && n.position.y) || 0;
    const par = n && n.parentId && byId.get(n.parentId);
    if (par) y += (par.position && par.position.y) || 0;
    return y;
  };
  const compOf = (id) => { const n = byId.get(id); return { slots: (n && n.data && n.data.slots) || [null, null, null, null, null], tag: (n && n.data && n.data.tag) || null }; };

  const reachedComp = new Set();
  const chainRows = [];
  for (const ch of chains) {
    const comps = ch.compIds.map(compOf)
      .sort((a, b) => tagRank(a.tag) - tagRank(b.tag))
      .slice(0, 2)
      .map((c, i) => ({ slots: c.slots, tag: c.tag, alt: i === 1 }));
    ch.compIds.forEach((id) => reachedComp.add(id));
    const startN = byId.get(ch.startId);
    chainRows.push({
      kind: "chain",
      pickCond: ch.pickCond ? { side: ch.pickCond.side, hero: ch.pickCond.hero || null, text: ch.pickCond.text || "" } : null,
      bans: ch.bans.map((b) => ({ side: b.side, hero: b.hero || null, order: b.order })),
      comps,
      y: absY(startN),
    });
  }

  // 기본안: 어떤 체인에도 도달되지 않는 조합 노드(맵 맨 위)
  const base = [];
  for (const n of nodes) {
    if (n.type === "comp" && !reachedComp.has(n.id)) {
      base.push({ kind: "base", pickCond: null, bans: [], comps: [{ slots: (n.data && n.data.slots) || [null, null, null, null, null], tag: (n.data && n.data.tag) || null, alt: false }], y: absY(n) });
    }
  }

  // 미포함: 연결(엣지) 없는 영웅/텍스트 노드 수
  const connected = new Set();
  for (const e of edges) { connected.add(e.source); connected.add(e.target); }
  const excludedCount = nodes.filter((n) => (n.type === "hero" || n.type === "text") && !connected.has(n.id)).length;

  const rows = [...base.sort((a, b) => a.y - b.y), ...chainRows.sort((a, b) => a.y - b.y)];
  return { rows, excludedCount };
}
