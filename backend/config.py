# -*- coding: utf-8 -*-
"""config.py — 상수·경로·게임데이터 파생(리팩토링 2단계 분리). 본문·값 무변경(이동만).

main.py 에서 이동. main.py 는 하위호환을 위해 이 모듈의 이름을 re-export 한다.
sys.path 삽입은 main.py 한 곳에만 유지(config 는 backend 가 경로에 있다고 가정).
"""
import os

# 기준 팀(우리 팀) 이름. 배포마다 환경변수 BASE_TEAM 으로 변경(예: export BASE_TEAM="Team A").
# 프론트엔드의 frontend/src/config.js BASE_TEAM 값과 동일하게 맞춰야 "우리 시점"이 동작한다.
BASE_TEAM = os.getenv("BASE_TEAM", "Team A")

# --- 상수 및 매핑 데이터 ---
# 영웅/맵/역할/EN→KO 게임 데이터는 game_data(SSOT: heroes.json, maps.json)에서 파생한다.
# 아래 변수명·값은 기존과 동일(로더가 재구성). 사용처 무수정.
from game_data import (
    KOREAN_HERO_MAP,
    TANKS,
    SUPPORTS,
    MAP_TYPE_DATA,
    CONTROL_MAP_KEYWORDS,
    FIGHTLAB_TANKS as _FIGHTLAB_TANKS,
    FIGHTLAB_SUPPORTS as _FIGHTLAB_SUPPORTS,
    FIGHTLAB_DAMAGE as _FIGHTLAB_DAMAGE,
)

PLAYER_ROLE_OVERRIDES = {
    "우양": 2,     # support
    "벤데타": 1,   # dps
}

# KOREAN_HERO_MAP, MAP_TYPE_DATA 는 game_data 로더에서 파생(위 import 참조).

NUMERIC_FIELDS = [
    "eliminations", "final_blows", "deaths",
    "all_damage_dealt", "barrier_damage_dealt", "hero_damage_dealt",
    "healing_dealt", "healing_received", "self_healing",
    "damage_taken", "damage_blocked", "defensive_assists", "offensive_assists",
    "ultimates_earned", "ultimates_used", "multikill_best", "multikills",
    "solo_kills", "objective_kills", "environmental_kills", "environmental_deaths",
    "hero_time_played"
]

FIGHT_QUIET_GAP_SEC = 20
# CONTROL_MAP_KEYWORDS 는 game_data 로더에서 파생(위 import 참조).

DATA_FILE = "scrim_data.json"
ROW_DATA_DIR = "scrim_rowdata_log"

if not os.path.exists(ROW_DATA_DIR):
    os.makedirs(ROW_DATA_DIR)

# DB에 저장된 맵명은 공백이 없는 경우가 많아(예: "왕의길", "서킷로얄") MAP_TYPE_DATA 키("왕의 길")와
# 직접 매칭되지 않는다. 공백을 제거한 정규화 lookup 테이블을 한 번만 만들어 둔다. (MAP_TYPE_DATA 자체는 불변)
_MAP_TYPE_DATA_NOSPACE = {k.replace(" ", ""): v for k, v in MAP_TYPE_DATA.items()}
# 플래시포인트/밀기 = 매치 단위(첫 한타 1개), 그 외 = 라운드 단위. ko/en 값 모두 포함.
_MATCH_LEVEL_MAP_TYPES = {"밀기", "Push", "플래시포인트", "Flashpoint"}

# 첫 킬 후 이 시간(초) 내 반대편 킬 발생 = "트레이드됨"
TRADE_WINDOW_SEC = 5

# 영웅 → 역할. 프론트 App.jsx heroRole과 동일 분류 + 신영웅.
# (신영웅 역할 근거: player_stats 집계 — 도미나 blocked/10≈24.8k→탱커, 미즈키 heal/10≈10k·
#  제트팩 캣 heal/10≈7.8k→지원, 벤데타/시온/안란/엠레/시에라/벤처/프레야 heal·blocked≈0→딜러)
# 매핑에 없는 영웅은 "other"로 안전 처리.
# _FIGHTLAB_TANKS/SUPPORTS/DAMAGE 는 game_data 로더에서 파생(파일 상단 import 참조).
# HERO_ROLE_DATA 는 아래 루프로 동일하게 구성한다(변경 없음).
HERO_ROLE_DATA: dict = {}
for _h in _FIGHTLAB_TANKS:
    HERO_ROLE_DATA[_h] = "tank"
for _h in _FIGHTLAB_SUPPORTS:
    HERO_ROLE_DATA[_h] = "support"
for _h in _FIGHTLAB_DAMAGE:
    HERO_ROLE_DATA[_h] = "damage"

# 백분위 풀 포함 최소 표본(프론트 안내용 상수 — 응답 meta로 내려줌)
MIN_SAMPLE_FOR_PERCENTILE_FIGHTS = 20   # 한타 지표: 최소 20한타
MIN_SAMPLE_FOR_PERCENTILE_ROUNDS = 10   # 라운드 지표: 최소 10라운드
PERCENTILE_MIN_POOL = 8                 # 풀 최소 인원
