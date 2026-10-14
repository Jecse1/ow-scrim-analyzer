# 집계 API · 세션 완료 알림 계약 (definitions_version 1)

디스코드 봇 등 외부 조회자가 쓰는 서버 집계 API의 계약 문서다. 봇은 이 응답을 표로 바꾸기만 하고
수치를 다시 계산하지 않는다. 집계 정의의 정본은 `backend/services/summary.py`(D1~D8),
응답 모델은 `backend/schemas_summary.py`, 회귀 고정값은 `backend/tests/golden/summary_sample.json`이다.

- 모든 엔드포인트는 백엔드(기본 `http://127.0.0.1:8000`)에 있다. 인증은 없다(내부망·nginx 뒤 전제).
- **핵심 필드**는 봇 표가 의존해도 되는 필드다. **참고 필드**는 표본 병기·각주·디버깅용이고,
  같은 definitions_version 안에서는 유지되지만 표의 필수 열로 쓰지 않는 것을 권장한다.
- 정의를 바꾸면 `definitions_version`을 올리고 골든을 `--update-golden`으로 갱신한다.

## 공통

### 기간 (D4)
| 파라미터 | 형식 | 기본값 |
|---|---|---|
| `from` | `YYYY-MM-DD`(포함) | `to` − 13일 (14일 창 — 프론트 '최근 2주' 프리셋과 같은 값) |
| `to` | `YYYY-MM-DD`(포함) | 오늘(Asia/Seoul) |

- 비교는 세션 날짜(`session_date`/`date`, `YYYY-MM-DD`) 문자열 비교다(프론트와 동일).
- 형식이 틀리면(`2026-1-01`, `2026-W40-1`, 존재하지 않는 날짜) 또는 `from > to`면 **422**.
- `base_team`(문자열, 기본 = 백엔드 환경변수 `BASE_TEAM`)이 "우리 팀"이다. 팀명은 정확히 일치해야 한다.

### meta (모든 `/api/summary/*` 응답)
| 필드 | 설명 |
|---|---|
| `base_team` | 집계 기준 팀 |
| `from`, `to` | 실제 적용된 기간(기본값이 채워진 결과) |
| `generated_at` | 생성 시각(Asia/Seoul, ISO 8601, 초 단위) |
| `definitions_version` | `"1"` |
| `population` | 모집단. 아래 표 참조 — 봇 각주용 |

### population
| 값 | 모집단 | 대응 웹 화면 | 엔드포인트 |
|---|---|---|---|
| `fight_matches_plus_manual` | 한타가 1개 이상인 로그 매치 + 수기(로그 없는) 매치 | 맵 분석 탭 | maps, opponents |
| `all_matches` | base_team이 참가한 모든 매치 | 세션 목록(달력) | period, /complete |
| `log_fights` | 로그 매치의 한타 레코드(수기 매치는 한타가 없음) | 궁극기 분석 탭 | ults |

같은 기간이라도 period와 maps의 매치 수가 다를 수 있다. 한타 0개 로그 매치는 period에만 들어간다.

### 승률 표기 규칙
- 승률은 0~1 실수다. 분모가 0이면 `null`이다. **반올림하지 않는다**(표시 단계에서 처리).
- 승률에는 항상 분자·분모 필드가 같이 있다. 표에는 표본을 함께 적는다(예: `50% (6/12)`).

## 정의 (D1~D8)
| 정의 | 내용 |
|---|---|
| D1 매치 결과 | 유효 승자 = `winner_override`(수기 보정) 우선, 없으면 원본 `winner`. 기준 팀이면 win, `"Draw"`면 draw, 다른 팀명이면 loss. 맵 승률 = wins / (wins + losses + draws). 무승부는 분모에 포함한다. |
| D2 첫 한타 | 밀기·플래시포인트는 매치당 1개, 그 외(쟁탈·화물·혼합·격돌·Unknown)는 라운드마다 1개. (매치, 라운드)별로 가장 먼저 시작한 한타. 첫 한타 승률 분모는 승자 판정 가능(us/them)한 것만이다. |
| D3 상대 | 매치의 두 팀명 중 base_team이 아닌 쪽. 세션명은 파싱하지 않는다. |
| D4 기간 | 위 "기간" 참조 |
| D5 궁극기 | 선궁 = 한타에서 처음 궁을 쓴 쪽(서버 `first_ult_side` 그대로). 카운터 = 상대 궁 H 최초 사용 **이후(동시 제외)** `response_window`초 이내의 우리 궁. 한타당 같은 영웅은 1회(가장 빠른 것)만 센다. |
| D6 한타 0개 로그 매치 | 맵 승률·첫 한타에서 제외하고 `excluded.no_fight_matches`로 센다. |
| D7 결과 없음 | 승자가 빈 매치는 승·패·무 집계에서 제외하고 `excluded.null_result_matches`로 센다. 무승부로 바꾸지 않는다. 그 매치의 **한타는 첫 한타·궁 집계에 그대로 포함**한다(한타 승패는 매치 승패와 독립 판정). |
| D8 맵 키 | 정본 한글 맵명(`maps.json`의 `ko`). 영문·별칭·띄어쓰기 변형은 같은 맵으로 합친다. 해석이 안 되는 맵명은 원문 그대로 별도 행이 된다. |

