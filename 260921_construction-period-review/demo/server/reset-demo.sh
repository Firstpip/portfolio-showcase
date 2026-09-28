#!/usr/bin/env bash
# 시연 기준 상태로 되돌린다 — 서버 검토 건을 기준 DB(reviews.baseline.db)로 복원.
# 리허설을 돌린 뒤, 그리고 미팅 당일 백엔드를 켜기 직전에 실행한다. (백엔드가 켜져 있으면 끄고 실행)
cd "$(dirname "$0")"
if lsof -tiTCP:8765 -sTCP:LISTEN >/dev/null 2>&1; then echo "백엔드가 켜져 있습니다. 먼저 끄고(CTRL+C) 다시 실행하세요."; exit 1; fi
[ -f reviews.baseline.db ] || { echo "reviews.baseline.db 없음"; exit 1; }
cp reviews.db "reviews.db.before-reset" 2>/dev/null
cp reviews.baseline.db reviews.db
echo "복원 완료 — 서버 검토 건 $(sqlite3 reviews.db 'select count(*) from reviews')건: $(sqlite3 reviews.db "select '#'||id||' '||site_name||' v'||latest_version from reviews" | tr '\n' ' ')"
