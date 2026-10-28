# -*- coding: utf-8 -*-
"""db/stat_rows.py — 통계 캐시 미스 경로용 컬럼 SELECT 로더(ORM 객체 생성 없음).

fight-records·full-events·player-fight-stats·summary 가 매번 세션 전체를 selectinload 로 ORM 객체화하던 비용
(FLC 사본 기준 로드 시간의 ~80%, 메모리 증가의 대부분)을 Core select 행으로 대체한다.
routers/stats.py 와 routers/summary.py 가 같이 쓰므로 db/ 에 둔다(routers 간 import 금지).

반환 형태는 기존 payload 빌더가 ORM 객체에 하던 속성 접근을 그대로 받도록 맞춘다:
  세션·매치·라운드 = 컬럼 속성 + 요청한 관계 리스트(matches / rounds·pauses / events·player_stats)를 가진 RowObj,
  이벤트·선수 스탯 = Core Row 그대로(속성 접근 지원).
요청하지 않은 관계는 붙이지 않는다 — 빌더가 그 관계를 읽으면 빈 결과가 아니라 AttributeError 로 드러나게.

정렬은 ORM 관계 로드와 같은 결과가 되도록 정한다:
  sessions date DESC, id DESC / matches match_index / rounds round_number / events timestamp (모델 relationship order_by),
  같은 값이면 rowid 순 — selectinload 가 부모 키 인덱스로 읽은 뒤 정렬(SQLite 정렬은 입력 순서를 보존)하는 것과 같다.
  order_by 가 없는 관계(pauses·player_stats)는 rowid 순.
값 변환은 Core 가 같은 컬럼 타입으로 하므로 ORM 속성과 같다(DateTime 등).
soft delete 된 세션·매치는 SQL 에서 제외한다(빌더들이 모두 건너뛰는 행 — 출력 무관).
"""
from collections import defaultdict

from sqlalchemy import literal_column, select

from db.models import Event, Match, Pause, PlayerStat, Round, Session

# _db_event_to_dict 가 읽는 컬럼(+ 묶음 키 round_id)
_EVENT_COLS = (
    "round_id", "event_type", "timestamp", "game_timestamp",
    "player_name", "player_team", "player_hero", "player_hero_img", "ability",
    "target_name", "target_team", "target_hero", "target_hero_img",
    "round_number", "attacker", "winner", "description", "score_t1", "score_t2",
    "capturing_team", "new_index", "old_index", "team",
)


class RowObj:
    """Core Row 의 컬럼을 속성으로 + 관계 리스트를 키워드로 붙인 가벼운 그릇(ORM 객체 대용)."""

    def __init__(self, row, **rel):
        self.__dict__.update(row._mapping)
        self.__dict__.update(rel)


def _rowid(table):
    return literal_column(f"{table.name}.rowid")


def _live(stmt):
    """soft delete 되지 않은 세션의 soft delete 되지 않은 매치로 한정(matches·sessions 가 조인돼 있어야 함)."""
    return stmt.where(Session.deleted_at.is_(None), Match.deleted_at.is_(None))


async def load_stat_sessions(db, *, events: bool = True, pauses: bool = False,
                             player_stats: bool = False) -> list:
    """살아 있는 세션(date DESC, id DESC) → .matches(살아 있는 매치, 수기 포함) → .rounds(→ .events / .player_stats), .pauses.
    db: AsyncSession. 관계는 인자로 요청한 것만 붙인다."""
    S, M, R = Session.__table__, Match.__table__, Round.__table__

    sessions = (await db.execute(
        select(S).where(S.c.deleted_at.is_(None)).order_by(S.c.date.desc(), S.c.id.desc())
    )).all()
    matches = (await db.execute(
        _live(select(M).join(S, S.c.id == M.c.session_id)).order_by(M.c.session_id, M.c.match_index, _rowid(M))
    )).all()
    rounds = (await db.execute(
        _live(select(R).join(M, M.c.id == R.c.match_id).join(S, S.c.id == M.c.session_id))
        .order_by(R.c.match_id, R.c.round_number, _rowid(R))
    )).all()

    ev_by_round = ps_by_round = pz_by_match = None
    if events:
        E = Event.__table__
        ev_by_round = defaultdict(list)
        for e in (await db.execute(
            _live(select(*(E.c[c] for c in _EVENT_COLS))
                  .select_from(E).join(R, R.c.id == E.c.round_id)
                  .join(M, M.c.id == R.c.match_id).join(S, S.c.id == M.c.session_id))
            .order_by(E.c.round_id, E.c.timestamp, E.c.id)
        )).all():
            ev_by_round[e.round_id].append(e)
    if player_stats:
        P = PlayerStat.__table__
        ps_by_round = defaultdict(list)
        for p in (await db.execute(
            _live(select(P).join(R, R.c.id == P.c.round_id)
                  .join(M, M.c.id == R.c.match_id).join(S, S.c.id == M.c.session_id))
            .order_by(P.c.round_id, P.c.id)
        )).all():
            ps_by_round[p.round_id].append(p)
    if pauses:
        Z = Pause.__table__
        pz_by_match = defaultdict(list)
        for z in (await db.execute(
            _live(select(Z).join(M, M.c.id == Z.c.match_id).join(S, S.c.id == M.c.session_id))
            .order_by(Z.c.match_id, Z.c.id)
        )).all():
            pz_by_match[z.match_id].append(RowObj(z))

    rd_by_match = defaultdict(list)
    for r in rounds:
        rel = {}
        if ev_by_round is not None:
            rel["events"] = ev_by_round.get(r.id, [])
        if ps_by_round is not None:
            rel["player_stats"] = ps_by_round.get(r.id, [])
        rd_by_match[r.match_id].append(RowObj(r, **rel))

    m_by_sess = defaultdict(list)
    for m in matches:
        rel = {"rounds": rd_by_match.get(m.id, [])}
        if pz_by_match is not None:
            rel["pauses"] = pz_by_match.get(m.id, [])
        m_by_sess[m.session_id].append(RowObj(m, **rel))

    return [RowObj(s, matches=m_by_sess.get(s.id, [])) for s in sessions]