### excluded 우선순위
분류는 상호 배타다. 우선순위는 **`no_fight_matches` → `null_result_matches`**이다.
승자가 비고 한타도 0개인 로그 매치(예: 로그 미업로드)는 `no_fight_matches`로만 센다.
`manual_matches_in_first_fight`는 기간·상대 범위 안의 수기 매치 수다. 첫 한타 집계에서 빠지지만
승패에는 포함된다. 수기 매치의 승자가 비어 있으면 D7에 따라 승패에서도 빠진다.

---

## GET /api/summary/maps
맵별 승률 + 첫 한타 승률. population `fight_matches_plus_manual`.

| 파라미터 | 타입 | 기본 | 설명 |
|---|---|---|---|
| `from`, `to`, `base_team` | | 공통 | |
| `opponent` | string | 없음(전체) | 상대 팀명 정확 일치 필터 |

응답: `{meta, maps[], total, excluded}`. `maps[]`는 매치 수 내림차순, 같으면 맵명 순이다.
`total`은 같은 구조이고 `map:"__total__"`, `map_type:null`이다.

| 필드 (maps[] · total) | 구분 | 설명 |
|---|---|---|
| `map` | 핵심 | 정본 한글 맵명(D8) |
| `matches` | 핵심 | 맵 승률 분모 = wins + losses + draws |
| `wins`, `losses`, `draws` | 핵심 | D1 |
| `map_winrate` | 핵심 | wins / matches |
| `first_fights` | 핵심 | 첫 한타 승률 분모(판정 가능) |
| `first_fight_wins` | 핵심 | |
| `first_fight_winrate` | 핵심 | |
| `map_type` | 참고 | 한글 모드 라벨(쟁탈/화물/혼합/밀기/플래시포인트/격돌/Unknown) |
| `first_fights_unknown` | 참고 | 승자 판정 불가 첫 한타 수 |
| `fights` | 참고 | 한타 레코드 수(판정 불가 포함) |

`excluded`: `no_fight_matches`, `null_result_matches`, `manual_matches_in_first_fight` (전부 참고).

## GET /api/summary/opponents
상대별 전적. population `fight_matches_plus_manual`. 파라미터: `from`, `to`, `base_team`.

응답: `{meta, opponents[], total, excluded}`. 매치 수 내림차순이다. `total.opponent = "__total__"`.

| 필드 | 구분 | 설명 |
|---|---|---|
| `opponent` | 핵심 | D3 |
| `matches`, `wins`, `losses`, `draws`, `map_winrate` | 핵심 | maps와 같은 정의 |
| `first_fights`, `first_fight_wins`, `first_fight_winrate` | 핵심 | |
| `sessions` | 참고 | 승패 집계 대상 매치가 속한 세션 수 |
| `first_fights_unknown` | 참고 | |

## GET /api/summary/period
기간 내 세션별 요약. population `all_matches`. 파라미터: `from`, `to`, `base_team`.

응답: `{meta, sessions[], total, excluded}`. 세션 순서는 날짜 내림차순(최신 먼저)이다. 매치 순서는 등록 순서다.

| 필드 (sessions[]) | 구분 | 설명 |
|---|---|---|
| `session_id`, `date`, `scrim_name` | 핵심 | |
| `opponents` | 핵심 | D3, 등장 순서 |
| `matches` | 핵심 | base_team 참가 매치 수(결과 없음 포함) |
| `wins`, `losses`, `draws` | 핵심 | D1 |
| `maps` | 핵심 | 정본 맵명 목록(매치 순서) |
| `no_result` | 참고 | 승자 빈 매치 수(D7) — matches = W + L + D + no_result |

| 필드 (total) | 구분 | 설명 |
|---|---|---|
| `sessions`, `matches`, `wins`, `losses`, `draws` | 핵심 | |
| `map_winrate` | 핵심 | wins / decided_matches |
| `decided_matches` | 핵심 | 승률 분모 = W + L + D |
| `no_result` | 참고 | |
| `skipped_matches_without_base_team` | 참고 | base_team이 참가하지 않아 건너뛴 매치 수 |

