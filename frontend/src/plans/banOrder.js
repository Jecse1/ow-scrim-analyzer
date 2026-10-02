// banOrder.js — 밴 선후 순서(연결 순서 기반) 공용 로직. 캔버스 표시·인쇄가 같은 함수를 써서 항상 일치.
// 순수 함수(DOM/gameData 비의존) → node 단위테스트 가능.
//
// 원칙: 밴 순서는 노드를 이은 순서로 결정한다.
//   상대 밴 → 우리 밴 → 조합 = 상대 선밴(theirs 1, ours 2)
//   우리 밴 → 상대 밴 → 조합 = 우리 선밴(ours 1, theirs 2)
// 밴 노드 = 조건 유형 상대 밴(theirs)/우리 밴(ours), 또는 금지 태그 영웅 노드(ours).
// 선픽 조건(상대 선픽/우리 선픽)은 체인 맨 앞 pickCond.
// 체인 시작 = 들어오는 엣지가 없는 조건 노드. 엣지를 따라 밴을 만난 순서대로 order 1·2(최대 2),
// 조합 노드에 도달하면 종료. 깊이 제한 3(밴 2 + 조합 1). 분기(한 밴 노드에서 조합 2개)는 밴 순서 공유.

function banSideOf(n) {
  if (!n) return null;
  if (n.type === "condition") {
    const ct = n.data && n.data.condType;
    if (ct === "enemy_ban") return "theirs";
    if (ct === "our_ban") return "ours";
  }
  if (n.type === "hero" && n.data && n.data.tag === "ban") return "ours";
  return null;
}
function pickSideOf(n) {
  const ct = n && n.type === "condition" ? n.data && n.data.condType : null;
  if (ct === "enemy_pick") return "theirs";
  if (ct === "our_pick") return "ours";
  return null;
}
const heroOf = (n) => (n && n.data && n.data.heroId) || null;

export function computeBanOrder(nodes, edges) {
  nodes = nodes || [];
  edges = edges || [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out = new Map();
  const indeg = new Map();
  for (const n of nodes) indeg.set(n.id, 0);
  for (const e of edges) {
    if (!out.has(e.source)) out.set(e.source, []);
    out.get(e.source).push(e.target);
    indeg.set(e.target, (indeg.get(e.target) || 0) + 1);
  }

  const chains = [];
  const byNode = {}; // nodeId -> [{order, side}]
  const record = (id, order, side) => {
    if (!byNode[id]) byNode[id] = [];
    if (!byNode[id].some((x) => x.order === order && x.side === side)) byNode[id].push({ order, side });
  };

  const starts = nodes.filter((n) => n.type === "condition" && (indeg.get(n.id) || 0) === 0);

  for (const start of starts) {
    const bans = [];        // [{nodeId, side, hero, order}] (체인 내 중복 제거)
    const compIds = [];
    let pickCond = null;

    const addBan = (n, order) => {
      const side = banSideOf(n);
      if (!bans.some((b) => b.nodeId === n.id)) bans.push({ nodeId: n.id, side, hero: heroOf(n), order });
      record(n.id, order, side);
    };
    const addComp = (id) => { if (!compIds.includes(id)) compIds.push(id); };

    // banCount = 지금까지 밴 수(이 경로). 깊이 제한: 밴 2개까지, 그 다음 조합만.
    const walk = (id, banCount, seen) => {
      for (const t of out.get(id) || []) {
        if (seen.has(t)) continue;
        const tn = byId.get(t);
        if (!tn) continue;
        if (tn.type === "comp") { addComp(t); continue; }
        if (banSideOf(tn)) {
          if (banCount >= 2) continue; // 밴 최대 2
          addBan(tn, banCount + 1);
          const s2 = new Set(seen); s2.add(t);
          walk(t, banCount + 1, s2);
        }
        // 밴·조합이 아닌 노드(텍스트/선픽 등 중간)는 따라가지 않음
      }
    };

    const startBanSide = banSideOf(start);
    if (startBanSide) {
      addBan(start, 1);
      walk(start.id, 1, new Set([start.id]));
    } else {
      const ps = pickSideOf(start);
      if (ps) pickCond = { nodeId: start.id, side: ps, hero: heroOf(start), text: (start.data && start.data.text) || "" };
      walk(start.id, 0, new Set([start.id]));
    }

    if (bans.length || compIds.length || pickCond) {
      const chain = { startId: start.id, bans, compIds };
      if (pickCond) chain.pickCond = pickCond;
      chains.push(chain);
    }
  }

  return { chains, byNode };
}
