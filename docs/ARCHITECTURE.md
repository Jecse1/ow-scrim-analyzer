# 백엔드 아키텍처 (리팩토링 2단계 후)

`main.py`(약 2,590줄)를 역할별 모듈로 분리했다. 함수 본문은 이동만 했고 API 응답·파싱 결과는 diff-0.

## 모듈 구조 (backend/)
```
main.py            app 생성 · lifespan · 미들웨어(GZip/CORS) · include_router(banpick→stats→scrims→summary)
config.py          상수 · 경로 · game_data 파생(KOREAN_HERO_MAP…HERO_ROLE_DATA) · makedirs 1회
analysis_constants.py 분석 정의 상수 정본(한타 창·트레이드/응수 창·최소 표본·기본 기간) — 프론트 utils/analysisConstants.js 와 같은 값 유지
schemas.py         요청 Pydantic 모델
schemas_summary.py 응답 Pydantic 모델(/api/summary/* · /api/sessions/{id}/complete 계약)
schemas_roster.py  응답 Pydantic 모델(POST /api/logs/roster — 등록 전 로그 명단)
serializers.py     DB ORM → dict 직렬화(_db_*_to_dict)
cache.py           응답 캐시(_RESPONSE_CACHE, 키 scrims·full-events·fight-records:*·player-fight-stats:*) · cache_get_or_compute(단일 비행) · 세대 번호(무효화 중 계산 폐기) · 지연 선채우기(register_warmer 순서) · _json_bytes
parsers/log_parser.py     parse_overwatch_log · assign_persistent_slots · 맵/팀/시간 헬퍼 · 역할점수
services/fight_analysis.py (기존) compute_fights · format_fights_for_api
services/fight_metrics.py  build_fight_summaries · compute_fight_metrics · _fight_to_record · _fightlab_*
services/stats.py          calculate_pure_stats · compute_player_fight_stats
services/fight_records.py  _build_fight_records_payload (/api/fight-records 본문 — routers/stats.py 에서 이동, 바이트 동일) · _match_fight_core(매치 단위 한타 core, 증분 저장 대비 경계)
services/summary.py        집계 정의 정본(D1~D8): summarize_maps/opponents/period/ults · summarize_session · format_session_message
services/discord_webhook.py 웹후크 비동기 발송(asyncio.create_task, 예외 전부 내부 처리)
game_data/__init__.py      게임데이터 파생 + canonical_map_name(프론트 gameData.js canonicalMapName 과 동일 규칙)
routers/stats.py           GET scrims · full-events · first-fights · fight-records · player-fight-stats
routers/scrims.py          등록/업로드/삭제/rebuild/상세(scrims·matches) · 등록 전 명단(/api/logs/roster) · 세션 완료 알림(/complete) + 파일 I/O 헬퍼
routers/summary.py         GET /api/summary/{maps,opponents,period,ults} (읽기 전용, /api/fight-records 응답 캐시 재사용 — 같은 키·같은 무효화) — 계약: docs/SUMMARY_API.md
db/ (기존)          database.py(엔진·세션·기동 시 멱등 스키마 보정 _COLUMN_PATCHES — alembic 미사용) · models.py(ORM)
db/stat_rows.py            load_stat_sessions — 통계 캐시 미스 경로(fight-records·full-events·player-fight-stats·summary)용 컬럼 SELECT 로더(ORM 객체 생성 없음, 정렬·값은 ORM 로드와 동일)
scripts/api_snapshot.py    기존 조회 API 응답 바이트·openapi 스냅샷/비교(리팩토링 회귀 증명, DB 사본으로 기동)
```

프론트 등록 흐름(frontend/src, 참고):
```
ScrimModal.jsx             등록 모달 — 1팀명·2팀명 자유 입력 + 로그 선택 시 /api/logs/roster 명단(slot 1 → 1팀명 칸 아래, slot 2 → 2팀명 칸 아래, 로그 라벨 표시)
App.jsx handleScrimSubmit  manual-register → upload N회 → 전부 성공 시 /api/sessions/{id}/complete 1회
```

