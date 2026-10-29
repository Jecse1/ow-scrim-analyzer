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

_BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.path.abspath(os.environ.get("ABILITY_DB_PATH") or os.path.join(_BACKEND_DIR, "data", "ability_uses.db"))

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
    uses = data.get("uses") or []
    con = _connect()
    try:
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
        return n
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
