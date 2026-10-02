// 캔버스 노드용 영웅 조회(id → 엔트리/표시명/역할).
import { BANPICK_HEROES, getDisplayName } from "../../gameData";

const BY_ID = new Map(BANPICK_HEROES.map((h) => [h.id, h]));
export const heroById = (id) => BY_ID.get(id) || null;
export const heroName = (id, lang) => { const h = BY_ID.get(id); return h ? getDisplayName(h.name, lang) : (id || ""); };
export const heroRole = (id) => { const h = BY_ID.get(id); return h ? h.role : null; };
