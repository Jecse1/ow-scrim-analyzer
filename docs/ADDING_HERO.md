# 신규 영웅 추가 절차 (SSOT)

영웅 데이터는 **단일 출처(SSOT)** 인 `backend/game_data/heroes.json` 에서 파생된다.
프론트/백엔드 모두 이 파일을 로드하므로, 신규 영웅은 **heroes.json 1개 엔트리 + 초상화 1장**
으로 전 화면(통계·궁극기·킬데스·개인·비교·매치·밴픽)에 반영된다. (STEP 3 검증 완료)

---

## 1. `backend/game_data/heroes.json` 에 엔트리 추가

`heroes` 배열에 아래 형태로 추가한다. (배열 순서는 무관 — 밴픽 표시 순서는 `banpick.order` 로 제어)

```json
{
  "id": "wuyang",
  "logName": "우양",
  "en": "Wuyang",
  "ko": "우양",
  "role": "support",
  "image": "우양",
  "aliases": ["Wuyang"],
  "skills": { "Ability 1": "격류", "Ability 2": "수호의 파도", "Ultimate": "해일 폭발" },
  "koreanHeroMap": { "우양": "Wuyang" },
  "roleForms": ["우양", "Wuyang"],
  "banpick": { "id": "wuyang", "name": "우양", "role": "Support", "order": 45 }
}
```

### 필드 설명
| 필드 | 설명 | 소비처 |
|---|---|---|
| `id` | 내부 식별자(영문 소문자·하이픈 없음 권장) | 전역 |
| `logName` | **정본 키 = 로그가 기록하는 표기** | 전역 조회 기준 |
| `en` / `ko` | 영문 / 한글 표기 | 조회 |
| `role` | `tank` / `damage` / `support` (소문자) | 역할 판정(getRole, TANK/SUPPORT_HEROES) |
| `image` | **초상화 파일명(확장자 제외). 실제 파일명과 대/소문자까지 일치해야 함** | `getHeroImageSrc → /heroes/{image}.png` |
| `aliases` | 로그·화면에 나올 수 있는 **모든 이형 표기**(영문/특수문자/띄어쓰기 변형 등) | 프론트 `getHeroByName` 조회 |
| `skills` | `{ "Ability 1", "Ability 2", "Ultimate" }` 또는 `null` | 스킬명(getSkillName / getAbilityName) |
| `koreanHeroMap` | `{ 로그한글표기: 영문 }` — 백엔드 파서(hero_image)·KOREAN_HERO_MAP 재현용 | 백엔드 |
| `roleForms` | 역할 목록 재현용 표기 배열(보통 `[한글, 영문]`) | 백엔드 `_FIGHTLAB_*` / 프론트 TANK/SUPPORT_HEROES |
| `banpick` | 밴픽 그리드 항목. `{ id, name(표시명), role(Tank/Damage/Support), order(정수) }` | 밴픽 |
| `banpick.order` | **밴픽 그리드 표시 순서**(정수, 오름차순). 보통 같은 역할 묶음의 마지막 값 + 1 | 밴픽 그리드 정렬 |

> 참고: 프론트 조회(`getHeroByName`)는 `logName/ko/en/aliases` 만 사용한다.
> `koreanHeroMap`/`roleForms` 는 **백엔드 재현용**이지만, 값 누락 시 백엔드 파생(KHM/역할목록)이
> 어긋나므로 **함께 채운다**. (향후 KHM 의존 제거 단계에서 이들 필드가 정리될 수 있다.)

---

## 2. 초상화 추가

`frontend/public/heroes/{image}.png` 를 추가한다.
- **파일명은 `image` 필드와 대/소문자까지 정확히 일치**해야 한다.
  - Windows 개발서버는 대소문자를 무시하지만, **리눅스(nginx) 배포는 대소문자를 구분**하여 404가 난다.
- 확장자는 `.png` 권장(밴픽 썸네일은 `.webp/.jpg/.jpeg` 폴백도 지원하나 1순위는 `{image}.png`).

---

## 3. 서버 반영

- **백엔드**: 재기동하면 `game_data/heroes.json` 을 다시 로드한다.
  - 백엔드 `hero_image` 는 파서가 `KOREAN_HERO_MAP`(=`koreanHeroMap`) 기반으로 DB에 저장하므로,
    로그의 한글 표기가 새로우면 `koreanHeroMap` 에 매핑을 넣어야 파싱 이미지가 맞는다.
- **프론트**: `@gamedata` 별칭으로 JSON 을 임포트한다.
  - 개발: vite HMR/리로드. 배포: `npm run build` 재빌드.

---

## 4. 검증

```bash
# 이미지 필드 ↔ 실제 파일명 대/소문자 일치 검사 (리눅스 404 예방, 상시 검사)
node frontend/scripts/check_image_fields.mjs

# (선택) 실측 스크린샷 — 백엔드+vite 기동 후
node frontend/scripts/screenshot.mjs
```

- `check_image_fields.mjs` 가 `caseMismatch`/`missing` 0 이어야 한다.
- 밴픽 그리드에서 신규 영웅이 `banpick.order` 위치에 나타나고, 개발 모드 콘솔에
  `[banpick] image fallback` 경고가 없어야 한다(=1순위 `{image}.png` 로 표시됨).

---

## 5. 영웅 역할 변경(패치로 role 이 바뀐 기존 영웅)

