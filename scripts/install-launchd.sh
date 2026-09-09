#!/usr/bin/env bash
# 데모 생성 워커를 launchd 에 등록/해제한다 (T8.12).
#
#   scripts/install-launchd.sh install     # 등록 + 즉시 시작
#   scripts/install-launchd.sh uninstall   # 중지 + 등록 해제
#   scripts/install-launchd.sh status      # 현재 상태
#   scripts/install-launchd.sh dry-run     # plist 만 생성해 보여주고 끝 (설치 안 함)
#
# 자격증명은 plist 가 아니라 worker/.env.local 에 둔다 (평문 plist 회피).
# GITHUB_TOKEN 이 거기 없으면 배포 단계에서 실패하므로 install 전에 확인한다.
set -euo pipefail

LABEL="co.firstpip.demo-worker"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKER_DIR="$REPO_ROOT/worker"
LOG_DIR="$HOME/Library/Logs/firstpip"
PLIST_DIR="$HOME/Library/LaunchAgents"
PLIST_PATH="$PLIST_DIR/$LABEL.plist"
TEMPLATE="$REPO_ROOT/scripts/$LABEL.plist.template"

die() { echo "❌ $*" >&2; exit 1; }

render() {
  local node_bin
  node_bin="$(command -v node)" || die "node 를 찾을 수 없습니다."
  [ -f "$WORKER_DIR/node_modules/tsx/dist/cli.mjs" ] || \
    die "tsx 가 없습니다. 먼저 'cd worker && npm install' 을 실행하세요."
  sed -e "s|__WORKER_DIR__|$WORKER_DIR|g" \
      -e "s|__NODE_BIN__|$node_bin|g" \
      -e "s|__LOG_DIR__|$LOG_DIR|g" \
      -e "s|__PATH__|$PATH|g" \
      "$TEMPLATE"
}

preflight() {
  [ -f "$WORKER_DIR/.env.local" ] || die "worker/.env.local 이 없습니다."
  grep -q '^SUPABASE_SERVICE_ROLE_KEY=' "$WORKER_DIR/.env.local" || \
    die "worker/.env.local 에 SUPABASE_SERVICE_ROLE_KEY 가 없습니다."
  if ! grep -q '^GITHUB_TOKEN=' "$WORKER_DIR/.env.local"; then
    echo "⚠️  worker/.env.local 에 GITHUB_TOKEN 이 없습니다."
    echo "   생성까지는 되지만 GitHub Pages 배포 단계에서 실패합니다."
  fi
}

case "${1:-}" in
  install)
    preflight
    mkdir -p "$LOG_DIR" "$PLIST_DIR"
    render > "$PLIST_PATH"
    plutil -lint "$PLIST_PATH" >/dev/null || die "plist 문법 오류"
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
    launchctl bootstrap "gui/$(id -u)" "$PLIST_PATH"
    launchctl enable "gui/$(id -u)/$LABEL"
    echo "✅ 등록 완료: $PLIST_PATH"
    echo "   로그: $LOG_DIR/demo-worker.log"
    ;;
  uninstall)
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
    rm -f "$PLIST_PATH"
    echo "✅ 등록 해제 완료 (로그는 $LOG_DIR 에 남습니다)"
    ;;
  status)
    if launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then
      echo "✅ 등록됨"
      launchctl print "gui/$(id -u)/$LABEL" | grep -E "state|pid|last exit" || true
    else
      echo "⚪️ 등록 안 됨"
    fi
    ;;
  dry-run)
    render
    ;;
  *)
    sed -n '2,10p' "$0"
    exit 1
    ;;
esac
