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

## 절대 규칙
- `image` 값과 실제 파일명은 **대/소문자까지** 일치. (자동 검사: `check_image_fields.mjs`)
- 초상화 파일은 삭제/개명하지 말 것(중복 정리는 배포 방식 확정 후 별도 단계).
