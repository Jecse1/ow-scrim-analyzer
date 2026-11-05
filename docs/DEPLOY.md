# 서버 배포 가이드 (Ubuntu + nginx + pm2)

Ubuntu 22.04/24.04, RAM 1GB 인스턴스(GCP e2-micro 등) 기준.
venv + pm2 + nginx로 구동하는 저사양 배포 절차. 배포는 이 문서(pm2+nginx)만 지원한다.

## 0. 스왑 생성 (1GB RAM 필수)

빌드(vite)와 pip 설치가 1GB RAM에서 OOM으로 죽는 것을 방지한다.

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

## 1. 기본 패키지

```bash
sudo apt update
sudo apt install -y git nginx sqlite3 python3.11 python3.11-venv
# Ubuntu 24.04은 기본 python3(3.12)로도 무방: sudo apt install -y python3-venv

# Node 20 (NodeSource)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm i -g pm2
```

## 2. 소스 받기

```bash
cd ~
git clone https://github.com/<owner>/<repo>.git app
cd app
```

### Private 저장소인 경우: 배포키(Deploy key)

```bash
ssh-keygen -t ed25519 -C "deploy@<server>" -f ~/.ssh/deploy_key -N ""
cat ~/.ssh/deploy_key.pub
```

- GitHub 저장소 → Settings → Deploy keys → Add deploy key → 공개키 붙여넣기.
  서버가 커밋·푸시(데이터 추적 운영)까지 하면 **Allow write access** 체크.
- `~/.ssh/config`에 등록 후 SSH URL로 clone:

```
Host github.com-app
    HostName github.com
    IdentityFile ~/.ssh/deploy_key
```

```bash
git clone git@github.com-app:<owner>/<repo>.git app
```

## 3. 백엔드 (Python venv)

```bash
cd ~/app/backend
python3.11 -m venv venv          # 또는 python3 -m venv venv
./venv/bin/pip install -U pip
./venv/bin/pip install -r requirements.txt
```

### 환경변수 (BASE_TEAM · DISCORD_WEBHOOK_URL · APP_NAME)

- **백엔드**: `BASE_TEAM`(`backend/config.py:11`)과 `DISCORD_WEBHOOK_URL`(선택, `backend/config.py:15`)을
  `os.getenv` 로 읽는다 — .env 자동 로드는 없으므로 pm2 `env`로 주입한다. 아래 5단계 ecosystem 예시 참조.
  `APP_NAME`은 프론트 전용.
- **`DISCORD_WEBHOOK_URL`**(선택): 세션 등록 완료 알림을 보낼 디스코드 웹후크 URL. **백엔드(uvicorn) 프로세스의
  env** 에 넣는다(디스코드 봇 프로세스가 아님). 비워 두면 `POST /api/sessions/{id}/complete` 가 발송 없이
  `webhook:"disabled"` 로 응답한다. 값은 비밀로 취급 — 기동 로그에는 `설정됨/미설정`만 찍히고, 발송 실패 로그에도
  상태 코드·예외 클래스명만 남는다. 저장소·문서에 실제 값을 적지 않는다. 계약: [SUMMARY_API.md](SUMMARY_API.md).
- **`CACHE_WARM`·`CACHE_WARM_DELAY_SEC`**(선택, `backend/cache.py`): 응답 캐시 선채우기. 기본은 켬(`1`) —
  기동 직후와 DB 변경(등록·업로드·수정·삭제) 뒤 `CACHE_WARM_DELAY_SEC`(기본 5)초 동안 추가 변경이 없으면
  scrims → full-events → fight-records → player-fight-stats 를 하나씩 계산해 둔다. pm2 로그 `[CACHE] warm <key> <ms>`.
  `CACHE_WARM=0` 이면 끈다(첫 요청이 계산).

- **프론트**: 환경변수가 아니라 `frontend/src/config.js`의 상수
  (`APP_NAME`, `BASE_TEAM`)를 직접 수정한 뒤 재빌드해 반영한다.
  백엔드 `BASE_TEAM`과 동일한 값으로 맞춰야 "우리 팀" 시점이 동작한다.

(기본값 정의: `backend/config.py:11`, `frontend/src/config.js:7,13`.)

## 4. 프론트 빌드

```bash
cd ~/app/frontend
npm ci
npm run build        # 산출물: frontend/dist
```

## 5. pm2로 백엔드 기동

```bash
cd ~/app/backend
pm2 start "./venv/bin/uvicorn main:app --host 127.0.0.1 --port 8000" \
    --name scrim-backend --cwd ~/app/backend
pm2 save
pm2 startup          # 출력된 명령을 sudo로 실행 → 부팅 시 자동 기동
```

