# -*- coding: utf-8 -*-
"""디스코드 알림 본문: 사용자 입력이 코드 블록을 벗어나지 못하고, 멘션이 울리지 않는다.

- services/summary.format_session_message: 세션명·팀명·맵명·날짜·ID 의 백틱·@ 이스케이프 → 매치 줄 자르기 →
  머리줄 자르기(닫는 ``` 보장). 백틱·@ 없는 입력은 바이트 동일(골든 tests/golden/summary_sample.json).
- services/discord_webhook: 페이로드 allowed_mentions = {"parse": []}.
"""
import asyncio

from services.summary import format_session_message, DISCORD_CONTENT_LIMIT
from services import discord_webhook

BASE = "Team Z"
ZW = "\u200b"


def _scrim(name="261104-평범", opp="팀C", map_name="리장 타워", n=1, date="2026-11-04", sid="2611040305"):
    return {"id": sid, "date": date, "scrim_name": name,
            "matches": [{"map_name": map_name, "team1_name": BASE, "team2_name": opp,
                         "winner": BASE, "score_t1": 2, "score_t2": 0}] * n}


def _assert_single_block(msg):
    lines = msg.split("\n")
    assert lines[0] == "```" and lines[-1] == "```"
    assert msg.count("```") == 2                      # 여는·닫는 펜스만 — 입력이 블록을 닫지 못한다
    assert len(msg) <= DISCORD_CONTENT_LIMIT


def test_backticks_and_mentions_stay_inside_code_block():
    evil = "x```\n@everyone <@123> @here `y`"
    msg = format_session_message(_scrim(name=evil, opp="```팀@C", map_name="```@here맵"), BASE)
    _assert_single_block(msg)
    for raw in ("@everyone", "@here", "<@123>"):
        assert raw not in msg
    assert f"@{ZW}everyone" in msg and f"<@{ZW}123>" in msg
    assert f"`{ZW}`{ZW}`{ZW}팀@{ZW}C" in msg           # 상대 팀명
    assert f"`{ZW}`{ZW}`{ZW}@{ZW}here맵 / 승 / 2:0" in msg  # 맵 줄


def test_plain_input_unchanged():
    msg = format_session_message(_scrim(), BASE)
    assert msg == "```\n2026-11-04 vs 팀C (261104-평범) [id:2611040305]\n리장 타워 / 승 / 2:0\n합계 1-0-0\n```"
    assert ZW not in msg


def test_long_header_keeps_closing_fence():
    # 세션명이 limit 보다 길어도(이스케이프로 더 늘어나도) 닫는 ``` 가 남는다 — 예전 msg[:limit] 는 잘라 먹었다
    for name in ("가" * 3000, "`" * 1500, "@" * 1500):
        msg = format_session_message(_scrim(name=name, n=5), BASE)
        _assert_single_block(msg)
        lines = msg.split("\n")
        assert lines[1].endswith("…")
        assert lines[-3] == "…외 5매치" and lines[-2] == "합계 5-0-0"


def test_long_map_lines_cut_before_header():
    msg = format_session_message(_scrim(map_name="맵" * 300, n=20), BASE)
    _assert_single_block(msg)
    lines = msg.split("\n")
    assert lines[1] == "2026-11-04 vs 팀C (261104-평범) [id:2611040305]"   # 머리줄은 그대로
    assert lines[-3].startswith("…외 ")


def test_webhook_payload_disables_mentions(monkeypatch):
    sent = {}

    class _Resp:
        status_code = 204

    class _Client:
        def __init__(self, **kw):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, url, json=None):
            sent["url"], sent["json"] = url, json
            return _Resp()

    monkeypatch.setattr(discord_webhook.httpx, "AsyncClient", _Client)
    content = format_session_message(_scrim(name="```@everyone"), BASE)
    asyncio.run(discord_webhook._post_webhook("http://127.0.0.1:9/hook", lambda: content))
    assert sent["json"] == {"content": content, "allowed_mentions": {"parse": []}}
