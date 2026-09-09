from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from contextlib import asynccontextmanager
import os
import sys
import uvicorn

# Ensure backend/ is on sys.path so the `db` package resolves regardless of cwd
_BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
if _BACKEND_DIR not in sys.path:
    sys.path.insert(0, _BACKEND_DIR)

_DB_IMPORT_ERROR = None
try:
    from sqlalchemy import select
    from db.database import init_db, AsyncSessionLocal
    from db.models import Session as DBSession, Match as DBMatch, Pause as DBPause, Round as DBRound, PlayerStat as DBPlayerStat, Event as DBEvent
    from services.fight_analysis import compute_fights, format_fights_for_api, compute_fight_metrics as fa_compute_fight_metrics
    _DB_AVAILABLE = True
except Exception as _e:
    _DB_AVAILABLE = False
    _DB_IMPORT_ERROR = f"{type(_e).__name__}: {_e}"
    print(f"[DB] Import failed: {_DB_IMPORT_ERROR}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    if _DB_AVAILABLE:
        try:
            await init_db()
            print("[DB] Initialized successfully")
        except Exception as e:
            print(f"[DB] Init failed: {e}")
    yield


app = FastAPI(lifespan=lifespan)

# 응답 gzip 압축 — 1KB 이상 JSON 전송량 절감 (Accept-Encoding: gzip 클라이언트만)
# compresslevel=6: 기본값 9는 압축률 이득이 거의 없이 CPU만 수 배 소모 (저사양 서버 고려)
app.add_middleware(GZipMiddleware, minimum_size=1000, compresslevel=6)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── 라우터 등록 ───────────────────────────────────────────────────────────────
# 등록(=경로 매칭) 순서: banpick → stats → scrims.
# stats 를 scrims 보다 먼저 등록해야 GET /api/scrims/full-events 가
# GET /api/scrims/{scrim_id} 보다 앞서 매칭된다(원래 동작 보존).
try:
    from banpick import router as banpick_router
    app.include_router(banpick_router)
except Exception as _e:
    print(f"[banpick] router not loaded: {_e}")

from routers.stats import router as stats_router
app.include_router(stats_router)
from routers.scrims import router as scrims_router
app.include_router(scrims_router)


# ── 하위호환 re-export ────────────────────────────────────────────────────────
# scripts/dump_game_data.py · scripts/make_game_data_json.py 가 `import main` 후
# main.<이름> 으로 참조하는 게임데이터 파생 상수를 노출한다(이 파일이 정본이 아님 — config 등에서 파생).
# 그 외 심볼은 분리 모듈(config/parsers/services/…)에서 직접 import 하며, 아래는 리팩토링 이전
# `from main import …` 호환을 위한 재노출이다(현재 외부 참조가 없는 이름은 STEP2 보고서의 "미사용 목록" 참조).
from config import (
    KOREAN_HERO_MAP, TANKS, SUPPORTS, MAP_TYPE_DATA, CONTROL_MAP_KEYWORDS,
    _FIGHTLAB_TANKS, _FIGHTLAB_SUPPORTS, _FIGHTLAB_DAMAGE,
    PLAYER_ROLE_OVERRIDES, NUMERIC_FIELDS, FIGHT_QUIET_GAP_SEC,
    DATA_FILE, ROW_DATA_DIR,
    _MAP_TYPE_DATA_NOSPACE, _MATCH_LEVEL_MAP_TYPES,
    TRADE_WINDOW_SEC, HERO_ROLE_DATA,
    MIN_SAMPLE_FOR_PERCENTILE_FIGHTS, MIN_SAMPLE_FOR_PERCENTILE_ROUNDS, PERCENTILE_MIN_POOL,
)
from parsers.log_parser import (
    normalize_team_name, is_control_map, resolve_map_type, is_match_level_map, safe_float,
    time_str_to_seconds, parse_log_timestamp,
    get_role_score, get_player_role_score,
    parse_overwatch_log, assign_persistent_slots,
)
from schemas import PauseInput, MatchSegment, ScrimManualInput, BatchDeleteRequest
from serializers import (
    _db_event_to_dict, _db_player_stat_to_dict, _db_round_to_dict,
    _aggregate_match_stats, _db_match_to_dict, _db_session_to_dict,
)
from services.fight_metrics import (
    build_fight_summaries, compute_fight_metrics,
    _build_match_pauses, _fightlab_hero_role, _fightlab_side, _fight_to_record,
)
from services.stats import calculate_pure_stats, compute_player_fight_stats
from cache import _RESPONSE_CACHE, _response_cache_get, _response_cache_store, _invalidate_response_cache


if __name__ == "__main__":
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
