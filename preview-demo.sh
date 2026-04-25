#!/usr/bin/env bash
# preview-demo.sh — 생성된 데모 HTML을 로컬에서 띄우고 브라우저를 자동으로 연다.
#
# 사용법:
#   ./preview-demo.sh                       # 기본: worker/.test-cache/t3.4-final.html (T3.4 산출물)
#   ./preview-demo.sh latest                # 위와 동일 (alias)
#   ./preview-demo.sh <project_slug>        # {project_slug}/portfolio-demo/index.html
#   ./preview-demo.sh <path/to/dir>         # 임의 디렉터리 (index.html 가정)
#   ./preview-demo.sh <path/to/file.html>   # 특정 HTML 파일
#
# 환경변수:
#   PREVIEW_PORT=4173   포트 변경 시 사용
#   PREVIEW_NO_OPEN=1   브라우저 자동 오픈 비활성 (CI/테스트용)

set -euo pipefail

PORT="${PREVIEW_PORT:-4173}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ARG="${1:-}"

if [[ -z "$ARG" || "$ARG" == "latest" ]]; then
  TARGET_DIR="$ROOT/worker/.test-cache"
  ENTRY="t3.4-final.html"
  if [[ ! -f "$TARGET_DIR/$ENTRY" ]]; then
    echo "✗ T3.4 산출물이 없습니다: $TARGET_DIR/$ENTRY" >&2
    echo "  먼저 'cd worker && npm run test:assemble' 를 실행해 데모를 빌드하세요." >&2
    exit 1
  fi
elif [[ -d "$ROOT/$ARG/portfolio-demo" ]]; then
  TARGET_DIR="$ROOT/$ARG/portfolio-demo"
  ENTRY="index.html"
elif [[ -d "$ARG" ]]; then
  TARGET_DIR="$(cd "$ARG" && pwd)"
  ENTRY="index.html"
elif [[ -f "$ARG" ]]; then
  TARGET_DIR="$(cd "$(dirname "$ARG")" && pwd)"
  ENTRY="$(basename "$ARG")"
else
  echo "✗ 프리뷰 대상을 찾을 수 없습니다: $ARG" >&2
  echo "  사용법: $0 [<project_slug> | <path> | <file>]" >&2
  exit 1
fi

if [[ ! -f "$TARGET_DIR/$ENTRY" ]]; then
  echo "✗ 진입 파일 없음: $TARGET_DIR/$ENTRY" >&2
  exit 1
fi

URL="http://localhost:${PORT}/${ENTRY}"

echo "▶ 서빙: $TARGET_DIR"
echo "▶ URL : $URL"
echo "▶ 종료: Ctrl+C"

if [[ "${PREVIEW_NO_OPEN:-}" != "1" ]] && command -v open >/dev/null 2>&1; then
  ( sleep 0.7 && open "$URL" ) &
fi

cd "$TARGET_DIR"
exec python3 -m http.server "$PORT" --bind 127.0.0.1
