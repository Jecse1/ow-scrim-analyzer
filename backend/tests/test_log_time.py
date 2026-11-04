# -*- coding: utf-8 -*-
"""로그 시각 접두어(log_time.tprint): 'YYYY-MM-DDTHH:MM:SSZ ' + 원래 print 인자 그대로."""
import re

from log_time import tprint


def test_tprint_prefixes_utc_iso_seconds(capsys):
    tprint("[DB] register OK: 2611040305", flush=True)
    tprint("[CACHE] warm", "scrims", 123)
    out = capsys.readouterr().out.splitlines()
    assert re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z \[DB\] register OK: 2611040305", out[0])
    assert re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z \[CACHE\] warm scrims 123", out[1])
