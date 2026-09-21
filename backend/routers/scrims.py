# -*- coding: utf-8 -*-
"""routers/scrims.py — 세션·매치 등록/업로드/삭제/rebuild/상세 라우터(리팩토링 2단계 분리).

main.py 의 @app 엔드포인트를 APIRouter 로 이동(경로·메서드·함수명·데코레이터 인자 무변경,
@app.->@router. 만 변경). load_data/save_data/_delete_* 파일 I/O 헬퍼와 _json_lock 동반.
services/routers → main import 금지. DB 가용성 가드는 자체 판정.
"""
import os
import json
import glob
import uuid
import tempfile
import threading
from datetime import datetime
from fastapi import APIRouter, HTTPException, Request, UploadFile, File, Form

_DB_IMPORT_ERROR = None
try:
    from sqlalchemy import select
    from db.database import AsyncSessionLocal
    from db.models import Session as DBSession, Match as DBMatch, Pause as DBPause, Round as DBRound, PlayerStat as DBPlayerStat, Event as DBEvent
    _DB_AVAILABLE = True
except Exception as _e:
    _DB_AVAILABLE = False
    _DB_IMPORT_ERROR = f'{type(_e).__name__}: {_e}'

from config import DATA_FILE, ROW_DATA_DIR, NUMERIC_FIELDS, BASE_TEAM
from schemas import ScrimManualInput, BatchDeleteRequest, WinnerOverrideInput, SessionPatchInput, MatchPatchInput
from cache import _invalidate_response_cache
from serializers import _db_match_to_dict, _db_session_to_dict
from parsers.log_parser import parse_overwatch_log, parse_log_timestamp, time_str_to_seconds
from services.stats import calculate_pure_stats
from services.fight_analysis import compute_fights

_json_lock = threading.Lock()
router = APIRouter()


