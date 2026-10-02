// extract.js — 캔버스 그래프 → 인쇄 치트시트 행 추출(순수 함수, DOM/gameData 비의존 → node 단위테스트 가능).
// 행 = 조건 노드 1개 + 그 노드에서 나가는 엣지로 도달하는 노드들(깊이 ≤2, 조건 노드를 만나면 중단).
// heroId 등 id 만 반환하고 이름/초상화 해석은 PrintSheet 가 담당한다.

const tagRank = (t) => (t === "priority" ? 0 : t === "alt" ? 1 : 2);
const firstLine = (s, n) => { const one = String(s || "").split("\n")[0]; return one.length > n ? one.slice(0, n - 1) + "…" : one; };

export function extractSheet(canvas) {
  const nodes = (canvas && canvas.nodes) || [];
  const edges = (canvas && canvas.edges) || [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out = new Map();
  for (const e of edges) { if (!out.has(e.source)) out.set(e.source, []); out.get(e.source).push(e.target); }

  const absY = (n) => {
    let y = (n.position && n.position.y) || 0;
    const par = n.parentId && byId.get(n.parentId);
    if (par) y += (par.position && par.position.y) || 0;
    return y;
  };
  const groupLabel = (n) => {
    const par = n.parentId && byId.get(n.parentId);
    return par && par.type === "group" ? (par.data && par.data.label) || "" : "";
  };

  // 조건 노드에서 도달: 깊이 ≤2, 조건 노드는 포함하되 더 확장하지 않음.
  function reach(startId) {
    const got = []; const seen = new Set([startId]);
    let frontier = [[startId, 0]];
    while (frontier.length) {
      const next = [];
      for (const [id, d] of frontier) {
        if (d >= 2) continue;
        for (const t of out.get(id) || []) {
          if (seen.has(t)) continue; seen.add(t);
          const tn = byId.get(t); if (!tn) continue;
          got.push(tn);
          if (tn.type !== "condition") next.push([t, d + 1]);
        }
      }
      frontier = next;
    }
    return got;
  }

  // 1) 모든 조건에서 도달 집합 + 각 조건의 도달 목록
  const reachedByAnyCond = new Set();
  const condReach = new Map();
  for (const n of nodes) {
    if (n.type !== "condition") continue;
    const r = reach(n.id);
    condReach.set(n.id, r);
    r.forEach((x) => reachedByAnyCond.add(x.id));
  }

  // 2) 행: 조건 노드. 단, 우리 밴/우리 선픽 조건이 다른 조건의 결과(도달됨)면 중복 행 생성 안 함.
  const rows = [];
  for (const n of nodes) {
    if (n.type !== "condition") continue;
    const ct = (n.data && n.data.condType) || "etc";
    if ((ct === "our_ban" || ct === "our_pick") && reachedByAnyCond.has(n.id)) continue;
    const reached = condReach.get(n.id) || [];
    const ourBans = reached
      .filter((r) => (r.type === "condition" && r.data && r.data.condType === "our_ban") || (r.type === "hero" && r.data && r.data.tag === "ban"))
      .map((r) => ({ heroId: (r.data && r.data.heroId) || null, text: r.type === "condition" ? (r.data && r.data.text) || "" : "" }));
    const comps = reached.filter((r) => r.type === "comp")
      .sort((a, b) => tagRank(a.data && a.data.tag) - tagRank(b.data && b.data.tag))
      .slice(0, 2)
      .map((c, i) => ({ slots: (c.data && c.data.slots) || [null, null, null, null, null], tag: (c.data && c.data.tag) || null, alt: i === 1 }));
    const memos = reached.filter((r) => r.type === "text").map((r) => ({ title: (r.data && r.data.title) || "", body: firstLine(r.data && r.data.body, 60) }));
    rows.push({ kind: "cond", condType: ct, heroId: (n.data && n.data.heroId) || null, text: (n.data && n.data.text) || "", ourBans, comps, memos, y: absY(n), group: groupLabel(n) });
  }

  // 3) 기본안: 어떤 조건에서도 도달되지 않는 조합 노드(맵 맨 위)
  const base = [];
  for (const n of nodes) {
    if (n.type === "comp" && !reachedByAnyCond.has(n.id)) {
      base.push({ kind: "base", comps: [{ slots: (n.data && n.data.slots) || [null, null, null, null, null], tag: (n.data && n.data.tag) || null, alt: false }], ourBans: [], memos: [], y: absY(n), group: groupLabel(n) });
    }
  }

  // 4) 미포함: 연결(엣지) 없는 영웅/텍스트 노드 수
  const connected = new Set();
  for (const e of edges) { connected.add(e.source); connected.add(e.target); }
  const excludedCount = nodes.filter((n) => (n.type === "hero" || n.type === "text") && !connected.has(n.id)).length;

  const rowsSorted = [...base.sort((a, b) => a.y - b.y), ...rows.sort((a, b) => a.y - b.y)];
  return { rows: rowsSorted, excludedCount };
}
