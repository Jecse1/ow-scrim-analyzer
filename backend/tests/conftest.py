# -*- coding: utf-8 -*-
"""tests/ 공용 픽스처. 환경변수(임시 DB·rowdata 경로)와 --update-golden 옵션은 backend/conftest.py."""
import os

import pytest

FIXTURE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures")


@pytest.fixture
def update_golden(request):
    return request.config.getoption("--update-golden")


@pytest.fixture
def fixture_text():
    def _read(name):
        with open(os.path.join(FIXTURE_DIR, name), "r", encoding="utf-8") as f:
            return f.read()
    return _read
