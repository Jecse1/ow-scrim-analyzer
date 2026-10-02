// 캔버스 노드가 쓰는 액션/상태 컨텍스트(노드 수정·복제·삭제·피커 열기·언어).
import { createContext, useContext } from "react";
export const CanvasCtx = createContext({
  lang: "ko",
  updateNodeData: () => {},
  updateEdgeData: () => {},
  duplicateNode: () => {},
  deleteNode: () => {},
  deleteEdge: () => {},       // (edgeId)
  hoveredEdgeId: null,        // 호버 중인 엣지 id(중앙 × 표시)
  banByNode: {},              // nodeId -> [{order, side}] (밴 선후 순서, computeBanOrder)
  openHeroPicker: () => {},   // (nodeId, { slotIndex, role })
  openCondEdit: () => {},     // (nodeId)
});
export const useCanvasCtx = () => useContext(CanvasCtx);
