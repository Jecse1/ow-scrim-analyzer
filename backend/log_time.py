# -*- coding: utf-8 -*-
"""log_time.py — 백엔드 운영 로그 줄 앞에 UTC 시각을 붙이는 공용 print.

[CACHE]·[REBUILD]·[DB]·[PRECHECK]·[ABILITY]·[WEBHOOK]·[DELETE] 줄은 print 대신 tprint 를 쓴다.
메시지 본문·print 인자(flush 등)는 그대로, 앞에 '2026-11-04T05:12:33Z ' 형식(UTC, 초 단위)만 붙는다.
pm2·journal 로그에 시각이 없어 장애 시점(등록·업로드·캐시 계산) 대조가 어려웠다.
"""
from datetime import datetime, timezone


def log_ts() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def tprint(*args, **kwargs) -> None:
    print(log_ts(), *args, **kwargs)
