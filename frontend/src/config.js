// ─────────────────────────────────────────────────────────────────────────────
// 앱 전역 설정. 배포/팀에 맞게 이 파일만 수정하면 됩니다.
// App-wide config. Edit only this file to rebrand or set your team name.
// ─────────────────────────────────────────────────────────────────────────────

// 앱 이름 (헤더·문서 제목에 표시) / App name shown in the header.
export const APP_NAME = "Scrim Analyzer";

// 기준 팀(우리 팀) 이름. 로그의 team1/team2 중 이 이름과 일치하는 쪽을 "우리"로 표시합니다.
// Base team (your team). Rows whose team name equals this are highlighted as "us".
// 백엔드도 동일 이름을 사용하세요 (환경변수 BASE_TEAM). Keep this in sync with the
// backend BASE_TEAM environment variable.
export const BASE_TEAM = "Team A";