pm2로 환경변수를 줄 때는 ecosystem 파일 사용:

```js
// ecosystem.config.js
module.exports = { apps: [{
  name: "scrim-backend",
  cwd: "/home/<user>/app/backend",
  script: "./venv/bin/uvicorn",
  args: "main:app --host 127.0.0.1 --port 8000",
  env: {
    BASE_TEAM: "MyTeam",
    // 선택 — 세션 등록 완료 디스코드 알림. 비우거나 생략하면 비활성(no-op).
    DISCORD_WEBHOOK_URL: ""
  }
}]};
```

> 위 앱명 `scrim-backend` 는 예시다 — 실서버 pm2 앱명은 환경마다 다를 수 있으니 `pm2 ls` 로 확인한다.
> env 를 바꾼 뒤에는 `pm2 restart <앱명> --update-env`(또는 ecosystem 으로 `pm2 startOrReload ecosystem.config.js --update-env`).

## 6. nginx

`/etc/nginx/sites-available/scrim` :

```nginx
# 응답 시간 기록: combined 뒤에 rt=$request_time(nginx 전체) urt=$upstream_response_time(백엔드) 를 덧붙인다.
# 앞부분은 combined 그대로라 goaccess --log-format=COMBINED 파싱도 그대로 된다(뒤 필드는 무시).
log_format scrim_timed '$remote_addr - $remote_user [$time_local] "$request" '
                       '$status $body_bytes_sent "$http_referer" "$http_user_agent" '
                       'rt=$request_time urt=$upstream_response_time';

server {
    listen 80;
    server_name _;
    access_log /var/log/nginx/access.log scrim_timed;

    root /home/<user>/app/frontend/dist;
    index index.html;

    # SPA 정적 서빙
    location / {
        try_files $uri /index.html;
    }

    # API 프록시
    location /api/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # WebSocket 프록시
    location /ws {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }

    # vite 개발 서버 경로 노출 차단
    location ~ /@fs/ { return 403; }

    # 설정/숨김 파일 차단
    location ~ /\. { return 404; }
    location ~* \.(env|ini|conf|config|yml|yaml|toml)$ { return 404; }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/scrim /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

느린 API 확인 — `/api/` 요청은 기본 `proxy_read_timeout` 60초를 넘으면 504 가 된다. `rt` 는 nginx 가 요청을 받은 뒤 응답을 다 보낼
때까지, `urt` 는 백엔드가 응답할 때까지(초). 백엔드에 닿지 않은 요청은 `urt=-`.

```bash
# 백엔드 응답이 5초 넘은 /api/ 요청
awk '/"(GET|POST|PATCH|DELETE) \/api\// { for (i = NF; i > 0; i--) if ($i ~ /^urt=/) { split($i, a, "="); if (a[2] + 0 > 5) print; break } }' /var/log/nginx/access.log
```

## 7. DB 백업 (sqlite .backup 일일 cron)

```bash
mkdir -p ~/backups
crontab -e
```

```cron
# 매일 04:30 — 온라인 백업(.backup은 잠금 안전) → gzip → 14일 지난 것 삭제
30 4 * * * sqlite3 /home/<user>/app/backend/data/scrim.db ".backup /home/<user>/backups/scrim-$(date +\%F).db" && gzip -f /home/<user>/backups/scrim-$(date +\%F).db && find /home/<user>/backups -name 'scrim-*.db.gz' -mtime +14 -delete
```

(DB 파일 경로는 `backend/config.py`의 DB 설정으로 확인.)

## 8. 업데이트 절차

```bash
cd ~/app
git pull
cd frontend && npm ci && npm run build
pm2 restart scrim-backend
```

스키마가 바뀐 경우: 백엔드 재시작만으로 자동 보정된다(기동 시 누락 컬럼 ADD COLUMN, 로그 `[DB] schema check`).

백엔드 의존성이 바뀐 경우:

```bash
cd ~/app/backend && ./venv/bin/pip install -r requirements.txt
```

## 9. DB 재구축 (rebuild-db)

`POST /api/admin/rebuild-db` 는 `meta.json` + 원문 로그로 DB 를 다시 만든다(화면: 스크림 세션 → Rebuild DB).
요청은 **202 `{job_id, started_at, state}` 로 바로 끝나고** 작업은 백그라운드에서 돈다 — nginx 60초 제한과 무관.
진행·결과는 `GET /api/admin/rebuild-db/status`(`state` idle·running·done·failed, `phase`, `sessions`·`matches`, `error`·`reason`).

```bash
curl -s -X POST http://127.0.0.1:8000/api/admin/rebuild-db
curl -s http://127.0.0.1:8000/api/admin/rebuild-db/status
```

- 운영 DB 사본 `scrim.db.rebuild-<job_id>.tmp`(같은 폴더) 위에서 재구축한 뒤 원자 교체한다. 그동안 조회는 기존 DB 로 계속 되고,
  쓰기 API(등록·업로드·편집·삭제·전술판 저장)와 중복 rebuild 는 **409**.
- 교체 직전 상태는 `scrim.db.before_rebuild_<시각>` 으로 남는다(하드링크 — 추가 공간 없음. 링크를 못 만드는 파일시스템이면 복사,
  로그 `[DB] backup hardlink unavailable`). 이 백업은 자동 정리되지 않는다 — 오래된 것은 직접 지운다.
  예: `find ~/app/backend/data -name 'scrim.db.before_rebuild_*' -mtime +30 -print` 로 확인한 뒤 같은 명령 끝에 `-delete`.
- 디스크 여유가 DB 크기×2 + 64MB 미만이면 시작하지 않고 **507**(status `reason` 에 free/need MB).
- 실패하면 임시 파일만 지우고 운영 DB 는 그대로(status `failed`, 로그 `[REBUILD] rebuild_database failed`).
- 작업 중 `pm2 restart` 하면 작업은 사라지고(운영 DB 는 교체 전이면 그대로, 교체는 원자라 옛/새 둘 중 하나) status 는 idle.
  남은 임시 파일은 다음 기동 때 지운다(로그 `[DB] stale rebuild files removed`).
- 로그: `[REBUILD] 시작 job=…` → `임시 사본` → `파싱 완료` → `완료: sessions=…` → `교체 완료(백업 link)` → `done job=…`.

## 10. 대회(공식 경기) 결과 등록

로그 없이 맵·맵 승패·출처 URL 만 남기는 대회 세션(`kind=tournament`)은 `backend/scripts/register_tournament.py` 로 등록한다
(등록 모달에는 없다). 경기 1개 = 세션 1개, 맵 = 수기 매치. 스크림 통계와 분리되어 화면·집계 기본값(스크림)에는 나오지 않고,
세션 목록 상단 필터 "대회"·"전체" 또는 API `?kind=tournament|all` 로 본다.

입력 JSON(형식은 스크립트 머리 주석이 정본):

```json
{"base_team": "Team A",
 "matches": [
  {"date": "2026-03-21", "start_hour": "16", "end_hour": "18", "opponent": "Team Z",
   "source_url": "https://liquipedia.net/overwatch/<대회 페이지>#<섹션>",
   "video_url": "https://youtu.be/<id>",
   "maps": [{"map": "부산", "winner": "Team A", "score": "2:0"},
            {"map": "이스페란사", "winner": "Team Z", "score": "63.70:110.47"}]}]}