# DEPRECATED (Phase 5): scrim_data.json is no longer the source of truth. Kept for recovery only.
def load_data():
    if not os.path.exists(DATA_FILE):
        return []
    try:
        with open(DATA_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except:
        return []


# DEPRECATED (Phase 5): No longer called in normal operation.
def save_data(data):
    dir_name = os.path.dirname(os.path.abspath(DATA_FILE))
    fd, tmp_path = tempfile.mkstemp(dir=dir_name, suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=4)
        os.replace(tmp_path, DATA_FILE)
    except Exception:
        try: os.unlink(tmp_path)
        except Exception: pass
        raise


def _delete_scrim_files(scrim_id: str) -> list[str]:
    """scrim_id 관련 파일 전부 삭제, 실패한 파일 경로 반환"""
    warnings = []
    patterns = [
        f"{ROW_DATA_DIR}/{scrim_id}_meta.json",
        *glob.glob(f"{ROW_DATA_DIR}/{scrim_id}_*.txt"),
    ]
    for path in patterns:
        if os.path.exists(path):
            try:
                os.remove(path)
                print(f"[DELETE] 파일 삭제: {path}")
            except Exception as e:
                warnings.append(f"파일 삭제 실패 ({path}): {e}")
    return warnings


def _delete_match_file(scrim_id: str, match_index: int) -> list[str]:
    """매치 로그 파일 삭제, 실패 시 warning 반환"""
    warnings = []
    path = f"{ROW_DATA_DIR}/{scrim_id}_{match_index}.txt"
    if os.path.exists(path):
        try:
            os.remove(path)
            print(f"[DELETE] 파일 삭제: {path}")
        except Exception as e:
            warnings.append(f"파일 삭제 실패 ({path}): {e}")
    return warnings


def _update_meta_json(scrim_id: str, mutate) -> bool:
    """meta.json(rebuild 소스)을 잠금 하에 읽어 mutate(meta)->bool 적용 후 원자적으로 저장.
    mutate가 False를 반환하면 저장하지 않는다. 파일 없으면 False."""
    meta_path = f"{ROW_DATA_DIR}/{scrim_id}_meta.json"
    if not os.path.exists(meta_path):
        return False
    with _json_lock:
        with open(meta_path, "r", encoding="utf-8") as f:
            meta = json.load(f)
        if not mutate(meta):
            return False
        dir_name = os.path.dirname(os.path.abspath(meta_path))
        fd, tmp_path = tempfile.mkstemp(dir=dir_name, suffix=".tmp")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump(meta, f, ensure_ascii=False, indent=4)
            os.replace(tmp_path, meta_path)
        except Exception:
            try: os.unlink(tmp_path)
            except Exception: pass
            raise
    return True


def _update_match_fields_in_meta(scrim_id: str, match_id: str, fields: dict) -> bool:
    """meta.json의 해당 매치에 fields를 병합(rebuild 복원 정합용)."""
    def mutate(meta):
        for m in meta.get("matches", []):
            if m.get("id") == match_id:
                m.update(fields)
                return True
        return False
    return _update_meta_json(scrim_id, mutate)


def _update_match_wo_in_meta(scrim_id: str, match_id: str, wo_value) -> bool:
    """meta.json(rebuild 소스)의 해당 매치 winner_override 를 동기화한다.
    등록 경로(register_scrim_manual)와 동일 필드명·표현("" = 미보정)을 쓴다 —
    rebuild 복원 코드(_wo_snapshot.get(id) or m.get("winner_override") or None)와 정합.
    파일/매치가 없으면 False."""
    meta_path = f"{ROW_DATA_DIR}/{scrim_id}_meta.json"
    if not os.path.exists(meta_path):
        return False
    with _json_lock:
        with open(meta_path, "r", encoding="utf-8") as f:
            meta = json.load(f)
        changed = False
        for m in meta.get("matches", []):
            if m.get("id") == match_id:
                m["winner_override"] = wo_value or ""
                changed = True
                break
        if not changed:
            return False
        dir_name = os.path.dirname(os.path.abspath(meta_path))
        fd, tmp_path = tempfile.mkstemp(dir=dir_name, suffix=".tmp")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump(meta, f, ensure_ascii=False, indent=4)
            os.replace(tmp_path, meta_path)
        except Exception:
            try: os.unlink(tmp_path)
            except Exception: pass
            raise
    return True


@router.post("/api/scrim/manual-register")
async def register_scrim_manual(request: Request):
    if not _DB_AVAILABLE:
        raise HTTPException(status_code=503, detail="Database not available")
    try:
        raw_body = await request.json()
        data = ScrimManualInput(**raw_body)
    except Exception as e:
        print(f"❌ [DEBUG] Validation Error: {e}")
        raise HTTPException(status_code=422, detail=f"Validation Error: {str(e)}")

    try:
        dt = datetime.strptime(data.date, "%Y-%m-%d")
        base_id = f"{dt.strftime('%y%m%d')}{data.start_time.zfill(2)}{data.end_time.zfill(2)}"
    except:
        base_id = datetime.now().strftime("%y%m%d%H%M")

    new_scrim_id = base_id
    counter = 0
    while os.path.exists(f"{ROW_DATA_DIR}/{new_scrim_id}_meta.json"):
        counter += 1
        new_scrim_id = f"{base_id}_{counter}"

    processed_matches = []
    
    for idx, match in enumerate(data.matches):
        video_offset = time_str_to_seconds(match.start_time)
        processed_pauses = []
        if match.pauses and len(match.pauses) > 0:
            for p in match.pauses:
                s_sec = time_str_to_seconds(p.start)
                e_sec = time_str_to_seconds(p.end)
                
                if s_sec > 0 and e_sec > 0 and s_sec != e_sec:
                    if s_sec > e_sec:
                        s_sec, e_sec = e_sec, s_sec
                    
                    processed_pauses.append({
                        "start_sec": s_sec,
                        "end_sec": e_sec,
                        "duration": e_sec - s_sec
                    })
        
        processed_pauses.sort(key=lambda x: x["start_sec"])

        # 승패 보정: 실제 팀명일 때만 인정(그 외 값은 무시 → 미보정)
        # 팀명/맵명 앞뒤 공백 제거 — 앞뒤 공백이 섞이면(예: ' TeamA' vs 'TeamA') 기준팀 필터·팀 목록이 갈라짐
        t1_name = (match.team1Name or "").strip() or "1팀"
        t2_name = (match.team2Name or "").strip() or "2팀"
        wo = (match.winner_override or "").strip()
        if wo not in (t1_name, t2_name):
            wo = ""

        # 수기(로그 없는) 매치: source='manual' + winner/score 직접 저장(원본=사용자 입력).
        src = "manual" if (match.source or "log") == "manual" else "log"
        manual_winner = ""
        if src == "manual":
            mw = (match.winner or "").strip()
            manual_winner = mw if mw in (t1_name, t2_name) else ""

        processed_matches.append({
            "id": str(uuid.uuid4()),
            "match_index": idx + 1,
            "map_name": (match.map_name or "").strip(),
            "team1_name": t1_name,
            "team2_name": t2_name,
            "result": match.result,
            "winner_override": wo,
            "source": src,
            "winner": manual_winner,
            "score_t1": int(match.score_t1 or 0) if src == "manual" else 0,
            "score_t2": int(match.score_t2 or 0) if src == "manual" else 0,
            "video_url": match.video_url or "",
            "video_offset": video_offset,
            "video_start_sec": match.video_start_sec if src == "manual" else None,
            "video_end_sec": match.video_end_sec if src == "manual" else None,
            "pauses": processed_pauses,
            "timeline": {"duration_sec": 0},
            "rounds": [], "stats": [],
            "fights": [], "fight_metrics": {}
        })

    new_scrim = {
        "id": new_scrim_id,
        "scrim_name": data.scrim_name,
        "date": data.date,
        "start_time": data.start_time,
        "end_time": data.end_time,
        "matches": processed_matches
    }

    with open(f"{ROW_DATA_DIR}/{new_scrim_id}_meta.json", "w", encoding="utf-8") as f:
        json.dump(new_scrim, f, ensure_ascii=False, indent=4)

    try:
        async with AsyncSessionLocal() as db:
            existing = await db.get(DBSession, new_scrim_id)
            if not existing:
                db.add(DBSession(
                    id=new_scrim_id,
                    scrim_name=data.scrim_name,
                    date=data.date,
                    start_time=data.start_time,
                    end_time=data.end_time,
                ))
            for m in processed_matches:
                db.add(DBMatch(
                    id=m["id"],
                    session_id=new_scrim_id,
                    match_index=m["match_index"],
                    map_name=m["map_name"],
                    team1_name=m["team1_name"],
                    team2_name=m["team2_name"],
                    result=m["result"],
                    winner_override=m.get("winner_override") or None,
                    source=m.get("source") or "log",
                    winner=m.get("winner") or "",
                    score_t1=m.get("score_t1") or 0,
                    score_t2=m.get("score_t2") or 0,
                    video_url=m["video_url"],
                    video_offset=m["video_offset"],
                    video_start_sec=m.get("video_start_sec"),
                    video_end_sec=m.get("video_end_sec"),
                ))
                for p in m["pauses"]:
                    db.add(DBPause(
                        match_id=m["id"],
                        start_sec=p["start_sec"],
                        end_sec=p["end_sec"],
                        duration=p["duration"],
                    ))
            await db.commit()
            print(f"[DB] register OK: {new_scrim_id}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"DB write failed: {e}")

    _invalidate_response_cache()
    return {"status": "success", "scrim_id": new_scrim_id}


@router.post("/api/matches/upload")
async def upload_match_log(scrim_id: str = Form(...), match_index: int = Form(...), file: UploadFile = File(...),
                           dry_run: str = Form(None), adopt: str = Form(None)):
    """로그 업로드/교체. dry_run='1' 이면 파싱만 하고 저장 없이 수기값과의 차이(diff)를 돌려준다.
    adopt: 수기(source='manual') 매치에 로그를 붙일 때 차이 처리 방식 —
      'parsed'(기본) = 맵·승자·스코어 전부 파싱값 채택,
      'keep'   = 맵은 수기값 유지, 파싱 winner/score는 컬럼에 저장하고 수기 winner를 winner_override로 이동(원본 보존 규칙과 일관)."""
    if not _DB_AVAILABLE:
        raise HTTPException(status_code=503, detail="Database not available")

    content = await file.read()
    try:
        log_text = content.decode("utf-8")
    except:
        log_text = content.decode("cp949", errors="ignore")

    is_dry = (dry_run or "").strip() in ("1", "true", "yes")
    if not is_dry:
        with open(f"{ROW_DATA_DIR}/{scrim_id}_{match_index}.txt", "w", encoding="utf-8") as f:
            f.write(log_text)

    try:
        from sqlalchemy.orm import selectinload as _sil
        from sqlalchemy import delete as sa_delete
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(DBMatch)
                .where(DBMatch.session_id == scrim_id, DBMatch.match_index == match_index, DBMatch.deleted_at.is_(None))
                .options(_sil(DBMatch.pauses))
            )
            db_match = result.scalars().first()
            if not db_match:
                raise HTTPException(status_code=404, detail="Match not found")

            match_id_val = db_match.id
            c_t1 = db_match.team1_name
            c_t2 = db_match.team2_name

            parsed = parse_overwatch_log(log_text, custom_t1=c_t1, custom_t2=c_t2)
            target_match: dict = {}
            calculate_pure_stats(parsed, target_match, match_label=f"{scrim_id} #{match_index}")

            # 수기 매치에 로그를 붙일 때: 수기값 vs 파싱값 차이(맵·승자·스코어)
            prev_source = db_match.source or "log"
            parsed_map = (parsed.get("map_name") or "").strip()
            diff = {}
            if prev_source == "manual":
                if parsed_map and parsed_map != (db_match.map_name or ""):
                    diff["map_name"] = {"manual": db_match.map_name or "", "parsed": parsed_map}
                if (target_match.get("winner") or "") != (db_match.winner or ""):
                    diff["winner"] = {"manual": db_match.winner or "", "parsed": target_match.get("winner") or ""}
                if (target_match.get("score_t1", 0), target_match.get("score_t2", 0)) != (db_match.score_t1 or 0, db_match.score_t2 or 0):
                    diff["score"] = {"manual": f"{db_match.score_t1 or 0}:{db_match.score_t2 or 0}",
                                     "parsed": f"{target_match.get('score_t1', 0)}:{target_match.get('score_t2', 0)}"}
            if is_dry:
                # 파싱만 — DB·파일 무변경. 프론트가 diff를 보여주고 adopt를 정해 재호출한다.
                return {"status": "dry_run", "source": prev_source, "diff": diff}

            if prev_source == "manual" and (adopt or "parsed") == "keep":
                # 수기값 유지: 맵은 수기값 그대로, 수기 winner는 winner_override로 이동(파싱 원본은 winner 컬럼에)
                manual_winner = (db_match.winner or "").strip()
                if manual_winner and manual_winner != (target_match.get("winner") or ""):
                    db_match.winner_override = manual_winner
            elif prev_source == "manual" and parsed_map:
                db_match.map_name = parsed_map  # 파싱값 채택
            db_match.source = "log"

            db_match.winner = target_match.get("winner", "")
            db_match.score_t1 = target_match.get("score_t1", 0)
            db_match.score_t2 = target_match.get("score_t2", 0)
            db_match.result = target_match.get("result", "")
            db_match.duration_sec = target_match.get("timeline", {}).get("duration_sec", 0)
            db_match.total_final_blows_t1 = target_match.get("total_final_blows_t1", 0)
            db_match.total_final_blows_t2 = target_match.get("total_final_blows_t2", 0)

            # 신규 방식: setup_complete의 real_timestamp 추출 → game_setup_sec 저장
            # -2 보정 없이 real_ts 그대로 저장. events.timestamp는 이미 (real_ts - 2)이므로
            # 빼면 자연스럽게 2초 전 점프 효과 발생 (사용자 의도 유지)
            game_setup_sec = None
            for _line in log_text.splitlines():
                if ",setup_complete," in _line:
                    _real_ts = parse_log_timestamp(_line.strip())
                    game_setup_sec = max(0, _real_ts)
                    break
            db_match.game_setup_sec = game_setup_sec

            await db.execute(sa_delete(DBEvent).where(DBEvent.match_id == match_id_val))
            await db.execute(sa_delete(DBPlayerStat).where(DBPlayerStat.match_id == match_id_val))
            await db.execute(sa_delete(DBRound).where(DBRound.match_id == match_id_val))

            for rnd in target_match.get("rounds", []):
                db_round = DBRound(
                    match_id=match_id_val,
                    round_number=rnd.get("round_number", 0),
                    winner=rnd.get("winner", ""),
                    duration_sec=rnd.get("duration_sec", 0),
                    final_blows_t1=rnd.get("final_blows_t1", 0),
                    final_blows_t2=rnd.get("final_blows_t2", 0),
                    # 로그 교체 = 새 라운드 구성 → VOD 보정은 자동(NULL)으로 초기화
                    video_delta_sec=rnd.get("video_delta_sec"),
                )
                db.add(db_round)
                await db.flush()
                for stat in rnd.get("stats", []):
                    db.add(DBPlayerStat(
                        round_id=db_round.id,
                        match_id=match_id_val,
                        team_name=stat.get("team_name", ""),
                        player_name=stat.get("player_name", ""),
                        hero_name=stat.get("hero_name", ""),
                        hero_image=stat.get("hero_image", ""),
                        slot_index=stat.get("slot_index", -1),
                        **{f: stat.get(f, 0) for f in NUMERIC_FIELDS},
                    ))
                for ev in rnd.get("events", []):
                    et = ev.get("event_type", "")
                    db.add(DBEvent(
                        round_id=db_round.id,
                        match_id=match_id_val,
                        event_type=et,
                        timestamp=float(ev.get("timestamp", 0)),
                        game_timestamp=float(ev.get("game_timestamp", 0)) if ev.get("game_timestamp") is not None else None,
                        player_name=ev.get("player_name"),
                        player_team=ev.get("player_team"),
                        player_hero=ev.get("player_hero"),
                        player_hero_img=ev.get("player_hero_img"),
                        ability=ev.get("ability"),
                        target_name=ev.get("target_name"),
                        target_team=ev.get("target_team"),
                        target_hero=ev.get("target_hero"),
                        target_hero_img=ev.get("target_hero_img"),
                        round_number=int(ev["round_number"]) if ev.get("round_number") is not None else None,
                        winner=ev.get("winner"),
                        attacker=ev.get("attacker"),
                        description=ev.get("desc"),
                        score_t1=int(ev["score_t1"]) if ev.get("score_t1") is not None else None,
                        score_t2=int(ev["score_t2"]) if ev.get("score_t2") is not None else None,
                        capturing_team=ev.get("capturing_team"),
                        new_index=int(ev["new_index"]) if ev.get("new_index") is not None else None,
                        old_index=int(ev["old_index"]) if ev.get("old_index") is not None else None,
                        team=ev.get("team"),
                    ))
            await db.commit()
            print(f"[DB] upload OK: match={match_id_val}")
            # meta.json 동기화(rebuild 소스): source 전환·(채택 결과) 맵·winner_override
            _update_match_fields_in_meta(scrim_id, match_id_val, {
                "source": "log",
                "map_name": db_match.map_name,
                "winner_override": db_match.winner_override or "",
            })
            _invalidate_response_cache()
            return {"status": "success", "diff": diff}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"DB error: {e}")


