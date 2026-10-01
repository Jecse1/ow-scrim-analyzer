// heroMapAssets.tsx — 밴픽/드래프트 플랜 공용 자산 컴포넌트·리졸버(STEP1 추출).
//
// BanpickApp.tsx 에 인라인이던 영웅/맵/모드/역할 썸네일·오버레이와 그 경로 리졸버를
// 값·렌더 동일하게 이곳으로 옮겨 export 한다(추출 전후 렌더 동일 — DOM/픽셀 검증).
// 외부 CDN 0, 기존 public/ 자산만 사용: /heroes/*, /maps/*, /mapicons/*, /roles/*.
// 데이터·헬퍼는 gameData(SSOT)에서 파생. 스타일 클래스(bp-mapicon·bp-roleicon)는 banpick.css.
import React from "react";
import { BANPICK_HEROES, BANPICK_MAPS, getHeroByName } from "../gameData";

export type Role = "Tank" | "Damage" | "Support";
export type MapType = "Control" | "Escort" | "Hybrid" | "Push" | "Flashpoint";
export type Lang = "ko" | "en" | "zh";
export type Hero = { id: string; name: string; role: Role };
export type MapInfo = { id: string; name: string; type: MapType };

const HEROES = BANPICK_HEROES as Hero[];
const MAPS = BANPICK_MAPS as MapInfo[];

export const ROLE_LABELS: Record<Lang, Record<Role, string>> = {
  ko: { Tank: "탱커", Damage: "딜러", Support: "힐러" },
  en: { Tank: "Tank", Damage: "Damage", Support: "Support" },
  zh: { Tank: "重装", Damage: "输出", Support: "支援" },
};
export const MAP_LABELS: Record<Lang, Record<MapType, string>> = {
  ko: { Control: "쟁탈", Escort: "호위", Hybrid: "혼합", Push: "밀기", Flashpoint: "플래시포인트" },
  en: { Control: "Control", Escort: "Escort", Hybrid: "Hybrid", Push: "Push", Flashpoint: "Flashpoint" },
  zh: { Control: "占领要点", Escort: "运载目标", Hybrid: "混合", Push: "推进", Flashpoint: "闪点行动" },
};

/* === image helpers === */
export const IMG_EXTS = [".png", ".webp", ".jpg", ".jpeg"];
// [STEP3] 영웅 썸네일 후보: 정본 image 필드(getHeroByName) 1순위 → 확장자/표시명/id 순 폴백.
//   후보 순서: /heroes/{image}.png → {image}.webp/.jpg/.jpeg → {name}.* → {id}.*
//   1순위(image.png)가 아닌 후보로 표시되면(=image 필드 오류 신호) 개발 모드에서 경고(HeroThumb).
export function heroSrcCandidates(id: string): string[] {
  const h = HEROES.find((x) => x.id === id);
  const entry = h?.name ? getHeroByName(h.name) : null;
  const bases: string[] = [];
  if (entry?.image) bases.push(entry.image); // 1순위: 정본 image
  if (h?.name) bases.push(h.name);           // 폴백: 표시명
  bases.push(id);                            // 폴백: id
  const list: string[] = [];
  for (const b of bases) for (const ext of IMG_EXTS) list.push(`/heroes/${encodeURIComponent(b)}${ext}`);
  return [...new Set(list)];
}
export function mapSrcCandidates(id: string): string[] {
  const m = MAPS.find((x) => x.id === id);
  const bases: string[] = [];
  if (m?.name) bases.push(m.name);
  bases.push(id);
  const list: string[] = [];
  for (const b of bases) for (const ext of IMG_EXTS) list.push(`/maps/${encodeURIComponent(b)}${ext}`);
  return list;
}

/** 맵 썸네일 */
export function MapThumb({ id, className, contain = false }: { id: string | null; className?: string; contain?: boolean }) {
  const [idx, setIdx] = React.useState(0);
  const candidates = React.useMemo(() => (id ? mapSrcCandidates(id) : []), [id]);
  if (!id || idx >= candidates.length) {
    return <div className={`absolute inset-0 bg-gradient-to-br from-neutral-100 to-neutral-200 ${className ?? ""}`} />;
  }
  return (
    <img
      src={candidates[idx]}
      alt={id ?? ""}
      onError={() => setIdx((i) => i + 1)}
      draggable={false}
      className={`absolute inset-0 w-full h-full ${contain ? "object-contain" : "object-cover"} ${className ?? ""}`}
    />
  );
}

