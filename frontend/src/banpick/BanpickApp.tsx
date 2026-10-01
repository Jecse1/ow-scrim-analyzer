import React, { useEffect, useMemo, useRef, useState } from "react";
import "./banpick.css";
import { useBanpickWS } from "./useBanpickWS";
import { useLanguage } from "../LanguageContext";
import { useTheme } from "../ThemeContext";
import { BANPICK_HEROES, BANPICK_MAPS, getHeroByName, getDisplayName, getMapDisplayName } from "../gameData";

// ── 멀티플레이어(1v1 실시간 대전) 스텁 — 이번 통합 단계는 SOLO 전용 ──
// 원본은 Firebase(Firestore 실시간 룸 + 익명 auth)로 코치 대전을 구현하지만,
// 분석기에 추가 의존성(firebase)을 들이지 않기 위해 transport를 no-op으로 대체한다.
// 대전 모드 진입 UI도 숨김(아래 Setup). 다음 단계에서 살릴 때 이 스텁만 교체하면 됨.
const ensureAnonAuth = async (): Promise<void> => {};
function useRoomSync(_roomId: string, _enabled: boolean) {
  return { remote: null as any, patch: async (_p?: any) => {}, pushFull: async (_s?: any) => {} };
}

/* ================= Constants & Types ================= */
const TIMER = { NORMAL: 30, PICK: 60 } as const; // 맵/밴:30초, 픽:60초
const MODE = { HERO_BAN_ONLY: 1, HERO_BAN_WITH_MAP: 2, FULL: 3 } as const;

type Team = "A" | "B";
type MapType = "Control" | "Escort" | "Hybrid" | "Push" | "Flashpoint";
type Role = "Tank" | "Damage" | "Support";
type Phase = "MAP_PICK" | "BAN_ORDER" | "HERO_BAN" | "HERO_PICK";
type Lang = "ko" | "en" | "zh";
type Side = "ATTACK" | "DEFENSE"; // 선공/선수비 타입
type PartMode = "SOLO" | "COACH_1V1";
type MyRole = "HOST" | Team | "OBS";
type Hero = { id: string; name: string; role: Role };
type MapInfo = { id: string; name: string; type: MapType };
type SetSnapshot = {
  bans: Record<Team, string[]>;
  picks: Record<Team, string[]>;
  map: string | null;
  winner: Team | null;
  mapPicker: Team | null;
  banFirst: Team;
  banSecond: Team;
  scoreA?: number;
  scoreB?: number;
  resultA?: "W" | "L" | "D"; // "D" (무승부) 추가
  attackOrDefense?: Side | null; // 선공/선수비 필드 추가
};

/** 1v1 READY 동기화 (rooms/{roomId} 문서의 readyA/readyB 필드만 관리) */
// SOLO 전용 스텁: READY 동기화 없음(대전 모드 미사용).
function useReadySyncFS(_roomId: string, _enabled: boolean) {
  const [readyA] = React.useState(false);
  const [readyB] = React.useState(false);
  const setReadyA = (_next: React.SetStateAction<boolean>) => {};
  const setReadyB = (_next: React.SetStateAction<boolean>) => {};
  return { readyA, readyB, setReadyA, setReadyB };
}

/* ===== helper (1v1 권한 매핑) ===== */
function roleAsTeam(partMode: PartMode, myRole: MyRole): Team | null {
  return partMode === "COACH_1V1" && myRole === "HOST" ? "A" : myRole === "A" || myRole === "B" ? myRole : null;
}
function canControlMapOrOrder(partMode: PartMode, myRole: MyRole, ownerTeam: Team): boolean {
  if (partMode === "SOLO") return true;
  const t = roleAsTeam(partMode, myRole);
  return t === ownerTeam;
}
function canControlBanTurn(partMode: PartMode, myRole: MyRole, turnTeam: Team): boolean {
  if (partMode === "SOLO") return true;
  const t = roleAsTeam(partMode, myRole);
  return t === turnTeam;
}

/* ===== i18n ===== */
const ROLE_LABELS: Record<Lang, Record<Role, string>> = {
  ko: { Tank: "탱커", Damage: "딜러", Support: "힐러" },
  en: { Tank: "Tank", Damage: "Damage", Support: "Support" },
  zh: { Tank: "重装", Damage: "输出", Support: "支援" },
};
const MAP_LABELS: Record<Lang, Record<MapType, string>> = {
  ko: { Control: "쟁탈", Escort: "호위", Hybrid: "혼합", Push: "밀기", Flashpoint: "플래시포인트" },
  en: { Control: "Control", Escort: "Escort", Hybrid: "Hybrid", Push: "Push", Flashpoint: "Flashpoint" },
  zh: { Control: "占领要点", Escort: "运载目标", Hybrid: "混合", Push: "推进", Flashpoint: "闪点行动" },
};
const SLOT_ROLES: Role[] = ["Tank", "Damage", "Damage", "Support", "Support"];

const STR = {
  ko: {
    title: "OW2 BAN Simulator",
    startSettings: "시작 설정",
    teamAName: "팀 A 이름",
    teamBName: "팀 B 이름",
    participation: "모드",
    solo: "solo",
    oneVone: "1vs1",
    scrim: "스크림 모드",
    format: "진행 방식",
    modeRange: "시뮬레이션 범위",
    mode1: "모드1: 영웅 밴",
    mode2: "모드2: 맵 + 영웅 밴",
    mode3: "모드3: 맵 + 영웅 밴 + 영웅 픽",
    firstPicker: "1세트 맵/밴 선택권",
    random: "랜덤",
    start: "시작하기",
    mapPick: "맵 선택",
    banOrder: "선/후밴 결정",
    heroBan: "영웅 밴",
    heroPick: "영웅 픽 (탱-딜-딜-힐-힐)",
    mapRight: "맵 선택권",
    pickFirst: "선밴",
    pickSecond: "후밴",
    timeLeft: "남은 시간",
    play: "시작",
    pause: "일시정지",
    confirmMap: "맵 확정",
    chooserRight: "선/후밴 선택권",
    confirm: "확정",
    curTurn: "현재 턴",
    banned: "밴됨",
    confirmBan: "밴 확정",
    slot: "슬롯",
    ready: "Ready",
    lockPickTeam: (name: string) => `${name} 픽 확정`,
    pickLockShort: "픽 확정",
    setWinner: "세트 승리 팀 선택",
    close: "닫기",
    showSummary: "경기 요약",
    showLog: "로그 보기",
    toastMap: "맵 확정",
    toastBan: "밴 확정",
    summary: "요약",
    noneYet: "아직 완료된 세트가 없습니다.",
    setN: (i: number) => `세트 ${i}`,
    map: "맵",
    mapPickerLabel: "맵 선택",
    firstBan: "선밴",
    secondBan: "후밴",
    none: "없음",
    inProgress: "진행 중",
    phase: "단계",
    selectedMap: "선택된 맵",
    nextFirstBan: "선밴 예정",
    log: "로그",
    noLog: "로그가 없습니다.",
    light: "☀️ 라이트 모드",
    dark: "🌙 다크 모드",
    koBtn: "한국어",
    enBtn: "English",
    teamNameRequired: "팀 이름을 입력해 주세요.",
    scoreDone: " · 경기 종료",
    openSummary: "요약",
    openLogs: "로그",
    seriesEnd: "경기가 종료되었습니다",
    endBtn: "종료",
  },
  en: {
    title: "OW2 BAN Simulator",
    startSettings: "Setup",
    teamAName: "Team A Name",
    teamBName: "Team B Name",
    participation: "Mode",
    solo: "solo",
    oneVone: "1vs1",
    scrim: "Scrim Mode",
    format: "Series Format",
    modeRange: "Simulation Scope",
    mode1: "Mode1: Hero Ban",
    mode2: "Mode2: Map + Hero Ban",
    mode3: "Mode3: Map + Hero Ban + Hero Pick",
    firstPicker: "Initial map/ban right",
    random: "Random",
    start: "Start",
    mapPick: "Map Pick",
    banOrder: "Decide First/Second Ban",
    heroBan: "Hero Ban",
    heroPick: "Hero Pick (Tank-Damage-Damage-Support-Support)",
    mapRight: "Map Right",
    pickFirst: "First Ban",
    pickSecond: "Second Ban",
    timeLeft: "Time Left",
    play: "Play",
    pause: "Pause",
    confirmMap: "Lock Map",
    chooserRight: "Ban Order Right",
    confirm: "Confirm",
    curTurn: "Turn",
    banned: "Banned",
    confirmBan: "Lock Ban",
    slot: "Slot",
    ready: "Ready",
    lockPickTeam: (name: string) => `${name} Picks Locked`,
    pickLockShort: "Lock Picks",
    setWinner: "Select Set Winner",
    close: "Close",
    showSummary: "Match Summary",
    showLog: "View Logs",
    toastMap: "Map Locked",
    toastBan: "Ban Locked",
    summary: "Summary",
    noneYet: "No finished sets yet.",
    setN: (i: number) => `Set ${i}`,
    map: "Map",
    mapPickerLabel: "Map Picker",
    firstBan: "First Ban",
    secondBan: "Second Ban",
    none: "None",
    inProgress: "In Progress",
    phase: "Phase",
    selectedMap: "Selected Map",
    nextFirstBan: "Next First Ban",
    log: "Logs",
    noLog: "No logs yet.",
    light: "☀️ Light Mode",
    dark: "🌙 Dark Mode",
    koBtn: "한국어",
    enBtn: "English",
    teamNameRequired: "Please enter team names.",
    scoreDone: " · Finished",
    openSummary: "Summary",
    openLogs: "Logs",
    seriesEnd: "Series Finished",
    endBtn: "End",
  },
  zh: {
    title: "OW2 BAN Simulator",
    startSettings: "初始设置",
    teamAName: "队伍 A 名称",
    teamBName: "队伍 B 名称",
    participation: "模式",
    solo: "solo",
    oneVone: "1vs1",
    scrim: "训练赛模式",
    format: "赛制",
    modeRange: "模拟范围",
    mode1: "模式1：英雄禁用",
    mode2: "模式2：地图 + 英雄禁用",
    mode3: "模式3：地图 + 英雄禁用 + 英雄选取",
    firstPicker: "第1局地图/禁用选择权",
    random: "随机",
    start: "开始",
    mapPick: "地图选择",
    banOrder: "决定先/后禁",
    heroBan: "英雄禁用",
    heroPick: "英雄选取（重装-输出-输出-支援-支援）",
    mapRight: "地图选择权",
    pickFirst: "先禁",
    pickSecond: "后禁",
    timeLeft: "剩余时间",
    play: "开始",
    pause: "暂停",
    confirmMap: "确定地图",
    chooserRight: "先/后禁选择权",
    confirm: "确定",
    curTurn: "当前回合",
    banned: "已禁用",
    confirmBan: "确定禁用",
    slot: "位置",
    ready: "Ready",
    lockPickTeam: (name: string) => `${name} 选取锁定`,
    pickLockShort: "锁定选取",
    setWinner: "选择本局获胜队伍",
    close: "关闭",
    showSummary: "比赛摘要",
    showLog: "查看日志",
    toastMap: "地图已确定",
    toastBan: "禁用已确定",
    summary: "摘要",
    noneYet: "尚无已完成的局。",
    setN: (i: number) => `第 ${i} 局`,
    map: "地图",
    mapPickerLabel: "地图选择方",
    firstBan: "先禁",
    secondBan: "后禁",
    none: "无",
    inProgress: "进行中",
    phase: "阶段",
    selectedMap: "已选地图",
    nextFirstBan: "下局先禁",
    log: "日志",
    noLog: "暂无日志。",
    light: "☀️ 浅色模式",
    dark: "🌙 深色模式",
    koBtn: "한국어",
    enBtn: "English",
    teamNameRequired: "请输入队伍名称。",
    scoreDone: " · 比赛结束",
    openSummary: "摘要",
    openLogs: "日志",
    seriesEnd: "比赛已结束",
    endBtn: "结束",
  },
} as const;

type I18n = (typeof STR)[keyof typeof STR];

/* ============== Data — gameData(SSOT) 파생 ============== */
// [STEP2] 영웅/맵 밴픽 데이터는 gameData(SSOT)에서 파생(값·표시순서 동일 — deep-equal 검증).
const HEROES: Hero[] = BANPICK_HEROES as Hero[];
const MAPS: MapInfo[] = BANPICK_MAPS as MapInfo[];

