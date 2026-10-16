# 밴픽 규칙 프리셋 (BANPICK_RULESET)

밴픽 실시간 대결(1v1)의 규칙은 `backend/banpick/ruleset.json` 으로 바꾼다. 파일이 없으면 `default`(공개판 현행 규칙)가 적용된다.
공개판 저장소에는 이 파일을 두지 않는다 — 대회·팀별 값은 각 인스턴스 저장소에만 둔다(FLC `map_pool.json` 과 같은 델타 방식).

- 정본: `backend/banpick/ruleset.py` (`DEFAULT`, `validate`, `load_ruleset`). 파일이 잘못되면 기동이 실패한다(조용히 default 로 가지 않음).
- 서버 권위: 상태기계(`state.py`)만 규칙을 판정한다. 프론트는 서버 state 의 `ruleset`·`banSeq`·`roleBanCount`·`repeatBlocked`·`mapChoices`·`setMode`·`mapAutoAssigned` 로 표시·비활성만 한다. 로컬(solo)·스크림 모드는 서버가 없어 항상 default 로 동작한다.
- 픽 규칙(5슬롯·동시·미러 허용)은 프리셋과 무관하게 불변이다.
- `map_pool.json`(인스턴스 맵풀 제한)과 공존한다. fixed 맵풀에서는 `modes` 의 맵만 후보가 되므로 두 파일을 함께 쓰면 교집합이다.

## 스키마

```json
{
  "name": "default",
  "bansPerSet": 2,
  "banOrder": ["first", "second"],
  "roleCapPerSet": 1,
  "banRepeat": { "scope": "allSets", "perTeam": true },
  "setStart": { "loserChooses": ["map", "banOrder"], "firstSet": "config" },
  "mapPool": { "mode": "free", "noRepeatModeWithin": 5 }
}
```

| 키 | 값 | 뜻 |
|---|---|---|
| `bansPerSet` | 정수 ≥ 0 | 세트당 총 밴 수 |
| `banOrder` | `"first"`/`"second"` 배열, 길이 = bansPerSet | 밴 턴 순서. `first` = 선밴 팀(맵/순서 선택 결과로 정해짐), `second` = 상대 |
| `roleCapPerSet` | 정수 ≥ 1 | 역할군별 밴 상한(세트 내, 양 팀 합산). 1 = 현행 "먼저 밴한 팀이 역할 선점"과 동치 |
| `banRepeat.scope` | `none` / `previousSet` / `allSets` | 재밴 금지 범위: 없음 / 직전 세트 / 과거 전 세트 |
| `banRepeat.perTeam` | bool | true = 자기 팀이 밴한 영웅만 금지, false = 양 팀 밴 모두 금지 |
| `setStart.loserChooses` | `["map","banOrder"]` 또는 `["banOrder"]` | 직전 세트 패자가 고르는 것. `map` 이 없으면 맵은 풀에서 자동(fixed 전용) |
| `setStart.firstSet` | `config` / `host` | 1세트 선택권: `config` = 설정 패널의 1세트 선택권(랜덤/A/B) 그대로, `host` = 방장 지정(랜덤이면 A) |
| `mapPool.mode` | `free` / `fixed` | free = 전체 맵, 같은 모드는 `noRepeatModeWithin` 세트 안에서 반복 금지(현행). fixed = 아래 모드별 맵 + 순서 고정 |
| `mapPool.modes` | `{모드: [map_id, ...]}` | fixed 전용. 모드 라벨은 쟁탈/화물/혼합/밀기/플래시포인트/격돌, map_id 는 `maps.json` 의 `banpick.id` |
| `mapPool.sequence` | `{bo3:[…], bo5:[…], bo7:[…]}` | fixed 전용. 세트별 모드 순서(길이 3/5/7). 한 모드가 그 모드의 맵 수보다 자주 나오면 검증 실패 |
| `mapPool.reuse` | `remaining-auto` | fixed 전용. 같은 모드가 다시 나오면 안 쓴 맵을 자동 배정(패자는 선/후밴만 선택) |

