# -*- coding: utf-8 -*-
"""services/abilities.py — 스킬 사용 저장소(db/ability_store.py)를 라우터에서 부르는 얇은 비동기 래퍼 + 백필.

업로드·로그 교체·매치/세션 삭제 경로에 호출 1줄씩만 추가하기 위한 진입점. 저장소는 원문에서 다시 만들 수 있는
파생 데이터라, 여기서 실패해도 기존 응답(업로드·삭제 결과)은 바꾸지 않고 로그만 남긴다
(실패한 매치는 행을 지워 두어 백필이 다시 채우게 한다).

백필(원문 → 스킬 데이터만, rebuild-db 없이):
  대상 = 살아 있는(매치·세션 deleted_at 없음) 로그 매치. 이미 처리한 매치(ability_matches 행 있음 — has_log 0 포함)는
  건너뛴다(멱등). 매치마다 원문 읽기·파싱·쓰기는 스레드풀, 쓰기는 매치 단위 트랜잭션 1개. 진행 "[ABILITY] backfill n/N".
  - 기동 시 저장소가 비어 있으면 캐시 선채우기(cache.py)가 끝난 뒤 자동 예약(ABILITY_AUTO_BACKFILL=0 이면 끔).
  - 관리 엔드포인트(routers/abilities.py)는 백그라운드로 시작하고 즉시 응답(nginx 60s 제한 회피).
  - rebuild-db 뒤에는 force: 처리 여부와 무관하게 대상 매치 전부를 재파싱해 매치 단위로 교체하고, 대상이 아닌 매치 행은 지운다.
  응답 캐시는 무효화하지 않는다 — 스킬 데이터는 기존 캐시 응답에 들어 있지 않다.
  비force 백필은 쓰기 직전에 처리 여부를 다시 본다(백필 도중 업로드가 먼저 채운 매치를 덮지 않게).
"""
import asyncio
import os
import time

from fastapi.concurrency import run_in_threadpool

from config import ROW_DATA_DIR
from db import ability_store
from parsers.ability_log import extract_ability_data
from parsers.log_parser import parse_overwatch_log

AUTO_BACKFILL = os.getenv("ABILITY_AUTO_BACKFILL", "1") != "0"   # 테스트는 0(backend/conftest.py)
PROGRESS_EVERY = 25           # 진행 로그 간격(매치 수)
_STORE_EMPTY = False          # 기동 시 저장소가 비어 있었는지(init_ability_store 가 정함)
_BACKFILL_TASK = None
_PENDING_FORCE = False        # 백필 실행 중 rebuild-db 가 끝나면 이어서 force 1회
BACKFILL_STATE: dict = {"state": "idle"}


def init_ability_store() -> None:
    """기동 시 파일·테이블 멱등 생성(동기, lifespan 에서 호출)."""
    global _STORE_EMPTY
    try:
        n = ability_store.init_store()
        _STORE_EMPTY = n == 0
        print(f"[ABILITY] store ready: {ability_store.DB_PATH} matches={n}")
    except Exception as e:
        print(f"[ABILITY] store init failed: {type(e).__name__}: {e}")


async def extract_abilities(log_text: str, parsed: dict) -> "dict | None":
    """원문 → 스킬 데이터(스레드풀). 실패하면 None(저장 단계에서 그 매치를 비워 둔다)."""
    try:
        return await run_in_threadpool(extract_ability_data, log_text, parsed)
    except Exception as e:
        print(f"[ABILITY] extract failed: {type(e).__name__}: {e}")
        return None


