// gameData.js — 프론트엔드 영웅/맵 게임 데이터 단일 출처(SSOT) 접근 모듈.
//
// backend/game_data/heroes.json · maps.json(정본)을 @gamedata 별칭으로 임포트해,
// 기존 각 화면 파일이 로컬에 중복 정의하던 상수/헬퍼를 값·동작 동일하게 재구성해 노출한다.
// (백엔드 game_data/__init__.py 의 프론트 대응판. 변수명 유지 → 사용처 최소 수정.)
//
// 정본 원칙:
//   - 표시용 데이터(역할·스킬명·별칭)는 heroes.json 에서 파생한다.
//   - 이미지 리졸버는 STEP 3에서 단일화: getHeroImageSrc(name) = /heroes/{image}.png
//     (getHeroByName → image 필드). STEP 2의 파일별 exactFileNames/ultExactFileNames/
//     overallImgAliases 호환 객체는 제거됐다. 밴픽 썸네일은 getHeroImageCandidates 사용.

import heroesDoc from '@gamedata/heroes.json';
import mapsDoc from '@gamedata/maps.json';

export const HEROES = heroesDoc.heroes;
export const MAPS = mapsDoc.maps;

// ── 이름 조회 ────────────────────────────────────────────────────────────────
// [STEP3B] 정본(logName/ko/en) + aliases 만으로 색인한다. roleForms/koreanHeroMap 은
//   백엔드(KHM/_FIGHTLAB_*) 재현용 필드이며, 프론트 조회에는 불필요함이 검증됐다
//   (aliases 가 전 표기형을 이미 포함 — dump 검증 diff-0). 어떤 표기든 해당 엔트리로 해석.
const _lookup = new Map();
for (const h of HEROES) {
  const forms = [h.logName, h.ko, h.en, ...(h.aliases || [])];
  for (const f of forms) if (f && !_lookup.has(f)) _lookup.set(f, h);
}
// 느슨한 조회: 공백·구두점 제거 + 소문자 + 흔한 오타(솔져→솔저) 정규화 후 색인.
//   1) 정확 일치 → 2) 정규화 일치 → 3) 정규화 접두 일치가 영웅 1명으로 유일할 때만 채택.
//   예: "d.va"/"D.va" → D.Va, "솔저"/"솔져"/"솔저 : 76"/"솔저76" → 솔저: 76.
const _TYPO_MAP = [[/솔져/g, '솔저']];
const _normKey = (s) => {
  let t = String(s || '').normalize('NFC').toLowerCase().replace(/[\s:.\-_'’]/g, '');
  for (const [re, rep] of _TYPO_MAP) t = t.replace(re, rep);
  return t;
};
const _lookupNorm = new Map();
for (const [f, h] of _lookup) { const k = _normKey(f); if (k && !_lookupNorm.has(k)) _lookupNorm.set(k, h); }
export const getHeroByName = (name) => {
  if (!name) return null;
  const raw = String(name).trim();
  const exact = _lookup.get(raw);
  if (exact) return exact;
  const k = _normKey(raw);
  if (!k) return null;
  const byNorm = _lookupNorm.get(k);
  if (byNorm) return byNorm;
  if (k.length < 2) return null;
  const hits = new Set();
  for (const [nk, h] of _lookupNorm) if (nk.startsWith(k)) hits.add(h);
  return hits.size === 1 ? [...hits][0] : null;
};

// ── 역할 ─────────────────────────────────────────────────────────────────────
export const getRole = (name) => {
  const h = getHeroByName(name);
  return h ? h.role : null;
};

// 역할별 표기형 목록(한글/영문 등 roleForms 전체). 기존 파일들의
// TANK_HEROES / SUPPORT_HEROES 리터럴과 집합 동일(사용처는 includes 판정만 함).
export const TANK_HEROES = HEROES.filter((h) => h.role === 'tank').flatMap((h) => h.roleForms || []);
export const SUPPORT_HEROES = HEROES.filter((h) => h.role === 'support').flatMap((h) => h.roleForms || []);

// ── 표시명(단일 함수) ────────────────────────────────────────────────────────
// [i18n] 어떤 표기(로그명/ko/en/별칭)든 한국어 표시명으로 통일한다.
//   규칙: getHeroByName(name)?.displayKo || ?.ko || name(폴백).
//   · displayKo 는 ko 가 영문 그대로인 경우만 지정(D.Va→'디바', D.Mon→'디몬'). 그 외 생략→ko.
//   STEP2/3A 의 HERO_ALIAS_MAP/getDisplayHeroName(별칭맵) 을 대체·제거함.
export const getDisplayName = (name) => {
  if (!name) return '';
  const h = getHeroByName(name);
  if (h) return h.displayKo || h.ko || String(name).trim();
  return String(name).trim();
};

// ── 스킬명 맵(정본 파생) ─────────────────────────────────────────────────────
// heroes.json 의 skills 에서 파생. 키 = 표시명(getDisplayName(logName)) — getSkillName 조회와
// 동일 함수를 써서 키/조회가 함께 이동(반환값 보존). 루시우 Ability 1 = 정본 '분위기 전환'.
export const HERO_SKILL_MAP = {};
for (const h of HEROES) {
  if (!h.skills) continue;
  HERO_SKILL_MAP[getDisplayName(h.logName)] = { ...h.skills };
}

// 정본 스킬명 조회 헬퍼(단축키 접미사 없는 원값). 미지정 시 입력 어빌리티 그대로.
export const getSkillName = (heroName, abilityRaw) => {
  const display = getDisplayName(heroName);
  const m = HERO_SKILL_MAP[display] || HERO_SKILL_MAP[String(heroName ?? '').trim()];
  const key = String(abilityRaw ?? '').trim();
  return (m && m[key]) || key;
};

// ── 이미지 리졸버(STEP 3: SSOT image 필드 기반 단일 리졸버) ───────────────────
// 입력명(logName/ko/en/aliases/roleForms 등) → getHeroByName → image 필드 → /heroes/{image}.png.
// STEP 2의 파일별 exactFileNames/ultExactFileNames/overallImgAliases 호환 객체를 대체·제거함.
// 미지 영웅(heroes.json 밖)은 기존 폴백(별칭 정규화 후 구두점 strip)과 동일하게 처리한다.
export const getHeroImageSrc = (heroName) => {
  if (!heroName || heroName === 'Unknown') return null;
  const h = getHeroByName(heroName);
  if (h) return `/heroes/${h.image}.png`;
  const displayName = getDisplayName(heroName);
  return `/heroes/${displayName.replace(/[\s.:]/g, '')}.png`;
};

// 밴픽 썸네일용 후보 리스트(image 1순위 + 확장자/이름/id 폴백). 첫 존재 후보를 표시한다.
// idx>0(=폴백)이면 image 필드 오류 신호 → 개발 모드 경고(소비처에서 처리).
const IMAGE_EXTS = ['.png', '.webp', '.jpg', '.jpeg'];
export const getHeroImageCandidates = (name, id) => {
  const h = getHeroByName(name);
  const bases = [];
  if (h && h.image) bases.push(h.image); // 1순위: 정본 image
  if (name) bases.push(name);            // 폴백: 표시명
  if (id) bases.push(id);                // 폴백: id
  const list = [];
  for (const b of bases) for (const ext of IMAGE_EXTS) list.push(`/heroes/${encodeURIComponent(b)}${ext}`);
  return [...new Set(list)];
};

// ── 밴픽 그리드 데이터(정본 파생) ────────────────────────────────────────────
// 값(id/name/role·type)과 "표시 순서"를 모두 heroes.json/maps.json 의 banpick 필드에서 파생한다.
// [STEP3B] 표시 순서 = banpick.order(정수). STEP 3A의 하드코딩 순서 목록을 제거하고 order 정렬로 대체.
// 기존 parseCSV 결과와 형태 동일: [{ id, name, role }] / [{ id, name, type }].
export const BANPICK_HEROES = HEROES
  .filter((h) => h.banpick)
  .slice()
  .sort((a, b) => a.banpick.order - b.banpick.order)
  .map((h) => ({ id: h.banpick.id, name: h.banpick.name, role: h.banpick.role }));
export const BANPICK_MAPS = MAPS
  .filter((m) => m.banpick)
  .slice()
  .sort((a, b) => a.banpick.order - b.banpick.order)
  .map((m) => ({ id: m.banpick.id, name: m.banpick.name, type: m.banpick.type }));
