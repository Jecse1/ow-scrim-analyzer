# -*- coding: utf-8 -*-
"""pytest 루트 설정(backend/). 어떤 앱 모듈보다 먼저 로드된다.

config.py(ROW_DATA_DIR 생성)·db/database.py(엔진 경로)는 import 시점에 경로를 정하므로,
여기서 환경변수로 임시 디렉터리를 먼저 지정해 테스트가 운영 DB·원문 로그 경로를 만들거나 건드리지 않게 한다.
"""
import os
import shutil
import tempfile

_TMP = tempfile.mkdtemp(prefix="scrim_pytest_")
os.environ["SCRIM_DB_PATH"] = os.path.join(_TMP, "data", "scrim.db")
os.environ["SCRIM_ROWDATA_DIR"] = os.path.join(_TMP, "scrim_rowdata_log")


def pytest_addoption(parser):
    parser.addoption("--update-golden", action="store_true", default=False,
                     help="tests/golden/*.json 을 현재 코드 출력으로 다시 쓴다(의도된 동작 변경 시에만).")


def pytest_unconfigure(config):
    shutil.rmtree(_TMP, ignore_errors=True)
