# -*- coding: utf-8 -*-
"""CORS: 다른 출처 요청에 credentials 허용 헤더가 없고, 요청 Origin 을 반사하지 않는다(main.py CORSMiddleware)."""
from fastapi.testclient import TestClient

EVIL = "https://evil.example"


def test_simple_request_has_no_credentials_header():
    import main
    with TestClient(main.app) as c:
        r = c.get("/api/scrims", headers={"Origin": EVIL})
    assert r.status_code == 200
    assert "access-control-allow-credentials" not in r.headers
    assert r.headers.get("access-control-allow-origin") == "*"


def test_preflight_has_no_credentials_header():
    import main
    with TestClient(main.app) as c:
        r = c.options("/api/sessions/delete-batch", headers={
            "Origin": EVIL, "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type"})
    assert r.status_code == 200
    assert "access-control-allow-credentials" not in r.headers
    assert r.headers.get("access-control-allow-origin") == "*"


def test_same_origin_request_unchanged():
    import main
    with TestClient(main.app) as c:
        r = c.get("/api/scrims")
    assert r.status_code == 200
    assert "access-control-allow-origin" not in r.headers
