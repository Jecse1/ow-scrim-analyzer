# -*- coding: utf-8 -*-
"""db/ability_store.py — 스킬 사용(ability_1/2_used) 저장소. scrim.db 와 분리된 SQLite 파일.

원문 로그에서 언제든 다시 만들 수 있는 파생 데이터라 git·서버 데이터 커밋 대상이 아니다(.gitignore).
경로: ABILITY_DB_PATH(미설정 시 backend/data/ability_uses.db). 테스트는 backend/conftest.py 가 임시 경로를 준다.
scrim.db 의 ORM·로더와 연결하지 않는다(relationship 없음) — 기존 응답·캐시와 무관.

테이블:
  ability_matches   매치 1행. mkey(정수 키) ↔ match_id, has_log(원문에 스킬 줄이 있었는지 — 0이면 "기록 없음"),
                    n1/n2(저장한 스킬1/스킬2 수). 이 행이 있으면 그 매치는 처리 완료(백필 멱등 표식).
  ability_uses      사용 1행. 기본 키(선수·영웅·슬롯·mkey·게임시간) 순서로 저장(WITHOUT ROWID) — 선수→영웅→스킬
                    조회가 곧 키 순서. 매치 단위 정리는 ix_ability_uses_mkey.
                    is_setup = 준비 시간(스폰룸) 사용, copy_hero = 에코 복제 중이면 복제한 영웅(아니면 NULL).
  ability_hero_time 매치·선수·영웅별 원문 플레이 시간(초) — 10분당 사용 수의 분모(player_stats 의 주 영웅 귀속 시간과 다름).
쓰기는 매치마다 짧은 트랜잭션 1개. 모든 함수는 동기 — 호출부가 스레드풀에서 부른다(services/abilities.py).
"""
import os
import sqlite3
import threading
import time

_BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.path.abspath(os.environ.get("ABILITY_DB_PATH") or os.path.join(_BACKEND_DIR, "data", "ability_uses.db"))
LAST_TX_MS = 0.0   # 직전 replace_match 의 쓰기 트랜잭션(BEGIN IMMEDIATE → COMMIT) 시간 — 백필 잠금 실측용
# 저장소 세대: 쓰기(교체·정리)마다 +1. 조회 응답의 ETag·선택지 캐시 키에 응답 캐시 세대와 함께 쓴다
# (백필은 응답 캐시를 무효화하지 않으므로 이 세대가 없으면 304 가 낡은 내용을 돌려줄 수 있다). 프로세스 안에서만 의미.
GEN = 0
_GEN_LOCK = threading.Lock()


def _bump() -> None:
    global GEN
    with _GEN_LOCK:
        GEN += 1

_SCHEMA = """
CREATE TABLE IF NOT EXISTS ability_matches (
    mkey INTEGER PRIMARY KEY,
    match_id VARCHAR NOT NULL UNIQUE,
    has_log INTEGER NOT NULL,
    n1 INTEGER NOT NULL DEFAULT 0,
    n2 INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS ability_uses (
    player_name VARCHAR NOT NULL,
    hero_name VARCHAR NOT NULL,
    slot INTEGER NOT NULL,
    mkey INTEGER NOT NULL,
    game_time FLOAT NOT NULL,
    round_no INTEGER,
    timestamp FLOAT NOT NULL,
    team_slot INTEGER NOT NULL,
    is_setup INTEGER NOT NULL DEFAULT 0,
    copy_hero VARCHAR,
    PRIMARY KEY (player_name, hero_name, slot, mkey, game_time)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS ix_ability_uses_mkey ON ability_uses(mkey);
CREATE TABLE IF NOT EXISTS ability_hero_time (
    mkey INTEGER NOT NULL,
    team_slot INTEGER NOT NULL,
    player_name VARCHAR NOT NULL,
    hero_name VARCHAR NOT NULL,
    seconds FLOAT NOT NULL,
    PRIMARY KEY (mkey, team_slot, player_name, hero_name)
) WITHOUT ROWID;
"""


def _connect() -> sqlite3.Connection:
    # isolation_level=None: BEGIN/COMMIT 를 직접 써서 트랜잭션 범위를 매치 1개로 고정한다.
    return sqlite3.connect(DB_PATH, timeout=10, isolation_level=None)


def init_store() -> int:
    """파일·테이블을 멱등 생성. 반환 = 처리된 매치 수(0 이면 비어 있음)."""
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    con = _connect()
    try:
        con.executescript(_SCHEMA)
        return con.execute("SELECT COUNT(*) FROM ability_matches").fetchone()[0]
    finally:
        con.close()


def _forget(con: sqlite3.Connection, mkey: int) -> None:
    con.execute("DELETE FROM ability_uses WHERE mkey = ?", (mkey,))
    con.execute("DELETE FROM ability_hero_time WHERE mkey = ?", (mkey,))