async def store_match_abilities(match_id: str, data: "dict | None") -> None:
    """업로드·로그 교체 직후(scrim.db 커밋 뒤) 그 매치의 스킬 데이터를 바꾼다."""
    try:
        if data is None:
            await run_in_threadpool(ability_store.forget_matches, [match_id])
            return
        n = await run_in_threadpool(ability_store.replace_match, match_id, data)
        print(f"[ABILITY] stored match={match_id} uses={n}" + ("" if data.get("has_log") else " (no ability log)"))
    except Exception as e:
        print(f"[ABILITY] store failed match={match_id}: {type(e).__name__}: {e}")
        try:
            await run_in_threadpool(ability_store.forget_matches, [match_id])
        except Exception:
            pass


async def forget_match_abilities(match_ids) -> None:
    """매치·세션 삭제(soft delete) 뒤 해당 매치들의 스킬 데이터 정리."""
    try:
        n = await run_in_threadpool(ability_store.forget_matches, list(match_ids or []))
        if n:
            print(f"[ABILITY] forgot {n} matches")
    except Exception as e:
        print(f"[ABILITY] forget failed: {type(e).__name__}: {e}")


# ── 백필 ─────────────────────────────────────────────────────────────────────

async def _backfill_targets() -> list:
    """(match_id, session_id, match_index, team1, team2) — 살아 있는 로그 매치, 세션·세트 순."""
    from sqlalchemy import select, or_
    from db.database import AsyncSessionLocal
    from db.models import Match, Session
    async with AsyncSessionLocal() as db:
        rows = (await db.execute(
            select(Match.id, Match.session_id, Match.match_index, Match.team1_name, Match.team2_name)
            .join(Session, Session.id == Match.session_id)
            .where(Match.deleted_at.is_(None), Session.deleted_at.is_(None),
                   or_(Match.source == "log", Match.source.is_(None)))
            .order_by(Match.session_id, Match.match_index))).all()
    return [tuple(r) for r in rows]


def _backfill_one(match_id: str, path: str, t1: str, t2: str, force: bool) -> tuple:
    """매치 1개 처리(스레드풀). 반환 (결과, 저장 수, has_log, 쓰기 트랜잭션 ms)."""
    if not os.path.exists(path):
        if force:
            ability_store.forget_matches([match_id])
        return "missing_file", 0, False, 0.0
    with open(path, "rb") as f:
        raw = f.read()
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        text = raw.decode("cp949", errors="ignore")   # 업로드 디코딩(_decode_log_bytes)과 같은 대체
    data = extract_ability_data(text, parse_overwatch_log(text, custom_t1=t1, custom_t2=t2))
    if not force and ability_store.match_status(match_id) is not None:
        return "skipped", 0, False, 0.0
    n = ability_store.replace_match(match_id, data)
    return "stored", n, data["has_log"], ability_store.LAST_TX_MS


