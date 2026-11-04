# TODO

- MAP_EN2KO 커버리지 확장: 현재 6/32 맵만 영→한 역매핑 존재, 나머지 26개 보강 필요.
- log_normalizer.py 파이프라인 미연결: 업로드 경로에서 호출되지 않음 — 연결 여부 결정 필요.
- remech(디바 재소환 등) 이벤트 파싱 미지원: 파서 이벤트 타입 추가 검토.
- VOD 링크 생성 함수 스킴 검사: `buildVideoLink`·`getYouTubeLink`·`sceneVodUrl`·수기 매치 VOD 링크(`MatchStats.jsx`)도 `isSafeVideoUrl` 로 거르기(현재는 `openVod`·`window.open` 경로만, 가운데 클릭·href 는 미검사).
- 화면별 승률 분모 정의 통일: OverallStats(전체 경기 수 분모)·MapAnalysisStats(무승부·미확정 포함)를 요약 API(definitions_version 2: W+L+D, 미확정 제외)와 맞출지 결정.
