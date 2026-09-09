# 게임 데이터는 game_data(SSOT: heroes.json, maps.json)에서 파생한다.
# 기존 HERO_CSV/MAP_CSV 리터럴 정의는 제거하고 로더 파생값을 쓴다(id/name/role/type 동일).
# 승인 델타(A): banpick 에 dmon(디몬,Tank) 1건 추가 — game_data/heroes.json 에 반영됨.
import os
import sys

_BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _BACKEND not in sys.path:
    sys.path.insert(0, _BACKEND)

from game_data import BANPICK_HEROES as HEROES, BANPICK_MAPS as MAPS  # noqa: E402

HERO_BY_ID = {h["id"]: h for h in HEROES}
MAP_BY_ID = {m["id"]: m for m in MAPS}


def hero_role(hero_id):
    h = HERO_BY_ID.get(hero_id)
    return h["role"] if h else None


def map_exists(map_id):
    return map_id in MAP_BY_ID