@router.get("/api/admin/db-status")
async def db_status():
    if not _DB_AVAILABLE:
        return {"db_available": False, "error": _DB_IMPORT_ERROR or "DB modules not installed"}
    try:
        from sqlalchemy import func as sa_func
        async with AsyncSessionLocal() as db:
            db_sessions  = (await db.execute(select(sa_func.count()).select_from(DBSession).where(DBSession.deleted_at.is_(None)))).scalar()
            db_sess_del  = (await db.execute(select(sa_func.count()).select_from(DBSession).where(DBSession.deleted_at.isnot(None)))).scalar()
            db_matches   = (await db.execute(select(sa_func.count()).select_from(DBMatch).where(DBMatch.deleted_at.is_(None)))).scalar()
            db_match_del = (await db.execute(select(sa_func.count()).select_from(DBMatch).where(DBMatch.deleted_at.isnot(None)))).scalar()
            db_rounds    = (await db.execute(select(sa_func.count()).select_from(DBRound))).scalar()
            db_ps        = (await db.execute(select(sa_func.count()).select_from(DBPlayerStat))).scalar()
            db_events    = (await db.execute(select(sa_func.count()).select_from(DBEvent))).scalar()

        return {
            "db_available": True,
            "db": {
                "sessions": db_sessions, "sessions_deleted": db_sess_del,
                "matches": db_matches, "matches_deleted": db_match_del,
                "rounds": db_rounds, "player_stats": db_ps, "events": db_events,
            },
            "soft_deleted": {"sessions": db_sess_del, "matches": db_match_del},
            "legacy_json_backup_exists": os.path.exists("scrim_data.json.phase5_backup"),
        }
    except Exception as e:
        return {"db_available": True, "error": str(e)}


