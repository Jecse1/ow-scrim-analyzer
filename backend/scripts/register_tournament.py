# -*- coding: utf-8 -*-
"""scripts/register_tournament.py — 대회(공식 경기) 결과를 수동 등록 API 로 등록한다.

경기(BO3/5/7) 1개 = 세션 1개(kind='tournament', source_url), 맵 = 수기 매치(source='manual', 승자 명시).
로그는 없다 — 맵·맵 승패·출처 URL 만. 세션 종류 분리는 services/session_kind.py.

멱등: GET /api/scrims?kind=tournament 의 (날짜·상대·source_url) 이 입력과 같으면 건너뛴다.
같은 JSON 을 다시 실행해도 0건 추가. --dry-run 은 조회만 하고 등록 요청 본문 요약을 출력한다.

입력 JSON:
  {
    "base_team": "Team A",
    "matches": [
      {"date": "2026-03-21", "start_hour": "16", "end_hour": "18", "opponent": "Team Z",
       "source_url": "https://example.org/wiki/League#Week_1",
       "scrim_name": "260321-Team Z",            (선택, 기본 YYMMDD-상대)
       "video_url": "https://youtu.be/xxxx",      (선택, 맵마다 같은 값으로 저장)
       "maps": [
         {"map": "부산", "winner": "Team A", "score": "2:0"},
         {"map": "이스페란사", "winner": "Team Z", "score": "63.70:110.47"}
       ]}
    ]
  }
  score 는 base_team:상대 순. 두 값이 정수면 score_t1/t2 로, 아니면(밀기 거리 등) 0:0 으로 두고
  원문은 매치 result 에 남긴다(승자는 winner 로 명시하므로 판정과 무관).

사용(backend/ 에서, 서버에선 localhost API 로):
  python scripts/register_tournament.py --input tournament.json --dry-run
  python scripts/register_tournament.py --input tournament.json --base-url http://127.0.0.1:8000
종료 코드: 0 = 성공(추가 0건 포함), 1 = 입력 오류 또는 등록 실패가 있음.
"""
import argparse
import json
import re
import sys
import urllib.error
import urllib.request
from datetime import datetime
from urllib.parse import urlsplit

KIND = "tournament"
_HOUR = re.compile(r"^\d{1,2}$")
_INT = re.compile(r"^\d+$")


def _is_http_url(value) -> bool:
    if not isinstance(value, str) or not value.strip():
        return False
    u = urlsplit(value.strip())
    return u.scheme in ("http", "https") and bool(u.netloc)


def validate(doc) -> list:
    """입력 오류 목록(빈 목록 = 통과). 하나라도 있으면 아무것도 등록하지 않는다."""
    errors = []
    base = (doc.get("base_team") or "").strip() if isinstance(doc, dict) else ""
    if not base:
        return ["base_team 없음"]
    matches = doc.get("matches")
    if not isinstance(matches, list) or not matches:
        return ["matches 없음"]
    seen = set()
    for i, m in enumerate(matches, 1):
        where = f"#{i}"
        try:
            datetime.strptime(m.get("date", ""), "%Y-%m-%d")
        except (TypeError, ValueError):
            errors.append(f"{where}: date 형식(YYYY-MM-DD)")
        for k in ("start_hour", "end_hour"):
            v = str(m.get(k, ""))
            if not _HOUR.match(v) or int(v) > 23:
                errors.append(f"{where}: {k} 00~23")
        opp = (m.get("opponent") or "").strip()
        if not opp or opp == base:
            errors.append(f"{where}: opponent 없음 또는 base_team 과 같음")
        if not _is_http_url(m.get("source_url")):
            errors.append(f"{where}: source_url 은 http(s) URL")
        if m.get("video_url") and not _is_http_url(m.get("video_url")):
            errors.append(f"{where}: video_url 은 http(s) URL")
        maps = m.get("maps")
        if not isinstance(maps, list) or not maps:
            errors.append(f"{where}: maps 없음")
            maps = []
        for j, mp in enumerate(maps, 1):
            if not (mp.get("map") or "").strip():
                errors.append(f"{where} 맵{j}: map 없음")
            if mp.get("winner") not in (base, opp):
                errors.append(f"{where} 맵{j}: winner 는 base_team 또는 opponent")
            if len(str(mp.get("score", "")).split(":")) != 2:
                errors.append(f"{where} 맵{j}: score 는 'a:b'")
        key = (m.get("date"), opp, (m.get("source_url") or "").strip())
        if key in seen:
            errors.append(f"{where}: 입력 안에서 (날짜·상대·source_url) 중복")
        seen.add(key)
    return errors


def session_name(m) -> str:
    if (m.get("scrim_name") or "").strip():
        return m["scrim_name"].strip()
    return f"{m['date'][2:4]}{m['date'][5:7]}{m['date'][8:10]}-{m['opponent'].strip()}"


