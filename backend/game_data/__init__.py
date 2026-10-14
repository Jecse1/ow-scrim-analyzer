# -*- coding: utf-8 -*-
"""
game_data — 영웅/맵 게임 데이터의 단일 출처(SSOT) 로더.

heroes.json / maps.json 을 읽어, 기존 코드가 쓰던 상수들을 값 동일하게 재구성해
노출한다. main.py / log_normalizer.py / banpick/data.py 는 각자의 리터럴 정의 대신
이 모듈의 값을 import 해서 쓴다(변수명 유지, 사용처 무수정).

정본 원칙:
    - 정본 키 = 로그가 기록하는 표기(예: 솔저 정본 '솔저: 76', D.Va/D.Mon 영문 리터럴).
    - 각 엔트리는 "정본 필드"(id/logName/en/ko/role/image/aliases/skills)와
      "무손실 재구성 필드"(koreanHeroMap/roleForms/banpick, 맵은 mapTypeData/
      controlKeywords/en2ko/banpick)를 함께 갖는다. 후자가 diff-0을 보장한다.

재구성 규칙(런타임 동작 보존):
    - KOREAN_HERO_MAP : 엔트리 순서 + 각 엔트리 koreanHeroMap 순서를 보존해
      역매핑(setdefault, 예: 'Soldier: 76' → 첫 한국어 '솔저: 76')을 원본과 동일하게 유지.
    - TANKS/SUPPORTS  : 원본에서 _FIGHTLAB_TANKS/SUPPORTS 와 내용 동일함이 검증됨 → 동일 파생.
    - MAP_TYPE_DATA / CONTROL_MAP_KEYWORDS / MAP_EN2KO : 엔트리별 저장값을 병합.
"""
from __future__ import annotations
import os
import re
import json
import unicodedata

_HERE = os.path.dirname(os.path.abspath(__file__))


def _load(name: str) -> dict:
    with open(os.path.join(_HERE, name), "r", encoding="utf-8") as f:
        return json.load(f)


_HEROES_DOC = _load("heroes.json")
_MAPS_DOC = _load("maps.json")

HEROES_DATA = _HEROES_DOC["heroes"]      # 정본 영웅 엔트리(프론트/향후 소비용 포함)
MAPS_DATA = _MAPS_DOC["maps"]            # 정본 맵 엔트리

# ── 영웅 파생 ────────────────────────────────────────────────────────────────
# 규칙: 엔트리에 en 이 있어도 koreanHeroMap 이 비어 있으면 KOREAN_HERO_MAP 에 넣지 않는다.
#   KOREAN_HERO_MAP 은 parse 의 이미지 파일명 소스이므로(main.py KOREAN_HERO_MAP.get(hero,hero)),
#   키를 추가하면 곧 이미지 경로가 바뀐다. 프레야/벤데타/우양은 정본 영웅(en 유지)이지만
#   KHM 에는 넣지 않는다(존재하는 한글 이미지 유지). 영어 로그 정규화는 HERO_EN2KO_EXPLICIT 담당.
#   ※ STEP 3(이미지 리졸버를 image 필드 기반으로 전환) 전까지 KHM 키 추가 금지.
KOREAN_HERO_MAP: dict = {}
for _h in HEROES_DATA:
    for _k, _v in _h.get("koreanHeroMap", {}).items():
        KOREAN_HERO_MAP[_k] = _v

FIGHTLAB_TANKS: list = []
FIGHTLAB_SUPPORTS: list = []
FIGHTLAB_DAMAGE: list = []
for _h in HEROES_DATA:
    _forms = _h.get("roleForms", [])
    _role = _h.get("role")
    if _role == "tank":
        FIGHTLAB_TANKS.extend(_forms)
    elif _role == "support":
        FIGHTLAB_SUPPORTS.extend(_forms)
    elif _role == "damage":
        FIGHTLAB_DAMAGE.extend(_forms)

# 원본에서 TANKS ≡ _FIGHTLAB_TANKS, SUPPORTS ≡ _FIGHTLAB_SUPPORTS (내용 동일) 검증됨.
TANKS: list = list(FIGHTLAB_TANKS)
SUPPORTS: list = list(FIGHTLAB_SUPPORTS)

# log_normalizer 의 EN→KO 명시 보강 테이블(정본 데이터라 여기서 관리).
HERO_EN2KO_EXPLICIT: dict = dict(_HEROES_DOC["heroEn2koExplicit"])

# ── 맵 파생 ─────────────────────────────────────────────────────────────────
MAP_TYPE_DATA: dict = {}
CONTROL_MAP_KEYWORDS: list = []
MAP_EN2KO: dict = {}
for _m in MAPS_DATA:
    MAP_TYPE_DATA.update(_m.get("mapTypeData", {}))
    CONTROL_MAP_KEYWORDS.extend(_m.get("controlKeywords", []))
    MAP_EN2KO.update(_m.get("en2ko", {}))

MODE_EN2KO: dict = dict(_MAPS_DOC["modeEn2ko"])