영웅의 역할은 heroes.json 에 **두 곳**(독립)에 있다.
- 최상위 `role`(소문자 `tank`/`damage`/`support`) — 통계·한타·라인업 집계용(`HERO_ROLE_DATA`/`TANK_HEROES`/`SUPPORT_HEROES` 파생)
- `banpick.role`(대문자 `Tank`/`Damage`/`Support`) — 밴픽·드래프트 플랜용

**`role` 과 `banpick.role` 두 필드를 함께 바꾼다.** 하나만 바꾸면 통계와 밴픽의 역할이 어긋난다.
변경 즉시 **과거 매치도 새 역할로 재분류된다(소급)** — 역할 분류는 날짜 개념 없이 현재 `role` 만 본다.
과거 데이터를 이전 역할로 보존하는 기능은 없다(필요하면 과거 데이터를 버리거나 별도 설계).

- 예) 솜브라: 2026-10-06 패치로 딜러→지원. `role` 을 `"support"`, `banpick.role` 을 `"Support"` 로 바꾸면
  전 기간(과거 포함) 솜브라가 지원으로 집계·표시된다.

---

## 6. 신규 맵 추가 절차(SSOT)

맵 정본은 `backend/game_data/maps.json` 1곳. 프론트/백엔드가 `@gamedata` 별칭으로 **같은 파일**을 공유한다.

### 6-1. `maps.json` 에 엔트리 추가(호위맵 예 — 지브롤터 구조와 동일)
```json
{
  "id": "grimsvotn",
  "ko": "감시 기지: 그림스뵈튼",
  "en": "Watchpoint: Grimsvötn",
  "zh": "Watchpoint: Grimsvötn",
  "type": "escort",
  "typeLabelKo": "화물",
  "modeLabelKo": "호위",
  "aliases": ["그림스뵈튼", "감시기지 그림스뵈튼", "감시기지: 그림스뵈튼", "Watchpoint: Grimsvotn"],
  "controlKeyword": false,
  "mapTypeData": { "감시 기지: 그림스뵈튼": "화물", "그림스뵈튼": "화물", "Watchpoint: Grimsvötn": "Escort" },
  "controlKeywords": [],
  "en2ko": { "Watchpoint: Grimsvötn": "감시 기지: 그림스뵈튼", "Watchpoint: Grimsvotn": "감시 기지: 그림스뵈튼" },
  "banpick": { "id": "grimsvotn", "name": "감시기지 그림스뵈튼", "type": "Escort", "order": 15 }
}
```
| 필드 | 설명 |
|---|---|
| `ko` | **정본 = 로그가 기록하는 한국어 표기**(조회 기준). 로그 실표기 미확인 시 선례 공백 규칙(`감시 기지: XXX`)을 따르고 첫 실로그로 검증 |
| `en` / `zh` | 영/중 표기. 출처 없으면 임시로 en 문자열 기입(보고에 표기) |
| `type` | `control`/`escort`/`hybrid`/`push`/`flashpoint`/`clash` (소문자). drift·아이콘은 **모드 기준 자동** — 추가 설정 불필요 |
| `aliases` | 로그·화면에 나올 수 있는 모든 이형(콜론 유무·공백 변형·ASCII 대체 등) |
| `en2ko` | 로그에 **영어 맵명이 나올 때** 한국어로 치환(`MAP_EN2KO`). 로그가 한국어면 비워도 됨 |
| `banpick` | 밴픽 그리드 항목. `name` 은 **밴픽 헤더 배경 이미지 파일명과 바이트 단위로 일치**해야 함(아래 6-2). `order` 는 보통 같은 모드 묶음의 마지막+1 |

### 6-2. 맵 이미지
- `frontend/public/maps/{banpick.name}.webp` 추가(예: `감시기지 그림스뵈튼.webp`).
- 밴픽 헤더 배경은 `BanpickApp.tsx` 가 `/maps/${banpick.name}.webp` 로 직접 참조하므로 **`banpick.name` 과 파일명(확장자 제외)이 바이트 단위로 동일**해야 한다(콜론/공백 포함).
- 규격: 기존 맵 webp 는 **폭 1000px, WEBP**(호위맵 높이 ~562–563). `check_image_fields.mjs` 는 **맵을 검사하지 않으니** 아래로 수동 확인:
  ```bash
  node -e "const fs=require('fs');const m=JSON.parse(fs.readFileSync('backend/game_data/maps.json','utf8')).maps.find(x=>x.id==='grimsvotn');console.log(fs.existsSync('frontend/public/maps/'+m.banpick.name+'.webp'))"
  ```
- `banpick` 필드가 없는 맵은 밴픽 그리드에 안 뜬다(`gameData.js` 의 `.filter(m=>m.banpick)`).

---

## 미결 TODO

- **독트린(doctrine, order 53)**: `en` 공란·초상화 이미지 없음 상태로 등록됨.
  공식 영문명 확정 시 `en`·`aliases`·`heroEn2koExplicit` 보강, 초상화 확보 시
  `{image}.png` 추가 후 `check_image_fields.mjs` 재검증.

---

## 절대 규칙
- `image` 값과 실제 파일명은 **대/소문자까지** 일치. (자동 검사: `check_image_fields.mjs`)
- 초상화 파일은 삭제/개명하지 말 것(중복 정리는 배포 방식 확정 후 별도 단계).
