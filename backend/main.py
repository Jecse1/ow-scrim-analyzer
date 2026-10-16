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
    from config import DISCORD_WEBHOOK_URL  # 값은 출력하지 않는다(설정 여부만)
    print(f"[WEBHOOK] DISCORD_WEBHOOK_URL: {'설정됨' if DISCORD_WEBHOOK_URL else '미설정'}")
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
# 집계 조회(봇·외부용). 경로 /api/summary/* — 위 라우터들과 접두가 겹치지 않아 순서 무관.
from routers.summary import router as summary_router
app.include_router(summary_router)

# 드래프트 플랜(플랜 전용 테이블·캐시. 경로 /api/plans/* — 기존 라우터와 충돌 없음)
try:
    from plans import router as plans_router
    app.include_router(plans_router)
except Exception as _e:
    print(f"[plans] router not loaded: {_e}")


if __name__ == "__main__":
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
