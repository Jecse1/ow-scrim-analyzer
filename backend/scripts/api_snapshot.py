# -*- coding: utf-8 -*-
"""scripts/api_snapshot.py — 기존 조회 API 응답 바이트 스냅샷(리팩토링 회귀 증명용).

GET /api/scrims · /api/fight-records · /api/first-fights · /api/scrims/full-events ·
/api/player-fight-stats 응답 바이트의 sha256 과, /openapi.json 을 키 정렬 정규화한 sha256
(전체 + 경로별 + 컴포넌트 스키마별)을 JSON 으로 저장하고, --compare 로 기준과 비교한다.

운영 DB 보호: --db 를 주면 그 파일을 임시 디렉터리로 "복사"한 뒤 SCRIM_DB_PATH /
SCRIM_ROWDATA_DIR 를 그 사본으로 지정해 uvicorn 을 직접 띄우고, 끝나면 내리고 지운다
(기동 시 init_db 가 스키마 보정·백필로 DB 에 쓰기 때문). --base-url 은 이미 사본으로 띄운 서버용.

사용(backend/ 에서):
  python scripts/api_snapshot.py --db <scrim.db 경로> --out base.json
  python scripts/api_snapshot.py --db <scrim.db 경로> --compare base.json
  python scripts/api_snapshot.py --base-url http://127.0.0.1:8000 --out base.json

비교 통과 조건: 5개 응답 sha256 동일 · openapi 의 기존 경로/스키마 동일(추가 경로·스키마만 허용).
종료 코드: 0 = 통과, 1 = 차이 있음.
"""
import argparse
import hashlib
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

ENDPOINTS = [
    "/api/scrims",
    "/api/fight-records",
    "/api/first-fights",
    "/api/scrims/full-events",
    "/api/player-fight-stats",
]

_BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _sha(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def _norm(obj) -> bytes:
    """키 정렬·공백 고정 직렬화(경로·스키마 비교용)."""
    return json.dumps(obj, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def _get(base_url: str, path: str) -> bytes:
    # Accept-Encoding 미지정 → GZip 미들웨어가 압축하지 않은 원본 바이트를 받는다.
    with urllib.request.urlopen(base_url.rstrip("/") + path, timeout=60) as r:
        if r.status != 200:
            raise RuntimeError(f"{path}: HTTP {r.status}")
        return r.read()


def take_snapshot(base_url: str) -> dict:
    endpoints = {}
    for p in ENDPOINTS:
        body = _get(base_url, p)
        endpoints[p] = {"sha256": _sha(body), "bytes": len(body)}
    spec = json.loads(_get(base_url, "/openapi.json"))
    paths = spec.get("paths", {})
    schemas = (spec.get("components") or {}).get("schemas", {})
    return {
        "endpoints": endpoints,
        "openapi": {
            "sha256": _sha(_norm(spec)),
            "paths": {k: _sha(_norm(v)) for k, v in sorted(paths.items())},
            "schemas": {k: _sha(_norm(v)) for k, v in sorted(schemas.items())},
        },
    }


def compare(base: dict, cur: dict) -> list:
    """차이 목록(빈 목록 = 통과). openapi 는 기존 키 동일 + 추가만 허용."""
    diffs = []
    for p, b in base["endpoints"].items():
        c = cur["endpoints"].get(p)
        if c is None:
            diffs.append(f"endpoint missing: {p}")
        elif c["sha256"] != b["sha256"]:
            diffs.append(f"endpoint changed: {p} ({b['bytes']}B -> {c['bytes']}B)")
    for section in ("paths", "schemas"):
        bs, cs = base["openapi"][section], cur["openapi"][section]
        for k, h in bs.items():
            if k not in cs:
                diffs.append(f"openapi {section} removed: {k}")
            elif cs[k] != h:
                diffs.append(f"openapi {section} changed: {k}")
    return diffs


def _added(base: dict, cur: dict) -> list:
    out = []
    for section in ("paths", "schemas"):
        out += [f"openapi {section} added: {k}" for k in cur["openapi"][section] if k not in base["openapi"][section]]
    return out


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def snapshot_from_db_copy(db_path: str) -> dict:
    """db_path 를 임시 사본으로 복사해 서버를 띄우고 스냅샷. 원본 파일은 읽기(복사)만 한다."""
    tmp = tempfile.mkdtemp(prefix="api_snapshot_")
    try:
        os.makedirs(os.path.join(tmp, "data"))
        os.makedirs(os.path.join(tmp, "rowdata"))
        copy_path = os.path.join(tmp, "data", "scrim.db")
        shutil.copyfile(db_path, copy_path)
        port = _free_port()
        env = dict(os.environ, SCRIM_DB_PATH=copy_path, SCRIM_ROWDATA_DIR=os.path.join(tmp, "rowdata"),
                   PYTHONDONTWRITEBYTECODE="1", PYTHONIOENCODING="utf-8")
        log = open(os.path.join(tmp, "server.log"), "wb")
        proc = subprocess.Popen(
            [sys.executable, "-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", str(port)],
            cwd=_BACKEND_DIR, env=env, stdout=log, stderr=subprocess.STDOUT)
        try:
            base_url = f"http://127.0.0.1:{port}"
            for _ in range(60):
                try:
                    _get(base_url, "/openapi.json")
                    break
                except (urllib.error.URLError, ConnectionError, OSError):
                    if proc.poll() is not None:
                        raise RuntimeError("server exited during startup (see server.log)")
                    time.sleep(0.5)
            else:
                raise RuntimeError("server did not start in 30s")
            return take_snapshot(base_url)
        finally:
            proc.terminate()
            try:
                proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                proc.kill()
            log.close()
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--db", help="이 scrim.db 를 임시 사본으로 복사해 서버를 직접 띄운다(원본 무변경)")
    src.add_argument("--base-url", help="이미 SCRIM_DB_PATH 사본으로 띄운 서버 주소")
    ap.add_argument("--out", help="스냅샷 JSON 저장 경로")
    ap.add_argument("--compare", help="기준 스냅샷 JSON 경로 — 차이를 출력하고 종료 코드로 알린다")
    args = ap.parse_args()

    cur = snapshot_from_db_copy(args.db) if args.db else take_snapshot(args.base_url)
    if args.out:
        with open(args.out, "w", encoding="utf-8") as f:
            json.dump(cur, f, ensure_ascii=False, indent=1, sort_keys=True)
        print(f"saved: {args.out}")
    for p, e in cur["endpoints"].items():
        print(f"{e['sha256'][:16]}  {e['bytes']:>9}B  {p}")
    print(f"{cur['openapi']['sha256'][:16]}  openapi ({len(cur['openapi']['paths'])} paths, "
          f"{len(cur['openapi']['schemas'])} schemas)")
    if args.compare:
        with open(args.compare, encoding="utf-8") as f:
            base = json.load(f)
        diffs = compare(base, cur)
        for line in _added(base, cur):
            print(line)
        if diffs:
            for d in diffs:
                print("DIFF " + d)
            sys.exit(1)
        print("COMPARE OK: endpoints identical, openapi existing paths/schemas identical")


if __name__ == "__main__":
    main()