def replace_match(match_id: str, data: dict) -> int:
    """매치 1개의 스킬 데이터를 통째로 바꾼다(업로드·로그 교체·백필 공용). 반환 = 저장한 사용 수."""
    global LAST_TX_MS
    uses = data.get("uses") or []
    con = _connect()
    try:
        t0 = time.perf_counter()
        con.execute("BEGIN IMMEDIATE")
        row = con.execute("SELECT mkey FROM ability_matches WHERE match_id = ?", (match_id,)).fetchone()
        n1 = sum(1 for u in uses if u["slot"] == 1)
        n2 = len(uses) - n1
        if row:
            mkey = row[0]
            _forget(con, mkey)
            con.execute("UPDATE ability_matches SET has_log = ?, n1 = ?, n2 = ? WHERE mkey = ?",
                        (int(bool(data.get("has_log"))), n1, n2, mkey))
        else:
            mkey = con.execute("INSERT INTO ability_matches(match_id, has_log, n1, n2) VALUES (?,?,?,?)",
                               (match_id, int(bool(data.get("has_log"))), n1, n2)).lastrowid
        con.executemany(
            "INSERT OR IGNORE INTO ability_uses(player_name, hero_name, slot, mkey, game_time, round_no, timestamp, "
            "team_slot, is_setup, copy_hero) VALUES (?,?,?,?,?,?,?,?,?,?)",
            [(u["player_name"], u["hero_name"], u["slot"], mkey, u["game_time"], u.get("round_no"), u["timestamp"],
              u["team_slot"], int(bool(u.get("is_setup"))), u.get("copy_hero")) for u in uses])
        con.executemany(
            "INSERT OR REPLACE INTO ability_hero_time(mkey, team_slot, player_name, hero_name, seconds) VALUES (?,?,?,?,?)",
            [(mkey, h["team_slot"], h["player_name"], h["hero_name"], h["seconds"]) for h in (data.get("hero_time") or [])])
        con.execute("COMMIT")
        LAST_TX_MS = (time.perf_counter() - t0) * 1000
        _bump()
        return len(uses)
    except BaseException:
        if con.in_transaction:
            con.execute("ROLLBACK")
        raise
    finally:
        con.close()


def forget_matches(match_ids) -> int:
    """매치 삭제 시 스킬 데이터 정리(매치 행까지 지운다 — 다시 살아나면 백필이 새로 채운다). 반환 = 지운 매치 수."""
    ids = [m for m in (match_ids or []) if m]
    if not ids:
        return 0
    con = _connect()
    try:
        n = 0
        for mid in ids:
            con.execute("BEGIN IMMEDIATE")
            row = con.execute("SELECT mkey FROM ability_matches WHERE match_id = ?", (mid,)).fetchone()
            if row:
                _forget(con, row[0])
                con.execute("DELETE FROM ability_matches WHERE mkey = ?", (row[0],))
                n += 1
            con.execute("COMMIT")
        if n:
            _bump()
        return n
    finally:
        con.close()


def processed_match_ids() -> set:
    """이미 처리한(행이 있는) 매치 id — 백필이 건너뛸 대상."""
    con = _connect()
    try:
        return {r[0] for r in con.execute("SELECT match_id FROM ability_matches")}
    finally:
        con.close()


def match_status(match_id: str) -> "dict | None":
    """매치의 저장 상태(테스트·검증용): has_log, n1, n2, stored(실제 행 수). 처리 전이면 None."""
    con = _connect()
    try:
        row = con.execute("SELECT mkey, has_log, n1, n2 FROM ability_matches WHERE match_id = ?", (match_id,)).fetchone()
        if not row:
            return None
        stored = con.execute("SELECT COUNT(*) FROM ability_uses WHERE mkey = ?", (row[0],)).fetchone()[0]
        return {"has_log": bool(row[1]), "n1": row[2], "n2": row[3], "stored": stored}
    finally:
        con.close()


# ── 조회(routers/abilities.py · services/ability_query.py) ──────────────────────

def _in(col: str, values) -> tuple:
    vals = list(values)
    return f"{col} IN ({','.join('?' * len(vals))})", vals


def match_keys() -> dict:
    """match_id → (mkey, has_log)."""
    con = _connect()
    try:
        return {r[0]: (r[1], bool(r[2])) for r in con.execute("SELECT match_id, mkey, has_log FROM ability_matches")}
    finally:
        con.close()


def fetch_uses(players=None, heroes=None, slots=None) -> list:
    """에코 복제 중 행(copy_hero)을 뺀 사용 행. 인자는 정확 일치 목록(None = 제한 없음).
    반환 튜플: (player_name, hero_name, slot, mkey, game_time, round_no, timestamp, team_slot, is_setup)."""
    where, args = ["copy_hero IS NULL"], []
    for col, vals in (("player_name", players), ("hero_name", heroes), ("slot", slots)):
        if vals is not None:
            if not vals:
                return []
            w, a = _in(col, vals)
            where.append(w)
            args += a
    con = _connect()
    try:
        return con.execute(
            "SELECT player_name, hero_name, slot, mkey, game_time, round_no, timestamp, team_slot, is_setup "
            f"FROM ability_uses WHERE {' AND '.join(where)}", args).fetchall()
    finally:
        con.close()


def hero_seconds(players=None, heroes=None) -> list:
    """(mkey, player_name, hero_name, seconds) — 원문 영웅별 플레이 시간."""
    where, args = [], []
    for col, vals in (("player_name", players), ("hero_name", heroes)):
        if vals is not None:
            if not vals:
                return []
            w, a = _in(col, vals)
            where.append(w)
            args += a
    con = _connect()
    try:
        return con.execute("SELECT mkey, player_name, hero_name, seconds FROM ability_hero_time"
                           + (f" WHERE {' AND '.join(where)}" if where else ""), args).fetchall()
    finally:
        con.close()


def use_counts() -> list:
    """(player_name, hero_name, slot, mkey, 횟수) — 에코 복제 중 행 제외. 선택지 집계용."""
    con = _connect()
    try:
        return con.execute("SELECT player_name, hero_name, slot, mkey, COUNT(*) FROM ability_uses "
                           "WHERE copy_hero IS NULL GROUP BY player_name, hero_name, slot, mkey").fetchall()
    finally:
        con.close()


def player_names() -> list:
    """원문 플레이 시간이 있는 선수 이름(검색의 선수 부분 일치 후보)."""
    con = _connect()
    try:
        return [r[0] for r in con.execute("SELECT DISTINCT player_name FROM ability_hero_time")]
    finally:
        con.close()