## 의존 방향 (단방향, 순환 없음)
```
routers → services → parsers → config
routers → serializers → services.fight_analysis
routers → cache · schemas · schemas_summary · db
services(stats·fight_records) → serializers._db_event_to_dict   (기존 services/stats.py 선례)
main → routers(include).  분리 모듈은 main 을 import 하지 않는다(하위호환 re-export 는 2026-10-16 삭제).
```

## 규칙: 신규 코드는 어디에 두는가
- **새 엔드포인트**: 조회/통계면 `routers/stats.py` 또는 주제별 라우터(`routers/summary.py` 등 — 새 라우터 파일이면 `main.py` 에 include 1줄 추가), 세션·매치 변경(쓰기)·세션 단위 동작이면 `routers/scrims.py` 에 `@router` 로 추가.
- **새 분석·계산 함수**: 순수 로직은 `services/`(집계=stats, 한타지표=fight_metrics), 로그 파싱은 `parsers/log_parser.py`.
- **새 상수·게임데이터 파생**: `config.py`. **분석 정의 상수(창·표본·기간)**: `analysis_constants.py` + 프론트 `utils/analysisConstants.js` 양쪽에 같은 값. **DB 직렬화**: `serializers.py`. **요청 스키마**: `schemas.py`. **응답 스키마(외부 계약)**: `schemas_summary.py`(집계·완료), `schemas_roster.py`(등록 전 명단).
- 라우터/서비스는 필요한 심볼을 해당 모듈에서 **직접 import**(절대 import, `from services.x import y`). `main` 에서 가져오지 않는다.
- 경로 매칭 우선순위상 include 순서(banpick→stats→scrims)를 바꾸지 말 것(`/api/scrims/full-events` vs `/api/scrims/{id}`).

## 유지 결정 (2026-10-16)
쓰이지 않는 것은 지웠고(alembic·Docker·main.py re-export), 아래는 "바꾸지 않기로" 한 것과 그 이유다.
근거가 약한 항목은 그대로 "이유 없음"으로 적는다. 분석 정의의 결정은 [DECISIONS.md](DECISIONS.md).

- **SQLAlchemy async(aiosqlite)**: 관례로 도입했고 현 부하(동시 사용자 소수, SQLite 단일 파일)에서 이득은 없다.
  동기 전환은 db·routers·services 전 계층 수정이라 비용으로 유지. 더 나은 방법이 확인되면 교체.
  CPU 작업 중 명단 추출·업로드 파싱/계산(DB 쓰기 전)·summary 집계·fight-records/player-fight-stats/full-events 의
  변환·직렬화는 `run_in_threadpool` 로 루프 밖에서 돈다(DB 로드는 AsyncSession 이라 루프에 남김). rebuild-db 는 아직 루프에서 실행.
  한계: GIL 때문에 한 번에 오래 걸리는 C 호출(큰 `json.loads`/`json.dumps`)은 스레드에서도 그 시간만큼 루프를 멈춘다.
- **pm2**: Python 프로세스 관리로는 비표준(systemd 가 표준)이지만 운영 중인 3서버의 절차를 하나로 통일하기 위해 유지([DEPLOY.md](DEPLOY.md)).
- **인라인 스타일 + theme 객체**(Tailwind 미도입): 전환 비용 대비 이득 없음. 색은 `ThemeContext` 토큰만 사용.
- **Recharts**: 기존 5화면(MatchStats·OverallStats·PlayerCompareView·PlayerProfileView·UltimateStats)에서만 사용. 신규 차트 금지(숫자 표 원칙, DECISIONS.md).
- **scrim.db**: 공개판 저장소는 `.gitignore` 로 DB 를 추적하지 않는다(팀 데이터 유출 방지). 운영 포크(비공개)는 서버 DB 를 git 으로 추적한다 —
  동기화가 단순하고 이력 복구 가치가 있어서. 충돌 위험은 "서버에서 먼저 커밋 후 pull" 절차로 관리.
- **i18n 객체 방식**: 라이브러리 미도입. `src/i18n/{ko,en,zh}.js` 분리 + `scripts/check_i18n_keys.mjs` 키 검사로 충분.
- **프론트 테스트 러너 vitest**(2026-10-16 도입): 밴픽 SOLO 규칙 해석 `rulesLocal.ts` 순수 함수 검증용. CI 에서 `npm test` 로 실행.