@router.post("/api/admin/rebuild-db")
async def rebuild_database():
    import shutil as _shutil
    from sqlalchemy import delete as sa_delete

    if not _DB_AVAILABLE:
        raise HTTPException(status_code=503, detail="Database not available")

    db_path = "data/scrim.db"
    backup_path = f"data/scrim.db.before_rebuild_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
    try:
        _shutil.copy(db_path, backup_path)
        print(f"[REBUILD] DB backup: {backup_path}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Backup failed: {e}")

    print("[REBUILD] raw 파일 파싱 시작...")
    meta_files = sorted(glob.glob(f"{ROW_DATA_DIR}/*_meta.json"), reverse=True)
    new_scrims: list = []
    parse_errors: list[str] = []

    for meta_path in meta_files:
        try:
            with open(meta_path, "r", encoding="utf-8") as f:
                scrim_obj = json.load(f)
            scrim_id = scrim_obj["id"]
            log_files = glob.glob(f"{ROW_DATA_DIR}/{scrim_id}_*.txt")
            if not log_files:
                print(f"[REBUILD] 경고: {scrim_id} 로그 없음 (메타만 등록)")
            for log_path in sorted(log_files):
                base_name = os.path.basename(log_path)
                try:
                    match_index = int(base_name.replace(f"{scrim_id}_", "").replace(".txt", ""))
                except:
                    continue
                with open(log_path, "r", encoding="utf-8") as lf:
                    log_text = lf.read()
                target_match = next((m for m in scrim_obj.get("matches", []) if m.get("match_index") == match_index), None)
                if target_match:
                    offset_save = target_match.get("video_offset", 0)
                    pauses_save = target_match.get("pauses", [])
                    c_t1 = target_match.get("team1_name", "1팀")
                    c_t2 = target_match.get("team2_name", "2팀")
                    parsed = parse_overwatch_log(log_text, custom_t1=c_t1, custom_t2=c_t2)
                    calculate_pure_stats(parsed, target_match, match_label=f"{scrim_id} #{match_index}")
                    target_match["video_offset"] = offset_save
                    target_match["pauses"] = pauses_save
                    # setup_complete real_timestamp 추출 (-2 보정 없이)
                    _gss = None
                    for _line in log_text.splitlines():
                        if ",setup_complete," in _line:
                            _real_ts = parse_log_timestamp(_line.strip())
                            _gss = max(0, _real_ts)
                            break
                    target_match["game_setup_sec"] = _gss
                    # 라운드별 VOD 보정 복원 — meta.json의 rounds_delta(수기 입력 스냅샷)를
                    # 재계산된 rounds에 round_number 기준으로 다시 얹는다.
                    _rd = {d.get("round_number"): d.get("video_delta_sec")
                           for d in (target_match.get("rounds_delta") or [])}
                    for _rnd in target_match.get("rounds", []):
                        if _rnd.get("round_number") in _rd:
                            _rnd["video_delta_sec"] = _rd[_rnd.get("round_number")]
            new_scrims.append(scrim_obj)
        except Exception as e:
            parse_errors.append(f"{os.path.basename(meta_path)}: {e}")
            print(f"[REBUILD] 파싱 실패: {meta_path}: {e}")

    print(f"[REBUILD] 파싱 완료: {len(new_scrims)} scrims. DB 재구축 시작...")

    total_sessions = total_matches = total_rounds = total_events = 0
    try:
        async with AsyncSessionLocal() as db:
            # 수기 승패 보정(winner_override)은 DB에만 있으므로 재구축 전 스냅샷 → 재구축 후 복원
            # (video_offset/pauses가 meta.json에서 보존되는 것과 같은 원칙)
            _wo_rows = await db.execute(select(DBMatch.id, DBMatch.winner_override)
                                        .where(DBMatch.winner_override.isnot(None)))
            _wo_snapshot = {row[0]: row[1] for row in _wo_rows}
            await db.execute(sa_delete(DBEvent))
            await db.execute(sa_delete(DBPlayerStat))
            await db.execute(sa_delete(DBRound))
            await db.execute(sa_delete(DBPause))
            await db.execute(sa_delete(DBMatch))
            await db.execute(sa_delete(DBSession))
            await db.flush()

            for scrim_obj in new_scrims:
                scrim_id = scrim_obj["id"]
                db.add(DBSession(
                    id=scrim_id,
                    scrim_name=scrim_obj.get("scrim_name", ""),
                    date=scrim_obj.get("date", ""),
                    start_time=scrim_obj.get("start_time", ""),
                    end_time=scrim_obj.get("end_time", ""),
                ))
                total_sessions += 1

                for m in scrim_obj.get("matches", []):
                    match_id_val = m.get("id") or str(uuid.uuid4())
                    db.add(DBMatch(
                        id=match_id_val,
                        session_id=scrim_id,
                        match_index=m.get("match_index", 0),
                        map_name=m.get("map_name", ""),
                        team1_name=m.get("team1_name") or m.get("team_1_name", ""),
                        team2_name=m.get("team2_name") or m.get("team_2_name", ""),
                        winner=m.get("winner", ""),
                        winner_override=_wo_snapshot.get(match_id_val) or m.get("winner_override") or None,
                        score_t1=m.get("score_t1", 0),
                        score_t2=m.get("score_t2", 0),
                        result=m.get("result", ""),
                        source=m.get("source") or "log",
                        video_url=m.get("video_url", ""),
                        video_offset=m.get("video_offset", 0),
                        video_start_sec=m.get("video_start_sec"),
                        video_end_sec=m.get("video_end_sec"),
                        game_setup_sec=m.get("game_setup_sec"),
                        duration_sec=m.get("timeline", {}).get("duration_sec", 0),
                        total_final_blows_t1=m.get("total_final_blows_t1", 0),
                        total_final_blows_t2=m.get("total_final_blows_t2", 0),
                    ))
                    for p in m.get("pauses", []):
                        db.add(DBPause(
                            match_id=match_id_val,
                            start_sec=p.get("start_sec", 0),
                            end_sec=p.get("end_sec", 0),
                            duration=p.get("duration", 0),
                        ))
                    total_matches += 1
                    await db.flush()

                    for rnd in m.get("rounds", []):
                        db_round = DBRound(
                            match_id=match_id_val,
                            round_number=rnd.get("round_number", 0),
                            winner=rnd.get("winner", ""),
                            duration_sec=rnd.get("duration_sec", 0),
                            final_blows_t1=rnd.get("final_blows_t1", 0),
                            final_blows_t2=rnd.get("final_blows_t2", 0),
                            video_delta_sec=rnd.get("video_delta_sec"),
                        )
                        db.add(db_round)
                        await db.flush()
                        total_rounds += 1

                        for stat in rnd.get("stats", []):
                            db.add(DBPlayerStat(
                                round_id=db_round.id,
                                match_id=match_id_val,
                                team_name=stat.get("team_name", ""),
                                player_name=stat.get("player_name", ""),
                                hero_name=stat.get("hero_name", ""),
                                hero_image=stat.get("hero_image", ""),
                                slot_index=stat.get("slot_index", -1),
                                **{f: stat.get(f, 0) for f in NUMERIC_FIELDS},
                            ))
                        for ev in rnd.get("events", []):
                            et = ev.get("event_type", "")
                            db.add(DBEvent(
                                round_id=db_round.id,
                                match_id=match_id_val,
                                event_type=et,
                                timestamp=float(ev.get("timestamp", 0)),
                                game_timestamp=float(ev.get("game_timestamp", 0)) if ev.get("game_timestamp") is not None else None,
                                player_name=ev.get("player_name"),
                                player_team=ev.get("player_team"),
                                player_hero=ev.get("player_hero"),
                                player_hero_img=ev.get("player_hero_img"),
                                ability=ev.get("ability"),
                                target_name=ev.get("target_name"),
                                target_team=ev.get("target_team"),
                                target_hero=ev.get("target_hero"),
                                target_hero_img=ev.get("target_hero_img"),
                                round_number=int(ev["round_number"]) if ev.get("round_number") is not None else None,
                                winner=ev.get("winner"),
                                attacker=ev.get("attacker"),
                                description=ev.get("desc"),
                                score_t1=int(ev["score_t1"]) if ev.get("score_t1") is not None else None,
                                score_t2=int(ev["score_t2"]) if ev.get("score_t2") is not None else None,
                                capturing_team=ev.get("capturing_team"),
                                new_index=int(ev["new_index"]) if ev.get("new_index") is not None else None,
                                old_index=int(ev["old_index"]) if ev.get("old_index") is not None else None,
                                team=ev.get("team"),
                            ))
                            total_events += 1

            await db.commit()
            print(f"[REBUILD] 완료: sessions={total_sessions} matches={total_matches} rounds={total_rounds} events={total_events}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"DB rebuild failed: {e}")

    _invalidate_response_cache()
    return {
        "success": True,
        "backup_created": backup_path,
        "sessions": total_sessions,
        "matches": total_matches,
        "rounds": total_rounds,
        "events": total_events,
        "parse_errors": parse_errors,
    }


@router.get("/api/scrims/{scrim_id}")
async def get_scrim_detail(scrim_id: str):
    if not _DB_AVAILABLE:
        raise HTTPException(status_code=503, detail="Database not available")
    try:
        from sqlalchemy.orm import selectinload
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(DBSession)
                .where(DBSession.id == scrim_id, DBSession.deleted_at.is_(None))
                .options(selectinload(DBSession.matches).selectinload(DBMatch.pauses))
            )
            session = result.scalars().first()
            if not session:
                raise HTTPException(status_code=404, detail="Scrim not found")
            session.matches = [m for m in (session.matches or []) if m.deleted_at is None]
            return _db_session_to_dict(session)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"DB error: {e}")


