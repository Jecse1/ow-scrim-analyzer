# -*- coding: utf-8 -*-
"""services/discord_webhook.py — 디스코드 웹후크 비동기 발송(세션 등록 완료 알림).

schedule_webhook(url, build_content) 는 asyncio.create_task 로 발송을 분리하고 즉시 반환한다(호출자는 기다리지 않음).
본문 생성(build_content 호출)도 발송 코루틴 안에서 하며, 코루틴은 모든 예외를 스스로 잡는다 → 호출한 엔드포인트의 응답에 어떤 영향도 주지 않는다.
실패(네트워크·타임아웃·4xx·5xx)는 logging.warning 으로 "상태 코드" 또는 "예외 클래스명"만 남긴다.
URL·요청 본문·응답 본문은 어디에도 기록하지 않는다.
"""
import asyncio
import logging
from typing import Callable

import httpx

logger = logging.getLogger("scrim.webhook")

# httpx/httpcore 는 INFO 레벨에서 요청 URL 을 로그로 남긴다 — 웹후크 URL(비밀값) 유출 방지로 WARNING 이상만.
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)

WEBHOOK_TIMEOUT_SEC = 5

# 실행 중 작업의 강한 참조(이벤트 루프는 task 를 약하게 참조 — 완료 전 GC 방지). 완료 시 제거.
_PENDING: set = set()


async def _post_webhook(url: str, build_content: Callable[[], str]) -> None:
    try:
        content = build_content()
        async with httpx.AsyncClient(timeout=WEBHOOK_TIMEOUT_SEC) as client:
            r = await client.post(url, json={"content": content})
        if r.status_code >= 300:
            logger.warning("[WEBHOOK] discord webhook failed: HTTP %s", r.status_code)
    except Exception as e:  # 본문 생성·네트워크·타임아웃·URL 형식 등 전부 — 응답 경로로 전파하지 않는다
        logger.warning("[WEBHOOK] discord webhook failed: %s", type(e).__name__)


def schedule_webhook(url: str, build_content: Callable[[], str]) -> None:
    """발송 작업을 현재 이벤트 루프에 분리 등록(fire-and-forget). build_content: 본문 문자열을 돌려주는 함수."""
    task = asyncio.create_task(_post_webhook(url, build_content))
    _PENDING.add(task)
    task.add_done_callback(_PENDING.discard)