# ── 맵명 정본화 ──────────────────────────────────────────────────────────────
# 프론트 gameData.js normalizeMapKey / resolveMapEntry / canonicalMapName 과 같은 규칙:
#   정규화 키 = 트림 → 소문자 → 모든 공백 제거 → NFC.
#   ① 정확 일치(ko·en·aliases) → ② 정규화 일치(ko·en·zh·aliases·mapTypeData 키), 먼저 나온 엔트리 우선.
#   미해석이면 입력값 그대로(별도 행으로 남는다).
# 공백 집합 = JS 의 \s · String.prototype.trim 과 동일(파이썬 \s 는 ﻿ 를 빼고 \x1c-\x1f·\x85 를 더 포함해 다름).
_JS_WS = "\t\n\v\f\r    -     　﻿"
_JS_WS_RUN = re.compile(f"[{_JS_WS}]+")
_JS_WS_EDGE = re.compile(f"^[{_JS_WS}]+|[{_JS_WS}]+$")


def _js_trim(s) -> str:
    return _JS_WS_EDGE.sub("", str(s if s is not None else ""))


def normalize_map_key(s) -> str:
    return unicodedata.normalize("NFC", _JS_WS_RUN.sub("", _js_trim(s).lower()))


def _build_map_lookups():
    exact, norm = {}, {}
    for m in MAPS_DATA:
        for f in [m.get("ko"), m.get("en"), *(m.get("aliases") or [])]:
            if f and f not in exact:
                exact[f] = m
        for f in [m.get("ko"), m.get("en"), m.get("zh"), *(m.get("aliases") or []), *(m.get("mapTypeData") or {})]:
            k = normalize_map_key(f)
            if k and k not in norm:
                norm[k] = m
    return exact, norm


_MAP_LOOKUP_EXACT, _MAP_LOOKUP_NORM = _build_map_lookups()


def resolve_map_entry(name):
    """어떤 표기든 maps.json 엔트리로 해석. 없으면 None."""
    raw = _js_trim(name)
    if not raw:
        return None
    return _MAP_LOOKUP_EXACT.get(raw) or _MAP_LOOKUP_NORM.get(normalize_map_key(raw))


def canonical_map_name(name):
    """집계 키용 정본 맵명(ko). 미해석이면 입력값 그대로."""
    entry = resolve_map_entry(name)
    return (entry or {}).get("ko") or name

# ── 밴픽 파생 ───────────────────────────────────────────────────────────────
# 표시 순서 = banpick.order(STEP 3B 도입)로 정렬. 파생 dict 은 order 를 제외해
# 기존 구조({id,name,role}/{id,name,type})를 보존한다(덤프 diff-0).
BANPICK_HEROES: list = [
    {_k: _v for _k, _v in _h["banpick"].items() if _k != "order"}
    for _h in sorted((_x for _x in HEROES_DATA if _x.get("banpick")), key=lambda _x: _x["banpick"].get("order", 0))
]
BANPICK_MAPS: list = [
    {_k: _v for _k, _v in _m["banpick"].items() if _k != "order"}
    for _m in sorted((_x for _x in MAPS_DATA if _x.get("banpick")), key=lambda _x: _x["banpick"].get("order", 0))
]

# ── 선수 별칭 파생 ──────────────────────────────────────────────────────────
# players.json: {"playerAliases": {정본명: [별칭...]}}. 부계정·개명 시 여기에 별칭만
# 추가하면 파서(normalize_player_name)가 저장 직전에 정본명으로 흡수한다(영웅 별칭과 별개).
# 공개판 기본은 빈 사전. "playerAliases" 키 부재 시 {}로 처리하고,
# "_"로 시작하는 키(_comment 등)는 무시한다.
_PLAYERS_DOC = _load("players.json")
PLAYER_ALIASES: dict = {
    _canon: _aliases
    for _canon, _aliases in _PLAYERS_DOC.get("playerAliases", {}).items()
    if not _canon.startswith("_")
}

# 역방향 조회 맵: casefold(별칭|정본) → 정본. 정본 자신도 키로 넣어
# 대소문자 변형(NAME/name 등)을 사전 추가 없이 흡수한다.
PLAYER_NAME_LOOKUP: dict = {}
for _canon, _aliases in PLAYER_ALIASES.items():
    _cf = _canon.casefold()
    if _cf in PLAYER_NAME_LOOKUP and PLAYER_NAME_LOOKUP[_cf] != _canon:
        raise ValueError(f"players.json 정본명 casefold 충돌: {_canon} vs {PLAYER_NAME_LOOKUP[_cf]}")
    PLAYER_NAME_LOOKUP[_cf] = _canon
    for _a in _aliases:
        _acf = _a.casefold()
        if _acf in PLAYER_NAME_LOOKUP and PLAYER_NAME_LOOKUP[_acf] != _canon:
            raise ValueError(f"players.json 별칭 충돌: {_a} → {_canon} vs {PLAYER_NAME_LOOKUP[_acf]}")
        PLAYER_NAME_LOOKUP[_acf] = _canon

# 정리(모듈 네임스페이스 오염 방지)
del _h, _k, _v, _forms, _role, _m
for _n in ("_canon", "_aliases", "_cf", "_a", "_acf"):
    if _n in dir():
        del globals()[_n]
del _n
