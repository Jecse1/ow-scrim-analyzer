# -*- coding: utf-8 -*-
"""services/rebuild_job.py — rebuild-db 비동기 작업 상태(프로세스 내, scrims·plans 공용).

POST /api/admin/rebuild-db 는 start() 로 백그라운드 작업을 띄우고 202 를 바로 돌려준다(예전: 끝까지 붙잡아 nginx 60초 504).
진행 중엔 쓰기 API(scrims·plans)·중복 rebuild 가 409 — 재구축은 운영 DB 사본 위에서 돌므로 그사이 운영 DB 에 쓴 것은
교체 때 사라진다. 상태는 메모리라 재시작하면 idle(남은 임시 파일은 init_db 가 지운다).
오류 문구는 고정(예외 문자열 비노출) — HTTPException.detail(문자열)만 그대로 옮긴다.
"""
import asyncio
import os
import uuid
from datetime import datetime
from typing import Awaitable, Callable, Optional

from fastapi import HTTPException

from log_time import tprint

_JOB: Optional[dict] = None     # 실행 중 {job_id, started_at} — None 이면 쓰기 허용
_TASK: Optional[asyncio.Task] = None   # 참조 보관(GC 로 작업이 사라지지 않게)
_STATUS: dict = {"state": "idle"}

_FIELDS = ("job_id", "started_at", "finished_at", "phase", "sessions", "matches", "rounds", "events",
           "parse_errors", "backup_created", "error", "reason")


def _now() -> str:
    return datetime.utcnow().isoformat(timespec="seconds") + "Z"


def _blank(state: str) -> dict:
    return {"state": state, **{k: None for k in _FIELDS}}


def is_running() -> bool:
    return _JOB is not None


def raise_if_rebuilding() -> None:
    if _JOB is not None:
        raise HTTPException(status_code=409, detail="DB rebuild in progress")


def status() -> dict:
    return {**_blank("idle"), **_STATUS}


def record_rejected(error: str, reason: str) -> None:
    """시작 전 거절(디스크 부족 등) — 작업은 만들지 않고 status 에 사유만 남긴다."""
    global _STATUS
    _STATUS = {**_blank("failed"), "finished_at": _now(), "error": error, "reason": reason}


def _set_phase(job_id: str, phase: str) -> None:
    if _STATUS.get("job_id") == job_id:
        _STATUS["phase"] = phase


def start(run: Callable[[str, Callable[[str], None]], Awaitable[dict]]) -> dict:
    """run(job_id, set_phase) 를 백그라운드로 실행. 검사와 설정 사이에 await 가 없어 단일 이벤트 루프에서 원자적."""
    global _JOB, _TASK, _STATUS
    raise_if_rebuilding()
    job = {"job_id": uuid.uuid4().hex, "started_at": _now()}
    _JOB = job
    _STATUS = {**_blank("running"), **job, "phase": "start"}
    tprint(f"[REBUILD] 시작 job={job['job_id']}")
    _TASK = asyncio.create_task(_runner(run, job))
    return {**job, "state": "running"}


async def _runner(run, job: dict) -> None:
    global _JOB, _TASK, _STATUS
    jid = job["job_id"]
    try:
        res = await run(jid, lambda phase: _set_phase(jid, phase))
        _STATUS = {**_blank("done"), **job, "finished_at": _now(), "phase": "done",
                   **{k: res.get(k) for k in ("sessions", "matches", "rounds", "events", "parse_errors")},
                   "backup_created": os.path.basename(res.get("backup_created") or "") or None}
        tprint(f"[REBUILD] done job={jid}")
    except Exception as e:
        err = e.detail if isinstance(e, HTTPException) and isinstance(e.detail, str) else "DB rebuild failed"
        _STATUS = {**_blank("failed"), **job, "finished_at": _now(), "phase": _STATUS.get("phase"), "error": err}
        tprint(f"[REBUILD] failed job={jid}: {err}")
    finally:
        if _JOB is job:
            _JOB = None
            _TASK = None

