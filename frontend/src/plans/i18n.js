// plans/i18n.js — 드래프트 플랜 UI 문자열(ko 우선). en/zh 는 제공 번역, 미정은 ko 폴백.
// TODO(i18n): en/zh 감수 필요(ko 기준 초벌).
const STR = {
  ko: {
    title: "드래프트 플랜", boards: "보드", newBoard: "새 보드", boardNamePh: "보드 이름",
    addBoard: "보드 추가", addMap: "맵 추가", open: "열기", duplicate: "복제",
    moveTo: "다른 보드로 이동", move: "이동", del: "삭제", cancel: "취소", done: "완료",
    rename: "이름 변경", nodesUnit: (n) => `노드 ${n}`,
    confirmDelBoardTitle: "보드 삭제", confirmDelBoard: (name, n) => `'${name}' 보드와 맵 ${n}장을 삭제할까요? 되돌릴 수 없습니다.`,
    noBoards: "보드가 없습니다", firstBoard: "첫 보드 만들기",
    noMaps: "이 보드에 맵이 없습니다", addMapHint: "맵 추가로 구상을 시작하세요",
    search: "맵 검색…", allModes: "전체",
    poolActive: "맵풀 활성 맵", poolOther: "맵풀 외", expand: "펼치기", collapse: "접기",
    inBoard: "추가됨", back: "보드 홈", selectBoard: "보드 선택",
    canvasSoon: "캔버스 편집은 다음 단계에서 제공됩니다",
  },
  en: {
    title: "Draft Plans", boards: "Boards", newBoard: "New board", boardNamePh: "Board name",
    addBoard: "Add board", addMap: "Add map", open: "Open", duplicate: "Duplicate",
    moveTo: "Move to board", move: "Move", del: "Delete", cancel: "Cancel", done: "Done",
    rename: "Rename", nodesUnit: (n) => `${n} nodes`,
    confirmDelBoardTitle: "Delete board", confirmDelBoard: (name, n) => `Delete board '${name}' and its ${n} map(s)? This cannot be undone.`,
    noBoards: "No boards yet", firstBoard: "Create first board",
    noMaps: "No maps in this board", addMapHint: "Add a map to start planning",
    search: "Search maps…", allModes: "All",
    poolActive: "Map pool", poolOther: "Outside pool", expand: "Expand", collapse: "Collapse",
    inBoard: "Added", back: "Boards", selectBoard: "Select board",
    canvasSoon: "Canvas editing comes in the next step",
  },
  zh: {
    title: "草案计划", boards: "看板", newBoard: "新建看板", boardNamePh: "看板名称",
    addBoard: "添加看板", addMap: "添加地图", open: "打开", duplicate: "复制",
    moveTo: "移动到看板", move: "移动", del: "删除", cancel: "取消", done: "完成",
    rename: "重命名", nodesUnit: (n) => `${n} 节点`,
    confirmDelBoardTitle: "删除看板", confirmDelBoard: (name, n) => `删除看板 '${name}' 及其 ${n} 张地图？此操作不可撤销。`,
    noBoards: "暂无看板", firstBoard: "创建第一个看板",
    noMaps: "此看板暂无地图", addMapHint: "添加地图以开始规划",
    search: "搜索地图…", allModes: "全部",
    poolActive: "地图池", poolOther: "地图池外", expand: "展开", collapse: "收起",
    inBoard: "已添加", back: "看板", selectBoard: "选择看板",
    canvasSoon: "画布编辑将在下一步提供",
  },
};

export function planT(lang) {
  return STR[lang] || STR.ko;
}
