#!/usr/bin/env bash
# 미팅 당일 점검 — 시연 전에 한 번 실행한다.  사용: bash preflight.sh
#   백엔드가 꺼져 있으면: 환경·파일·계정 점검 후 기준 DB 로 되돌리고 "이제 bash run.sh" 를 안내
#   백엔드가 켜져 있으면: 위 점검 + 서버 연동(기상·AI·벡터·Word) 점검
cd "$(dirname "$0")"
PASS=0; WARN=0; FAIL=0
ok(){ echo "  ✔ $1"; PASS=$((PASS+1)); }
warn(){ echo "  ▲ $1"; WARN=$((WARN+1)); }
bad(){ echo "  ✘ $1"; FAIL=$((FAIL+1)); }
UP=0; lsof -tiTCP:8765 -sTCP:LISTEN >/dev/null 2>&1 && UP=1

echo "[1] 노트북 상태"
if docker info >/dev/null 2>&1; then
  N=$(docker ps -q 2>/dev/null | wc -l | tr -d ' ')
  warn "Docker 가 켜져 있습니다 (컨테이너 ${N}개). 다른 작업을 마쳤다면 Docker Desktop 을 종료하세요 — 데모가 느려집니다"
else ok "Docker 꺼짐"; fi
SW=$(sysctl -n vm.swapusage | sed -E 's/.*used = ([0-9.]+)M.*/\1/'); SWI=${SW%.*}
if [ "${SWI:-0}" -gt 2500 ]; then warn "스왑 사용 ${SW}MB — 쓰지 않는 앱과 브라우저 탭을 닫으세요"; else ok "스왑 사용 ${SW}MB"; fi
BAT=$(pmset -g batt | grep -o '[0-9]*%' | head -1); PWR=$(pmset -g batt | head -1 | grep -o "'.*'")
case "$PWR" in *AC*) ok "전원 연결됨 (배터리 $BAT)";; *) warn "배터리로 동작 중 ($BAT) — 충전기를 연결하세요";; esac
if curl -s -m 6 -o /dev/null https://api.anthropic.com 2>/dev/null; then ok "인터넷 연결됨"; else warn "인터넷 연결 안 됨 — AI 버튼 두 개가 동작하지 않습니다 (테더링)"; fi

echo "[2] 파일"
MISS=0
for f in ../index.html ../vendor/xlsx.full.min.js ../data/pumsem2026.pdf ../data/gosi_2024-1021.html ../data/guide_period_2026.pdf reviews.baseline.db app.py vector_index.py; do [ -s "$f" ] || { bad "없음: $f"; MISS=1; }; done
[ $MISS = 0 ] && ok "데모·원문 PDF·기준 DB"
if [ -s models/e5-small/model_quantized.onnx ] && [ -s models/e5-small/tokenizer.json ]; then ok "문장 임베딩 모델"; else warn "문장 임베딩 모델 없음 — bash get-model.sh (없어도 문자 방식으로 동작)"; fi
DM=0; for f in sample-boq.xlsx sample-boq-road.xlsx sample-boq-format2.xlsx sample-boq-format3.xlsx sample-std-add.xlsx; do cmp -s "$HOME/Desktop/시연파일/$f" "../$f" || DM=1; done
if [ $DM = 0 ]; then ok "바탕화면 시연파일 5개"; else mkdir -p "$HOME/Desktop/시연파일" && cp ../sample-boq.xlsx ../sample-boq-road.xlsx ../sample-boq-format2.xlsx ../sample-boq-format3.xlsx ../sample-std-add.xlsx "$HOME/Desktop/시연파일/" && ok "바탕화면 시연파일 5개 (방금 다시 복사)"; fi
if grep -q '^KMA_SERVICE_KEY=.\{20,\}' .env 2>/dev/null; then ok "기상청 인증키"; else bad "기상청 인증키 없음 (.env)"; fi
python3 -c "import fastapi, uvicorn, httpx, numpy, docx, onnxruntime, tokenizers" 2>/dev/null && ok "서버 실행 패키지" || bad "서버 실행 패키지 누락 — pip3 install -r requirements.txt"

