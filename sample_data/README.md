# Sample data / 샘플 데이터

`sample_match_map1.txt` is a **single anonymized real match log** — one Overwatch
Workshop scrim on one map (Control — Antarctic Peninsula). Player names are replaced
with `Player1`–`Player10`, teams are the positional `1팀`/`2팀`, and all real dates,
times, and team/personal identifiers have been removed; only match-relative
timestamps (`[hh:mm:ss]`) and gameplay stats remain. Use it to try the app end-to-end
without your own logs.

`sample_match_map1.txt` 는 **실제 매치 로그 1건을 익명화한** 파일입니다 — 한 맵(쟁탈 ·
남극 반도)의 오버워치 워크숍 스크림 1경기입니다. 선수명은 `Player1`~`Player10` 으로,
팀은 위치 기준 `1팀`/`2팀` 으로 치환했으며 실제 날짜·시각·팀·개인 식별정보는 모두
제거했습니다. 남은 것은 매치 경과 타임스탬프(`[hh:mm:ss]`)와 게임플레이 수치뿐입니다.
자신의 로그 없이도 앱을 처음부터 끝까지 체험할 때 사용하세요.

## How to use / 사용법

1. Start the backend and frontend (see the main [README](../README.md)).
   백엔드와 프론트엔드를 실행합니다 (메인 [README](../README.md) 참고).
2. In the app, register a scrim session (upload / "스크림 등록"):
   앱에서 스크림 세션을 등록합니다:
   - **Session name / 세션명**: e.g. `250101-Team B` (any label; date is illustrative)
   - **Team 1 / 1팀**: `Team B`  · **Team 2 / 2팀**: `Team A`
     > In the log, `1팀`/`2팀` are positional. Map `2팀` to your base team
     > (`Team A`, the default in `frontend/src/config.js`) so the "us" view works.
     > 로그의 `1팀`/`2팀` 은 위치 기준입니다. "우리 시점"이 동작하도록 `2팀` 을 기준 팀
     > (`Team A`, `frontend/src/config.js` 기본값)에 맞추세요.
   - **Map / 맵**: `남극반도` (Antarctic Peninsula)
3. Upload `sample_match_map1.txt` as the match log.
   `sample_match_map1.txt` 를 매치 로그로 업로드합니다.
4. Open the session → the analysis tabs (fights, ultimates, first fight, etc.)
   will populate. 세션을 열면 분석 탭들이 채워집니다.

## Log format / 로그 형식

Each line is `[hh:mm:ss] ,<event_type>,<seconds>,<fields...>`. Events include
`match_start`, `round_start/end`, `hero_spawn/swap`, `ultimate_charged/start/end`,
`player_stat`, and eliminations (masked as `****` in the raw Workshop export).
Team slots are the positional `1팀` / `2팀`; team names come from the scrim
registration form, not the log file.

각 줄은 `[hh:mm:ss] ,<이벤트>,<초>,<필드...>` 형식입니다. 팀은 위치 기준 `1팀`/`2팀`
이며, 팀 이름은 로그가 아니라 스크림 등록 폼에서 입력합니다.
