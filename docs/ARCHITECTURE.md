# 백엔드 아키텍처 (리팩토링 2단계 후)

`main.py`(약 2,590줄)를 역할별 모듈로 분리했다. 함수 본문은 이동만 했고 API 응답·파싱 결과는 diff-0.

## 모듈 구조 (backend/)
```
main.py            app 생성 · lifespan · 미들웨어(GZip/CORS) · include_router(banpick→stats→scrims) · 하위호환 re-export
config.py          상수 · 경로 · game_data 파생(KOREAN_HERO_MAP…HERO_ROLE_DATA) · makedirs 1회
schemas.py         요청 Pydantic 모델
serializers.py     DB ORM → dict 직렬화(_db_*_to_dict)
cache.py           응답 캐시(_RESPONSE_CACHE + get/store/invalidate) — 단일 객체
parsers/log_parser.py     parse_overwatch_log · assign_persistent_slots · 맵/팀/시간 헬퍼 · 역할점수
services/fight_analysis.py (기존) compute_fights · format_fights_for_api
services/fight_metrics.py  build_fight_summaries · compute_fight_metrics · _fight_to_record · _fightlab_*
services/stats.py          calculate_pure_stats · compute_player_fight_stats
routers/stats.py           GET scrims · full-events · first-fights · fight-records · player-fight-stats
routers/scrims.py          등록/업로드/삭제/rebuild/상세(scrims·matches) + 파일 I/O 헬퍼
db/ (기존)          database.py(엔진·세션) · models.py(ORM)
```

## 의존 방향 (단방향, 순환 없음)
```
routers → services → parsers → config
routers → serializers → services.fight_analysis
routers → cache · schemas · db
main → routers(include) + 하위호환 re-export.  분리 모듈은 main 을 import 하지 않는다.
```

## 규칙: 신규 코드는 어디에 두는가
- **새 엔드포인트**: 조회/통계면 `routers/stats.py`, 세션·매치 변경(쓰기)이면 `routers/scrims.py` 에 `@router` 로 추가. `main` 수정 불필요(자동 포함).
- **새 분석·계산 함수**: 순수 로직은 `services/`(집계=stats, 한타지표=fight_metrics), 로그 파싱은 `parsers/log_parser.py`.
- **새 상수·게임데이터 파생**: `config.py`. **DB 직렬화**: `serializers.py`. **요청 스키마**: `schemas.py`.
- 라우터/서비스는 필요한 심볼을 해당 모듈에서 **직접 import**(절대 import, `from services.x import y`). `main` 에서 가져오지 않는다.
- 경로 매칭 우선순위상 include 순서(banpick→stats→scrims)를 바꾸지 말 것(`/api/scrims/full-events` vs `/api/scrims/{id}`).
