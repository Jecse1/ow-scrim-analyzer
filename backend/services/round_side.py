# -*- coding: utf-8 -*-
"""round_side.py — 공수(attacker) 판정 공용 유틸.

공수는 반드시 "판정 시각 이전 마지막 round_start의 attacker"(시각 기반)로 구한다.
round_id→attacker 딕셔너리 방식은 쓰지 않는다: 파서가 경계 시각의 round_start 를 이전 라운드에
넣던 시기(services/stats.py 라운드 배정 수정 전 — rebuild-db 하지 않은 DB)에는 round_start 의
round_id 가 한 라운드 뒤처져 공수가 뒤집힌다. 시각 기반은 수정 전·후 DB 모두에서 같은 답을 낸다.

공수 개념이 있는 모드만 라벨링한다(혼합·화물·격돌). 플래시포인트·쟁탈·밀기는
attacker 값이 있어도 '무'로 고정한다(플래시포인트는 R1 attacker가 전파되는 문제,
쟁탈·밀기는 공수 개념 없음).
"""

# 공수 개념이 있는 모드 (resolve_map_type ko/en 표기)
SIDE_MODES = {'혼합', 'Hybrid', '화물', '호위', 'Escort', '격돌', 'Clash'}


def load_round_starts(cur, match_id):
    """매치의 round_start (timestamp, attacker) 시각 오름차순 리스트."""
    return sorted(
        (r[0], (r[1] or '').strip())
        for r in cur.execute(
            "SELECT timestamp, attacker FROM events "
            "WHERE match_id=? AND event_type='round_start'", (match_id,))
    )


def attacker_at(rs_list, ts):
    """ts 이전(이하) 마지막 round_start의 attacker. 없으면 ''."""
    a = ''
    for t_, a_ in rs_list:
        if t_ <= ts:
            a = a_
        else:
            break
    return a


def side_label(mode, team, t1, t2, rs_list, ts):
    """팀 `team` 관점 공수 라벨('공'/'수'/'무').
    mode가 SIDE_MODES 밖이면 항상 '무'."""
    if (mode or '').strip() not in SIDE_MODES:
        return '무'
    a = attacker_at(rs_list, ts)
    if a == team:
        return '공'
    if a in (t1, t2):
        return '수'
    return '무'
