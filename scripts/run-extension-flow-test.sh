#!/bin/bash
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TEST_DIR="$ROOT_DIR/testing/tauri"
source "$TEST_DIR/utils.sh"

check_dependencies >/dev/null 2>&1 || true
LOG_FILE="/tmp/blink-test.log"
start_app "$LOG_FILE"
wait_for_app 180 "$LOG_FILE" || { echo "App not ready"; stop_app; exit 1; }
"$TEST_DIR/tests/functional/33-extension-install-flow.sh"
EXIT_CODE=$?
stop_app
exit $EXIT_CODE