echo "[3] AI 계정 (실제로 한 번 호출합니다, 약 10초)"
if command -v claude >/dev/null 2>&1; then
  T0=$(date +%s)
  R=$(cd .claude-empty 2>/dev/null || cd /tmp; echo "OK 두 글자만 답하세요" | claude -p --model "${DEMO_LLM_MODEL:-sonnet}" --output-format json --tools "" --dangerously-skip-permissions 2>&1)
  T1=$(date +%s)
  if echo "$R" | python3 -c "import sys,json; d=json.load(sys.stdin); sys.exit(0 if (not d.get('is_error')) and d.get('result') else 1)" 2>/dev/null; then ok "AI 호출 성공 ($((T1-T0))초)"; else bad "AI 호출 실패 — 터미널에서 claude 를 실행해 로그인 상태를 확인하세요: $(echo "$R" | head -c 160)"; fi
else bad "claude 명령 없음"; fi

echo "[4] 서버 검토 건"
if [ $UP = 0 ]; then
  cp reviews.db reviews.db.before-reset 2>/dev/null; cp reviews.baseline.db reviews.db
  ok "기준 상태로 되돌림 — $(sqlite3 reviews.db "select '#'||id||' '||substr(site_name,1,2)||' v'||latest_version from reviews" | tr '\n' ' ')"
else
  C=$(sqlite3 reviews.db 'select count(*) from reviews')
  if cmp -s reviews.db reviews.baseline.db; then ok "기준 상태 (1건)"; else warn "기준 상태가 아닙니다 (${C}건). 백엔드를 끄고 bash reset-demo.sh 후 다시 켜세요"; fi
fi

if [ $UP = 1 ]; then
  echo "[5] 서버 연동"
  H=$(curl -s -m 8 http://127.0.0.1:8765/api/health)
  chk(){ echo "$H" | python3 -c "import sys,json; d=json.load(sys.stdin); sys.exit(0 if $1 else 1)" 2>/dev/null; }
  chk "d['kma']" && ok "기상청 연동" || bad "기상청 연동 꺼짐"
  chk "d['llm']" && ok "AI 연동" || bad "AI 연동 꺼짐"
  chk "d['docx']" && ok "Word 출력" || bad "Word 출력 꺼짐"
  chk "'임베딩' in d['vector']" && ok "벡터 검색: 문장 임베딩" || warn "벡터 검색: 문자 방식 (모델 없음)"
  chk "all(s in d['kma_cached_stations'] for s in ['143','279'])" && ok "대구·구미 기상 자료 보관됨" || warn "대구·구미 기상 자료가 캐시에 없음 — 첫 화면에서 수집에 20초쯤 걸립니다"
  W=$(curl -s -m 60 -o /dev/null -w "%{http_code} %{time_total}" "http://127.0.0.1:8765/api/weather?station=143&start=2016&end=2025")
  [ "${W%% *}" = "200" ] && ok "대구 기상 10년 응답 (${W##* }초)" || bad "기상 응답 실패 ($W)"
  P=$(curl -s -m 8 -o /dev/null -w "%{http_code}" http://127.0.0.1:8765/vendor/xlsx.full.min.js)
  [ "$P" = "200" ] && ok "엑셀 파서 (로컬)" || bad "엑셀 파서 없음"
fi

echo
echo "결과: 통과 $PASS · 주의 $WARN · 실패 $FAIL"
if [ $FAIL -gt 0 ]; then echo "→ 실패 항목을 먼저 해결하세요."; exit 1; fi
if [ $UP = 0 ]; then echo "→ 이제  bash run.sh  로 백엔드를 켜고, 이 점검을 한 번 더 실행하면 서버 연동까지 확인합니다."; else echo "→ 브라우저에서 http://127.0.0.1:8765/ 를 열고 시나리오 2절 준비 순서를 따르세요."; fi
