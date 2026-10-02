// 캔버스 노드가 쓰는 액션/상태 컨텍스트(노드 수정·복제·삭제·피커 열기·언어).
import { createContext, useContext } from "react";
export const CanvasCtx = createContext({
  lang: "ko",
  updateNodeData: () => {},
  updateEdgeData: () => {},
  duplicateNode: () => {},
  deleteNode: () => {},
  openHeroPicker: () => {},   // (nodeId, { slotIndex, role })
  openCondEdit: () => {},     // (nodeId)
});
export const useCanvasCtx = () => useContext(CanvasCtx);
