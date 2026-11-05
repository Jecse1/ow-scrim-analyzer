import os
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import declarative_base, sessionmaker
from log_time import tprint

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
    # 세션 종류(NULL = 스크림, 'tournament' = 대회 공식 경기)·대회 결과 출처 URL
    ("sessions", "kind", "ALTER TABLE sessions ADD COLUMN kind VARCHAR"),
    ("sessions", "source_url", "ALTER TABLE sessions ADD COLUMN source_url VARCHAR"),
]


def _apply_column_patches(sync_conn):
    from sqlalchemy import text
    added = []
    for table, col, ddl in _COLUMN_PATCHES:
        cols = [r[1] for r in sync_conn.execute(text(f"PRAGMA table_info({table})"))]
        if cols and col not in cols:
            sync_conn.execute(text(ddl))
            added.append(f"{table}.{col}")
    tprint(f"[DB] schema check: {'added columns ' + str(added) if added else 'ok'}")


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
    tprint(f"[DB] winner_source backfill: {n} rows" + (f" ({len(rows) - n} left NULL: no winner)" if len(rows) > n else ""))


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
    tprint(f"[DB] draw reclassify: {len(rows)} draws, detail filled {n_detail}, winner_source changed {n_ws}")


def rebuild_tmp_path(db_path: str, job_id: str) -> str:
    """rebuild-db 임시 파일 경로(같은 폴더 — os.replace 가 원자이려면 같은 파일시스템이어야 한다)."""
    return f"{db_path}.rebuild-{job_id}.tmp"


def cleanup_stale_rebuild_files(db_path: str) -> list:
    """재시작 등으로 끝나지 못한 rebuild 임시 파일(+ -journal)을 지운다. 운영 DB·백업은 건드리지 않는다."""
    import glob
    removed = []
    for p in glob.glob(glob.escape(db_path) + ".rebuild-*.tmp*"):
        try:
            os.remove(p)
            removed.append(os.path.basename(p))
        except OSError as e:
            tprint(f"[DB] stale rebuild file remove failed: {os.path.basename(p)}: {type(e).__name__}")
    if removed:
        tprint(f"[DB] stale rebuild files removed: {removed}")
    return removed


async def swap_db_file(session_factory, db_path: str, tmp_path: str, backup_path: str,
                       timeout: float = 10.0) -> str:
    """재구축이 끝난 tmp_path 로 db_path 를 원자 교체한다. 반환: 백업 방식 "link" | "copy".

    1) 백업 = 옛 파일의 하드링크(복사 없음). 링크를 못 만드는 파일시스템이면 복사로 폴백.
    2) { 엔진 dispose → os.replace } 를 성공할 때까지 반복 — Windows 는 열린 핸들이 있으면 replace 가
       PermissionError 라 유휴 연결을 닫고 진행 중 요청이 끝나기를 기다린다. Linux 는 첫 시도에 교체되고
       진행 중 요청은 옛 inode 를 끝까지 읽는다. 본 경로가 비는 순간은 없다(rename 두 번 방식과의 차이).
    3) dispose 한 번 더 — 옛 파일을 잡은 유휴 연결을 버린다. 엔진 객체는 그대로(dispose 는 풀만 새로 만든다)라
       `from db.database import AsyncSessionLocal` 로 가져간 모듈들이 손대지 않아도 새 파일을 본다.
    timeout 안에 교체하지 못하면 백업을 지우고 예외 — 운영 DB 는 옛 것 그대로, tmp_path 정리는 호출자 몫."""
    import asyncio
    import shutil
    import time
    engine = session_factory.kw["bind"]
    try:
        os.link(db_path, backup_path)
        method = "link"
    except OSError as e:
        tprint(f"[DB] backup hardlink unavailable ({type(e).__name__}) — copying instead")
        await asyncio.to_thread(shutil.copy2, db_path, backup_path)
        method = "copy"
    from sqlalchemy.util import greenlet_spawn
    deadline = time.monotonic() + timeout
    # dispose 뒤에 반납되는 연결(진행 중이던 요청)은 새 풀이 아니라 옛 풀로 돌아가 열린 채 남는다 —
    # Windows 에선 그 핸들이 replace 를 막으므로 재시도마다 옛 풀들도 다시 비운다.
    old_pools = []
    while True:
        old_pools.append(engine.sync_engine.pool)
        await engine.dispose()
        for p in old_pools:
            await greenlet_spawn(p.dispose)
        try:
            os.replace(tmp_path, db_path)
            break
        except PermissionError:
            if time.monotonic() >= deadline:
                try:
                    os.remove(backup_path)
                except OSError:
                    pass
                raise
            await asyncio.sleep(0.05)
    await engine.dispose()
    for p in old_pools:   # Linux: 교체 중 반납된 옛 inode 연결도 닫는다
        await greenlet_spawn(p.dispose)
    return method


async def init_db():
    os.makedirs(_DB_DIR, exist_ok=True)
    cleanup_stale_rebuild_files(_DB_PATH)
    async with engine.begin() as conn:
        from db import models  # noqa: F401 — ensure models are imported before create_all
        await conn.run_sync(Base.metadata.create_all)
        await conn.run_sync(_apply_column_patches)
        await conn.run_sync(_backfill_winner_source)
        await conn.run_sync(_backfill_draw_detail)


async def get_db():
    async with AsyncSessionLocal() as session:
        yield session