# DEPRECATED (Phase 5): No longer used. Kept for manual recovery only.
def _find_session_in_json(scrim_id: str) -> dict | None:
    for scrim in load_data():
        if scrim.get("id") == scrim_id:
            return scrim
    return None


# DEPRECATED (Phase 5): No longer used. Kept for manual recovery only.
def _find_match_in_json(match_id: str) -> dict | None:
    for scrim in load_data():
        for m in scrim.get("matches", []):
            if m.get("id") == match_id:
                return m
    return None


@router.get("/api/matches/{match_id}")
async def get_match_detail(match_id: str):
    if not _DB_AVAILABLE:
        raise HTTPException(status_code=503, detail="Database not available")
    try:
        from sqlalchemy.orm import selectinload
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(DBMatch)
                .where(DBMatch.id == match_id, DBMatch.deleted_at.is_(None))
                .options(
                    selectinload(DBMatch.rounds).selectinload(DBRound.player_stats),
                    selectinload(DBMatch.rounds).selectinload(DBRound.events),
                    selectinload(DBMatch.pauses),
                )
            )
            db_match = result.scalars().first()
            if not db_match:
                raise HTTPException(status_code=404, detail="Match not found")
            return _db_match_to_dict(db_match, full=True)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"DB error: {e}")


# ── 사후 승패 보정(winner_override) ─────────────────────────────
@router.patch("/api/matches/{match_id}/winner-override")
async def update_match_winner_override(match_id: str, body: WinnerOverrideInput):
    """이미 등록된 매치의 수기 승패 보정을 갱신한다(무승부/미기록 매치 교정용).
    검증: 값은 해당 매치의 team1_name/team2_name 중 하나 또는 null(해제)만 허용.
    원본 winner 컬럼은 무변경 — winner_override 만 갱신하고 meta.json(rebuild 소스)도 동기화."""
    if not _DB_AVAILABLE:
        raise HTTPException(status_code=503, detail="Database not available")

    wo = (body.winner_override or "").strip() or None

    try:
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(DBMatch).where(DBMatch.id == match_id, DBMatch.deleted_at.is_(None))
            )
            m = result.scalars().first()
            if not m:
                raise HTTPException(status_code=404, detail="Match not found")
            if wo is not None and wo not in (m.team1_name, m.team2_name):
                raise HTTPException(
                    status_code=422,
                    detail=f"winner_override must be one of ['{m.team1_name}', '{m.team2_name}'] or null",
                )
            m.winner_override = wo  # 원본 winner 무변경
            scrim_id = m.session_id
            await db.commit()
            print(f"[DB] winner_override 갱신: match={match_id} → {wo!r}")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"DB error: {e}")

    _update_match_wo_in_meta(scrim_id, match_id, wo)
    _invalidate_response_cache()
    return {"success": True, "match_id": match_id, "winner_override": wo or ""}


