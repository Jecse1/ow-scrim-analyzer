# 선수 개명·부계정 처리 절차

선수가 닉네임을 바꾸거나 부계정으로 스크림에 참가하면 통계가 두 사람으로 갈라진다.
아래 두 단계로 정본명 하나로 합친다.

## 1. 별칭 사전에 추가 (앞으로 들어올 로그)

`backend/game_data/players.json`의 `playerAliases`에 별칭을 추가한다.

```json
{ "playerAliases": { "정본명": ["별칭1", "별칭2"] } }
```

- 파서(`parsers/log_parser.py`의 `normalize_player_name`)가 저장 직전에 casefold 일치로
  별칭 → 정본명 치환한다. 정본명 자신도 조회 키에 들어가므로 대소문자 변형(NAME/name)은
  사전 추가 없이 자동 흡수된다.
- 정본명·별칭이 casefold 기준으로 다른 선수와 충돌하면 로더가 기동 시 ValueError를 던진다.
- `_`로 시작하는 키(`_comment` 등)는 무시된다.

## 2. 기존 DB 행 치환 (이미 저장된 세션)

백엔드 중지 → DB 백업 → 트랜잭션으로 아래 3개 UPDATE를 별칭마다 실행,
변경 행수가 사전 실측 합계와 일치할 때만 COMMIT. `:team`은 자기 팀 식별자(BASE_TEAM).

```sql
UPDATE player_stats SET player_name=:canon WHERE player_name=:alias AND team_name=:team;
UPDATE events SET player_name=:canon WHERE player_name=:alias AND player_team=:team;
UPDATE events SET target_name=:canon WHERE target_name=:alias AND target_team=:team;
```

선수명이 저장되는 컬럼은 위 3개가 전부다(다른 events 컬럼 attacker/winner/team 등은 팀명).
치환 후 별칭 grep 0건, 정본 행수 = 치환 전 정본+별칭 합계인지 확인한다.