### default 와 현행 규칙의 대응
- 팀당 1밴·총 2 = `bansPerSet 2`, `["first","second"]`.
- 역할 선점(roleLock) = `roleCapPerSet 1`. `state["roleLock"]` 은 표시용으로 유지되지만 판정은 `roleBanCount` 로 한다(동치 테스트 `test_default_role_cap_equals_legacy_role_lock`).
- 과거 전 세트에 자기 팀이 밴한 영웅 재밴 금지 = `allSets` + `perTeam true`.
- 직전 패자가 맵과 선/후밴을 고름 = `loserChooses ["map","banOrder"]`(현행 `map_pick` 액션이 둘을 함께 받는다).
- 자유 맵풀 + 같은 모드 5세트 사이클 금지 = `free` + `noRepeatModeWithin 5`.

## 예시: 세트당 밴 4개·역할 상한 2·직전 세트 자기 팀 재밴 금지·고정 맵풀

공개판 테스트(`backend/banpick/test_ruleset.py` 의 `SYNTH`)가 이 값으로 규칙을 검증한다. 운영 인스턴스에서는 같은 내용을
`backend/banpick/ruleset.json` 으로 둔다.

```json
{
  "name": "synthetic-4ban",
  "bansPerSet": 4,
  "banOrder": ["first", "second", "second", "first"],
  "roleCapPerSet": 2,
  "banRepeat": { "scope": "previousSet", "perTeam": true },
  "setStart": { "loserChooses": ["map", "banOrder"], "firstSet": "host" },
  "mapPool": {
    "mode": "fixed",
    "modes": {
      "쟁탈": ["busan", "samoa"],
      "혼합": ["neoncross", "paraiso"],
      "밀기": ["lunasafi", "colosseo"],
      "화물": ["rialto", "grimsvotn"],
      "플래시포인트": ["suravasa", "atliss"]
    },
    "sequence": {
      "bo3": ["쟁탈", "혼합", "플래시포인트"],
      "bo5": ["쟁탈", "혼합", "플래시포인트", "화물", "밀기"],
      "bo7": ["쟁탈", "혼합", "플래시포인트", "화물", "밀기", "혼합", "쟁탈"]
    },
    "reuse": "remaining-auto"
  }
}
```

동작: 1세트는 방장이 1세트 선택권(A/B)을 지정(랜덤이면 A). 선택권 팀이 이번 세트 모드의 2맵 중 하나와 선/후밴을 고른다 →
선밴 팀 1개 → 후밴 팀 2개 → 선밴 팀 1개. 같은 역할군은 양 팀 합쳐 2개까지. 직전 세트에 자기 팀이 밴한 영웅은 이번 세트에
자기 팀이 밴할 수 없다(상대가 밴했던 영웅·두 세트 전 영웅은 가능). 이후 세트는 직전 패자가 고른다. BO7 의 6·7세트처럼
같은 모드가 다시 나오면 안 쓴 맵이 자동 배정되고 패자는 선/후밴만 고른다.

## 프론트에 내려가는 필드(서버 state)

| 필드 | 뜻 |
|---|---|
| `ruleset` | 적용 중인 프리셋 전체(위 스키마 + name) |
| `banSeq` / `banIdx` | 이번 세트 밴 턴 팀 배열(예 `["A","B","B","A"]`)과 현재 인덱스 |
| `roleBanCount` | 역할별 밴 수(양 팀 합산) — `roleCapPerSet` 과 비교해 역할 칩·영웅을 비활성 |
| `repeatBlocked` | 팀별 재밴 금지 영웅 id 목록 |
| `mapChoices` / `setMode` | fixed 맵풀일 때 이번 세트 후보 맵·모드 라벨(free 면 null) |
| `mapAutoAssigned` | 맵이 자동 배정되어 선/후밴만 고르는 세트인지 |
