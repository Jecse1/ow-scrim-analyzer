# -*- coding: utf-8 -*-
"""game_data JSON(heroes·maps·players) 중복 검사.

json.load 는 같은 객체 안의 중복 키를 마지막 값으로 조용히 덮어쓴다 — 병합 충돌을 손으로 풀다 같은 키가
두 번 들어가도(JDG heroes.json, 2026-10-29) 로드는 성공하고 앞 값이 사라진다. object_pairs_hook 으로
모든 깊이의 중복 키를 잡고, 엔트리 배열(heroes·maps)의 id 중복도 본다.
"""
import json
import os

import pytest

GAME_DATA = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "game_data")
FILES = ["heroes.json", "maps.json", "players.json"]


def _strict_pairs(pairs):
    seen = {}
    for k, v in pairs:
        if k in seen:
            raise ValueError(f"duplicate key: {k!r}")
        seen[k] = v
    return seen


def _load_strict(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f, object_pairs_hook=_strict_pairs)


@pytest.mark.parametrize("name", FILES)
def test_game_data_json_has_no_duplicate_keys(name):
    doc = _load_strict(os.path.join(GAME_DATA, name))
    for list_key in ("heroes", "maps"):
        entries = doc.get(list_key)
        if isinstance(entries, list):
            ids = [e["id"] for e in entries]
            dup = sorted({i for i in ids if ids.count(i) > 1})
            assert not dup, f"{name}: duplicate {list_key} id {dup}"


def test_strict_loader_catches_duplicate_key(tmp_path):
    p = tmp_path / "dup.json"
    p.write_text('{"heroes": [{"id": "ana", "ko": "아나", "ko": "아나2"}]}', encoding="utf-8")
    with pytest.raises(ValueError, match="duplicate key: 'ko'"):
        _load_strict(str(p))
    assert json.loads(p.read_text(encoding="utf-8"))["heroes"][0]["ko"] == "아나2"   # 기본 json 은 조용히 덮어씀