```

- `score` 는 base_team:상대 순. 정수가 아니면(밀기 거리) 점수 0:0 + 매치 result 에 원문, 승자는 `winner` 로 명시.
- 세션명 기본 `YYMMDD-상대`(세션 목록이 첫 하이픈 뒤를 상대로 표시). 같은 날 두 경기는 시작 시각이 달라 세션 ID 가 갈린다.
- 출처는 Liquipedia 대회 페이지 + 섹션 앵커(경기 단위 페이지가 없다).

```bash
cd ~/app/backend
# 1) dry-run — 조회만, 등록 예정 목록과 맵 승패 출력
./venv/bin/python scripts/register_tournament.py --input /path/tournament.json --dry-run
# 2) 등록 — localhost API(기본 http://127.0.0.1:8000)
./venv/bin/python scripts/register_tournament.py --input /path/tournament.json
```

- **멱등**: `GET /api/scrims?kind=tournament` 의 (날짜·상대·source_url) 이 같으면 건너뛴다(`skip`). 같은 JSON 을 다시 실행해도
  0건 추가 — 이후 경기는 JSON 에 덧붙여 다시 실행하면 된다.
- 입력 검증(날짜·시각·URL·승자·점수 형식·입력 안 중복)에 하나라도 걸리면 아무것도 등록하지 않는다(종료 코드 1).
  등록 실패가 하나라도 있으면 종료 코드 1, 이미 등록된 것은 그대로.
- rebuild-db 중이면 등록 API 가 409 → 끝난 뒤 다시 실행. 디스코드 알림(`/complete`)은 보내지 않는다.
- 등록 뒤 서버 데이터(scrim.db·meta.json)를 커밋하는 절차는 스크림 등록과 같다.
- 잘못 등록한 세션은 세션 목록 "대회" 필터에서 선택 삭제한다(같은 JSON 재실행 시 다시 등록됨).
