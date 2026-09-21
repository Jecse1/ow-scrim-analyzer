# 서버 배포 가이드 (Ubuntu + nginx + pm2)

Ubuntu 22.04/24.04, RAM 1GB 인스턴스(GCP e2-micro 등) 기준. Docker 없이
venv + pm2 + nginx로 구동하는 저사양 배포 절차. (Docker 배포는 README 참조.)

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

### 환경변수 (BASE_TEAM · APP_NAME)

- **백엔드**: `BASE_TEAM`만 읽는다(`backend/config.py:11`, `os.getenv` 방식 —
  .env 자동 로드는 없으므로 pm2 `env`로 주입한다. 아래 5단계 ecosystem 예시 참조).
  `APP_NAME`은 프론트 전용.

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
  env: { BASE_TEAM: "MyTeam" }
}]};
```

## 6. nginx

`/etc/nginx/sites-available/scrim` :

```nginx
server {
    listen 80;
    server_name _;

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

스키마가 바뀐 경우: 백엔드 재시작만으로 자동 보정된다(기동 시 누락 컬럼 ADD COLUMN, 로그 `[DB] schema check`). alembic으로 직접 적용할 때는 미스탬프 DB면 `alembic stamp <직전 리비전>` 후 `upgrade head`가 필요할 수 있다.

백엔드 의존성이 바뀐 경우:

```bash
cd ~/app/backend && ./venv/bin/pip install -r requirements.txt
```
