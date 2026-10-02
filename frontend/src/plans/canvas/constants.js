// canvas/constants.js — 조건 유형·색 태그·조합 슬롯 역할 정의(ko/en/zh 라벨).
export const COND_TYPES = {
  enemy_ban:  { color: "#ef4444", isBan: true,  label: { ko: "상대 밴",  en: "Enemy ban",  zh: "对方禁用" } },
  our_ban:    { color: "#f59e0b", isBan: true,  label: { ko: "우리 밴",  en: "Our ban",    zh: "我方禁用" } },
  enemy_pick: { color: "#3b82f6", isBan: false, label: { ko: "상대 선픽", en: "Enemy pick", zh: "对方先选" } },
  our_pick:   { color: "#22c55e", isBan: false, label: { ko: "우리 선픽", en: "Our pick",   zh: "我方先选" } },
  etc:        { color: "#9ca3af", isBan: false, label: { ko: "기타",     en: "Other",      zh: "其他" } },
};
export const COND_ORDER = ["enemy_ban", "our_ban", "enemy_pick", "our_pick", "etc"];

export const COLOR_TAGS = {
  priority: { color: "#22c55e", label: { ko: "우선", en: "Priority", zh: "优先" } },
  alt:      { color: "#3b82f6", label: { ko: "대안", en: "Alt",      zh: "备选" } },
  ban:      { color: "#ef4444", label: { ko: "금지", en: "Ban",      zh: "禁止" } },
  memo:     { color: "#a1a1aa", label: { ko: "메모", en: "Memo",     zh: "备注" } },
};
export const COLOR_TAG_ORDER = ["priority", "alt", "ban", "memo"];

export const SLOT_ROLES = ["Tank", "Damage", "Damage", "Support", "Support"];

// 노드 기본 폭(템플릿 좌표 계산·겹침 방지용). NodeShell minWidth 로도 사용.
export const NODE_W = { condition: 220, hero: 120, comp: 320, text: 260, group: 300 };

export const NODE_KINDS = [
  { type: "condition", key: "1", label: { ko: "조건", en: "Condition", zh: "条件" } },
  { type: "hero",      key: "2", label: { ko: "영웅", en: "Hero",      zh: "英雄" } },
  { type: "comp",      key: "3", label: { ko: "조합", en: "Comp",      zh: "阵容" } },
  { type: "text",      key: "4", label: { ko: "텍스트", en: "Text",    zh: "文本" } },
];

export const tagBorder = (data) => (data && data.tag && COLOR_TAGS[data.tag] ? COLOR_TAGS[data.tag].color : undefined);