# ── 세션 정보 수정 ─────────────────────────────────────────────
@router.patch("/api/sessions/{scrim_id}")
async def patch_session(scrim_id: str, body: SessionPatchInput):
    """세션 이름·날짜·팀명 정정. 팀명은 등록 시 오타 교정 용도 —
    BASE_TEAM(기준 팀)은 변경 거부, 상대팀명만 치환 가능.
    치환 시 그 세션의 matches(team1/team2/winner/winner_override)·player_stats·events
    팀 컬럼을 한 트랜잭션에서 일괄 갱신하고 meta.json도 동기화한다."""
    if not _DB_AVAILABLE:
        raise HTTPException(status_code=503, detail="Database not available")

    rn_from = (body.team_rename_from or "").strip()
    rn_to = (body.team_rename_to or "").strip()
    if bool(rn_from) != bool(rn_to):
        raise HTTPException(status_code=422, detail="teamRenameFrom/teamRenameTo must be given together")
    if rn_from:
        if rn_from == BASE_TEAM:
            raise HTTPException(status_code=422, detail=f"기준 팀({BASE_TEAM})의 이름은 변경할 수 없습니다")
        if rn_to == BASE_TEAM:
            raise HTTPException(status_code=422, detail=f"상대팀명을 기준 팀({BASE_TEAM})으로 바꿀 수 없습니다")

    try:
        from sqlalchemy import update as sa_update
        from sqlalchemy.orm import selectinload as _sil
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(DBSession).where(DBSession.id == scrim_id, DBSession.deleted_at.is_(None))
                .options(_sil(DBSession.matches))
            )
            s = result.scalars().first()
            if not s:
                raise HTTPException(status_code=404, detail="Session not found")

            if body.scrim_name is not None:
                s.scrim_name = body.scrim_name.strip() or s.scrim_name
            if body.date is not None and body.date.strip():
                s.date = body.date.strip()

            renamed_match_ids = []
            if rn_from:
                match_ids = [m.id for m in (s.matches or []) if m.deleted_at is None]
                for m in (s.matches or []):
                    if m.deleted_at is not None:
                        continue
                    hit = False
                    if m.team1_name == rn_from: m.team1_name = rn_to; hit = True
                    if m.team2_name == rn_from: m.team2_name = rn_to; hit = True
                    if (m.winner or "") == rn_from: m.winner = rn_to; hit = True
                    if (m.winner_override or "") == rn_from: m.winner_override = rn_to; hit = True
                    if m.result and rn_from in m.result: m.result = m.result.replace(rn_from, rn_to); hit = True
                    if hit: renamed_match_ids.append(m.id)
                if match_ids:
                    await db.execute(sa_update(DBPlayerStat)
                                     .where(DBPlayerStat.match_id.in_(match_ids), DBPlayerStat.team_name == rn_from)
                                     .values(team_name=rn_to))
                    for col in (DBEvent.player_team, DBEvent.target_team, DBEvent.winner,
                                DBEvent.capturing_team, DBEvent.team, DBEvent.attacker):
                        await db.execute(sa_update(DBEvent)
                                         .where(DBEvent.match_id.in_(match_ids), col == rn_from)
                                         .values(**{col.key: rn_to}))
            await db.commit()
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"DB error: {e}")

    # meta.json 동기화(rebuild 소스)
    def mutate(meta):
        changed = False
        if body.scrim_name is not None and body.scrim_name.strip():
            meta["scrim_name"] = body.scrim_name.strip(); changed = True
        if body.date is not None and body.date.strip():
            meta["date"] = body.date.strip(); changed = True
        if rn_from:
            for m in meta.get("matches", []):
                for k in ("team1_name", "team2_name", "winner", "winner_override"):
                    if m.get(k) == rn_from:
                        m[k] = rn_to; changed = True
                if m.get("result") and rn_from in m["result"]:
                    m["result"] = m["result"].replace(rn_from, rn_to); changed = True
        return changed
    _update_meta_json(scrim_id, mutate)
    _invalidate_response_cache()
    return {"success": True, "scrim_id": scrim_id,
            "renamed": {"from": rn_from, "to": rn_to} if rn_from else None}