`excluded.sessions_without_base_team`(참고): 기간 안에 있지만 base_team 참가 매치가 0인 세션 수(행에서 제외).

## GET /api/summary/ults
선궁·후궁·카운터. population `log_fights`.

| 파라미터 | 타입 | 기본 | 범위 |
|---|---|---|---|
| `from`, `to`, `base_team` | | 공통 | |
| `opponent` | string | 없음 | 상대 팀명 정확 일치 |
| `response_window` | number(초) | 3 | 1 ≤ x ≤ 30 (프론트 응수 창과 같은 기본·범위) |
| `min_sample` | int | 5 | ≥ 1 — 카운터 행 최소 표본 |
| `limit` | int | 10 | 1 ~ 100 — 카운터 최대 행 수(봇 표 15행 제한 고려) |

응답: `{meta, first_ult, counters[], counters_total, fights, fights_known, params}`.

`first_ult.us` / `.them` / `.none` (선궁 = 우리 / 상대 / 궁 없음):
| 필드 | 구분 | 설명 |
|---|---|---|
| `n` | 핵심 | 승률 분모(판정 가능 한타) |
| `wins`, `winrate` | 핵심 | 우리 기준 |
| `fights` | 참고 | 판정 불가 포함 전체 한타 수 |

`counters[]`는 n ≥ min_sample인 (상대 궁, 우리 응수 궁) 쌍이다. 정렬은 승률 내림차순 → 표본 내림차순 → 영웅명이고, 상위 `limit`행만 준다.
| 필드 | 구분 | 설명 |
|---|---|---|
| `enemy_hero`, `our_hero` | 핵심 | 영웅명(로그 표기 — 대부분 한글, 예외 `D.Va`) |
| `n`, `wins`, `winrate` | 핵심 | 그 응수가 나온 한타의 우리 승률 |
| `no_response_n`, `no_response_winrate` | 핵심 | 같은 상대 궁에 창 안에서 우리 궁이 없던 한타 |
| `avg_react_sec` | 참고 | 평균 응수 시간(초) |
| `enemy_hero_n`, `enemy_hero_wins`, `enemy_hero_winrate` | 참고 | 그 상대 궁이 나온 한타 전체 |
| `no_response_wins` | 참고 | |

`counters_total`(참고): limit 적용 전 행 수. `fights` / `fights_known`(참고): 범위 내 한타 수 / 판정 가능 한타 수.
`params`(참고): 실제 적용된 `response_window`, `min_sample`, `limit`.

---

## POST /api/sessions/{session_id}/complete
세션 등록 완료 신호. 웹 프론트가 등록 루프(manual-register 1회 + 로그 upload N회)가 **모두 성공했을 때만** 끝에 1회 호출한다
(upload 하나라도 실패하면 호출하지 않음). 완료 alert에 `webhook` 값을 "디스코드 알림: 전송 요청됨/미설정"으로, 호출 자체 실패는 "실패"로 표기한다.
디스코드 봇의 알림 재전송 명령도 이 엔드포인트를 호출한다(예정).

- **읽기 전용·멱등**: DB와 meta.json을 바꾸지 않는다. 같은 세션이면 항상 같은 응답이다.
- 없는 세션·삭제된 세션은 **404**다.
- 기준 팀은 백엔드 환경변수 `BASE_TEAM`이다(쿼리로 바꿀 수 없음). 승패는 D1, 상대는 D3이고 모집단은 `all_matches`다.

응답:
| 필드 | 구분 | 설명 |
|---|---|---|
| `status` | 핵심 | 항상 `"ok"` |
| `session.id`, `.date`, `.scrim_name` | 핵심 | |
| `session.opponents` | 핵심 | |
| `session.matches`, `.wins`, `.losses`, `.draws` | 핵심 | period의 세션 행과 같은 계산 |
| `session.maps` | 핵심 | 정본 맵명(매치 순서) |
| `session.no_result` | 참고 | |
| `webhook` | 핵심 | `"queued"`(발송 작업 분리됨 — 성공 보장 아님) / `"disabled"`(`DISCORD_WEBHOOK_URL` 미설정, no-op) |

### 웹후크 (백엔드 env `DISCORD_WEBHOOK_URL`, 선택)
- 설정돼 있으면 `asyncio.create_task`로 발송을 분리하고 응답은 기다리지 않는다. 디스코드 웹후크에
  `{"content": ...}`를 POST한다(타임아웃 5초).
