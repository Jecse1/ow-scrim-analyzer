// test_extract.mjs — extract.js 단위 테스트(node 실행). 밴 선후 순서(computeBanOrder) 반영 shape.
import assert from "node:assert";
import { extractSheet } from "./extract.js";

const cond = (id, condType, extra = {}, pos = { x: 0, y: 0 }) => ({ id, type: "condition", position: pos, data: { condType, ...extra } });
const comp = (id, slots, extra = {}, pos = { x: 0, y: 0 }) => ({ id, type: "comp", position: pos, data: { slots, ...extra } });
const hero = (id, heroId, extra = {}, pos = { x: 0, y: 0 }) => ({ id, type: "hero", position: pos, data: { heroId, ...extra } });
const text = (id, title, body = "", pos = { x: 0, y: 0 }) => ({ id, type: "text", position: pos, data: { title, body } });
const edge = (s, t) => ({ id: s + "-" + t, source: s, target: t });
const banOrder = (row, o) => row.bans.find((b) => b.order === o);

function test_cond_to_comp() {
  const r = extractSheet({
    nodes: [cond("c1", "enemy_ban", { heroId: "genji" }, { x: 0, y: 100 }), comp("m1", ["dva", null, null, null, null], { tag: "priority" })],
    edges: [edge("c1", "m1")],
  });
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].kind, "chain");
  assert.equal(banOrder(r.rows[0], 1).side, "theirs");
  assert.equal(banOrder(r.rows[0], 1).hero, "genji");
  assert.equal(r.rows[0].comps[0].slots[0], "dva");
  console.log("test_cond_to_comp OK — 조건→조합(밴 theirs1)");
}

function test_base() {
  const r = extractSheet({
    nodes: [comp("base", ["rein", null, null, null, null]), cond("c1", "enemy_ban", {}, { x: 0, y: 50 }), comp("m1", [null, null, null, null, null])],
    edges: [edge("c1", "m1")],
  });
  assert.equal(r.rows[0].kind, "base");
  assert.equal(r.rows[0].comps[0].slots[0], "rein");
  assert.equal(r.rows[0].bans.length, 0);
  assert.ok(r.rows.some((x) => x.kind === "chain"));
  console.log("test_base OK — 기본안(미도달 조합) 맨 위, 밴 없음");
}

function test_two_comps_alt() {
  const r = extractSheet({
    nodes: [cond("c1", "enemy_pick"), comp("mA", ["a"], { tag: "alt" }), comp("mP", ["p"], { tag: "priority" }), comp("mX", ["x"], {})],
    edges: [edge("c1", "mA"), edge("c1", "mP"), edge("c1", "mX")],
  });
  const row = r.rows.find((x) => x.kind === "chain");
  assert.equal(row.comps.length, 2, "최대 2개");
  assert.equal(row.comps[0].slots[0], "p", "우선 먼저");
  assert.equal(row.comps[0].alt, false);
  assert.equal(row.comps[1].slots[0], "a", "대안 두번째");
  assert.equal(row.comps[1].alt, true);
  console.log("test_two_comps_alt OK — 우선→대안 최대 2, 두번째 대안 표기");
}

function test_depth_and_stop() {
  // 밴 3번째(b3)·그 뒤 조합 제외. b3 뒤 comp 는 도달 안 돼 기본안으로.
  const r = extractSheet({
    nodes: [cond("b1", "enemy_ban"), cond("b2", "our_ban"), cond("b3", "enemy_ban"), comp("m", ["m"])],
    edges: [edge("b1", "b2"), edge("b2", "b3"), edge("b3", "m")],
  });
  const chain = r.rows.find((x) => x.kind === "chain");
  assert.equal(chain.bans.length, 2, "밴 최대 2");
  assert.ok(!banOrder(chain, 3), "3번째 밴 없음");
  assert.equal(chain.comps.length, 0, "깊이 초과로 조합 미도달");
  assert.ok(r.rows.some((x) => x.kind === "base" && x.comps[0].slots[0] === "m"), "미도달 조합은 기본안");
  console.log("test_depth_and_stop OK — 밴 깊이 제한 + 중단");
}

function test_our_ban() {
  // 금지 태그 영웅 = 우리 밴(ours), order 2
  const r = extractSheet({
    nodes: [cond("c1", "enemy_ban"), hero("h1", "tracer", { tag: "ban" }), comp("m", ["m"])],
    edges: [edge("c1", "h1"), edge("h1", "m")],
  });
  const chain = r.rows.find((x) => x.kind === "chain");
  assert.equal(banOrder(chain, 2).side, "ours", "금지 태그 영웅=우리 밴");
  assert.equal(banOrder(chain, 2).hero, "tracer");
  console.log("test_our_ban OK — 금지 태그 영웅 = 우리 밴");
}

function test_excluded() {
  const r = extractSheet({
    nodes: [cond("c1", "enemy_ban"), comp("m1", []), hero("lone", "ana"), text("note", "메모만")],
    edges: [edge("c1", "m1")],
  });
  assert.equal(r.excludedCount, 2, "고립 영웅+텍스트 2개");
  assert.ok(!r.rows.some((x) => x.kind === "hero"), "고립 노드는 행 없음");
  console.log("test_excluded OK — 미포함 N개 집계");
}

// ── 밴 순서 케이스 ──
function test_order_theirs_first() {
  const r = extractSheet({ nodes: [cond("eb", "enemy_ban"), cond("ob", "our_ban"), comp("m", ["m"])], edges: [edge("eb", "ob"), edge("ob", "m")] });
  const c = r.rows.find((x) => x.kind === "chain");
  assert.equal(banOrder(c, 1).side, "theirs");
  assert.equal(banOrder(c, 2).side, "ours");
  console.log("test_order_theirs_first OK — 상대 선밴(theirs1·ours2)");
}
function test_order_ours_first() {
  const r = extractSheet({ nodes: [cond("ob", "our_ban"), cond("eb", "enemy_ban"), comp("m", ["m"])], edges: [edge("ob", "eb"), edge("eb", "m")] });
  const c = r.rows.find((x) => x.kind === "chain");
  assert.equal(banOrder(c, 1).side, "ours");
  assert.equal(banOrder(c, 2).side, "theirs");
  console.log("test_order_ours_first OK — 우리 선밴(ours1·theirs2)");
}
function test_pickcond() {
  const r = extractSheet({ nodes: [cond("ep", "enemy_pick", { text: "윈스턴 선픽" }), cond("eb", "enemy_ban"), comp("m", ["m"])], edges: [edge("ep", "eb"), edge("eb", "m")] });
  const c = r.rows.find((x) => x.kind === "chain");
  assert.ok(c.pickCond && c.pickCond.side === "theirs", "선픽 조건 보관");
  assert.equal(c.pickCond.text, "윈스턴 선픽");
  assert.equal(banOrder(c, 1).side, "theirs");
  assert.equal(c.comps[0].slots[0], "m");
  console.log("test_pickcond OK — 선픽 조건 + 밴");
}

try {
  test_cond_to_comp();
  test_base();
  test_two_comps_alt();
  test_depth_and_stop();
  test_our_ban();
  test_excluded();
  test_order_theirs_first();
  test_order_ours_first();
  test_pickcond();
  console.log("ALL PASS");
} catch (e) {
  console.error("FAIL:", e.message);
  process.exit(1);
}
