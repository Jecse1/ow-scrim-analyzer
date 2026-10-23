import os
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import declarative_base, sessionmaker

_DB_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
_DB_PATH = os.path.join(_DB_DIR, "scrim.db")
# 테스트·로컬 사본 검증용 경로 재지정(SCRIM_DB_PATH). 미설정 시 기존 경로 그대로.
if os.environ.get("SCRIM_DB_PATH"):
    _DB_PATH = os.path.abspath(os.environ["SCRIM_DB_PATH"])
    _DB_DIR = os.path.dirname(_DB_PATH)

DATABASE_URL = f"sqlite+aiosqlite:///{_DB_PATH}"

engine = create_async_engine(DATABASE_URL, echo=False, connect_args={"check_same_thread": False})

AsyncSessionLocal = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

Base = declarative_base()


# 기동 시 멱등 스키마 보정 대상: (테이블, 컬럼, ADD COLUMN 절).
# create_all은 기존 테이블에 새 컬럼을 추가하지 않으므로, 옛 DB에서도 재시작만으로 반영되게 한다.
# 이 목록이 스키마 변경의 정본(alembic 미사용 — 2026-10-16 삭제). 새 컬럼은 여기에 한 줄 추가하면 재시작만으로 반영된다.
_COLUMN_PATCHES = [
    ("matches", "source", "ALTER TABLE matches ADD COLUMN source VARCHAR NOT NULL DEFAULT 'log'"),
    ("matches", "video_start_sec", "ALTER TABLE matches ADD COLUMN video_start_sec INTEGER"),
    ("matches", "video_end_sec", "ALTER TABLE matches ADD COLUMN video_end_sec INTEGER"),
    # 라운드별 VOD 보정값
    ("rounds", "video_delta_sec", "ALTER TABLE rounds ADD COLUMN video_delta_sec INTEGER"),
    # 승자 출처
    ("matches", "winner_source", "ALTER TABLE matches ADD COLUMN winner_source VARCHAR"),
    # 판정 경로·근거(JSON 텍스트)
    ("matches", "winner_detail", "ALTER TABLE matches ADD COLUMN winner_detail TEXT"),
]


def _apply_column_patches(sync_conn):
    from sqlalchemy import text
    added = []
    for table, col, ddl in _COLUMN_PATCHES:
        cols = [r[1] for r in sync_conn.execute(text(f"PRAGMA table_info({table})"))]
        if cols and col not in cols:
            sync_conn.execute(text(ddl))
            added.append(f"{table}.{col}")
    print(f"[DB] schema check: {'added columns ' + str(added) if added else 'ok'}")


def _backfill_winner_source(sync_conn):
    """winner_source IS NULL 인 매치를 파생 규칙으로 채운다(멱등 — 이미 값이 있는 행은 건드리지 않음).
    승자가 빈 매치는 파생값도 NULL 이라 그대로 남는다(다음 기동에도 다시 계산될 뿐 결과 동일)."""
    from sqlalchemy import text
    from services.winner_source import derive_winner_source
    rows = sync_conn.execute(text(
        "SELECT id, winner, winner_override, source, score_t1, score_t2 "
        "FROM matches WHERE winner_source IS NULL")).mappings().all()
    n = 0
    for r in rows:
        ws = derive_winner_source(dict(r))
        if ws:
            sync_conn.execute(text("UPDATE matches SET winner_source = :ws WHERE id = :id"),
                              {"ws": ws, "id": r["id"]})
            n += 1
    print(f"[DB] winner_source backfill: {n} rows" + (f" ({len(rows) - n} left NULL: no winner)" if len(rows) > n else ""))


def _backfill_draw_detail(sync_conn):
    """무승부(winner='Draw', 보정 없음) 매치를 실제 무승부(draw)/미확정(undetermined)으로 재분류한다.
    로그 매치의 winner_detail 이 비어 있으면 DB 근거(맵 모드·round_start 의 라운드 번호 수·match_end 점수)로
    채운다(진행도는 DB 에 없어 null — 업로드·rebuild-db 때 채워짐). 이미 있는 winner_detail 은 덮지 않는다.
    입력이 같으면 결과가 같으므로 몇 번 돌려도 같다(멱등)."""
    import json
    from sqlalchemy import text
    from parsers.log_parser import resolve_map_type
    from services.winner_source import classify_draw_path, derive_winner_source
    rows = sync_conn.execute(text(
        "SELECT id, map_name, winner, winner_override, source, score_t1, score_t2, winner_source, winner_detail "
        "FROM matches WHERE winner = 'Draw' AND (winner_override IS NULL OR winner_override = '')")).mappings().all()
    n_detail = n_ws = 0
    for r in rows:
        r = dict(r)
        if (r["source"] or "log") == "log" and not r["winner_detail"]:
            rounds = sync_conn.execute(text(
                "SELECT COUNT(DISTINCT round_number) FROM events "
                "WHERE match_id = :id AND event_type = 'round_start' AND round_number IS NOT NULL"), {"id": r["id"]}).scalar() or 0
            me = sync_conn.execute(text(
                "SELECT score_t1, score_t2 FROM events WHERE match_id = :id AND event_type = 'match_end' "
                "ORDER BY game_timestamp DESC LIMIT 1"), {"id": r["id"]}).first()
            has_me = me is not None and me[0] is not None and me[1] is not None
            detail = {
                "path": classify_draw_path(resolve_map_type(r["map_name"] or "") or "", rounds, has_me,
                                           me[0] if has_me else None, me[1] if has_me else None),
                "rounds": rounds,
                "match_end": {"present": has_me, "t1": me[0] if has_me else None, "t2": me[1] if has_me else None},
                "prog_t1": None, "prog_t2": None,
            }
            r["winner_detail"] = json.dumps(detail, ensure_ascii=False)
            sync_conn.execute(text("UPDATE matches SET winner_detail = :d WHERE id = :id"),
                              {"d": r["winner_detail"], "id": r["id"]})
            n_detail += 1
        ws = derive_winner_source(r)
        if ws != r["winner_source"]:
            sync_conn.execute(text("UPDATE matches SET winner_source = :ws WHERE id = :id"), {"ws": ws, "id": r["id"]})
            n_ws += 1
    print(f"[DB] draw reclassify: {len(rows)} draws, detail filled {n_detail}, winner_source changed {n_ws}")


async def init_db():
    os.makedirs(_DB_DIR, exist_ok=True)
    async with engine.begin() as conn:
        from db import models  # noqa: F401 — ensure models are imported before create_all
        await conn.run_sync(Base.metadata.create_all)
        await conn.run_sync(_apply_column_patches)
        await conn.run_sync(_backfill_winner_source)
        await conn.run_sync(_backfill_draw_detail)


async def get_db():
    async with AsyncSessionLocal() as session:
        yield session
