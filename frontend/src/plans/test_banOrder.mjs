// test_banOrder.mjs — computeBanOrder 단위 테스트. 실행: node test_banOrder.mjs
import { computeBanOrder } from "./banOrder.js";

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => { if (cond) { pass++; console.log(`OK ${name}${extra ? " — " + extra : ""}`); } else { fail++; console.log(`FAIL ${name}${extra ? " — " + extra : ""}`); } };

const cond = (id, ct, extra = {}) => ({ id, type: "condition", position: { x: 0, y: 0 }, data: { condType: ct, ...extra } });
const comp = (id, slots = [null, null, null, null, null]) => ({ id, type: "comp", position: { x: 0, y: 0 }, data: { slots } });
const hero = (id, heroId, tag) => ({ id, type: "hero", position: { x: 0, y: 0 }, data: { heroId, tag } });
const E = (s, t) => ({ id: `${s}_${t}`, source: s, target: t });
const banOf = (ch, order) => ch.bans.find((b) => b.order === order);

// 1) 상대 → 우리 → 조합 = 상대 선밴 (theirs 1, ours 2)
{
  const { chains, byNode } = computeBanOrder([cond("eb", "enemy_ban"), cond("ob", "our_ban"), comp("m")], [E("eb", "ob"), E("ob", "m")]);
  const c = chains[0];
  ok("상대→우리→조합: theirs1·ours2", chains.length === 1 && banOf(c, 1).side === "theirs" && banOf(c, 2).side === "ours" && c.compIds.includes("m"),
    `bans=${JSON.stringify(c.bans.map((b) => [b.order, b.side]))}`);
  ok("byNode 기록", byNode["eb"][0].order === 1 && byNode["ob"][0].order === 2);
}
// 2) 우리 → 상대 → 조합 = 우리 선밴 (ours 1, theirs 2)
{
  const { chains } = computeBanOrder([cond("ob", "our_ban"), cond("eb", "enemy_ban"), comp("m")], [E("ob", "eb"), E("eb", "m")]);
  const c = chains[0];
  ok("우리→상대→조합: ours1·theirs2", banOf(c, 1).side === "ours" && banOf(c, 2).side === "theirs",
    `bans=${JSON.stringify(c.bans.map((b) => [b.order, b.side]))}`);
}
// 3) 밴 1개
{
  const { chains } = computeBanOrder([cond("eb", "enemy_ban"), comp("m")], [E("eb", "m")]);
  const c = chains[0];
  ok("밴 1개", c.bans.length === 1 && banOf(c, 1).side === "theirs" && c.compIds.includes("m"));
}
// 4) 선픽 + 밴 2개
{
  const { chains } = computeBanOrder(
    [cond("ep", "enemy_pick", { text: "윈스턴 선픽" }), cond("eb", "enemy_ban"), cond("ob", "our_ban"), comp("m")],
    [E("ep", "eb"), E("eb", "ob"), E("ob", "m")]);
  const c = chains[0];
  ok("선픽+밴 2개", c.pickCond && c.pickCond.side === "theirs" && c.bans.length === 2 && banOf(c, 1).side === "theirs" && banOf(c, 2).side === "ours",
    `pick=${c.pickCond && c.pickCond.side}, bans=${c.bans.length}`);
}
// 5) 분기 2조합 (밴 순서 공유)
{
  const { chains } = computeBanOrder([cond("eb", "enemy_ban"), comp("m1"), comp("m2")], [E("eb", "m1"), E("eb", "m2")]);
  const c = chains[0];
  ok("분기 2조합: 밴 공유", c.bans.length === 1 && c.compIds.length === 2 && c.compIds.includes("m1") && c.compIds.includes("m2"),
    `comps=${c.compIds.length}`);
}
// 6) 깊이 초과 중단 (밴 3번째·그 뒤 조합 제외)
{
  const { chains } = computeBanOrder(
    [cond("b1", "enemy_ban"), cond("b2", "our_ban"), cond("b3", "enemy_ban"), comp("m")],
    [E("b1", "b2"), E("b2", "b3"), E("b3", "m")]);
  const c = chains[0];
  ok("깊이 초과 중단", c.bans.length === 2 && !c.bans.some((b) => b.nodeId === "b3") && c.compIds.length === 0,
    `bans=${c.bans.length}, comps=${c.compIds.length}`);
}
// 7) 금지 태그 영웅 = 우리 밴
{
  const { chains } = computeBanOrder([cond("eb", "enemy_ban"), hero("h", "tracer", "ban"), comp("m")], [E("eb", "h"), E("h", "m")]);
  const c = chains[0];
  ok("금지 태그 영웅 = 우리 밴(order2)", banOf(c, 2) && banOf(c, 2).side === "ours" && banOf(c, 2).hero === "tracer",
    `ban2=${JSON.stringify(banOf(c, 2))}`);
}

console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
