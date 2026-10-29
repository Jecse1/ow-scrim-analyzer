# -*- coding: utf-8 -*-
"""services/abilities.py — 스킬 사용 저장소(db/ability_store.py)를 라우터에서 부르는 얇은 비동기 래퍼.

업로드·로그 교체·매치/세션 삭제 경로에 호출 1줄씩만 추가하기 위한 진입점. 저장소는 원문에서 다시 만들 수 있는
파생 데이터라, 여기서 실패해도 기존 응답(업로드·삭제 결과)은 바꾸지 않고 로그만 남긴다
(실패한 매치는 행을 지워 두어 백필이 다시 채우게 한다).
"""
from fastapi.concurrency import run_in_threadpool

from db import ability_store
from parsers.ability_log import extract_ability_data


def init_ability_store() -> None:
    """기동 시 파일·테이블 멱등 생성(동기, lifespan 에서 호출)."""
    try:
        n = ability_store.init_store()
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