/* === image helpers === */
const IMG_EXTS = [".png", ".webp", ".jpg", ".jpeg"];
// [STEP3] 영웅 썸네일 후보: 정본 image 필드(getHeroByName) 1순위 → 확장자/표시명/id 순 폴백.
//   후보 순서: /heroes/{image}.png → {image}.webp/.jpg/.jpeg → {name}.* → {id}.*
//   1순위(image.png)가 아닌 후보로 표시되면(=image 필드 오류 신호) 개발 모드에서 경고(HeroThumb).
function heroSrcCandidates(id: string): string[] {
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
function mapSrcCandidates(id: string): string[] {
  const m = MAPS.find((x) => x.id === id);
  const bases: string[] = [];
  if (m?.name) bases.push(m.name);
  bases.push(id);
  const list: string[] = [];
  for (const b of bases) for (const ext of IMG_EXTS) list.push(`/maps/${encodeURIComponent(b)}${ext}`);
  return list;
}

/** 맵 썸네일 */
function MapThumb({ id, className, contain = false }: { id: string | null; className?: string; contain?: boolean }) {
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
function HeroThumb({ id, className, contain = true }: { id: string | null; className?: string; contain?: boolean }) {
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
function BanSlashOverlay() {
  return (
    <div className="pointer-events-none absolute inset-0 z-30">
      <div className="absolute left-[-30%] right-[-30%] top-1/2 h-[5px] bg-red-600/90 -rotate-45" />
      <div className="absolute left-[-30%] right-[-30%] top-[calc(50%+11px)] h-[5px] bg-red-600/90 -rotate-45" />
    </div>
  );
}

/** 맵 타입 아이콘/텍스트 */
const MAPICON_EXTS = [".svg", ".png", ".webp", ".jpg", ".jpeg"];
function mapTypeIconCandidates(mt: MapType): string[] {
  const bases = [mt.toLowerCase(), MAP_LABELS.ko[mt], MAP_LABELS.en[mt]];
  const list: string[] = [];
  for (const b of bases) for (const ext of MAPICON_EXTS) list.push(`/mapicons/${encodeURIComponent(b)}${ext}`);
  return list;
}
function MapTypeBadge({ type, lang, className }: { type: MapType; lang: Lang; className?: string }) {
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
const ROLE_ICON_EXTS = [".svg", ".png", ".webp", ".jpg", ".jpeg"];
function roleIconCandidates(role: Role, lang: Lang): string[] {
  const bases = [role.toLowerCase(), ROLE_LABELS.ko[role], ROLE_LABELS.en[role]];
  const list: string[] = [];
  for (const b of bases) for (const ext of ROLE_ICON_EXTS) list.push(`/roles/${encodeURIComponent(b)}${ext}`);
  return list;
}
function RoleBadge({ role, lang, className }: { role: Role; lang: Lang; className?: string }) {
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

/* ================= Summary / Log Modal ================= */
function SummaryLogModal(props: {
  teamName: Record<Team, string>;
  completedSets: SetSnapshot[];
  logs: string[];
  tab: "summary" | "log";
  setTab: (t: "summary" | "log") => void;
  onClose: () => void;
  dark: boolean;
  t: I18n;
  onFinishSet: (t: Team) => void;
  onFinishSetA: (r: "W" | "L" | "D", aScore: number, bScore: number) => void;
  scrimMode: boolean;
  seriesDone: boolean;
  onExitSeries: () => void;
  canEditWinner: boolean;
}) {
  const wrapClass = `${props.dark ? "bg-neutral-800 border-neutral-700" : "bg-white border-neutral-200"} border rounded-2xl p-5 max-h-[90vh] overflow-y-auto`;
  const tabBtn = (active: boolean) =>
    `px-2 py-1 rounded border ${
      active
        ? `border-emerald-500 ring-2 ring-emerald-500/60 ${props.dark ? "bg-emerald-900/30 text-emerald-100" : "bg-emerald-50 text-emerald-900"}`
        : props.dark
        ? "border-neutral-700"
        : "border-neutral-300"
    }`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* [수정됨] 배경 클릭 시 닫히는 이벤트(onClick={props.onClose})를 제거했습니다. */}
      <div className="absolute inset-0 bg-black/60" />
      
      <div className={`relative z-10 w-full max-w-2xl ${wrapClass}`}>
        <div className="flex items-center mb-3">
          <div className="font-semibold">{props.tab === "summary" ? props.t.showSummary : props.t.showLog}</div>
          <div className="ml-auto flex gap-2 text-xs">
            <button className={tabBtn(props.tab === "summary")} onClick={() => props.setTab("summary")}>
              {props.t.showSummary}
            </button>
            <button className={tabBtn(props.tab === "log")} onClick={() => props.setTab("log")}>
              {props.t.showLog}
            </button>
            <button className={`px-2 py-1 rounded border ${props.dark ? "border-neutral-700" : "border-neutral-300"}`} onClick={props.onClose}>
              {props.t.close}
            </button>
          </div>
        </div>

        {props.tab === "summary" ? (
          <div className="space-y-3 text-xs max-h:[60vh] max-h-[60vh] overflow-y-auto">
            {props.completedSets.length === 0 && <div className="text-neutral-400">{props.t.noneYet}</div>}
            {props.completedSets.map((s, i) => {
              const mapObj = s.map ? MAPS.find((m) => m.id === s.map) : null;
              const a = props.teamName.A;
              const b = props.teamName.B;
              return (
                <div key={i} className="border border-neutral-200 rounded-lg p-2">
                  <div className="font-medium mb-1">
                    {props.t.setN(i + 1)} {s.winner ? `- 승자: ${s.winner === "A" ? a : b}` : ""}
                  </div>
                  <div className="mb-1">
                    {props.t.map}: <b>{mapObj ? `${mapObj.name} (${MAP_LABELS.ko[mapObj.type]})` : "-"}</b> / {props.t.mapPickerLabel}: <b>{s.mapPicker ? (s.mapPicker === "A" ? a : b) : "-"}</b>
                  </div>
                  <div className="mb-1">
                    {props.t.firstBan}: <b>{s.banFirst === "A" ? a : b}</b> / {props.t.secondBan}: <b>{s.banSecond === "A" ? a : b}</b>
                  </div>
                  <div className="mb-1">
                    A팀 밴: {s.bans.A.length ? s.bans.A.map((id) => HEROES.find((h) => h.id === id)?.name ?? id).join(", ") : props.t.none}
                  </div>
                  <div className="mb-1">
                    B팀 밴: {s.bans.B.length ? s.bans.B.map((id) => HEROES.find((h) => h.id === id)?.name ?? id).join(", ") : props.t.none}
                  </div>
                  {(s.picks.A.length > 0 || s.picks.B.length > 0) && (
                    <div className="mt-1 grid grid-cols-2 gap-2">
                      <div>
                        <div className="text-[11px] text-neutral-400 mb-0.5">A팀 픽</div>
                        <div>{s.picks.A.map((id) => HEROES.find((h) => h.id === id)?.name ?? id).join(" / ") || "-"}</div>
                      </div>
                      <div>
                        <div className="text-[11px] text-neutral-400 mb-0.5">B팀 픽</div>
                        <div>{s.picks.B.map((id) => HEROES.find((h) => h.id === id)?.name ?? id).join(" / ") || "-"}</div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-xs max-h-[60vh] overflow-y-auto space-y-1">
            {props.logs.length === 0 && <div className="text-neutral-400">{props.t.noLog}</div>}
            {props.logs.map((l, i) => (
              <div key={i} className="border-b border-neutral-200 pb-1">
                {l}
              </div>
            ))}
          </div>
        )}

        {props.seriesDone ? (
          <div className="mt-4 flex items-center justify-between">
            <div className="text-sm font-medium">{props.t.seriesEnd}</div>
            <button
              className={`px-3 py-2 rounded-lg border ${props.dark ? "border-neutral-700 bg-neutral-900 text-white" : "border-neutral-300 bg-white text-neutral-900"}`}
              onClick={props.onExitSeries}
            >
              {props.t.endBtn}
            </button>
          </div>
        ) : props.canEditWinner ? (
          props.scrimMode ? (
            <FinishBarForA t={props.t} onSubmit={(resultA, scoreA, scoreB) => props.onFinishSetA(resultA, scoreA, scoreB)} dark={props.dark} />
          ) : (
            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-2">
              <button
                className={`px-3 py-2 rounded-lg border bp-touch ${props.dark ? "border-neutral-700 bg-neutral-900 text-white" : "border-neutral-300 bg-white text-neutral-900"}`}
                onClick={() => props.onFinishSet("A")}
              >
                {props.teamName.A} 승리
              </button>
              <button
                className={`px-3 py-2 rounded-lg border bp-touch ${props.dark ? "border-neutral-700 bg-neutral-900 text-white" : "border-neutral-300 bg-white text-neutral-900"}`}
                onClick={() => props.onFinishSet("B")}
              >
                {props.teamName.B} 승리
              </button>
            </div>
          )
        ) : (
          <div className="mt-4 text-xs text-neutral-400">승자 선택은 A팀 코치(호스트)만 가능합니다.</div>
        )}
      </div>
    </div>
  );
}

// ‼️ FinishBarForA 수정 (무승부 버튼 추가) ‼️
function FinishBarForA({ t, onSubmit, dark }: { t: I18n; onSubmit: (r: "W" | "L" | "D", a: number, b: number) => void; dark: boolean }) {
  const [a, setA] = React.useState(0);
  const [b, setB] = React.useState(0);
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      <span className="text-xs">세부 스코어를 입력하세요</span>
      <input className={`w-14 px-2 py-1 rounded border ${dark ? "border-neutral-700 bg-neutral-900" : "border-neutral-300 bg-white"}`} type="number" value={a} min={0} onChange={(e) => setA(+e.target.value)} />
      <span>:</span>
      <input className={`w-14 px-2 py-1 rounded border ${dark ? "border-neutral-700 bg-neutral-900" : "border-neutral-300 bg-white"}`} type="number" value={b} min={0} onChange={(e) => setB(+e.target.value)} />
      <div className="ml-auto flex gap-2">
        <button className={`px-3 py-2 rounded-lg border ${dark ? "border-neutral-700" : "border-neutral-300"}`} onClick={() => onSubmit("W", a, b)}>
          승리(W)
        </button>
        <button className={`px-3 py-2 rounded-lg border ${dark ? "border-neutral-700" : "border-neutral-300"}`} onClick={() => onSubmit("L", a, b)}>
          패배(L)
        </button>
        <button className={`px-3 py-2 rounded-lg border ${dark ? "border-neutral-700" : "border-neutral-300"}`} onClick={() => onSubmit("D", a, b)}>
          무승부(D)
        </button>
      </div>
    </div>
  );
}

/** ‼️ 선공/선수비 선택 모달 (A팀 기준) - 배경 클릭 닫기 제거 ‼️ */
function AttackDefenseModal({
  open,
  onClose,
  onConfirm,
  dark,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (side: Side) => void;
  dark: boolean;
}) {
  if (!open) return null;

  const wrap = `${dark ? "bg-neutral-800 border-neutral-700" : "bg-white border-neutral-200"} border rounded-2xl p-5`;
  const btn = (side: Side) => `w-full px-3 py-4 rounded-lg border ${dark ? "border-neutral-700" : "border-neutral-300"}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* [수정됨] 배경 클릭 시 닫히는 이벤트 제거 */}
      <div className="absolute inset-0 bg-black/60" />
      
      <div className={`relative z-10 w-full max-w-xs ${wrap}`}>
        <div className="font-semibold mb-1">선공/선수비 선택</div>
        <div className="text-xs text-neutral-400 mb-4">
          A팀의 선공/선수비를 선택합니다.
        </div>
        <div className="grid grid-cols-2 gap-3">
          <button className={btn("ATTACK")} onClick={() => onConfirm("ATTACK")}>
            선공격
          </button>
          <button className={btn("DEFENSE")} onClick={() => onConfirm("DEFENSE")}>
            선수비
          </button>
        </div>
        {/* 필요한 경우 닫기 버튼을 따로 추가하거나, 선택을 강제해야 한다면 버튼 없음 */}
      </div>
    </div>
  );
}

function BetweenSetModal({
  open,
  onClose,
  defaultMapPicker,
  defaultBanFirst,
  teamName,
  dark,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  defaultMapPicker: Team;
  defaultBanFirst: Team;
  teamName: Record<Team, string>;
  dark: boolean;
  onConfirm: (nextMapPicker: Team, nextBanFirst: Team) => void;
}) {
  const [mp, setMp] = React.useState<Team>(defaultMapPicker);
  const [bf, setBf] = React.useState<Team>(defaultBanFirst);
  if (!open) return null;

  const wrap = `${dark ? "bg-neutral-800 border-neutral-700" : "bg-white border-neutral-200"} border rounded-2xl p-5`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* [수정됨] 배경 클릭 시 닫히는 이벤트 제거 */}
      <div className="absolute inset-0 bg-black/60" />
      
      <div className={`relative z-10 w-full max-w-md ${wrap}`}>
        <div className="font-semibold mb-3">다음 세트 설정</div>

        <div className="space-y-3 text-sm">
          <div>
            <div className="text-xs mb-1">맵 선택 팀</div>
            <div className="flex gap-2">
              {(["A", "B"] as Team[]).map((t) => (
                <button
                  key={t}
                  className={`px-3 py-1 rounded border ${mp === t ? "border-emerald-500 ring-2 ring-emerald-500/60" : "border-neutral-300"}`}
                  onClick={() => setMp(t)}
                >
                  {t} ({t === "A" ? teamName.A : teamName.B})
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="text-xs mb-1">선밴 팀</div>
            <div className="flex gap-2">
              {(["A", "B"] as Team[]).map((t) => (
                <button
                  key={t}
                  className={`px-3 py-1 rounded border ${bf === t ? "border-emerald-500 ring-2 ring-emerald-500/60" : "border-neutral-300"}`}
                  onClick={() => setBf(t)}
                >
                  {t} ({t === "A" ? teamName.A : teamName.B})
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-2">
          {/* 닫기 버튼으로만 닫을 수 있게 유지 */}
          <button className={`px-3 py-2 rounded-lg border ${dark ? "border-neutral-700" : "border-neutral-300"}`} onClick={onClose}>
            닫기
          </button>
          <button className={`ml-auto px-3 py-2 rounded-lg border ${dark ? "border-neutral-700" : "border-neutral-300"}`} onClick={() => onConfirm(mp, bf)}>
            다음 세트 시작
          </button>
        </div>
      </div>
    </div>
  );
}

// ‼️ ScrimSummaryModal 수정 (제목 형식, 본문 형식) ‼️
function ScrimSummaryModal({
  open,
  onClose,
  sets,
  teamName,
  dark,
  setScrimActive,
  syncOn,
  myRole,
  patch,
  onExitSeries,
  scrimTime,
  onToast,
}: {
  open: boolean;
  onClose: () => void;
  sets: SetSnapshot[];
  teamName: Record<Team, string>;
  dark: boolean;
  setScrimActive: React.Dispatch<React.SetStateAction<boolean>>;
  syncOn: boolean;
  myRole: MyRole;
  patch: (data: any) => void;
  onExitSeries: () => void;
  scrimTime: string;
  onToast: (m: string) => void;
}) {
  if (!open) return null;
  const wins = sets.filter((s) => s.resultA === "W").length;
  const loses = sets.filter((s) => s.resultA === "L").length;
  const draws = sets.filter((s) => s.resultA === "D").length;

  const scoreStr = `${wins}승 ${draws}무 ${loses}패`;
  const finalResultStr = wins > loses ? "W" : wins < loses ? "L" : "D";
  const startTime = parseInt(scrimTime, 10);
  const timeStr = !isNaN(startTime)
    ? `${startTime} ~ ${startTime + 2} / `
    : scrimTime
    ? `${scrimTime} / `
    : "";

  const title = `Scrim / ${yymmdd()} / ${timeStr}vs ${teamName.B} / ${scoreStr} / ${finalResultStr}`;

  const lines = [
    title,
    "",
    ...sets.map((s, i) => {
      const mapObj = s.map ? MAPS.find((m) => m.id === s.map) : null;
      const resultText = s.resultA === "W" ? "승리(W)" : s.resultA === "L" ? "패배(L)" : "무승부(D)";
      const rline = `세트 ${i + 1} - ${s.scoreA ?? 0}:${s.scoreB ?? 0} ${resultText}`;
      const sideStr = s.attackOrDefense === "ATTACK" ? "/ 선공격 " : s.attackOrDefense === "DEFENSE" ? "/ 선수비 " : "";
      const mline = `맵 : ${mapObj ? `${mapObj.name}(${MAP_LABELS.ko[mapObj.type]})` : "-"} ${sideStr}/ 맵 선택 : ${s.mapPicker ?? "-"}`;
      const bline = `선밴 : ${s.banFirst} / 후밴 : ${s.banSecond}`;
      const aban = `${teamName.A} 밴 : ${s.bans.A.map((id) => HEROES.find((h) => h.id === id)?.name ?? id).join(", ") || "-"}`;
      const apick = `${teamName.A} 픽 : ${s.picks.A.map((id) => HEROES.find((h) => h.id === id)?.name ?? id).join(" / ") || "-"}`;
      const bban = `${teamName.B} 밴 : ${s.bans.B.map((id) => HEROES.find((h) => h.id === id)?.name ?? id).join(", ") || "-"}`;
      const bpick = `${teamName.B} 픽 : ${s.picks.B.map((id) => HEROES.find((h) => h.id === id)?.name ?? id).join(" / ") || "-"}`;
      return [rline, mline, bline, "", aban, apick, "", bban, bpick, ""].join("\n");
    }),
  ].join("\n");

  const wrap = `${dark ? "bg-neutral-800 border-neutral-700" : "bg-white border-neutral-200"} border rounded-2xl p-5`;

  const download = () => {
    const blob = new Blob([lines], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${yymmdd()}_scrim.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* [수정됨] 배경 클릭 시 닫히는 이벤트 제거 */}
      <div className="absolute inset-0 bg-black/60" />

      <div className={`relative z-10 w-full max-w-2xl ${wrap}`}>
        <div className="font-semibold mb-2">스크림 요약</div>
        <textarea
          className={`w-full h-[50vh] rounded-lg border ${dark ? "border-neutral-700 bg-neutral-900 text-white" : "border-neutral-300 bg-white text-neutral-900"} text-xs p-2`}
          readOnly
          value={lines}
        />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            className={`px-3 py-2 rounded-lg border ${dark ? "border-neutral-700" : "border-neutral-300"}`}
            onClick={() => copyWithToast(lines, onToast, "요약 복사됨", "복사 실패")}
          >
            복사
          </button>
          <button className={`px-3 py-2 rounded-lg border ${dark ? "border-neutral-700" : "border-neutral-300"}`} onClick={download}>
            .txt 저장
          </button>

          <button className={`ml-auto px-3 py-2 rounded-lg border ${dark ? "border-neutral-700" : "border-neutral-300"}`} onClick={onClose}>
            닫기
          </button>

          <button
            className={`px-3 py-2 rounded-lg border ${dark ? "border-neutral-700" : "border-neutral-300"}`}
            onClick={onExitSeries}
          >
            스크림 종료
          </button>
        </div>
      </div>
    </div>
  );
}

function yymmdd(d = new Date()) {
  const y = String(d.getFullYear()).slice(2);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

/* [1-3] 클립보드 복사(공용). 보안 컨텍스트가 아니거나(HTTP) navigator.clipboard가 없으면
   임시 textarea + execCommand('copy') 폴백. 성공 여부(boolean)를 반환한다. */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* 폴백으로 진행 */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "-9999px";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
/* 복사 + 결과 토스트. 토스트 표시는 호출부가 주입(popToast). */
function copyWithToast(text: string, toast: (m: string) => void, okMsg = "복사되었습니다", failMsg = "복사 실패") {
  copyText(text).then((ok) => toast(ok ? okMsg : failMsg));
}

/* ================= [STEP5] 밴픽 헤더 (맵 배경 띠) ================= */
/* 선택된 맵 이미지를 전체 폭 배경(blur+어둡게)으로 깔고 좌우 끝은 패널색으로 페이드.
   중앙에 "선택된 맵 · <모드>" + 맵명 크게, 우상단에 페이즈·턴. 밴 셀은 헤더에서 제거(팀 열로 이동).
   HERO_BAN_ONLY/맵 없음은 중립 배경 + 페이즈만. 맵 이미지=public/maps/<맵명>.webp. */
function BanpickHeader({ selectedMap, mode, phase, turnTeam, teamName, bans, heroById, t, lang }: {
  selectedMap: string | null;
  mode: number;
  phase: Phase;
  turnTeam: Team | null;
  teamName: Record<Team, string>;
  bans?: Record<Team, string[]>;
  heroById?: (id: string) => Hero | undefined;
  t: I18n;
  lang: Lang;
}) {
  const m = selectedMap ? MAPS.find((x) => x.id === selectedMap) : null;
  const hasMap = mode !== MODE.HERO_BAN_ONLY && !!m;
  const modeLbl = m ? MAP_LABELS[lang][m.type] : "";
  const phaseLabel =
    phase === "HERO_BAN" ? t.heroBan :
    phase === "HERO_PICK" ? (lang === "ko" ? "영웅 픽" : lang === "zh" ? "英雄选取" : "Hero Pick") :
    phase === "BAN_ORDER" ? t.banOrder : "";
  const turnWord = lang === "ko" ? "턴" : lang === "zh" ? "回合" : "turn";
  // [STEP7] 밴 페이즈에서만 양 팀 밴 현황 셀을 헤더 안(좌하단)에 표시. 맵명(중앙)과 겹치지 않음.
  const showBans = phase === "HERO_BAN" && !!bans && !!heroById;
  const banCell = (tm: Team) => {
    const hid = bans![tm][0] ?? null;
    const name = hid ? getDisplayName(heroById!(hid)?.name ?? hid) : "—";
    return (
      <div key={tm} className="bp-bghdr-bancell">
        <div className="bp-bghdr-banthumb">
          {hid ? (<><HeroThumb id={hid} contain={false} /><BanSlashOverlay /></>) : <span className="bp-bghdr-bandash">—</span>}
        </div>
        <div className="bp-bghdr-banmeta">
          <span className="bp-bghdr-banteam">{teamName[tm]} {t.banned}</span>
          <span className="bp-bghdr-banname" style={{ color: hid ? "var(--bp-danger)" : undefined }}>{name}</span>
        </div>
      </div>
    );
  };
  return (
    <div className={cn("bp-bghdr-wrap", showBans && "hasbans")}>
      <div className={cn("bp-bghdr", !hasMap && "nomap")}>
        {hasMap && (
          <div className="bp-bghdr-img" style={{ backgroundImage: `url("/maps/${encodeURIComponent(m!.name)}.webp")` }} />
        )}
        <div className="bp-bghdr-content">
          <div className="bp-bghdr-center">
            {hasMap ? (
              <>
                <div className="bp-bghdr-sub">{t.selectedMap} · {modeLbl}</div>
                <div className="bp-bghdr-name">{getMapDisplayName(m!.name)}</div>
              </>
            ) : (
              <div className="bp-bghdr-name">{phaseLabel}</div>
            )}
          </div>
          <div className="bp-bghdr-phase">
            {phaseLabel}{turnTeam ? ` · ${teamName[turnTeam]} ${turnWord}` : ""}
          </div>
        </div>
      </div>
      {showBans && (
        <div className="bp-bghdr-bans">
          {banCell("A")}
          {banCell("B")}
        </div>
      )}
    </div>
  );
}

/* 밴 카드 — 팀 열 최상단(픽 슬롯 위). 밴 영웅 회색+빨강 대각선 2줄 + "BAN" 태그 + 영웅명(빨강).
   밴 전엔 점선 테두리 '밴 대기'. 팀당 밴 1개 고정이라 단일 카드. */
function BanCard({ heroId, heroById, lang, mobile }: {
  heroId: string | null;
  heroById: (id: string) => Hero | undefined;
  lang: Lang;
  mobile?: boolean;
}) {
  const name = heroId ? getDisplayName(heroById(heroId)?.name ?? heroId) : "";
  const wait = lang === "ko" ? "밴 대기" : lang === "zh" ? "等待禁用" : "Awaiting ban";
  return (
    <div className={cn("bp-bancard", heroId ? "banned" : "empty", mobile && "mobile")}>
      {heroId ? (
        <>
          <div className="bp-bancard-img"><HeroThumb id={heroId} contain={false} /></div>
          <BanSlashOverlay />
          <span className="bp-bancard-tag">BAN</span>
          <span className="bp-bancard-name">{name}</span>
        </>
      ) : (
        <span className="bp-bancard-wait">{wait}</span>
      )}
    </div>
  );
}

/* ================= [STEP3] 밴 연출 오버레이 (tear) ================= */
/* 밴 확정 순간 화면 중앙에 밴 영웅 초상화가 떠오름(1.0초):
   0~0.2 등장(스케일업·페이드인·컬러) → 0.2~0.7 회색 전환 + 대각선 두 조각으로 어긋나며 벌어짐
   → 0.7~1.0 페이드아웃. pointer-events none(입력 차단 없음). 그리드/헤더의 정적 밴 표시는 별도 유지. */
function BanReveal({ team, heroId, teamName, heroById, t }: {
  team: Team;
  heroId: string;
  teamName: Record<Team, string>;
  heroById: (id: string) => Hero | undefined;
  t: I18n;
}) {
  const name = getDisplayName(heroById(heroId)?.name ?? heroId);
  const teamNm = team === "A" ? teamName.A : teamName.B;
  return (
    <div className="bp-br-overlay pointer-events-none fixed inset-0 flex flex-col items-center justify-center" style={{ zIndex: 60 }}>
      <div className="bp-br-portrait bp-br-tear">
        <div className="bp-br-piece bp-br-piece-top"><HeroThumb id={heroId} contain={false} /></div>
        <div className="bp-br-piece bp-br-piece-bot"><HeroThumb id={heroId} contain={false} /></div>
      </div>
      <div className="bp-br-caption">{teamNm} {t.banned} — {name}</div>
    </div>
  );
}

/* ================= UI 작은 컴포넌트 ================= */
function RoleIcon({ role, lang, className }: { role: Role; lang: Lang; className?: string }) {
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
const cn = (...a: (string | undefined | false)[]) => a.filter(Boolean).join(" ");

/** 픽 컬럼(좌/우) */
type PickColumnProps = {
  team: Team;
  teamName: Record<Team, string>;
  lang: Lang;
  t: I18n;
  phase: Phase;                                   // [STEP5] HERO_BAN/HERO_PICK 공용 열 — 픽 컨트롤은 PICK만
  bans: Record<Team, string[]>;                   // [STEP5] 팀 밴(헤더 대신 열 최상단 밴 카드)
  pickSlots: Record<Team, (string | null)[]>;
  pickLockedTeam: Record<Team, boolean>;
  activeSlot: Record<Team, number>;
  onFocusSlot: (team: Team, idx: number) => void; // [1-2] 슬롯 재포커스(로컬=setActiveSlot, 1v1=set_active_slot)
  confirmPick: (team: Team) => void;
  onUnlock: (team: Team) => void;                 // [1-2] 레디 해제
  canUnlock: boolean;                             // [1-2] 해제 가능(본인 팀·상대 미락·세트 미확정)
  canPickForTeam: (team: Team) => boolean;
  heroById: (id: string) => Hero | undefined;
};
const PickColumn = React.memo(function PickColumn({
  team,
  teamName,
  lang,
  t,
  phase,
  bans,
  pickSlots,
  pickLockedTeam,
  activeSlot,
  onFocusSlot,
  confirmPick,
  onUnlock,
  canUnlock,
  canPickForTeam,
  heroById,
}: PickColumnProps) {
  const label = team === "A" ? teamName.A : teamName.B;
  const locked = pickLockedTeam[team];
  const roleLabel = (r: Role) => ROLE_LABELS[lang][r];
  const canClickSlot = (t: Team) => canPickForTeam(t) && !pickLockedTeam[t];

  return (
    <div
      className={["h-full flex flex-col overflow-hidden", "p-2 rounded-xl border", locked ? "border-emerald-500" : "border-neutral-300", "w-full min-w-[220px] max-w-[320px] mx-auto"].join(" ")}
      style={locked ? { borderColor: "#4ade80", boxShadow: "0 0 0 1px #4ade8055" } : undefined}
    >
      <div className="shrink-0 mb-2">
        <div className="flex items-center mb-1">
          <div className="text-xs font-semibold">{label}</div>
          {locked && (
            <span className="ml-2 text-[10px] px-2 py-0.5 rounded-full border font-semibold" style={{ borderColor: "#4ade80", color: "#4ade80", background: "rgba(74,222,128,0.14)" }}>
              {t.ready}
            </span>
          )}
        </div>
        {/* [STEP5] 밴 카드 — 열 최상단, 픽 슬롯 바로 위 */}
        <BanCard heroId={bans[team][0] ?? null} heroById={heroById} lang={lang} />
        {/* 픽 완료 — 상태 배지형 버튼(HERO_PICK 전용): 완료=초록 / 진행가능=파랑 / 대기=중립. */}
        {phase === "HERO_PICK" && (() => {
          const allFilled = !pickSlots[team].some((v) => v === null);
          const canAct = canPickForTeam(team);
          const done = locked;
          const ready = !done && allFilled && canAct; // 5슬롯 다 참 + 내 차례 → 누를 수 있음
          const badgeStyle = done
            ? { borderColor: "#4ade80", color: "#4ade80", background: "rgba(74,222,128,0.14)" }
            : ready
            ? { borderColor: "var(--bp-primary)", color: "var(--bp-primary)", background: "rgba(59,130,246,0.14)" }
            : { borderColor: "var(--bp-border2)", background: "var(--bp-surface2)", color: "var(--bp-textsub)" }; // 대기 = 중립 pill
          // [1-2] 확정(락) 상태 + 해제 가능 → '레디 해제' 클릭 버튼으로 전환(세트 확정 후엔 비활성 ✓ 픽 완료)
          if (done && canUnlock) {
            return (
              <button
                className="w-full px-2 py-2 rounded-lg border text-xs font-semibold"
                style={{ borderColor: "var(--bp-danger)", color: "var(--bp-danger)", background: "rgba(239,68,68,0.12)" }}
                onClick={() => onUnlock(team)}
              >
                ✓ 픽 완료 · 레디 해제
              </button>
            );
          }
          return (
            <button
              className="w-full px-2 py-2 rounded-lg border text-xs font-semibold"
              style={badgeStyle}
              onClick={() => confirmPick(team)}
              disabled={done || !allFilled || !canAct}
            >
              {done ? "✓ 픽 완료" : ready ? "픽 완료 (클릭)" : "픽 완료"}
            </button>
          );
        })()}
      </div>

      {/* [STEP5] 슬롯 5개 — flex로 남은 높이를 균등 분배(세로 스크롤 없음). 이미지는 정사각. */}
      <div className="flex-1 min-h-0 flex flex-col gap-2 overflow-hidden">
        {SLOT_ROLES.map((sr, i) => {
          const hid = pickSlots[team][i];
          const active = activeSlot[team] === i && !pickLockedTeam[team];
          const heroName = hid ? getDisplayName(heroById(hid)?.name ?? hid) : roleLabel(sr);
          const clickable = canClickSlot(team);
          const slotRole: Role = (hid ? (heroById(hid)?.role as Role) : sr) ?? sr;
          return (
            <button
              key={i}
              disabled={!clickable}
              onClick={() => clickable && onFocusSlot(team, i)}
              className={["flex-1 min-h-0 w-full rounded-xl border flex flex-col p-1", active ? "bp-sel-pick" : "border-neutral-300", !clickable && "opacity-60 cursor-not-allowed"].join(" ")}
            >
              <div className="relative flex-1 min-h-0 aspect-square mx-auto rounded-lg overflow-hidden bg-neutral-100">
                <HeroThumb id={hid ?? null} />
              </div>
              <div className="mt-0.5 text-[11px] font-medium flex items-center justify-center gap-1 min-h-[15px] truncate shrink-0">
                <RoleIcon role={slotRole} lang={lang} className="shrink-0" />
                <span className="truncate">{heroName}</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
});

/* ================= App ================= */
export default function BanpickApp() {
  useEffect(() => {
    ensureAnonAuth();
  }, []);

  /* === Theme === */
  // #4 분석기 전역 테마(ThemeContext)를 구독 — 라이트/다크에 밴픽도 반응.
  const { isDarkMode } = useTheme();
  const [dark, setDark] = useState(isDarkMode);
  useEffect(() => { setDark(isDarkMode); }, [isDarkMode]);
  // 분석기 다크 theme 톤으로 통일한 커스텀 클래스(banpick.css 정의). 글래스/그라데이션/링 제거.
  const theme = useMemo(
    () => ({
      root: "bp-root-base",
      header: "bp-header",
      panel: "bp-panel",
      btnBorder: "bp-btnborder",
      chipBg: "bp-chip",
      activeGreen: "bp-active",
    }),
    []
  );

  /* === Language === */
  const [lang, setLang] = useState<Lang>("ko");
  // ② 언어를 분석기 전역(LanguageContext)에 연결 — 자체 토글 제거, 전역과 동기화.
  const { language: appLang } = useLanguage();
  useEffect(() => { if (appLang === "ko" || appLang === "en" || appLang === "zh") setLang(appLang); }, [appLang]);
  const t: I18n = useMemo(() => STR[lang], [lang]);
  const roleLabel = (r: Role) => ROLE_LABELS[lang][r];
  const mapTypeLabel = (mt: string) => (mt === "All" ? (lang === "ko" ? "전체" : lang === "zh" ? "全部" : "All") : MAP_LABELS[lang][mt as MapType]);

  /* === Setup === */
  const [teamName, setTeamName] = useState<Record<Team, string>>({ A: "Team A", B: "Team B" });
  const [sets, setSets] = useState(3);
  const [mode, setMode] = useState<number>(MODE.FULL);
  const [partMode, setPartMode] = useState<PartMode>("SOLO");
  const [myRole, setMyRole] = useState<MyRole>("HOST");
  const myTeamRole = useMemo(() => roleAsTeam(partMode, myRole), [partMode, myRole]);
  const [firstSetPicker, setFirstSetPicker] = useState<"AUTO" | Team>("AUTO");
  const is1v1 = partMode === "COACH_1V1";
  // Scrim
  const [scrimMode, setScrimMode] = useState(false);
  const [scrimActive, setScrimActive] = useState(false);
  const [betweenOpen, setBetweenOpen] = useState(false);
  const [scrimTime, setScrimTime] = useState("");

  /* === 실시간 대전 transport (서버 권위 WebSocket) === */
  const remoteMode = partMode === "COACH_1V1";
  const ws = useBanpickWS(remoteMode);
  const remote = ws.remote;
  const wsSend = ws.send;
  const roomId = ws.roomCode;                              // 서버 발급 6자리 방 코드
  const syncOn = remoteMode && !!roomId;
  // 서버가 유일 권위 → 클라 patch/pushFull은 미사용(액션은 wsSend로만).
  const patch = React.useCallback((_p?: any) => {}, []);
  const pushFull = React.useCallback((_s?: any) => {}, []);

  // 서버가 배정한 역할(A/B)을 로컬 myRole에 반영
  useEffect(() => { if (ws.myRole) setMyRole(ws.myRole); }, [ws.myRole]);

  // config는 방 생성 시 서버로 전달되므로 로컬 상태만 갱신
  const setInitialPickerSync = setFirstSetPicker;
  const setScrimModeSync = setScrimMode;
  const setScrimTimeSync = setScrimTime;

  // [1-1] 팀명 변경: 로컬 즉시 반영 + 1v1은 서버에 저장 요청.
  //   서버가 전원 broadcast → 상대 화면 반영 + 재접속/새로고침 시 유지(서버 state가 정본).
  //   편집 권한(A명=HOST/A, B명=B)은 클라 disabled + 서버 FORBIDDEN 양쪽에서 강제.
  const renameTeam = React.useCallback((team: Team, name: string) => {
    setTeamName((p) => ({ ...p, [team]: name }));
    if (remoteMode) wsSend({ type: "set_team_name", team, name });
  }, [remoteMode, wsSend]);

  // READY: 서버 state의 ready 기준, 토글은 내 역할로 액션 전송
  const readyA = !!remote?.ready?.A;
  const readyB = !!remote?.ready?.B;
  const myReady = myTeamRole === "A" ? readyA : myTeamRole === "B" ? readyB : false;
  const applyReady = (next: any) => {
    const val = typeof next === "function" ? next(myReady) : next;
    wsSend({ type: "ready", value: !!val });   // 서버는 내 역할의 ready만 반영(연결 없으면 no-op)
  };
  const setReadyA = applyReady;
  const setReadyB = applyReady;

  /* === Match === */
  const [started, setStarted] = useState(false);
  const [phase, setPhase] = useState<Phase>(mode === MODE.HERO_BAN_ONLY ? "BAN_ORDER" : "MAP_PICK");
  const [timer, setTimer] = useState<number>(TIMER.NORMAL);
  const [run, setRun] = useState(false);

  /* === per-set === */
  const [orderChooser, setOrderChooser] = useState<Team>("A");
  const [banStarterChoice, setBanStarterChoice] = useState<null | "PICKER" | "OPPONENT">(null);
  const [mapPicker, setMapPicker] = useState<Team>("A");
  const [selectedMap, setSelectedMap] = useState<string | null>(null);
  const [turn, setTurn] = useState<Team>("A");
  const [bans, setBans] = useState<Record<Team, string[]>>({ A: [], B: [] });
  const [roleLock, setRoleLock] = useState<Partial<Record<Role, Team>>>({});
  const [pendingBan, setPendingBan] = useState<Record<Team, string | null>>({ A: null, B: null });
  const [attackOrDefense, setAttackOrDefense] = useState<Side | null>(null);

  const [pickSlots, setPickSlots] = useState<Record<Team, (string | null)[]>>({ A: [null, null, null, null, null], B: [null, null, null, null, null] });
  const [activeSlot, setActiveSlot] = useState<Record<Team, number>>({ A: 0, B: 0 });
  const [pickLockedTeam, setPickLockedTeam] = useState<Record<Team, boolean>>({ A: false, B: false });
  const [pickLocked, setPickLocked] = useState(false);

  const [completedSets, setCompletedSets] = useState<SetSnapshot[]>([]);
  const [usedModesCycle, setUsedModesCycle] = useState<Set<MapType>>(new Set());
  const [usedMaps, setUsedMaps] = useState<Set<string>>(new Set());
  const [winnerThisSet, setWinnerThisSet] = useState<Team | null>(null);

  const [mapFilter, setMapFilter] = useState<"All" | MapType>("All");
  const [filterRole, setFilterRole] = useState<Role>("Tank");

  /* === feedback & logs === */
  const [toast, setToast] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [showSummaryOpen, setShowSummaryOpen] = useState(false);
  const [summaryTab, setSummaryTab] = useState<"summary" | "log">("summary");
  const [showScrimSummary, setShowScrimSummary] = useState(false);
  const [showSideModal, setShowSideModal] = useState(false);
  const [frozenSummarySets, setFrozenSummarySets] = useState<SetSnapshot[]>([]);

  /* === [STEP3] 밴 연출 오버레이 큐 ===
     밴 확정 시 화면 중앙에 밴 영웅 초상화를 띄워 tear(대각 찢기) 모션 재생(1.0초). 큐로 순차 재생. */
  const [revealQueue, setRevealQueue] = useState<{ team: Team; heroId: string; id: number }[]>([]);
  const revealIdRef = useRef(0);
  const enqueueReveal = React.useCallback((team: Team, heroId: string) => {
    setRevealQueue((q) => [...q, { team, heroId, id: ++revealIdRef.current }]);
  }, []);
  const currentReveal = revealQueue[0] ?? null;
  useEffect(() => {
    if (!currentReveal) return;
    const tid = window.setTimeout(() => setRevealQueue((q) => q.slice(1)), 1000);
    return () => window.clearTimeout(tid);
  }, [currentReveal?.id]);

  // [STEP3] 1v1 트리거 — remote.bans 변화 감지(밴한 쪽·상대 모두). 이전 스냅샷 대비 '추가된' 밴만 재생.
  //   최초 수신(마운트·재접속·새로고침)은 스냅샷만 저장하고 재생 생략.
  //   리셋(세트 전환)은 추가가 아니라 제거/초기화라 added가 비어 재생 안 됨(=밴 페이즈 외 재생 방지).
  const prevRemoteBansRef = useRef<Record<Team, string[]> | null>(null);
  useEffect(() => {
    if (!remoteMode) return;
    const rb = remote?.bans as Record<Team, string[]> | undefined;
    if (!rb) return;
    const prev = prevRemoteBansRef.current;
    if (prev === null) { prevRemoteBansRef.current = { A: [...rb.A], B: [...rb.B] }; return; } // 최초 수신 생략
    (["A", "B"] as Team[]).forEach((tm) => {
      rb[tm].filter((h) => !prev[tm].includes(h)).forEach((h) => enqueueReveal(tm, h));
    });
    prevRemoteBansRef.current = { A: [...rb.A], B: [...rb.B] };
  }, [remote?.bans, remoteMode, enqueueReveal]);

  const otherTeam = (t: Team): Team => (t === "A" ? "B" : "A");
  const canEditWinner = useMemo(() => (partMode === "COACH_1V1" ? myTeamRole === "A" : myRole !== "OBS"), [partMode, myTeamRole, myRole]);
  const heroById = (id: string) => HEROES.find((h) => h.id === id);

  const teamBanHistory = useMemo(() => {
    const hist: Record<Team, Set<string>> = { A: new Set(), B: new Set() };
    completedSets.forEach((s) => {
      s.bans.A.forEach((h) => hist.A.add(h));
      s.bans.B.forEach((h) => hist.B.add(h));
    });
    return hist;
  }, [completedSets]);

  // ... App 컴포넌트 내부 ...

  const filteredMapsForPick = useMemo(() => {
    const available = MAPS.filter((m) => !usedMaps.has(m.id));
    const firstSet = completedSets.length === 0;
    const typeAllowed = (m: MapInfo) => {
      // [수정] 첫 세트라고 해서 반드시 Control일 필요 없음 (삭제됨)
      // if (firstSet) return m.type === "Control"; 
      
      // 같은 모드(쟁탈, 호위 등)가 너무 자주 반복되지 않도록 하는 로직은 유지하거나
      // 원하시면 아래 조건도 삭제하여 모든 맵을 항상 열어둘 수 있습니다.
      // 현재는 5세트 이내에 같은 모드 반복 금지 로직만 남겨둡니다.
      if (usedModesCycle.size < 5 && usedModesCycle.has(m.type)) return false;
      return true;
    };
    return available.filter((m) => (mapFilter === "All" ? true : m.type === mapFilter)).filter(typeAllowed);
  }, [mapFilter, usedMaps, usedModesCycle, completedSets.length]);

  
  const allBannedThisSet = useMemo(() => bans.A.concat(bans.B), [bans]);

  /* === Series Score === */
  const targetWins = useMemo(() => (sets === 3 ? 2 : sets === 5 ? 3 : 4), [sets]);
  const winsA = useMemo(() => completedSets.filter((s) => s.winner === "A").length, [completedSets]);
  const winsB = useMemo(() => completedSets.filter((s) => s.winner === "B").length, [completedSets]);
  const seriesDone = scrimMode ? false : winsA >= targetWins || winsB >= targetWins;

  /* ========== Sync: 호스트 스냅샷 스로틀 푸시 ========== */
  const sharedSnapshot = useMemo(
    () => ({
      teamName,
      sets,
      mode,
      partMode,
      myRole,
      firstSetPicker,
      started,
      phase,
      timer,
      run,
      orderChooser,
      banStarterChoice,
      mapPicker,
      selectedMap,
      turn,
      bans,
      roleLock,
      pendingBan,
      pickSlots,
      pickLockedTeam,
      pickLocked,
      activeSlot,
      completedSets,
      usedMaps: Array.from(usedMaps),
      usedModesCycle: Array.from(usedModesCycle),
      winnerThisSet,
      logs,
      scrimMode,
      scrimActive,
      scrimTime,
      attackOrDefense,
    }),
    [
      teamName,
      sets,
      mode,
      partMode,
      myRole,
      firstSetPicker,
      started,
      phase,
      timer,
      run,
      orderChooser,
      banStarterChoice,
      mapPicker,
      selectedMap,
      turn,
      bans,
      roleLock,
      pendingBan,
      pickSlots,
      pickLockedTeam,
      pickLocked,
      activeSlot,
      completedSets,
      usedMaps,
      usedModesCycle,
      winnerThisSet,
      logs,
      scrimMode,
      scrimActive,
      scrimTime,
      attackOrDefense,
    ]
  );

  const pushRef = useRef<number | null>(null);
  // 호스트만 pushFull, 시작 후에만
  useEffect(() => {
    if (!syncOn || myRole !== "HOST" || !started) return;

    if (pushRef.current) window.clearTimeout(pushRef.current);
    pushRef.current = window.setTimeout(() => {
      pushFull(sharedSnapshot);
    }, 300);

    return () => {
      if (pushRef.current) window.clearTimeout(pushRef.current);
    };
  }, [sharedSnapshot, syncOn, myRole, started, pushFull]);

  // 2) 원격 스냅샷을 호스트/게스트 모두 로컬에 반영
  useEffect(() => {
    if (!syncOn || !remote) return;

    setTeamName((v) => remote.teamName ?? v);   // [1-1] 서버 권위 팀명 반영(상대 변경·재접속 유지)
    setStarted((v) => remote.started ?? v);
    setPhase((v) => remote.phase ?? v);
    setTimer((v) => remote.timer ?? v);
    setRun((v) => remote.run ?? v);

    setOrderChooser((v) => remote.orderChooser ?? v);
    setBanStarterChoice((v) => remote.banStarterChoice ?? v);
    setMapPicker((v) => remote.mapPicker ?? v);
    setSelectedMap((v) => remote.selectedMap ?? v);
    setTurn((v) => remote.turn ?? v);
    setBans((v) => remote.bans ?? v);
    setRoleLock((v) => remote.roleLock ?? v);
    // pendingBan은 "선택→확정" 2단계용 클라 전용 버퍼 → 원격 동기화 제외.
    // (서버는 항상 {A:null,B:null}을 보내 매 브로드캐스트마다 선택이 지워지는 버그였음)
    setPickSlots((v) => remote.pickSlots ?? v);
    setPickLockedTeam((v) => remote.pickLockedTeam ?? v);
    setPickLocked((v) => remote.pickLocked ?? v);
    // activeSlot은 서버(권위)를 따른다. 서버는 팀별로만 activeSlot을 갱신하므로 '내 팀' 값은
    // 상대 픽으로 변하지 않는다 → 상대 브로드캐스트가 내 슬롯 포커스·역할 필터를 흔들지 않음(#4).
    // [1-2] 원격 수동 슬롯 포커스는 set_active_slot 액션으로 서버에 반영 → 서버 activeSlot과 일치.
    setActiveSlot((v) => remote.activeSlot ?? v);

    setScrimMode((v) => remote.scrimMode ?? v);
    setScrimActive((v) => remote.scrimActive ?? v);
    setScrimTime((v) => remote.scrimTime ?? v);
    setAttackOrDefense((v) => remote.attackOrDefense ?? v);

    setCompletedSets((v) => remote.completedSets ?? v);
    setUsedMaps(new Set(remote.usedMaps ?? []));
    setUsedModesCycle(new Set(remote.usedModesCycle ?? []));
    setWinnerThisSet((v) => remote.winnerThisSet ?? v);
    setLogs((v) => remote.logs ?? v);
    setFirstSetPicker((v) => remote.firstSetPicker ?? v);
  }, [remote, syncOn, myRole]);

  // ★ HOST도 게스트 patch를 받아서 로컬로 흡수 (되돌림 방지)
  useEffect(() => {
    if (!syncOn || !remote) return;
    if (myRole !== "HOST") return;

    // 게스트가 바꾸는 가능성이 있는 필드들만 흡수
    if (remote.teamName) setTeamName(remote.teamName);   // [1-1] 게스트(B)의 팀명 변경 흡수
    if (remote.pickSlots) setPickSlots(remote.pickSlots);
    if (remote.activeSlot) setActiveSlot(remote.activeSlot);
    if (remote.pendingBan) setPendingBan(remote.pendingBan);
    if (remote.selectedMap !== undefined) setSelectedMap(remote.selectedMap);
    if (remote.banStarterChoice !== undefined) setBanStarterChoice(remote.banStarterChoice);
    if (remote.turn) setTurn(remote.turn);
    if (remote.phase) setPhase(remote.phase);
    if (remote.pickLockedTeam) setPickLockedTeam(remote.pickLockedTeam);
    if (remote.attackOrDefense !== undefined) setAttackOrDefense(remote.attackOrDefense);
  }, [syncOn, remote, myRole]);

  // READY → 동시에 시작: HOST가 깃발 1회만 세움 (단일 useEffect로만)
  useEffect(() => {
    if (!is1v1) return;

    // 원격에서 이미 started가 올라왔으면 로컬 맞춤 (게스트 포함)
    if (remote?.started) {
      if (!started) {
        setStarted(true);
        setPhase(remote.phase ?? (mode === MODE.HERO_BAN_ONLY ? "BAN_ORDER" : "MAP_PICK"));
        setRun(true);
      }
      return;
    }

    // 둘 다 READY이고, 내가 호스트이며 아직 시작 안 했을 때만 서버에 시작 플래그 1회 반영
    if (readyA && readyB && myRole === "HOST" && !remote?.started) {
      patch({ started: true, phase: mode === MODE.HERO_BAN_ONLY ? "BAN_ORDER" : "MAP_PICK" });
    }
  }, [is1v1, readyA, readyB, remote?.started, remote?.phase, myRole, mode, started, patch]);

  useEffect(() => {
    if (!started || !scrimMode) return;
    if (!scrimActive) {
      setScrimActive(true);
      if (syncOn && myRole === "HOST") patch({ scrimActive: true });
    }
  }, [started, scrimMode, scrimActive, syncOn, myRole, patch]);

  /* ========== 타이머 등 기타 로직 ========== */
  // 원격 모드는 서버가 타이머 권위 → 로컬 카운트다운/자동초기화 비활성(remote.timer 표시만).
  useEffect(() => {
    if (remoteMode) return;
    if (!started) return;
    setTimer(phase === "HERO_PICK" ? TIMER.PICK : TIMER.NORMAL);
    setRun(true);
  }, [phase, started, remoteMode]);

  useEffect(() => {
    if (remoteMode) return;
    if (!run || !started) return;
    if (timer <= 0) {
      setRun(false);
      onTimeout();
      return;
    }
    const id = setInterval(() => setTimer((t) => t - 1), 1000);
    return () => clearInterval(id);
  }, [run, timer, started, remoteMode]);

  useEffect(() => {
    if (phase === "HERO_PICK" && pickLockedTeam.A && pickLockedTeam.B) {
      setPickLocked(true);
      setRun(false);
      setShowSummaryOpen(true);
      setSummaryTab("summary");
    }
  }, [phase, pickLockedTeam]);

  useEffect(() => {
    if (phase !== "HERO_PICK") return;
    let tTeam: Team | null = null;
    if (partMode === "SOLO") tTeam = !pickLockedTeam.A ? "A" : !pickLockedTeam.B ? "B" : null;
    else tTeam = myTeamRole as Team | null;
    if (tTeam) {
      const role = SLOT_ROLES[activeSlot[tTeam]] ?? "Tank";
      if (filterRole !== role) setFilterRole(role);
    }
  }, [phase, partMode, myTeamRole, pickLockedTeam, activeSlot, filterRole]);

  useEffect(() => {
    if (phase !== "HERO_BAN") return;
    const allowed: Role[] = (["Tank", "Damage", "Support"] as Role[]).filter((r) => {
      const lock = roleLock[r];
      return !lock || lock === turn;
    });
    if (!allowed.includes(filterRole)) {
      setFilterRole(allowed[0] ?? "Tank");
    }
  }, [phase, turn, roleLock, filterRole]);

  // 세트 초기화 (직전 세트 패자에게 권한)
  useEffect(() => {
    if (remoteMode) return; // 원격 모드는 서버가 세트 초기화 → remote 반영
    if (scrimMode) return; // 스크림은 BetweenSetModal에서 초기화
    if (!started) return;
    if (seriesDone) {
      setRun(false);
      return;
    }
    const first = completedSets.length === 0;
    const lastWinner: Team | null = first ? null : completedSets[completedSets.length - 1].winner ?? null;
    const chooser: Team = first ? (firstSetPicker === "AUTO" ? (Math.random() < 0.5 ? "A" : "B") : firstSetPicker) : lastWinner ? (lastWinner === "A" ? "B" : "A") : "A";
    setOrderChooser(chooser);
    setMapPicker(chooser);
    setTurn(chooser);
    setSelectedMap(null);
    setBanStarterChoice(null);
    setAttackOrDefense(null); // ‼️ 초기화 추가
    setRoleLock({});
    setPendingBan({ A: null, B: null });
    setPickSlots({ A: [null, null, null, null, null], B: [null, null, null, null, null] });
    setActiveSlot({ A: 0, B: 0 });
    setPickLockedTeam({ A: false, B: false });
    setPickLocked(false);
    setBans({ A: [], B: [] });
    setWinnerThisSet(null);
    setPhase(mode === MODE.HERO_BAN_ONLY ? "BAN_ORDER" : "MAP_PICK");
  }, [completedSets.length, mode, started, seriesDone, firstSetPicker, scrimMode]);

  // 시리즈 종료되면 요약 모달 자동 오픈
  useEffect(() => {
    if (!started) return;
    if (!seriesDone) return;
    setRun(false);
    setShowSummaryOpen(true);
    setSummaryTab("summary");
  }, [seriesDone, started]);

  /* ========== Actions ========== */
  function popToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 900);
  }
  function logLine(msg: string) {
    setLogs((ls) => ls.concat([msg]));
  }

  const pushImportant = React.useCallback(() => {
    if (syncOn && myRole === "HOST") pushFull(sharedSnapshot);
  }, [syncOn, myRole, pushFull, sharedSnapshot]);

  function handleStart() {
    if (!teamName.A.trim() || !teamName.B.trim()) {
      alert(t.teamNameRequired);
      return;
    }
    if (partMode === "COACH_1V1") {
      if (!(readyA && readyB)) {
        alert("양 팀 모두 READY가 되어야 시작할 수 있습니다.");
        return;
      }
      wsSend({ type: "start" });   // 서버 권위: 시작은 서버가 판정
      return;
    }
    setStarted(true);

    if (scrimMode) {
      setScrimActive(true);
      if (syncOn && myRole === "HOST") patch({ scrimActive: true });
    }
  }

  function confirmBanOrderClick() {
    if (remoteMode) { wsSend({ type: "ban_order", ban_order: banStarterChoice }); return; }
    if (!banStarterChoice) return;
    const starter: Team = banStarterChoice === "OPPONENT" ? otherTeam(orderChooser) : orderChooser;

    // 로컬 반영
    setTurn(starter);
    setPhase("HERO_BAN");

    // 서버 반영 (게스트가 눌러도 서버에 반영되도록!)
    if (syncOn) {
      patch({
        banStarterChoice,
        turn: starter,
        phase: "HERO_BAN",
      });
    }
  }

  // ‼️ commitMap 함수 수정 (스크림 모드 분기 처리) ‼️
  /** 맵 확정 버튼 클릭 시 */
  function commitMap() {
    if (mode === MODE.HERO_BAN_ONLY) return;
    if (!selectedMap || !banStarterChoice) return;

    const mapObj = MAPS.find((m) => m.id === selectedMap);

    // ‼️ 맵 타입 체크 시 scrimMode인지 확인 ‼️
    if (scrimMode && mapObj && (mapObj.type === "Escort" || mapObj.type === "Hybrid")) {
      // (스크림 모드)이고 (호위/혼합 맵) -> 선공/선수비 선택 모달 열기
      setRun(false);
      setShowSideModal(true);
      // 밴 페이즈로의 진행은 모달의 onConfirm에서 처리
    } else {
      // (SOLO, 1v1 모드) 또는 (스크림이지만 쟁탈/밀기/플포 맵) -> 즉시 밴 페이즈로 진행
      setAttackOrDefense(null); // 공수선택 없음
      proceedToBanPhase(null);
    }
  }

  /** ‼️ 밴 페이즈로 진행하는 공통 로직 (신규 함수) ‼️ */
  function proceedToBanPhase(side: Side | null) {
    if (remoteMode) { wsSend({ type: "map_pick", map_id: selectedMap, ban_order: banStarterChoice, side }); return; }
    if (!selectedMap || !banStarterChoice) return; // 필수값 재확인

    const starter: Team = banStarterChoice === "OPPONENT" ? otherTeam(mapPicker) : mapPicker;
    const mapObj = MAPS.find((m) => m.id === selectedMap);

    // 로그 기록 (선공/선수비 포함)
    const sideStr = side === "ATTACK" ? " / 선공격" : side === "DEFENSE" ? " / 선수비" : "";
    logLine(`[세트 ${completedSets.length + 1}] ${t.confirmMap}: ${mapObj?.name ?? selectedMap}${sideStr}`);
    popToast(t.toastMap);

    // 로컬 상태 업데이트
    setTurn(starter);
    setPhase("HERO_BAN");
    setRun(true); // 타이머 다시 시작

    // 서버 반영 (게스트가 눌러도 반영되도록)
    if (syncOn) {
      patch({
        selectedMap,
        banStarterChoice,
        turn: starter,
        phase: "HERO_BAN",
        attackOrDefense: side, // ‼️ 선택된 사이드 정보 동기화
      });
    }
  }

  function proceedAfterBans() {
    if (mode === MODE.FULL) setPhase("HERO_PICK");
    else {
      setShowSummaryOpen(true);
      setSummaryTab("summary");
      setRun(false);
    }
  }

// [수정됨] 팀별 중복 밴 방지 로직 복구
  function applyBan(team: Team, id: string) {
    if (remoteMode) { wsSend({ type: "ban", hero_id: id }); return; }
    const hero = heroById(id);
    if (!hero) return;
    if (bans[team].length >= 1) return;
    
    // ★ 핵심 복구: 이 팀이 과거 세트에 이 영웅을 밴 했었다면, 이번에는 밴 할 수 없음
    if (teamBanHistory[team].has(id)) return; 

    if (roleLock[hero.role] && roleLock[hero.role] !== team) return;
    if (allBannedThisSet.includes(id)) return;

    const newBans: Record<Team, string[]> = { ...bans, [team]: [...bans[team], id] };
    const newRoleLock = roleLock[hero.role] ? roleLock : { ...roleLock, [hero.role]: team };
    const newPending = { ...pendingBan, [team]: null };

    logLine(`${teamName[team]} ${t.confirmBan}: ${hero.name}`);

    const total = newBans.A.length + newBans.B.length;
    let nextPhase: Phase = phase;
    let nextTurn: Team = turn;

    if (total >= 2) {
      if (mode === MODE.FULL) nextPhase = "HERO_PICK";
      else {
        // 요약 모달 등은 아래 setState에서 그대로 동작
      }
    } else {
      nextTurn = otherTeam(team);
    }

    // 로컬 반영
    setBans(newBans);
    if (newRoleLock !== roleLock) setRoleLock(newRoleLock);
    setPendingBan(newPending);
    if (nextTurn !== turn) setTurn(nextTurn);

    if (total >= 2) {
      if (mode === MODE.FULL) setPhase("HERO_PICK");
      else {
        setShowSummaryOpen(true);
        setSummaryTab("summary");
        setRun(false);
      }
    }

    // ★ 서버 반영
    if (syncOn) {
      const payload: any = {
        bans: newBans,
        roleLock: newRoleLock,
        pendingBan: newPending,
        turn: nextTurn,
      };
      if (total >= 2) payload.phase = nextPhase;
      patch(payload);
    }

    // [STEP3] 밴 연출 트리거 — 로컬 분기 성공 시점(1v1은 remote.bans 변화 감지로 별도 처리).
    enqueueReveal(team, id);

    popToast(t.toastBan);
  }

  function commitBan(forceId?: string) {
    const id = forceId ?? pendingBan[turn];
    if (!id) return;
    // popToast는 applyBan 안에서 처리
    applyBan(turn, id);
  }

  function canPickForTeam(team: Team) {
    if (phase !== "HERO_PICK") return false;
    if (partMode === "SOLO") return team === "A" ? !pickLockedTeam.A : pickLockedTeam.A && !pickLockedTeam.B;
    return myTeamRole === team;
  }

  function slotCanTake(team: Team, heroId: string) {
    if (phase !== "HERO_PICK" || pickLocked || pickLockedTeam[team]) return false;
    if (!canPickForTeam(team)) return false;
    if (allBannedThisSet.includes(heroId)) return false;
    if (pickSlots[team].includes(heroId)) return true;
    const idx = activeSlot[team];
    const need = SLOT_ROLES[idx];
    const hero = heroById(heroId);
    return hero?.role === need;
  }

  function togglePick(team: Team, heroId: string) {
    if (remoteMode) { wsSend({ type: "pick_toggle", hero_id: heroId }); return; }
    if (phase !== "HERO_PICK" || pickLocked || pickLockedTeam[team]) return;
    if (!canPickForTeam(team)) return;

    // 현재 상태를 바탕으로 다음 상태 계산
    const exist = pickSlots[team].indexOf(heroId);

    let nextSlots: Record<Team, (string | null)[]> = { ...pickSlots };
    let nextActive: Record<Team, number> = { ...activeSlot };

    if (exist !== -1) {
      // 이미 들어가 있던 영웅이면 제거
      nextSlots[team] = nextSlots[team].map((v, i) => (i === exist ? null : v));
      nextActive[team] = exist;
    } else {
      const idx = activeSlot[team];
      if (!slotCanTake(team, heroId)) return;
      nextSlots[team] = nextSlots[team].map((v, i) => (i === idx ? heroId : v));

      // 다음 빈 슬롯 탐색
      const arr = nextSlots[team];
      let nextIdx = -1;
      for (let i = 0; i < arr.length; i++) {
        if (i !== idx && arr[i] === null) {
          nextIdx = i;
          break;
        }
      }
      nextActive[team] = nextIdx === -1 ? idx : nextIdx;
    }

    // 로컬 반영
    setPickSlots(nextSlots);
    setActiveSlot(nextActive);

    // ★ 서버 반영 (게스트가 눌러도 호스트가 곧바로 받아서 되살림)
    if (syncOn) patch({ pickSlots: nextSlots, activeSlot: nextActive });
  }

  function handleHeroClick(heroId: string) {
    if (phase !== "HERO_PICK" || pickLocked) return;
    let t: Team | null = null;
    if (partMode === "SOLO") t = !pickLockedTeam.A ? "A" : !pickLockedTeam.B ? "B" : null;
    else t = myTeamRole as Team | null;
    if (!t) return;
    togglePick(t, heroId);
  }

  function confirmPick(team: Team) {
    if (remoteMode) { wsSend({ type: "pick_lock" }); return; }
    if (pickSlots[team].some((v) => v === null)) return;

    const nextLocked = { ...pickLockedTeam, [team]: true };
    setPickLockedTeam(nextLocked);

    const names = pickSlots[team].map((id) => (id ? heroById(id)?.name ?? id : "(빈)"));
    logLine(STR[lang].lockPickTeam(teamName[team]) + ": " + names.join(" / "));
    popToast(STR[lang].lockPickTeam(teamName[team]));

    // ★ 서버에도 락 반영
    if (syncOn) patch({ pickLockedTeam: nextLocked });
  }

  // [1-2] 픽 확정(레디) 해제 — 본인 팀만, 상대 미락·세트 미확정일 때만. 서버가 해제 상태 broadcast.
  function unlockPick(team: Team) {
    if (remoteMode) { wsSend({ type: "pick_unlock" }); return; }
    if (pickLocked || !pickLockedTeam[team] || pickLockedTeam[otherTeam(team)]) return;
    const next = { ...pickLockedTeam, [team]: false };
    setPickLockedTeam(next);
    logLine(`${teamName[team]} 픽 해제`);
    if (syncOn) patch({ pickLockedTeam: next });
  }

  // [1-2] 슬롯 재포커스(해당 슬롯만 교체용). 로컬=로컬 setActiveSlot, 1v1=서버 set_active_slot.
  function focusSlot(team: Team, idx: number) {
    if (phase !== "HERO_PICK" || pickLocked || pickLockedTeam[team]) return;
    if (!canPickForTeam(team)) return;
    if (remoteMode) { wsSend({ type: "set_active_slot", slot: idx }); return; }
    setActiveSlot((p) => ({ ...p, [team]: idx }));
  }

  // [1-2] 해제 가능 여부: 본인 팀 통제 + 락 상태 + 상대 미락 + 세트 미확정.
  const controllableTeam = (team: Team) => partMode === "SOLO" || myTeamRole === team;
  const canUnlockTeam = (team: Team) =>
    pickLockedTeam[team] && !pickLocked && !pickLockedTeam[otherTeam(team)] && controllableTeam(team);

  // ‼️ 'finishSet' 함수 (단순 승리)
  function finishSet(winner: Team) {
    if (remoteMode) { wsSend({ type: "set_result", result: winner }); return; }
    const effective: "PICKER" | "OPPONENT" = banStarterChoice ?? "PICKER";
    const mapPickerThis: Team | null = mode === MODE.HERO_BAN_ONLY ? null : mapPicker;
    const firstChooser: Team = mode === MODE.HERO_BAN_ONLY ? orderChooser : mapPickerThis ?? orderChooser;
    const banFirstTeam: Team = effective === "OPPONENT" ? otherTeam(firstChooser) : firstChooser;

    const snapshot: SetSnapshot = {
      bans,
      picks: { A: pickSlots.A.filter(Boolean) as string[], B: pickSlots.B.filter(Boolean) as string[] },
      map: selectedMap,
      winner,
      mapPicker: mapPickerThis,
      banFirst: banFirstTeam,
      banSecond: otherTeam(banFirstTeam),
      attackOrDefense: attackOrDefense, // ‼️ 공수정보 추가
    };

    setWinnerThisSet(winner);
    setCompletedSets((prev) => prev.concat([snapshot]));

    if (selectedMap) {
      const m = MAPS.find((x) => x.id === selectedMap);
      if (m) {
        setUsedMaps((prev) => new Set(prev).add(selectedMap));
        setUsedModesCycle((prev) => {
          const nxt = new Set(prev);
          nxt.add(m.type);
          return nxt.size >= 5 ? new Set() : nxt;
        });
      }
    }
    logLine(`[세트 ${completedSets.length + 1}] 승자: ${winner === "A" ? teamName.A : teamName.B}`);
    setTimeout(pushImportant, 0);
  }

  // ‼️ 'finishSetA' 함수 (스크림용 상세 승리/무승부)
  function finishSetA(resultA: "W" | "L" | "D", scoreA: number, scoreB: number) {
    if (remoteMode) { wsSend({ type: "set_result", result: resultA === "W" ? "A" : resultA === "L" ? "B" : "D", scoreA, scoreB }); return; }
    const winner: Team | null = resultA === "W" ? "A" : resultA === "L" ? "B" : null; // ‼️ 무승부(D) 시 winner는 null

    const effective: "PICKER" | "OPPONENT" = banStarterChoice ?? "PICKER";
    const mapPickerThis: Team | null = mode === MODE.HERO_BAN_ONLY ? null : mapPicker;
    const firstChooser: Team = mode === MODE.HERO_BAN_ONLY ? orderChooser : mapPickerThis ?? orderChooser;
    const banFirstTeam: Team = effective === "OPPONENT" ? (firstChooser === "A" ? "B" : "A") : firstChooser;

    const snapshot: SetSnapshot = {
      bans,
      picks: { A: pickSlots.A.filter(Boolean) as string[], B: pickSlots.B.filter(Boolean) as string[] },
      map: selectedMap,
      winner,
      mapPicker: mapPickerThis,
      banFirst: banFirstTeam,
      banSecond: banFirstTeam === "A" ? "B" : "A",
      scoreA,
      scoreB,
      resultA,
      attackOrDefense: attackOrDefense, // ‼️ 공수정보 추가
    };

    setWinnerThisSet(winner);
    setCompletedSets((prev) => prev.concat([snapshot]));

    // ‼️ 로그 메시지 수정 ‼️
    const resultText = resultA === "W" ? "승리(W)" : resultA === "L" ? "패배(L)" : "무승부(D)";
    logLine(`[세트 ${completedSets.length + 1}] 결과: ${resultText} (${scoreA}:${scoreB})`);

    if (syncOn && myRole === "HOST") pushFull(sharedSnapshot);

    if (scrimMode) {
      setBetweenOpen(true); // ⬅️ 다음세트 설정 모달 오픈
    } else {
      // 기존 시리즈 흐름 유지(요약 모달은 이미 열려 있음)
    }
  }

  function onTimeout() {
    if (phase === "MAP_PICK") {
      let chosen = selectedMap;
      const pool = filteredMapsForPick;
      if (!chosen && pool.length) chosen = pool[Math.floor(Math.random() * pool.length)].id;

      const choice: "PICKER" | "OPPONENT" = banStarterChoice ?? "PICKER";
      
      // 맵이 자동 선택되었으므로, 공수선택도 자동으로 처리 (null)
      setBanStarterChoice(choice);
      setSelectedMap(chosen || null);
      setAttackOrDefense(null);
      proceedToBanPhase(null); // 즉시 밴페이즈로
      return;
    }

    if (phase === "BAN_ORDER") {
      const choice: "PICKER" | "OPPONENT" = banStarterChoice ?? "PICKER";
      const starter: Team = choice === "OPPONENT" ? otherTeam(orderChooser) : orderChooser;

      setBanStarterChoice(choice);
      setTurn(starter);
      setPhase("HERO_BAN");

      if (syncOn) {
        patch({
          banStarterChoice: choice,
          turn: starter,
          phase: "HERO_BAN",
        });
      }
      return;
    }

    // (나머지 HERO_BAN/HERO_PICK 분기도 필요하면 같은 방식으로 phase/turn 등을 patch)
  }

  // ‼️ resetToHome 함수 수정 ‼️
  function resetToHome() {
    setRun(false);
    setTimer(TIMER.NORMAL);
    setShowSummaryOpen(false);
    setToast(null);
    setLogs([]);

    setReadyA(false);
    setReadyB(false);

    setCompletedSets([]);
    setUsedMaps(new Set());
    setUsedModesCycle(new Set());

    setSelectedMap(null);
    setMapPicker("A");
    setOrderChooser("A");
    setTurn("A");
    setBanStarterChoice(null);
    setRoleLock({});
    setPendingBan({ A: null, B: null });
    setAttackOrDefense(null); // ‼️ 초기화 추가

    setBans({ A: [], B: [] });
    setPickSlots({ A: [null, null, null, null, null], B: [null, null, null, null, null] });
    setActiveSlot({ A: 0, B: 0 });
    setPickLockedTeam({ A: false, B: false });
    setPickLocked(false);
    setWinnerThisSet(null);

    setStarted(false);

    // ‼️ 스크림 모드 관련 상태 초기화 추가 ‼️
    setScrimMode(false);
    setScrimActive(false);
    setScrimTime("");
    setPartMode("SOLO"); // 기본 모드로 리셋
    setFirstSetPicker("AUTO"); // 픽 순서 리셋
    setMode(MODE.FULL); // 시뮬레이션 범위 리셋

    // (1v1 모드) 다른 플레이어에게도 종료 알림
    if (syncOn && myRole === "HOST") {
      patch({
        started: false,
        scrimMode: false,
        scrimActive: false,
        scrimTime: "",
        attackOrDefense: null, // ‼️ 초기화 추가
      });
    }
  }

  /* === permission flags === */
  const canEditMapStuff = partMode === "SOLO" || canControlMapOrOrder(partMode, myRole, mapPicker);
  const canEditOrderStuff = partMode === "SOLO" || canControlMapOrOrder(partMode, myRole, orderChooser);
  const canBanThisTurn = partMode === "SOLO" || canControlBanTurn(partMode, myRole, turn);

  // [STEP5] 진행 팀(표시용): SOLO=미잠금 팀 우선, 그 외=내 팀. 헤더 턴/모바일 공용.
  const pickTurnTeam: Team | null =
    partMode === "SOLO" ? (!pickLockedTeam.A ? "A" : !pickLockedTeam.B ? "B" : null) : (myTeamRole as Team | null);
  const headerTurnTeam: Team | null = phase === "HERO_BAN" ? turn : phase === "HERO_PICK" ? pickTurnTeam : null;

  // [STEP5] 밴 중앙 영역(역할 필터 + 밴 그리드 + 확정 바) — 데스크톱/모바일 공용. HERO_BAN에서만 호출.
  const renderBanArea = () => (
    <>
      <div className="flex flex-wrap items-center gap-2 mb-2">
        {(["Tank", "Damage", "Support"] as Role[])
          .filter((r) => { const lock = roleLock[r]; return !lock || lock === turn; })
          .map((r) => (
            <button key={r} onClick={() => setFilterRole(r)} className={"px-3 py-1 rounded-full border text-xs " + (filterRole === r ? theme.activeGreen : "border-neutral-300")}>{roleLabel(r)}</button>
          ))}
        <div className="ml-auto text-xs">{t.curTurn}: <b>{turn === "A" ? teamName.A : teamName.B}</b> · {t.timeLeft}: <b>{timer}s</b></div>
      </div>
      <div className="mx-auto w-full max-w-[1440px] px-1 sm:px-2">
      <div className="grid gap-3 bp-grid-ban">
        {HEROES.filter((h) => h.role === filterRole).map((h) => {
          const isLockedRole = roleLock[h.role] && roleLock[h.role] !== turn;
          const bannedThisSet = bans.A.includes(h.id) || bans.B.includes(h.id);
          const bannedByThisTeamBefore = teamBanHistory[turn].has(h.id);
          const disabled = !canBanThisTurn || !!isLockedRole || bannedThisSet || bannedByThisTeamBefore || bans[turn].length >= 1;
          const selected = pendingBan[turn] === h.id;
          return (
            <div
              key={h.id}
              onClick={() => { if (disabled) return; setPendingBan((p) => { const next = { ...p, [turn]: p[turn] === h.id ? null : h.id }; if (syncOn) patch({ pendingBan: next }); return next; }); }}
              className={"cursor-pointer rounded-xl border overflow-hidden " + (disabled ? "opacity-50 border-neutral-200" : selected ? "bp-sel-ban" : "border-neutral-300")}
            >
              <div className="relative w-full aspect-square overflow-hidden">
                <HeroThumb id={h.id} contain={false} />
                {bannedThisSet && <BanSlashOverlay />}
              </div>
            </div>
          );
        })}
      </div>
      </div>
      <div className="mt-3 flex items-center gap-2 bp-actionbar">
        <button className={`px-3 py-2 rounded-lg border ${theme.btnBorder} bp-touch`} onClick={() => setRun((r) => { const next = !r; popToast(next ? t.play : t.pause); return next; })}>{run ? t.pause : t.play}</button>
        <button className={`px-3 py-2 rounded-lg border ${theme.btnBorder} bp-touch`} disabled={!pendingBan[turn] || !canBanThisTurn} onClick={() => commitBan()}>{t.confirmBan}</button>
      </div>
    </>
  );

  // [STEP5] PickColumn 공통 props(A/B) — HERO_BAN·HERO_PICK 공용.
  const pickColProps = (team: Team) => ({
    team, teamName, lang, t, phase, bans, pickSlots, pickLockedTeam,
    activeSlot, onFocusSlot: focusSlot, confirmPick, onUnlock: unlockPick, canUnlock: canUnlockTeam(team),
    canPickForTeam, heroById,
  });

  /* ============== UI ============== */
  return (
    <div className={"bp-root " + (dark ? "" : "light ") + theme.root}>
      {/* 상단 바(타이틀·스코어보드·토글) 전부 제거 — 분석기 네비가 있으므로 콘텐츠만 렌더.
          요약/로그 등 기능 버튼은 아래 콘텐츠 상단 툴바로 이동. */}
      <main className="mx-auto w-full max-w-none px-4 lg:px-6 py-6 2xl:max-w-[1720px]">
        {!started ? (
          <Setup
            teamName={teamName}
            onRenameTeam={renameTeam}
            sets={sets}
            setSets={setSets}
            mode={mode}
            setMode={setMode}
            partMode={partMode}
            setPartMode={setPartMode}
            myRole={myRole}
            setMyRole={setMyRole}
            initialPicker={firstSetPicker}
            setInitialPicker={setInitialPickerSync}
            onStart={handleStart}
            dark={dark}
            t={t}
            roomCode={roomId}
            opponentConnected={ws.opponentConnected}
            onCreateRoom={() => ws.createRoom({ mode, sets, scrimMode, teamNameA: teamName.A, teamNameB: teamName.B, firstSetPicker })}
            onJoinRoom={(code) => ws.joinRoom(code)}
            readyA={readyA}
            readyB={readyB}
            setReadyA={setReadyA}
            setReadyB={setReadyB}
            scrimMode={scrimMode}
            setScrimMode={setScrimModeSync}
            scrimTime={scrimTime}
            setScrimTime={setScrimTimeSync}
            onToast={popToast}
          />
        ) : (
          <section className={`p-4 ${theme.panel}`}>
            {/* 콘텐츠 상단 툴바(요약/로그만) — 스코어 바는 제거 */}
            <div className="flex items-center gap-2 mb-3">
              <div className="ml-auto flex items-center gap-2">
                <button className={`px-2 py-1 rounded border ${theme.btnBorder} text-xs`} onClick={() => { setSummaryTab("summary"); setShowSummaryOpen(true); }}>{t.openSummary}</button>
                <button className={`px-2 py-1 rounded border ${theme.btnBorder} text-xs`} onClick={() => { setSummaryTab("log"); setShowSummaryOpen(true); }}>{t.openLogs}</button>
                {scrimMode && (
                  <button className={`px-2 py-1 rounded border ${theme.btnBorder} text-xs`} onClick={() => { setFrozenSummarySets(completedSets); setShowScrimSummary(true); }}>스크림 종료</button>
                )}
              </div>
            </div>
            {/* [STEP7] 헤더: MAP_PICK=h2, 그 외(HERO_BAN·HERO_PICK·BAN_ORDER)=맵 배경 띠(BanpickHeader).
                HERO_BAN은 헤더 좌하단에 양 팀 밴 셀 표시(bans/heroById 전달). "영웅 밴" h2는 헤더 우상단 표시로 대체. */}
            {phase === "MAP_PICK" ? (
              <h2 className="font-semibold mb-3">{mode !== MODE.HERO_BAN_ONLY && STR[lang].mapPick}</h2>
            ) : (
              <BanpickHeader selectedMap={selectedMap} mode={mode} phase={phase} turnTeam={headerTurnTeam} teamName={teamName} bans={bans} heroById={heroById} t={t} lang={lang} />
            )}

            {/* MAP PICK */}
            {mode !== MODE.HERO_BAN_ONLY && phase === "MAP_PICK" && (
              <div>
                <div className="flex flex-wrap items-center gap-2 mb-3">
                  {(["All", "Control", "Escort", "Hybrid", "Push", "Flashpoint"] as const).map((mt) => (
                    <button
                      key={mt}
                      onClick={() => setMapFilter((prev) => (prev === mt ? "All" : mt))}
                      className={"px-3 py-1 rounded-full border text-xs " + (mapFilter === mt ? theme.activeGreen : "border-neutral-300")}
                    >
                      {mapTypeLabel(mt)}
                    </button>
                  ))}
                  <div className="ml-auto text-xs">
                    {t.mapRight}: <b>{mapPicker === "A" ? teamName.A : teamName.B}</b>
                  </div>
                </div>

                <div className="mx-auto w-full max-w-[1440px] px-1 sm:px-2">
                  <div className="grid gap-4 bp-grid-map">
                    {filteredMapsForPick.map((m) => (
                      <button
                        key={m.id}
                        onClick={() => {
                          if (!canEditMapStuff) return;
                          setSelectedMap((prev) => {
                            const next = prev === m.id ? null : m.id;
                            if (syncOn) patch({ selectedMap: next }); // ★ 선택 즉시 서버에 반영
                            return next;
                          });
                        }}
                        className={"text-left rounded-xl border overflow-hidden " + (selectedMap === m.id ? "bp-sel-pick" : "border-neutral-300")}
                      >
                        <div className="relative w-full aspect-[16/9] overflow-hidden">
                          <MapThumb id={m.id} />
                        </div>
                        {/* #6 이름은 이미지 바로 아래 한 줄 + 최소 패딩 */}
                        <div className="px-2 py-1 text-[12px] font-medium flex items-center gap-1 overflow-hidden">
                          <MapTypeBadge type={m.type} lang={lang} className="shrink-0" />
                          <span className="truncate leading-tight">{getMapDisplayName(m.name)}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center gap-2 mt-3">
                  <div className="text-xs">{t.banOrder}:</div>
                  <button
                    className={`px-3 py-1 rounded-lg border text-xs bp-touch ${banStarterChoice === "PICKER" ? theme.activeGreen : theme.btnBorder}`}
                    onClick={() => {
                      if (!canEditMapStuff) return;
                      const next = banStarterChoice === "PICKER" ? null : "PICKER";
                      setBanStarterChoice(next);
                      if (syncOn) patch({ banStarterChoice: next }); // ★
                    }}
                  >
                    {t.pickFirst}
                  </button>
                  <button
                    className={`px-3 py-1 rounded-lg border text-xs bp-touch ${banStarterChoice === "OPPONENT" ? theme.activeGreen : theme.btnBorder}`}
                    onClick={() => {
                      if (!canEditMapStuff) return;
                      const next = banStarterChoice === "OPPONENT" ? null : "OPPONENT";
                      setBanStarterChoice(next);
                      if (syncOn) patch({ banStarterChoice: next }); // ★
                    }}
                  >
                    {t.pickSecond}
                  </button>
                  <div className="ml-auto text-xs">
                    {t.timeLeft}: <b>{timer}s</b>
                  </div>
                </div>

                <div className="mt-3 flex gap-2 bp-actionbar">
                  <button
                    className={`px-3 py-2 rounded-lg border ${theme.btnBorder} bp-touch`}
                    onClick={() =>
                      setRun((r) => {
                        const next = !r;
                        popToast(next ? t.play : t.pause);
                        return next;
                      })
                    }
                  >
                    {run ? t.pause : t.play}
                  </button>
                  <button
                    className={`px-3 py-2 rounded-lg border ${theme.btnBorder} bp-touch`}
                    disabled={!selectedMap || !banStarterChoice || !canEditMapStuff}
                    onClick={() => canEditMapStuff && commitMap()}
                  >
                    {t.confirmMap}
                  </button>
                </div>
              </div>
            )}

            {/* BAN ORDER */}
            {phase === "BAN_ORDER" && (
              <div>
                <div className="text-xs mb-2">
                  {t.chooserRight}: <b>{orderChooser === "A" ? teamName.A : teamName.B}</b>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    className={`px-3 py-1 rounded-lg border text-xs bp-touch ${banStarterChoice === "PICKER" ? theme.activeGreen : theme.btnBorder}`}
                    onClick={() => {
                      if (!canEditOrderStuff) return;
                      setBanStarterChoice((v) => (v === "PICKER" ? null : "PICKER"));
                    }}
                  >
                    {t.pickFirst}
                  </button>
                  <button
                    className={`px-3 py-1 rounded-lg border text-xs bp-touch ${banStarterChoice === "OPPONENT" ? theme.activeGreen : theme.btnBorder}`}
                    onClick={() => {
                      if (!canEditOrderStuff) return;
                      setBanStarterChoice((v) => (v === "OPPONENT" ? null : "OPPONENT"));
                    }}
                  >
                    {t.pickSecond}
                  </button>
                  <div className="ml-auto text-xs">
                    {t.timeLeft}: <b>{timer}s</b>
                  </div>
                </div>
                <div className="mt-3">
                  <button
                    className={`px-3 py-2 rounded-lg border ${theme.btnBorder}`}
                    disabled={!banStarterChoice || !canEditOrderStuff}
                    onClick={() => canEditOrderStuff && confirmBanOrderClick()}
                  >
                    {t.confirm}
                  </button>
                </div>
              </div>
            )}

            {/* [STEP7] HERO_BAN — 전폭 밴 영역(dc39c45 복원): 요약 패널(위) + 역할 필터 + 밴 그리드 + 확정.
                픽 슬롯 열 미표시. 데스크톱/모바일 공용(bp-grid-ban 반응형). 밴 tear 오버레이는 전역 유지. */}
            {phase === "HERO_BAN" && <div>{renderBanArea()}</div>}

            {/* [STEP5] HERO_PICK — 3열(팀 열: 밴 카드 + 슬롯 | 가운데: 픽 그리드) */}
            {phase === "HERO_PICK" && (() => {
              return (
              <>
                {/* ===== 데스크톱: 3열(팀A | 그리드 | 팀B) — 열 최상단 밴 카드 + 슬롯 ===== */}
                <div className="hidden md:flex bp-draft-cols overflow-hidden gap-4">
                  <aside className="min-w-0 w-full md:w-[260px] lg:w-[300px] h-full pr-2">
                    <PickColumn {...pickColProps("A")} />
                  </aside>

                  <main className="min-w-0 flex-1 h-full overflow-y-auto pr-2">
                    <PickCenter lang={lang} t={t} filterRole={filterRole} teamName={teamName} bannedIds={allBannedThisSet} pickedA={pickSlots.A} pickedB={pickSlots.B} onHeroClick={handleHeroClick} />
                  </main>

                  <aside className="min-w-0 w-full md:w-[260px] lg:w-[300px] h-full">
                    <PickColumn {...pickColProps("B")} />
                  </aside>
                </div>

                {/* ===== 모바일: 상단고정 턴/타이머 + 양팀 픽현황(가로압축) + 영웅 그리드 + 하단고정 확정 ===== */}
                <div className="md:hidden">
                  {/* 턴·남은시간 — 스크롤 무관 항상 상단 고정 */}
                  <div className="bp-turnbar flex items-center gap-2 text-xs">
                    <span>{t.curTurn}: <b>{headerTurnTeam ? teamName[headerTurnTeam] : "-"}</b></span>
                    <span className="ml-auto">{t.timeLeft}: <b>{timer}s</b></span>
                  </div>

                  {/* 양 팀: 밴 카드 + 가로 슬롯 행(HERO_BAN은 슬롯 비활성 플레이스홀더) */}
                  {(["A", "B"] as Team[]).map((tm) => {
                    const locked = pickLockedTeam[tm];
                    const clickable = phase === "HERO_PICK" && canPickForTeam(tm) && !locked;
                    return (
                      <div key={tm} className="mb-2">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-semibold">{tm === "A" ? teamName.A : teamName.B}</span>
                          {locked && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full border font-semibold" style={{ borderColor: "#4ade80", color: "#4ade80", background: "rgba(74,222,128,0.14)" }}>{t.ready}</span>
                          )}
                          {phase === "HERO_PICK" && pickTurnTeam === tm && !locked && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full border font-semibold" style={{ borderColor: "var(--bp-primary)", color: "var(--bp-primary)", background: "rgba(59,130,246,0.14)" }}>{t.curTurn}</span>
                          )}
                          {locked && canUnlockTeam(tm) && (
                            <button
                              className="text-[10px] px-2 py-0.5 rounded-full border font-semibold bp-touch"
                              style={{ borderColor: "var(--bp-danger)", color: "var(--bp-danger)", background: "rgba(239,68,68,0.12)" }}
                              onClick={() => unlockPick(tm)}
                            >
                              레디 해제
                            </button>
                          )}
                        </div>
                        <div className="flex gap-1 items-stretch">
                          <div className="flex-1 min-w-0"><BanCard heroId={bans[tm][0] ?? null} heroById={heroById} lang={lang} mobile /></div>
                          {SLOT_ROLES.map((sr, i) => {
                            const hid = pickSlots[tm][i];
                            const active = activeSlot[tm] === i && !locked;
                            const slotRole: Role = (hid ? (heroById(hid)?.role as Role) : sr) ?? sr;
                            return (
                              <button
                                key={i}
                                disabled={!clickable}
                                onClick={() => clickable && focusSlot(tm, i)}
                                className={["flex-1 min-w-0 rounded-lg border p-0.5", active ? "bp-sel-pick" : "border-neutral-300", !clickable && "opacity-60"].join(" ")}
                              >
                                <div className="relative w-full aspect-square rounded overflow-hidden bg-neutral-100">
                                  <HeroThumb id={hid ?? null} />
                                </div>
                                <div className="flex items-center justify-center mt-0.5">
                                  <RoleIcon role={slotRole} lang={lang} className="shrink-0" />
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}

                  {/* 가운데 그리드 — 픽(PickCenter) */}
                  <PickCenter lang={lang} t={t} filterRole={filterRole} teamName={teamName} bannedIds={allBannedThisSet} pickedA={pickSlots.A} pickedB={pickSlots.B} onHeroClick={handleHeroClick} />


                  {/* 하단 고정 확정 — HERO_PICK 전용(HERO_BAN은 renderBanArea에 밴 확정 포함) */}
                  {phase === "HERO_PICK" && pickTurnTeam && (() => {
                    const tm = pickTurnTeam;
                    const allFilled = !pickSlots[tm].some((v) => v === null);
                    const canAct = canPickForTeam(tm);
                    const done = pickLockedTeam[tm];
                    const ready = !done && allFilled && canAct;
                    const badgeStyle = done
                      ? { borderColor: "#4ade80", color: "#4ade80", background: "rgba(74,222,128,0.14)" }
                      : ready
                      ? { borderColor: "var(--bp-primary)", color: "var(--bp-primary)", background: "rgba(59,130,246,0.14)" }
                      : { borderColor: "var(--bp-border2)", background: "var(--bp-surface2)", color: "var(--bp-textsub)" };
                    return (
                      <div className="bp-actionbar">
                        <button
                          className="w-full px-2 rounded-lg border text-xs font-semibold bp-touch"
                          style={badgeStyle}
                          onClick={() => confirmPick(tm)}
                          disabled={done || !allFilled || !canAct}
                        >
                          {(tm === "A" ? teamName.A : teamName.B)} — {done ? "✓ 픽 완료" : ready ? "픽 완료 (클릭)" : "픽 완료"}
                        </button>
                      </div>
                    );
                  })()}
                </div>
              </>
              );
            })()}
          </section>
        )}
      </main>

      {/* 토스트 */}
      {toast && <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-40 ${theme.panel} rounded-full px-3 py-1 text-xs shadow-lg`}>{toast}</div>}

      {/* [STEP3] 밴 연출 오버레이 — 큐의 맨 앞 1건 재생(key로 remount). */}
      {currentReveal && (
        <BanReveal
          key={currentReveal.id}
          team={currentReveal.team}
          heroId={currentReveal.heroId}
          teamName={teamName}
          heroById={heroById}
          t={t}
        />
      )}

      {/* 요약/로그 모달 */}
      {showSummaryOpen && (
        <SummaryLogModal
          teamName={teamName}
          completedSets={completedSets}
          logs={logs}
          tab={summaryTab}
          setTab={setSummaryTab}
          onClose={() => setShowSummaryOpen(false)}
          dark={dark}
          t={t}
          scrimMode={scrimMode}
          onFinishSet={(tm: Team) => {
            finishSet(tm);
            setShowSummaryOpen(false);
          }}
          onFinishSetA={(resultA, aScore, bScore) => {
            finishSetA(resultA, aScore, bScore);
            setShowSummaryOpen(false);
          }}
          seriesDone={seriesDone}
          onExitSeries={resetToHome}
          canEditWinner={canEditWinner}
        />
      )}

      {/* 스크림 모드 전용 '다음 세트 설정' 모달 */}
      <BetweenSetModal
        open={betweenOpen}
        onClose={() => setBetweenOpen(false)}
        defaultMapPicker={completedSets.length ? (completedSets[completedSets.length - 1].mapPicker === "A" ? "B" : "A") : "A"}
        defaultBanFirst={completedSets.length ? (completedSets[completedSets.length - 1].banFirst === "A" ? "B" : "A") : "A"}
        teamName={teamName}
        dark={dark}
        onConfirm={(mp, bf) => {
          const choice: "PICKER" | "OPPONENT" = bf === mp ? "PICKER" : "OPPONENT";

          // 다음 세트 초기화
          setSelectedMap(null);
          setBanStarterChoice(null);
          setAttackOrDefense(null); // ‼️ 초기화 추가
          setRoleLock({});
          setPendingBan({ A: null, B: null });
          setBans({ A: [], B: [] });
          setPickSlots({ A: [null, null, null, null, null], B: [null, null, null, null, null] });
          setActiveSlot({ A: 0, B: 0 });
          setPickLockedTeam({ A: false, B: false });
          setPickLocked(false);
          setWinnerThisSet(null);

          // 권리 지정
          setMapPicker(mp);
          setOrderChooser(mp);
          setBanStarterChoice(choice);
          setTurn(mp);
          setPhase(mode === MODE.HERO_BAN_ONLY ? "BAN_ORDER" : "MAP_PICK");
          setRun(true);

          if (syncOn) {
            patch({
              selectedMap: null,
              bans: { A: [], B: [] },
              pickSlots: { A: [null, null, null, null, null], B: [null, null, null, null, null] },
              activeSlot: { A: 0, B: 0 },
              pickLockedTeam: { A: false, B: false },
              pickLocked: false,
              roleLock: {},
              pendingBan: { A: null, B: null },
              attackOrDefense: null, // ‼️ 초기화 추가
              mapPicker: mp,
              orderChooser: mp,
              banStarterChoice: choice,
              turn: mp,
              phase: mode === MODE.HERO_BAN_ONLY ? "BAN_ORDER" : "MAP_PICK",
              run: true,
            });
          }

          setBetweenOpen(false);
        }}
      />

      {/* ‼️ 선공/선수비 모달 렌더링 수정 ‼️ */}
      <AttackDefenseModal
        open={showSideModal}
        onClose={() => setShowSideModal(false)}
        onConfirm={(side) => {
          setAttackOrDefense(side); // 선택한 사이드 저장
          proceedToBanPhase(side); // 밴 페이즈로 진행
          setShowSideModal(false); // 모달 닫기
        }}
        dark={dark}
        // ‼️ teamName과 chooserTeam prop 제거 ‼️
      />

      {/* 스크림 모드 전용 '종료' 모달 */}
      {showScrimSummary && (
        <ScrimSummaryModal
          open={showScrimSummary}
          onClose={() => setShowScrimSummary(false)}
          sets={frozenSummarySets}
          teamName={teamName}
          dark={dark}
          setScrimActive={setScrimActive}
          syncOn={syncOn}
          myRole={myRole}
          patch={patch}
          onExitSeries={resetToHome}
          scrimTime={scrimTime}
          onToast={popToast}
        />
      )}
    </div>
  );
}

/* ================= Setup ================= */
function Setup(props: {
  teamName: Record<Team, string>;
  onRenameTeam: (team: Team, name: string) => void;
  sets: number;
  setSets: (v: number) => void;
  mode: number;
  setMode: (v: number) => void;
  partMode: PartMode;
  setPartMode: (v: PartMode) => void;
  myRole: MyRole;
  setMyRole: (v: MyRole) => void;
  initialPicker: "AUTO" | Team;
  setInitialPicker: (v: "AUTO" | Team) => void;
  onStart: () => void;
  dark: boolean;
  t: I18n;
  roomCode?: string;
  opponentConnected?: boolean;
  onCreateRoom?: () => void;
  onJoinRoom?: (code: string) => void;
  readyA: boolean;
  readyB: boolean;
  setReadyA: React.Dispatch<React.SetStateAction<boolean>>;
  setReadyB: React.Dispatch<React.SetStateAction<boolean>>;
  scrimMode: boolean;
  setScrimMode: (v: boolean) => void;
  scrimTime: string;
  setScrimTime: (v: string) => void;
  onToast: (m: string) => void;
}) {
  const canEditGlobal = props.partMode === "SOLO" || props.myRole === "HOST" || props.scrimMode;
  const canEditAName = props.partMode === "SOLO" || props.myRole === "HOST" || props.myRole === "A" || props.scrimMode;
  const canEditBName = props.partMode === "SOLO" || props.myRole === "B" || props.scrimMode;

  const { t, dark } = props;

  // 1. scrimMode가 true이면 "SCRIM", 아니면 partMode 값으로 현재 모드를 결정
  const currentCombinedMode = props.scrimMode ? "SCRIM" : props.partMode;

  // 2. 드롭다운 변경 시 scrimMode와 partMode를 동시에 업데이트하는 핸들러
  const handleModeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    if (value === "SCRIM") {
      props.setScrimMode(true);
      props.setPartMode("SOLO"); // 스크림 모드는 SOLO 기반으로 설정
    } else if (value === "COACH_1V1") {
      props.setScrimMode(false);
      props.setPartMode("COACH_1V1");
    } else {
      // "SOLO"
      props.setScrimMode(false);
      props.setPartMode("SOLO");
    }
  };

  const fieldStyle = `w-full px-3 py-2 rounded-lg border bp-touch ${dark ? "border-neutral-700 bg-neutral-900 text-white" : "border-neutral-300 bg-white text-neutral-900"}`;
  const boxStyle = `${dark ? "bg-neutral-800 border-neutral-700" : "bg-white border-neutral-200"} max-w-xl mx-auto border rounded-2xl p-6`;

  const [joinCode, setJoinCode] = React.useState("");
  const canToggleA = props.myRole === "HOST" || props.myRole === "A";
  const canToggleB = props.myRole === "B";

  return (
    <div className={boxStyle}>
      <div className="text-base font-semibold mb-4">{t.startSettings}</div>

      <div className="grid gap-3">
        <label className="text-xs">{t.teamAName}</label>
        <input className={fieldStyle} value={props.teamName.A} onChange={(e) => props.onRenameTeam("A", e.target.value)} disabled={!canEditAName} />
        <label className="text-xs">{t.teamBName}</label>
        <input className={fieldStyle} value={props.teamName.B} onChange={(e) => props.onRenameTeam("B", e.target.value)} disabled={!canEditBName} />
      </div>

      <div className="grid grid-cols-2 gap-3 mt-4">
        <div>
          <div className="text-xs mb-1">{t.participation}</div>
          <select className={fieldStyle} value={currentCombinedMode} onChange={handleModeChange} disabled={!canEditGlobal}>
            <option value="SOLO">{t.solo}</option>
            <option value="COACH_1V1">{t.oneVone}</option>
            <option value="SCRIM">{t.scrim}</option>
          </select>
        </div>
        <div>
          <div className="text-xs mb-1">{t.format}</div>
          <select className={fieldStyle} value={props.sets} onChange={(e) => props.setSets(Number(e.target.value))} disabled={!canEditGlobal}>
            <option value={3}>BO3</option>
            <option value={5}>BO5</option>
            <option value={7}>BO7</option>
          </select>
        </div>
      </div>

      {/* ‼️ "스크림 시간" 입력창 (텍스트 수정) ‼️ */}
      {props.scrimMode && (
        <div className="grid gap-3 mt-3">
          <div className="text-xs">스크림 시작 시간 (HH / 24h)</div>
          <input
            className={fieldStyle}
            value={props.scrimTime}
            onChange={(e) => props.setScrimTime(e.target.value)}
            disabled={!canEditGlobal}
            placeholder="HH (예: 16)"
          />
        </div>
      )}

      <div className="grid gap-3 mt-3">
        <div className="text-xs">{t.modeRange}</div>
        <select className={fieldStyle} value={props.mode} onChange={(e) => props.setMode(Number(e.target.value))} disabled={!canEditGlobal}>
          <option value={MODE.HERO_BAN_ONLY}>{t.mode1}</option>
          <option value={MODE.HERO_BAN_WITH_MAP}>{t.mode2}</option>
          <option value={MODE.FULL}>{t.mode3}</option>
        </select>
      </div>

      <>
        <div className="text-xs mt-3">{t.firstPicker}</div>
        <div className="flex gap-2 mt-1">
          <button
            className={`px-3 py-1 rounded-lg border bp-touch ${props.initialPicker === "AUTO" ? "border-emerald-500 ring-2 ring-emerald-500/60" : "border-neutral-300"}`}
            onClick={() => props.setInitialPicker("AUTO")}
            disabled={!canEditGlobal}
          >
            {t.random}
          </button>
          <button
            className={`px-3 py-1 rounded-lg border bp-touch ${props.initialPicker === "A" ? "border-emerald-500 ring-2 ring-emerald-500/60" : "border-neutral-300"}`}
            onClick={() => props.setInitialPicker("A")}
            disabled={!canEditGlobal}
          >
            A
          </button>
          <button
            className={`px-3 py-1 rounded-lg border bp-touch ${props.initialPicker === "B" ? "border-emerald-500 ring-2 ring-emerald-500/60" : "border-neutral-300"}`}
            onClick={() => props.setInitialPicker("B")}
            disabled={!canEditGlobal}
          >
            B
          </button>
        </div>
      </>

      {props.partMode === "COACH_1V1" && (
        <>
          {!props.roomCode ? (
            /* 방 생성 / 코드 입장 */
            <div className="mt-4 grid gap-3">
              <button
                type="button"
                className={`px-3 py-2 rounded-lg border bp-touch ${dark ? "border-neutral-700" : "border-neutral-300"}`}
                onClick={() => props.onCreateRoom && props.onCreateRoom()}
              >
                방 만들기 (호스트 = A)
              </button>
              <div className="text-xs" style={{ textAlign: "center", opacity: 0.6 }}>또는</div>
              <div className="flex gap-2">
                <input
                  className={fieldStyle}
                  placeholder="방 코드 6자리 입력"
                  value={joinCode}
                  maxLength={6}
                  onChange={(e) => setJoinCode(e.target.value.trim().toLowerCase())}
                />
                <button
                  type="button"
                  className={`px-3 py-2 rounded-lg border bp-touch ${dark ? "border-neutral-700" : "border-neutral-300"}`}
                  onClick={() => joinCode.length === 6 && props.onJoinRoom && props.onJoinRoom(joinCode)}
                  disabled={joinCode.length !== 6}
                >
                  입장 (B)
                </button>
              </div>
            </div>
          ) : (
            /* 방 대기실: 코드 · 상대 연결 · READY */
            <>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <span className="text-xs">방 코드</span>
                <span className="text-lg font-extrabold" style={{ letterSpacing: "3px" }}>{props.roomCode.toUpperCase()}</span>
                <button
                  type="button"
                  className={`px-2 py-1 rounded border ${dark ? "border-neutral-700" : "border-neutral-300"} text-xs`}
                  onClick={() => copyWithToast(props.roomCode!.toUpperCase(), props.onToast, "방 코드 복사됨", "복사 실패 — 코드를 길게 눌러 복사하세요")}
                >
                  복사
                </button>
                <span className="text-xs ml-auto" style={{ color: props.opponentConnected ? "#5bb98b" : "#a1a1aa" }}>
                  {props.opponentConnected ? "● 상대 연결됨" : "○ 상대 대기 중…"}
                </span>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <button
                  type="button"
                  className={`px-3 py-2 rounded-lg border bp-touch ${dark ? "border-neutral-700" : "border-neutral-300"}`}
                  style={props.readyA ? { borderColor: "#4ade80", boxShadow: "0 0 0 1px #4ade8055" } : undefined}
                  onClick={() => canToggleA && props.setReadyA((v) => !v)}
                  disabled={!canToggleA}
                  title={canToggleA ? "" : "A팀 코치만 변경 가능"}
                >
                  A 팀 READY: {props.readyA ? "ON" : "OFF"}
                </button>
                <button
                  type="button"
                  className={`px-3 py-2 rounded-lg border bp-touch ${dark ? "border-neutral-700" : "border-neutral-300"}`}
                  style={props.readyB ? { borderColor: "#4ade80", boxShadow: "0 0 0 1px #4ade8055" } : undefined}
                  onClick={() => canToggleB && props.setReadyB((v) => !v)}
                  disabled={!canToggleB}
                  title={canToggleB ? "" : "B팀 코치만 변경 가능"}
                >
                  B 팀 READY: {props.readyB ? "ON" : "OFF"}
                </button>
              </div>
            </>
          )}
        </>
      )}

      <button
        className={`w-full mt-4 px-4 py-3 rounded-xl border ${
          dark ? "border-neutral-700 bg-neutral-900 hover:bg-neutral-800 text-white" : "border-neutral-300 bg-white hover:bg-neutral-50 text-neutral-900"
        }`}
        onClick={props.onStart}
        disabled={props.partMode === "COACH_1V1" && (!props.roomCode || !(props.readyA && props.readyB))}
        title={props.partMode === "COACH_1V1" && !(props.readyA && props.readyB) ? "양 팀 READY 필요" : ""}
      >
        {t.start}
      </button>
    </div>
  );
}

/* 중앙 픽 그리드 */
type PickCenterProps = {
  lang: Lang;
  t: I18n;
  filterRole: Role;
  teamName: Record<Team, string>;
  bannedIds: string[];
  pickedA: (string | null)[];
  pickedB: (string | null)[];
  onHeroClick: (id: string) => void;
};
const PickCenter = React.memo(function PickCenter({ lang, t, filterRole, teamName, bannedIds, pickedA, pickedB, onHeroClick }: PickCenterProps) {
  return (
    <div className="w-full grid gap-3 bp-grid-pick">
      {HEROES.filter((h) => h.role === filterRole).map((h) => {
        const pickedAFlag = pickedA.includes(h.id);
        const pickedBFlag = pickedB.includes(h.id);
        const banned = bannedIds.includes(h.id);
        const borderClass = banned
          ? "border-neutral-200 opacity-50"
          : pickedAFlag && pickedBFlag
          ? "bp-sel-both"
          : pickedAFlag
          ? "bp-sel-pick"
          : pickedBFlag
          ? "bp-sel-pickb"
          : "border-neutral-300";
        const nameLen = h.name?.length;
        const nameClass = nameLen <= 6 ? "text-[13px]" : nameLen <= 9 ? "text-[12px]" : "text-[11px]";
        return (
          <div key={h.id} onClick={() => onHeroClick(h.id)} className={["rounded-xl border overflow-hidden cursor-pointer flex flex-col", borderClass].join(" ")}>
            <div className="relative w-full aspect-square overflow-hidden">
              <HeroThumb id={h.id} contain={false} />
              {banned && <BanSlashOverlay />}
              <div className="absolute bottom-1 right-1 flex gap-1 z-30">
                {pickedAFlag && <span className="px-2 py-0.5 rounded-full bg-blue-600/80 text-[10px] text-white">{teamName.A}</span>}
                {pickedBFlag && <span className="px-2 py-0.5 rounded-full bg-rose-600/80 text-[10px] text-white">{teamName.B}</span>}
                {banned && <span className="px-2 py-0.5 rounded-full bg-red-600/80 text-[10px] text-white">{t.banned}</span>}
              </div>
            </div>
            <div className={["px-3 py-1 font-medium flex items-center gap-2 overflow-hidden", nameClass].join(" ")}>
              <RoleBadge role={h.role} lang={lang} className="shrink-0" />
              <span className="truncate leading-tight">{getDisplayName(h.name)}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
});