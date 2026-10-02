// pngExport.js — 캔버스(노드 전체 영역) PNG 내보내기. 배경 투명 옵션. 파일명 <보드>_<맵>_<YYMMDD>.png.
import { getNodesBounds, getViewportForBounds } from "@xyflow/react";
import { toPng } from "html-to-image";

const PAD = 40;
const MAXW = 2600, MAXH = 2000;

export async function exportCanvasPng({ nodes, filename, transparent }) {
  if (!nodes || nodes.length === 0) return false;
  const bounds = getNodesBounds(nodes);
  const w = Math.min(MAXW, Math.max(200, bounds.width + PAD * 2));
  const h = Math.min(MAXH, Math.max(150, bounds.height + PAD * 2));
  const vp = getViewportForBounds(bounds, w, h, 0.3, 2, PAD);
  const el = document.querySelector(".react-flow__viewport");
  if (!el) return false;
  const dataUrl = await toPng(el, {
    backgroundColor: transparent ? undefined : getComputedStyle(document.querySelector(".plan-root") || document.body).getPropertyValue("--pl-bg").trim() || "#0b0b0d",
    width: w, height: h,
    style: { width: w + "px", height: h + "px", transform: `translate(${vp.x}px, ${vp.y}px) scale(${vp.zoom})` },
    pixelRatio: 2,
    filter: (node) => !(node.classList && (node.classList.contains("react-flow__minimap") || node.classList.contains("react-flow__controls") || node.classList.contains("react-flow__handle") || node.classList.contains("pl-node-toolbar"))),
  });
  const a = document.createElement("a");
  a.href = dataUrl; a.download = filename;
  a.click();
  return true;
}

export function pngFilename(board, map, now = new Date()) {
  const safe = (s) => String(s || "").replace(/[\\/:*?"<>|\s]+/g, "_").slice(0, 40);
  const yy = String(now.getFullYear()).slice(2), mm = String(now.getMonth() + 1).padStart(2, "0"), dd = String(now.getDate()).padStart(2, "0");
  return `${safe(board)}_${safe(map)}_${yy}${mm}${dd}.png`;
}