# ── 매치 정보 수정 ─────────────────────────────────────────────
@router.patch("/api/matches/{match_id}")
async def patch_match(match_id: str, body: MatchPatchInput):
    """매치 정보 수정: 맵·VOD(URL/오프셋/구간)·순서(match_index)·(수기 매치 한정) winner/score.
    로그 매치(source='log')의 승패 정정은 winner-override 엔드포인트 사용 — 원본 winner 불변 규칙 유지.
    match_index 변경 시 같은 세션에서 그 순번을 쓰던 매치와 자리를 맞바꾼다."""
    if not _DB_AVAILABLE:
        raise HTTPException(status_code=503, detail="Database not available")

    try:
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(DBMatch).where(DBMatch.id == match_id, DBMatch.deleted_at.is_(None))
            )
            m = result.scalars().first()
            if not m:
                raise HTTPException(status_code=404, detail="Match not found")

            is_manual = (m.source or "log") == "manual"
            if (body.winner is not None or body.score_t1 is not None or body.score_t2 is not None) and not is_manual:
                raise HTTPException(status_code=422,
                                    detail="로그 매치의 승패·스코어는 직접 수정할 수 없습니다 — winner-override를 사용하세요")

            meta_fields = {}
            if body.map_name is not None and body.map_name.strip():
                m.map_name = body.map_name.strip(); meta_fields["map_name"] = m.map_name
            if body.winner is not None:
                w = body.winner.strip()
                if w and w not in (m.team1_name, m.team2_name):
                    raise HTTPException(status_code=422,
                                        detail=f"winner must be one of ['{m.team1_name}', '{m.team2_name}'] or ''")
                m.winner = w; meta_fields["winner"] = w
            if body.score_t1 is not None:
                m.score_t1 = max(0, int(body.score_t1)); meta_fields["score_t1"] = m.score_t1
            if body.score_t2 is not None:
                m.score_t2 = max(0, int(body.score_t2)); meta_fields["score_t2"] = m.score_t2
            if body.video_url is not None:
                m.video_url = body.video_url.strip(); meta_fields["video_url"] = m.video_url
            if body.video_offset is not None:
                m.video_offset = max(0, int(body.video_offset)); meta_fields["video_offset"] = m.video_offset
            if body.video_start_sec is not None:
                m.video_start_sec = max(0, int(body.video_start_sec)); meta_fields["video_start_sec"] = m.video_start_sec
            if body.video_end_sec is not None:
                m.video_end_sec = max(0, int(body.video_end_sec)); meta_fields["video_end_sec"] = m.video_end_sec

            # 라운드별 VOD 보정 — 로그 매치 전용. null = 자동(모드 기본값)으로 되돌림.
            if body.rounds_delta is not None:
                if is_manual:
                    raise HTTPException(status_code=422, detail="수기 매치에는 라운드별 VOD 보정이 없습니다")
                r_rows = (await db.execute(
                    select(DBRound).where(DBRound.match_id == match_id))).scalars().all()
                by_num = {r.round_number: r for r in r_rows}
                for rd in body.rounds_delta:
                    r_row = by_num.get(rd.round_number)
                    if not r_row:
                        raise HTTPException(status_code=422, detail=f"round {rd.round_number} not found")
                    r_row.video_delta_sec = None if rd.video_delta_sec is None else int(rd.video_delta_sec)
                # meta.json 동기화(rebuild 복원용): 매치 전체 라운드의 저장값 스냅샷
                meta_fields["rounds_delta"] = [
                    {"round_number": r.round_number, "video_delta_sec": r.video_delta_sec}
                    for r in sorted(r_rows, key=lambda x: x.round_number)
                ]

            swapped = None
            if body.match_index is not None and int(body.match_index) != m.match_index:
                new_idx = int(body.match_index)
                other = (await db.execute(
                    select(DBMatch).where(DBMatch.session_id == m.session_id,
                                          DBMatch.match_index == new_idx,
                                          DBMatch.deleted_at.is_(None)))).scalars().first()
                old_idx = m.match_index
                if other:
                    other.match_index = old_idx
                    swapped = other.id
                m.match_index = new_idx
                meta_fields["match_index"] = new_idx

            scrim_id = m.session_id
            await db.commit()
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"DB error: {e}")

    if meta_fields:
        _update_match_fields_in_meta(scrim_id, match_id, meta_fields)
    if swapped:
        _update_match_fields_in_meta(scrim_id, swapped, {"match_index": old_idx})
    _invalidate_response_cache()
    return {"success": True, "match_id": match_id, "updated": list(meta_fields.keys()),
            "swapped_with": swapped}