- 본문은 2,000자 이내의 고정폭 코드 블록 1개다(폭 보정 없음):
  ```
  2026-10-08 vs 팀C (261008-팀C) [id:2610082022]
  리장 타워 / 승 / 2:0
  부산 / 미정 / 0:0
  합계 2-1-2 (미정 2)
  ```
  - 1줄: 날짜 · 상대 · (세션명) · `[id:세션ID]`(반복 호출로 같은 세션 알림이 중복될 때 채널에서 식별용)
  - 매치마다 `맵 / 승·패·무·미정 / 우리:상대 점수`
  - 끝줄: `합계 승-패-무` (미정이 있으면 괄호로 덧붙임)
  - 2,000자를 넘으면 뒤쪽 매치 줄부터 잘라내고 `…외 N매치`를 붙인다.
- 반복 호출하면 매번 다시 발송한다(무상태 — 중복 억제 없음).
- 실패(연결·타임아웃·4xx·5xx·본문 생성 오류)는 발송 작업 안에서 전부 잡는다. `/complete` 응답에는 영향이 없다.
  로그에는 `[WEBHOOK] discord webhook failed: HTTP <코드>` 또는 `…: <예외 클래스명>` 한 줄만 남는다.
  **URL·요청 본문·응답 본문은 기록하지 않는다.** 기동 로그에는 `[WEBHOOK] DISCORD_WEBHOOK_URL: 설정됨/미설정`만 남는다.
- `DISCORD_WEBHOOK_URL`은 **백엔드 프로세스**의 env다(pm2 ecosystem `env`). 디스코드 봇 프로세스의 env가 아니다.
  설정 방법은 [DEPLOY.md](DEPLOY.md) 참조.

---

## POST /api/logs/roster
등록 **전** 로그 1개의 팀별 선수·영웅 명단. 웹 등록 모달이 로그 파일을 고르는 즉시 호출해 1팀명·2팀명 칸 아래에
각 자리의 명단을 보여 준다(팀명 역입력 방지 — 입력한 이름과 로그 라벨을 대조). **DB·파일 쓰기 없음**, 세션·매치가 없어도 호출할 수 있다.

요청: `multipart/form-data`, 필드 `file`(로그 `.txt` 1개 — `/api/matches/upload`와 같은 필드명·디코드: UTF-8, 실패 시 cp949).

응답 200:
| 필드 | 설명 |
|---|---|
| `teams[]` | 항상 2개, `slot` 1 → 2 순 |
| `teams[].slot` | `1` = 로그 **첫 `match_start`의 첫 팀** = 등록 시 `team1_name` 자리, `2` = `team2_name` 자리. 파서는 팀명을 위치로만 대응하므로(첫 팀 → team1_name) 프론트는 1팀명 입력값을 slot 1 자리(`team1Name`), 2팀명을 slot 2 자리(`team2Name`)로 manual-register를 호출한다(이 API는 `BASE_TEAM`과 무관) |
| `teams[].label` | 로그 원시 팀 라벨(예: `1팀`/`2팀`, `Team 1`/`Team 2`). `match_start`가 없으면 `1팀`/`2팀` |
| `teams[].players[]` | `{name, heroes[]}` — `name`은 `players.json` 별칭 적용 후 정본명, 순서는 파서 `slot_index`(탱→딜→힐). `heroes`는 경기 누적 플레이 시간이 0보다 큰 영웅만, 시간 내림차순 → 영웅명 순. 라운드 준비 시간(게임 시계 정지)에 거쳐 간 영웅은 `player_stat`에 0초로 나오므로 제외되고, 그런 영웅뿐인 선수는 명단에 남되 `heroes`가 빈 배열 |
| `warnings[]` | `{code, line, event, message}` — `precheck_log_text` 경고(업로드 응답과 같은 형식, 최대 50건). 두 slot 외 팀 라벨이 `player_stat`에 있으면 `roster_extra_team` 추가(그 팀은 명단에서 제외) |
| `warning_count` | 전체 경고 수(50건 초과분 포함) |

422: 선수 기록(`player_stat`)이 하나도 없음(빈 파일·로그 아님) 또는 파싱 예외. `detail`은 고정 문구(+예외 클래스명)이고 파일 내용을 담지 않는다.

구현 메모: 파서 시그니처를 바꾸지 않으려고 `custom_t1/custom_t2`에 임시 팀명(`"__roster,team1__"` 등 — 쉼표가 있어 로그 필드와 충돌 불가)을
넘기고 응답 `label`은 원시 라벨로 되돌린다. `routers/scrims.py`의 `_first_match_start_labels`는 `parsers/log_parser.py`의
첫 `match_start` 라벨 규칙을 복제한 것이다 — **파서의 그 규칙을 바꾸면 함께 갱신**한다.
