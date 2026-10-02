// test_extract.mjs — extract.js 단위 테스트(node 실행). bare assert + __main__ 스타일.
import assert from "node:assert";
import { extractSheet } from "./extract.js";

const cond = (id, condType, extra = {}, pos = { x: 0, y: 0 }) => ({ id, type: "condition", position: pos, data: { condType, ...extra } });
const comp = (id, slots, extra = {}, pos = { x: 0, y: 0 }) => ({ id, type: "comp", position: pos, data: { slots, ...extra } });
const hero = (id, heroId, extra = {}, pos = { x: 0, y: 0 }) => ({ id, type: "hero", position: pos, data: { heroId, ...extra } });
const text = (id, title, body = "", pos = { x: 0, y: 0 }) => ({ id, type: "text", position: pos, data: { title, body } });
const edge = (s, t) => ({ id: s + "-" + t, source: s, target: t });

function test_cond_to_comp() {
  const r = extractSheet({
    nodes: [cond("c1", "enemy_ban", { heroId: "genji" }, { x: 0, y: 100 }), comp("m1", ["dva", null, null, null, null], { tag: "priority" })],
    edges: [edge("c1", "m1")],
  });
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].kind, "cond");
  assert.equal(r.rows[0].condType, "enemy_ban");
  assert.equal(r.rows[0].heroId, "genji");
  assert.equal(r.rows[0].comps.length, 1);
  assert.deepEqual(r.rows[0].comps[0].slots[0], "dva");
  console.log("test_cond_to_comp OK — 조건→조합");
}

function test_base() {
  // 도달되지 않는 조합 = 기본안(맨 위)
  const r = extractSheet({
    nodes: [comp("base", ["rein", null, null, null, null]), cond("c1", "enemy_ban", {}, { x: 0, y: 50 }), comp("m1", [null, null, null, null, null])],
    edges: [edge("c1", "m1")],
  });
  assert.equal(r.rows[0].kind, "base"); // 기본안 먼저
  assert.equal(r.rows[0].comps[0].slots[0], "rein");
  assert.ok(r.rows.some((x) => x.kind === "cond"));
  console.log("test_base OK — 기본안(미도달 조합) 맨 위");
}

function test_two_comps_alt() {
  // 우선→대안 순, 최대 2개, 두 번째 alt
  const r = extractSheet({
    nodes: [cond("c1", "enemy_pick"), comp("mA", ["a"], { tag: "alt" }), comp("mP", ["p"], { tag: "priority" }), comp("mX", ["x"], {})],
    edges: [edge("c1", "mA"), edge("c1", "mP"), edge("c1", "mX")],
  });
  const row = r.rows.find((x) => x.kind === "cond");
  assert.equal(row.comps.length, 2, "최대 2개");
  assert.equal(row.comps[0].slots[0], "p", "우선 먼저");
  assert.equal(row.comps[0].alt, false);
  assert.equal(row.comps[1].slots[0], "a", "대안 두번째");
  assert.equal(row.comps[1].alt, true);
  console.log("test_two_comps_alt OK — 우선→대안 최대 2, 두번째 대안 표기");
}

function test_depth_and_stop() {
  // 깊이 ≤2: c1→A→B→C 에서 C(깊이3) 제외. 조건 중단: c1→c2→m2 에서 m2 는 c1 행에 없음.
  const r = extractSheet({
    nodes: [
      cond("c1", "enemy_ban"), comp("A", ["A"]), comp("B", ["B"]), comp("C", ["C"]),
      cond("c2", "etc"), comp("m2", ["m2"]),
    ],
    edges: [edge("c1", "A"), edge("A", "B"), edge("B", "C"), edge("c1", "c2"), edge("c2", "m2")],
  });
  const row1 = r.rows.find((x) => x.kind === "cond" && x.condType === "enemy_ban");
  const compSlots = row1.comps.map((c) => c.slots[0]);
  assert.ok(compSlots.includes("A"), "깊이1 A 포함");
  assert.ok(compSlots.includes("B"), "깊이2 B 포함");
  assert.ok(!compSlots.includes("C"), "깊이3 C 제외");
  assert.ok(!compSlots.includes("m2"), "조건 c2 너머 m2 제외(조건에서 중단)");
  console.log("test_depth_and_stop OK — 깊이 ≤2 + 조건 노드 중단");
}

function test_our_ban() {
  // 우리 밴: 밴 태그 영웅 + our_ban 조건(결과면 자기 행 없음)
  const r = extractSheet({
    nodes: [cond("c1", "enemy_ban"), hero("h1", "tracer", { tag: "ban" }), cond("ob", "our_ban", { heroId: "sombra" })],
    edges: [edge("c1", "h1"), edge("c1", "ob")],
  });
  const condRows = r.rows.filter((x) => x.kind === "cond");
  assert.equal(condRows.length, 1, "our_ban 결과는 자기 행 안 만듦");
  const bans = condRows[0].ourBans.map((b) => b.heroId);
  assert.ok(bans.includes("tracer"), "밴 태그 영웅");
  assert.ok(bans.includes("sombra"), "our_ban 조건");
  console.log("test_our_ban OK — 우리 밴(밴 태그 영웅 + our_ban 조건)");
}

function test_excluded() {
  // 연결 없는 영웅/텍스트 = 미포함 집계, 인쇄 행에는 없음
  const r = extractSheet({
    nodes: [cond("c1", "enemy_ban"), comp("m1", []), hero("lone", "ana"), text("note", "메모만")],
    edges: [edge("c1", "m1")],
  });
  assert.equal(r.excludedCount, 2, "고립 영웅+텍스트 2개");
  assert.ok(!r.rows.some((x) => x.kind === "hero"), "고립 노드는 행 없음");
  console.log("test_excluded OK — 미포함 N개 집계");
}

try {
  test_cond_to_comp();
  test_base();
  test_two_comps_alt();
  test_depth_and_stop();
  test_our_ban();
  test_excluded();
  console.log("ALL PASS");
} catch (e) {
  console.error("FAIL:", e.message);
  process.exit(1);
}