async def _run_backfill(force: bool) -> None:
    global _PENDING_FORCE
    t0 = time.perf_counter()
    st = BACKFILL_STATE
    st.clear()
    st.update({"state": "running", "force": force, "started_at": time.time(), "done": 0, "total": 0,
               "skipped": 0, "stored_matches": 0, "stored_uses": 0, "no_log": 0, "missing_file": 0,
               "failed": 0, "pruned": 0, "max_tx_ms": 0.0, "p50_tx_ms": None, "p95_tx_ms": None, "elapsed_sec": None})
    tx_samples: list = []
    try:
        targets = await _backfill_targets()
        if force:
            live = {t[0] for t in targets}
            stale = [m for m in await run_in_threadpool(ability_store.processed_match_ids) if m not in live]
            st["pruned"] = await run_in_threadpool(ability_store.forget_matches, stale)
            todo = targets
        else:
            done_ids = await run_in_threadpool(ability_store.processed_match_ids)
            todo = [t for t in targets if t[0] not in done_ids]
            st["skipped"] = len(targets) - len(todo)
        st["total"] = len(todo)
        print(f"[ABILITY] backfill start: {len(todo)} matches"
              + (" (force)" if force else f", already done {st['skipped']}"), flush=True)
        for i, (mid, sid, idx, t1, t2) in enumerate(todo, 1):
            path = os.path.join(ROW_DATA_DIR, f"{sid}_{idx}.txt")
            try:
                res, n, has_log, tx = await run_in_threadpool(_backfill_one, mid, path, t1, t2, force)
            except Exception as e:
                print(f"[ABILITY] backfill failed match={mid}: {type(e).__name__}: {e}", flush=True)
                res, n, has_log, tx = "failed", 0, False, 0.0
            if res == "stored":
                st["stored_matches"] += 1
                st["stored_uses"] += n
                st["no_log"] += 0 if has_log else 1
                st["max_tx_ms"] = max(st["max_tx_ms"], round(tx, 1))
                tx_samples.append(tx)
            else:
                st[{"missing_file": "missing_file", "skipped": "skipped", "failed": "failed"}[res]] += 1
            st["done"] = i
            if i % PROGRESS_EVERY == 0 or i == len(todo):
                print(f"[ABILITY] backfill {i}/{len(todo)}", flush=True)
        st["state"] = "done"
    except asyncio.CancelledError:
        st["state"] = "cancelled"
        raise
    except Exception as e:
        st["state"] = "error"
        st["error"] = f"{type(e).__name__}: {e}"
        print(f"[ABILITY] backfill error: {st['error']}", flush=True)
    finally:
        st["elapsed_sec"] = round(time.perf_counter() - t0, 2)
        if tx_samples:
            tx_samples.sort()
            st["p50_tx_ms"] = round(tx_samples[len(tx_samples) // 2], 1)
            st["p95_tx_ms"] = round(tx_samples[int(len(tx_samples) * 0.95)], 1)
    print(f"[ABILITY] backfill done: matches={st['stored_matches']} uses={st['stored_uses']} no_log={st['no_log']} "
          f"missing_file={st['missing_file']} failed={st['failed']} pruned={st['pruned']} "
          f"{st['elapsed_sec']}s tx p50/p95/max={st['p50_tx_ms']}/{st['p95_tx_ms']}/{st['max_tx_ms']}ms", flush=True)
    if _PENDING_FORCE:
        _PENDING_FORCE = False
        start_backfill(force=True)


def start_backfill(force: bool = False) -> dict:
    """백필 시작(백그라운드, 이벤트 루프 안에서 호출). 실행 중이면 새로 시작하지 않는다(force 요청은 끝난 뒤 1회 이어서)."""
    global _BACKFILL_TASK, _PENDING_FORCE
    if _BACKFILL_TASK is not None and not _BACKFILL_TASK.done():
        if force:
            _PENDING_FORCE = True
        return {"status": "running", **BACKFILL_STATE}
    _BACKFILL_TASK = asyncio.get_running_loop().create_task(_run_backfill(force))
    return {"status": "started", "force": force}


def backfill_state() -> dict:
    running = _BACKFILL_TASK is not None and not _BACKFILL_TASK.done()
    return {"running": running, **BACKFILL_STATE}


async def _auto_backfill_after_warm() -> None:
    import cache
    await asyncio.sleep(0)   # 같은 기동 단계에서 예약된 선채우기 작업이 먼저 잡히게
    while True:
        task = cache._WARM_TASK   # 선채우기 작업(무효화로 다시 예약되면 새 작업을 기다린다)
        if task is None or task.done():
            break
        await asyncio.wait({task})
    print("[ABILITY] store empty at boot -> auto backfill", flush=True)
    start_backfill()


def schedule_auto_backfill() -> None:
    """기동 시 저장소가 비어 있었으면 캐시 선채우기 완료 후 백필 예약(lifespan 에서 schedule_warm 다음에 호출)."""
    if AUTO_BACKFILL and _STORE_EMPTY:
        asyncio.get_running_loop().create_task(_auto_backfill_after_warm())


def cancel_backfill() -> None:
    if _BACKFILL_TASK is not None and not _BACKFILL_TASK.done():
        _BACKFILL_TASK.cancel()