/** 영웅 썸네일 */
export function HeroThumb({ id, className, contain = true }: { id: string | null; className?: string; contain?: boolean }) {
  const [idx, setIdx] = React.useState(0);
  const candidates = React.useMemo(() => (id ? heroSrcCandidates(id) : []), [id]);
  if (!id || idx >= candidates.length) {
    return <div className={`absolute inset-0 bg-gradient-to-br from-neutral-100 to-neutral-200 ${className ?? ""}`} />;
  }
  return (
    <img
      src={candidates[idx]}
      alt={id ?? ""}
      onError={() => setIdx((i) => i + 1)}
      onLoad={() => { if (idx > 0 && import.meta.env.DEV) console.warn("[banpick] image fallback", id, candidates[idx]); }}
      draggable={false}
      className={["absolute inset-0 w-full h-full", contain ? "object-contain" : "object-cover", "object-center", className ?? ""].join(" ")}
    />
  );
}

/** 밴 오버레이 */
export function BanSlashOverlay() {
  return (
    <div className="pointer-events-none absolute inset-0 z-30">
      <div className="absolute left-[-30%] right-[-30%] top-1/2 h-[5px] bg-red-600/90 -rotate-45" />
      <div className="absolute left-[-30%] right-[-30%] top-[calc(50%+11px)] h-[5px] bg-red-600/90 -rotate-45" />
    </div>
  );
}

/** 맵 타입 아이콘/텍스트 */
export const MAPICON_EXTS = [".svg", ".png", ".webp", ".jpg", ".jpeg"];
export function mapTypeIconCandidates(mt: MapType): string[] {
  const bases = [mt.toLowerCase(), MAP_LABELS.ko[mt], MAP_LABELS.en[mt]];
  const list: string[] = [];
  for (const b of bases) for (const ext of MAPICON_EXTS) list.push(`/mapicons/${encodeURIComponent(b)}${ext}`);
  return list;
}
export function MapTypeBadge({ type, lang, className }: { type: MapType; lang: Lang; className?: string }) {
  const [idx, setIdx] = React.useState(0);
  const cands = React.useMemo(() => mapTypeIconCandidates(type), [type]);
  if (idx >= cands.length) {
    return <span className={`text-[10px] opacity-80 ${className ?? ""}`}>{MAP_LABELS[lang][type]}</span>;
  }
  return (
    <img
      src={cands[idx]}
      alt={MAP_LABELS[lang][type]}
      title={MAP_LABELS[lang][type]}
      onError={() => setIdx((i) => i + 1)}
      // bp-mapicon: 어두운 아이콘을 테마 텍스트 색 실루엣으로(다크=흰/라이트=검) 렌더해 식별 복구
      className={`bp-mapicon object-contain ${className ?? ""}`}
      draggable={false}
    />
  );
}

/** 역할 아이콘/텍스트 */
export const ROLE_ICON_EXTS = [".svg", ".png", ".webp", ".jpg", ".jpeg"];
export function roleIconCandidates(role: Role, lang: Lang): string[] {
  const bases = [role.toLowerCase(), ROLE_LABELS.ko[role], ROLE_LABELS.en[role]];
  const list: string[] = [];
  for (const b of bases) for (const ext of ROLE_ICON_EXTS) list.push(`/roles/${encodeURIComponent(b)}${ext}`);
  return list;
}
export function RoleIcon({ role, lang, className }: { role: Role; lang: Lang; className?: string }) {
  const [idx, setIdx] = React.useState(0);
  const cands = React.useMemo(() => roleIconCandidates(role, lang), [role, lang]);
  if (idx >= cands.length) {
    return <span className={`text-[10px] opacity-80 ${className ?? ""}`}>{ROLE_LABELS[lang][role]}</span>;
  }
  return (
    <img
      src={cands[idx]}
      alt={ROLE_LABELS[lang][role]}
      title={ROLE_LABELS[lang][role]}
      onError={() => setIdx((i) => i + 1)}
      className={`bp-roleicon object-contain ${className ?? ""}`}
      draggable={false}
    />
  );
}
