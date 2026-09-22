#!/usr/bin/env bash
# 데모 백엔드 실행 — http://127.0.0.1:8765 에서 데모(index.html)와 API를 함께 서빙
# 기상청 실데이터를 쓰려면 공공데이터포털 인증키를 환경변수로 넘긴다:
#   KMA_SERVICE_KEY='...' ./run.sh
cd "$(dirname "$0")"
python3 -c "import fastapi, uvicorn, httpx" 2>/dev/null || pip3 install fastapi uvicorn httpx
[ -f .env ] && set -a && . ./.env && set +a
exec python3 app.py
