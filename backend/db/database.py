import os
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import declarative_base, sessionmaker

_DB_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
_DB_PATH = os.path.join(_DB_DIR, "scrim.db")

DATABASE_URL = f"sqlite+aiosqlite:///{_DB_PATH}"

engine = create_async_engine(DATABASE_URL, echo=False, connect_args={"check_same_thread": False})

AsyncSessionLocal = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

Base = declarative_base()


# 기동 시 멱등 스키마 보정 대상: (테이블, 컬럼, ADD COLUMN 절).
# create_all은 기존 테이블에 새 컬럼을 추가하지 않으므로, 옛 DB에서도 재시작만으로 반영되게 한다.
# alembic 리비전(d4e5f6a7b8c9)과 동일 정의 — 어느 쪽이 먼저 적용돼도 결과 동일(멱등).
_COLUMN_PATCHES = [
    ("matches", "source", "ALTER TABLE matches ADD COLUMN source VARCHAR NOT NULL DEFAULT 'log'"),
    ("matches", "video_start_sec", "ALTER TABLE matches ADD COLUMN video_start_sec INTEGER"),
    ("matches", "video_end_sec", "ALTER TABLE matches ADD COLUMN video_end_sec INTEGER"),
    # alembic 리비전(e5f6a7b8c9d0)과 동일 정의 — 라운드별 VOD 보정값
    ("rounds", "video_delta_sec", "ALTER TABLE rounds ADD COLUMN video_delta_sec INTEGER"),
    # alembic 리비전(f6a7b8c9d0e1)과 동일 정의 — 승자 출처
    ("matches", "winner_source", "ALTER TABLE matches ADD COLUMN winner_source VARCHAR"),
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


async def init_db():
    os.makedirs(_DB_DIR, exist_ok=True)
    async with engine.begin() as conn:
        from db import models  # noqa: F401 — ensure models are imported before create_all
        await conn.run_sync(Base.metadata.create_all)
        await conn.run_sync(_apply_column_patches)
        await conn.run_sync(_backfill_winner_source)


async def get_db():
    async with AsyncSessionLocal() as session:
        yield session