def build_body(base: str, m) -> dict:
    """수동 등록 API 본문. 1팀 = base_team, 2팀 = 상대."""
    opp = m["opponent"].strip()
    rows = []
    for mp in m["maps"]:
        a, b = (x.strip() for x in str(mp["score"]).split(":"))
        ints = bool(_INT.match(a) and _INT.match(b))
        rows.append({
            "map_name": mp["map"].strip(), "team1Name": base, "team2Name": opp,
            "start_time": "00:00", "end_time": "00:00",
            "result": f"{a}:{b}", "source": "manual", "winner": mp["winner"],
            "score_t1": int(a) if ints else 0, "score_t2": int(b) if ints else 0,
            "videoUrl": (m.get("video_url") or "").strip(),
        })
    return {
        "scrimName": session_name(m), "date": m["date"],
        "startHour": str(m["start_hour"]).zfill(2), "endHour": str(m["end_hour"]).zfill(2),
        "kind": KIND, "sourceUrl": m["source_url"].strip(), "matches": rows,
    }


def existing_keys(sessions, base: str) -> set:
    """GET /api/scrims?kind=tournament 응답 → {(날짜, 상대, source_url)}. 상대 = 매치 팀명 중 base_team 이 아닌 쪽."""
    keys = set()
    for s in sessions or []:
        opp = ""
        for mt in s.get("matches") or []:
            for t in (mt.get("team1_name"), mt.get("team2_name")):
                if t and t != base:
                    opp = t
                    break
            if opp:
                break
        keys.add((s.get("date"), opp, (s.get("source_url") or "").strip()))
    return keys


def run(doc, api, dry_run: bool = False, out=print) -> dict:
    """api: get_json(path) / post_json(path, body) -> (status, json). 반환 {added, skipped, failed, planned}."""
    base = doc["base_team"].strip()
    have = existing_keys(api.get_json(f"/api/scrims?kind={KIND}")[1], base)
    res = {"added": 0, "skipped": 0, "failed": 0, "planned": 0}
    for m in doc["matches"]:
        key = (m["date"], m["opponent"].strip(), m["source_url"].strip())
        label = f"{m['date']} {session_name(m)} ({len(m['maps'])}맵)"
        if key in have:
            res["skipped"] += 1
            out(f"skip  {label} — 이미 등록됨")
            continue
        body = build_body(base, m)
        if dry_run:
            res["planned"] += 1
            wins = sum(1 for r in body["matches"] if r["winner"] == base)
            out(f"plan  {label} {body['startHour']}~{body['endHour']}시 {wins}:{len(body['matches']) - wins}")
            continue
        status, data = api.post_json("/api/scrim/manual-register", body)
        if status == 200 and isinstance(data, dict) and data.get("scrim_id"):
            res["added"] += 1
            have.add(key)
            out(f"add   {label} → {data['scrim_id']}")
        else:
            res["failed"] += 1
            out(f"FAIL  {label} → HTTP {status} {str(data)[:200]}")
    return res


class HttpApi:
    def __init__(self, base_url: str):
        self.base_url = base_url.rstrip("/")

    def _call(self, req):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.status, json.loads(r.read().decode("utf-8") or "null")
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", "replace")
            try:
                return e.code, json.loads(body)
            except ValueError:
                return e.code, body

    def get_json(self, path):
        status, data = self._call(urllib.request.Request(self.base_url + path))
        if status != 200:
            raise RuntimeError(f"GET {path} → HTTP {status}")
        return status, data

    def post_json(self, path, body):
        req = urllib.request.Request(self.base_url + path, data=json.dumps(body).encode("utf-8"),
                                     headers={"Content-Type": "application/json"}, method="POST")
        return self._call(req)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="대회 결과 등록(수동 등록 API, kind=tournament)")
    ap.add_argument("--input", required=True, help="입력 JSON 경로")
    ap.add_argument("--base-url", default="http://127.0.0.1:8000", help="백엔드 주소(기본 localhost:8000)")
    ap.add_argument("--dry-run", action="store_true", help="조회만 하고 등록하지 않음")
    args = ap.parse_args(argv)
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    with open(args.input, "r", encoding="utf-8") as f:
        doc = json.load(f)
    errors = validate(doc)
    if errors:
        print("입력 오류 — 등록하지 않음:")
        for e in errors:
            print(f"  {e}")
        return 1
    res = run(doc, HttpApi(args.base_url), dry_run=args.dry_run)
    print(f"{'dry-run ' if args.dry_run else ''}완료: 입력 {len(doc['matches'])} · 추가 {res['added']} · "
          f"예정 {res['planned']} · 건너뜀 {res['skipped']} · 실패 {res['failed']}")
    return 1 if res["failed"] else 0


if __name__ == "__main__":
    sys.exit(main())
