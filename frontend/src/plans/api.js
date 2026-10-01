// plans/api.js — 드래프트 플랜 REST 클라이언트(axios). 상대경로 /api/plans/* (dev 프록시·prod nginx).
import axios from "axios";

const base = "/api/plans";

export const plansApi = {
  listBoards: () => axios.get(`${base}/boards`).then((r) => r.data),
  createBoard: (name) => axios.post(`${base}/boards`, { name }).then((r) => r.data),
  updateBoard: (id, patch) => axios.patch(`${base}/boards/${id}`, patch).then((r) => r.data),
  deleteBoard: (id) => axios.delete(`${base}/boards/${id}`).then((r) => r.data),
  createMap: (boardId, mapId) => axios.post(`${base}/maps`, { board_id: boardId, map_id: mapId }).then((r) => r.data),
  updateMap: (id, patch) => axios.patch(`${base}/maps/${id}`, patch).then((r) => r.data),
  deleteMap: (id) => axios.delete(`${base}/maps/${id}`).then((r) => r.data),
  duplicateMap: (id) => axios.post(`${base}/maps/${id}/duplicate`).then((r) => r.data),
  getCanvas: (id) => axios.get(`${base}/maps/${id}/canvas`).then((r) => r.data),
  putCanvas: (id, canvas) => axios.put(`${base}/maps/${id}/canvas`, canvas).then((r) => r.data),
};

// 서버 updated_at 은 UTC naive(SQLite CURRENT_TIMESTAMP) → tz 없으면 'Z'로 간주해 파싱.
export function parseServerTime(iso) {
  if (!iso) return null;
  const s = /[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : iso + "Z";
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

// "방금 / N분 전 / N시간 전 / N일 전 / YYYY-MM-DD" (ko/en/zh). nowMs 주입 가능(테스트/결정성).
export function formatRelative(iso, lang = "ko", nowMs = Date.now()) {
  const d = parseServerTime(iso);
  if (!d) return "";
  const diff = Math.max(0, nowMs - d.getTime());
  const min = Math.floor(diff / 60000);
  const hr = Math.floor(diff / 3600000);
  const day = Math.floor(diff / 86400000);
  const L = {
    ko: { now: "방금", min: (n) => `${n}분 전`, hr: (n) => `${n}시간 전`, day: (n) => `${n}일 전` },
    en: { now: "just now", min: (n) => `${n}m ago`, hr: (n) => `${n}h ago`, day: (n) => `${n}d ago` },
    zh: { now: "刚刚", min: (n) => `${n}分钟前`, hr: (n) => `${n}小时前`, day: (n) => `${n}天前` },
  }[lang] || null;
  const t = L || { now: "방금", min: (n) => `${n}분 전`, hr: (n) => `${n}시간 전`, day: (n) => `${n}일 전` };
  if (day >= 7) {
    const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), dd = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${dd}`;
  }
  if (day >= 1) return t.day(day);
  if (hr >= 1) return t.hr(hr);
  if (min >= 1) return t.min(min);
  return t.now;
}
