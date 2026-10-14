# 백엔드 아키텍처 (리팩토링 2단계 후)

`main.py`(약 2,590줄)를 역할별 모듈로 분리했다. 함수 본문은 이동만 했고 API 응답·파싱 결과는 diff-0.

## 모듈 구조 (backend/)
```
main.py            app 생성 · lifespan · 미들웨어(GZip/CORS) · include_router(banpick→stats→scrims→summary) · 하위호환 re-export
config.py          상수 · 경로 · game_data 파생(KOREAN_HERO_MAP…HERO_ROLE_DATA) · makedirs 1회
schemas.py         요청 Pydantic 모델
schemas_summary.py 응답 Pydantic 모델(/api/summary/* · /api/sessions/{id}/complete 계약)
serializers.py     DB ORM → dict 직렬화(_db_*_to_dict)
cache.py           응답 캐시(_RESPONSE_CACHE + get/store/invalidate) — 단일 객체
parsers/log_parser.py     parse_overwatch_log · assign_persistent_slots · 맵/팀/시간 헬퍼 · 역할점수
services/fight_analysis.py (기존) compute_fights · format_fights_for_api
services/fight_metrics.py  build_fight_summaries · compute_fight_metrics · _fight_to_record · _fightlab_*
services/stats.py          calculate_pure_stats · compute_player_fight_stats
services/fight_records.py  _build_fight_records_payload (/api/fight-records 본문 — routers/stats.py 에서 이동, 바이트 동일)
services/summary.py        집계 정의 정본(D1~D8): summarize_maps/opponents/period/ults · summarize_session · format_session_message
services/discord_webhook.py 웹후크 비동기 발송(asyncio.create_task, 예외 전부 내부 처리)
game_data/__init__.py      게임데이터 파생 + canonical_map_name(프론트 gameData.js canonicalMapName 과 동일 규칙)
routers/stats.py           GET scrims · full-events · first-fights · fight-records · player-fight-stats
routers/scrims.py          등록/업로드/삭제/rebuild/상세(scrims·matches) · 세션 완료 알림(/complete) + 파일 I/O 헬퍼
routers/summary.py         GET /api/summary/{maps,opponents,period,ults} (읽기 전용, 캐시 없음) — 계약: docs/SUMMARY_API.md
db/ (기존)          database.py(엔진·세션) · models.py(ORM)
scripts/api_snapshot.py    기존 조회 API 응답 바이트·openapi 스냅샷/비교(리팩토링 회귀 증명, DB 사본으로 기동)
```

## 의존 방향 (단방향, 순환 없음)
```
routers → services → parsers → config
routers → serializers → services.fight_analysis
routers → cache · schemas · schemas_summary · db
services(stats·fight_records) → serializers._db_event_to_dict   (기존 services/stats.py 선례)
main → routers(include) + 하위호환 re-export.  분리 모듈은 main 을 import 하지 않는다.
```

## 규칙: 신규 코드는 어디에 두는가
- **새 엔드포인트**: 조회/통계면 `routers/stats.py` 또는 주제별 라우터(`routers/summary.py` 등 — 새 라우터 파일이면 `main.py` 에 include 1줄 추가), 세션·매치 변경(쓰기)·세션 단위 동작이면 `routers/scrims.py` 에 `@router` 로 추가.
- **새 분석·계산 함수**: 순수 로직은 `services/`(집계=stats, 한타지표=fight_metrics), 로그 파싱은 `parsers/log_parser.py`.
- **새 상수·게임데이터 파생**: `config.py`. **DB 직렬화**: `serializers.py`. **요청 스키마**: `schemas.py`. **응답 스키마(외부 계약)**: `schemas_summary.py`.
- 라우터/서비스는 필요한 심볼을 해당 모듈에서 **직접 import**(절대 import, `from services.x import y`). `main` 에서 가져오지 않는다.
- 경로 매칭 우선순위상 include 순서(banpick→stats→scrims)를 바꾸지 말 것(`/api/scrims/full-events` vs `/api/scrims/{id}`).