# ── 세션 단건 삭제 ─────────────────────────────────────────────
@router.delete("/api/sessions/{scrim_id}")
async def delete_session(scrim_id: str):
    # 1. DB soft delete
    if _DB_AVAILABLE:
        try:
            from sqlalchemy.orm import selectinload as _sil
            async with AsyncSessionLocal() as db:
                result = await db.execute(
                    select(DBSession)
                    .where(DBSession.id == scrim_id, DBSession.deleted_at.is_(None))
                    .options(_sil(DBSession.matches))
                )
                sess = result.scalars().first()
                if not sess:
                    raise HTTPException(status_code=404, detail=f"Session {scrim_id} not found")
                if sess:
                    now = datetime.utcnow()
                    sess.deleted_at = now
                    for m in (sess.matches or []):
                        if m.deleted_at is None:
                            m.deleted_at = now
                    await db.commit()
                    print(f"[DB] soft-delete session: {scrim_id}")
        except HTTPException:
            raise
        except Exception as e:
            print(f"[DB] delete_session failed: {e}")

    print(f"[DELETE] 세션 삭제: {scrim_id}  ({datetime.now().isoformat()})")
    warnings = _delete_scrim_files(scrim_id)
    _invalidate_response_cache()
    return {"success": True, "deleted_count": 1, "warnings": warnings, "failed_ids": []}


# ── 세션 배치 삭제 ─────────────────────────────────────────────
@router.post("/api/sessions/delete-batch")
async def delete_sessions_batch(req: BatchDeleteRequest):
    if not req.ids:
        raise HTTPException(status_code=400, detail="ids 배열이 비어 있습니다")

    deleted_ids: list[str] = []
    failed_ids: list[str] = []

    # 1. DB soft delete
    if _DB_AVAILABLE:
        try:
            from sqlalchemy.orm import selectinload as _sil
            async with AsyncSessionLocal() as db:
                now = datetime.utcnow()
                for sid in req.ids:
                    result = await db.execute(
                        select(DBSession)
                        .where(DBSession.id == sid, DBSession.deleted_at.is_(None))
                        .options(_sil(DBSession.matches))
                    )
                    sess = result.scalars().first()
                    if sess:
                        sess.deleted_at = now
                        for m in (sess.matches or []):
                            if m.deleted_at is None:
                                m.deleted_at = now
                        deleted_ids.append(sid)
                    else:
                        failed_ids.append(sid)
                await db.commit()
            print(f"[DB] soft-delete sessions batch: {deleted_ids}")
        except Exception as e:
            print(f"[DB] delete_sessions_batch failed: {e}")
            # Fallback: treat all as to-delete via JSON only
            deleted_ids = list(req.ids)
            failed_ids = []
    else:
        deleted_ids = list(req.ids)

    print(f"[DELETE] 세션 배치 삭제: {deleted_ids}  ({datetime.now().isoformat()})")
    warnings: list[str] = []
    for sid in deleted_ids:
        warnings.extend(_delete_scrim_files(sid))

    _invalidate_response_cache()
    return {
        "success": len(failed_ids) == 0,
        "deleted_count": len(deleted_ids),
        "warnings": warnings,
        "failed_ids": failed_ids,
    }


# ── 매치 단건 삭제 ─────────────────────────────────────────────
@router.delete("/api/matches/{match_id}")
async def delete_match(match_id: str):
    found_scrim_id = None
    found_match_index = None

    # 1. DB soft delete
    if _DB_AVAILABLE:
        try:
            async with AsyncSessionLocal() as db:
                result = await db.execute(
                    select(DBMatch).where(DBMatch.id == match_id, DBMatch.deleted_at.is_(None))
                )
                m = result.scalars().first()
                if m:
                    found_scrim_id = m.session_id
                    found_match_index = m.match_index
                    m.deleted_at = datetime.utcnow()
                    await db.commit()
                    print(f"[DB] soft-delete match: {match_id}")
        except Exception as e:
            print(f"[DB] delete_match failed: {e}")

    if not found_scrim_id:
        raise HTTPException(status_code=404, detail=f"Match {match_id} not found")
    warnings: list[str] = []

    print(f"[DELETE] 매치 삭제: {match_id} (scrim={found_scrim_id}, index={found_match_index})  ({datetime.now().isoformat()})")
    warnings.extend(_delete_match_file(found_scrim_id, found_match_index))
    _invalidate_response_cache()
    return {"success": True, "deleted_count": 1, "warnings": warnings, "failed_ids": []}


# ── 매치 배치 삭제 ─────────────────────────────────────────────
@router.post("/api/matches/delete-batch")
async def delete_matches_batch(req: BatchDeleteRequest):
    if not req.ids:
        raise HTTPException(status_code=400, detail="ids 배열이 비어 있습니다")

    # [(scrim_id, match_index, match_id)]
    db_deleted: list[tuple[str, int, str]] = []
    failed_ids: list[str] = []

    # 1. DB soft delete
    if _DB_AVAILABLE:
        try:
            async with AsyncSessionLocal() as db:
                now = datetime.utcnow()
                for mid in req.ids:
                    result = await db.execute(
                        select(DBMatch).where(DBMatch.id == mid, DBMatch.deleted_at.is_(None))
                    )
                    m = result.scalars().first()
                    if m:
                        m.deleted_at = now
                        db_deleted.append((m.session_id, m.match_index, mid))
                    else:
                        failed_ids.append(mid)
                await db.commit()
            print(f"[DB] soft-delete matches batch: {[x[2] for x in db_deleted]}")
        except Exception as e:
            print(f"[DB] delete_matches_batch failed: {e}")
            db_deleted = [(None, None, mid) for mid in req.ids]
            failed_ids = []

    warnings: list[str] = []
    print(f"[DELETE] 매치 배치 삭제: {[x[2] for x in db_deleted]}  ({datetime.now().isoformat()})")
    for scrim_id, match_index, _ in db_deleted:
        if scrim_id and match_index is not None:
            warnings.extend(_delete_match_file(scrim_id, match_index))

    _invalidate_response_cache()
    return {
        "success": len(failed_ids) == 0,
        "deleted_count": len(db_deleted),
        "warnings": warnings,
        "failed_ids": failed_ids,
    }
