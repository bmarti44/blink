#!/bin/bash
source "$(dirname "$0")/../lib/test-client.sh"

TEST_LABEL="pptx-open"
TMP_DIR=""
FILENAME="deck.pptx"

setup() {
  TMP_DIR=$(mktemp -d /tmp/ob-pptx-open-XXXXXX)
  test_invoke "create_document" "{\"path\": \"$TMP_DIR/$FILENAME\"}" > /dev/null 2>&1
  # Apply simple edits via sidecar-backed backend may be limited, just open and render
  open_context_window "$TMP_DIR" "$TEST_LABEL" "PPTX Open" >/dev/null 2>&1
  wait_for_window_bridge "$TEST_LABEL" 30 >/dev/null 2>&1
  wait_for_workbench 60 "$TEST_LABEL" >/dev/null 2>&1
}

teardown() {
  [ -n "$TEST_LABEL" ] && close_window "$TEST_LABEL" >/dev/null 2>&1
  [ -n "$TMP_DIR" ] && rm -rf "$TMP_DIR" >/dev/null 2>&1
}

open_pptx_editor() {
  open_view explorer "$TEST_LABEL" > /dev/null 2>&1
  wait_for_element ".explorer-viewlet" 10 "$TEST_LABEL" || true
  test_js "(function(){const rows=Array.from(document.querySelectorAll('.explorer-viewlet .monaco-list-row'));for(const row of rows){const label=row.querySelector('.label-name')?.textContent?.trim()||row.textContent?.trim();if(label=='$FILENAME'){['mousedown','mouseup','click','dblclick'].forEach(t=>row.dispatchEvent(new MouseEvent(t,{bubbles:true,cancelable:true,button:0})));return 'opened';}}return 'not-found';})()" "$TEST_LABEL"
}

assert_rendered() {
  local logs=$(test_console 200 "$TEST_LABEL")
  echo "$logs" | jq -r '.[].message // ""' | grep -q "PptxResolver" || return 1
  local txt=$(test_js "(function(){return (window.__PPTX_LAST_RENDER_TEXT__||'').slice(0,200)})()" "$TEST_LABEL" | jq -r '.result')
  [ -n "$txt" ] || return 1
}

trap teardown EXIT
setup

test_01_open_pptx_renders() {
  open_pptx_editor >/dev/null 2>&1
  sleep 2
  local ok=$(test_js "(function(){return !!window.__PPTX_LAST_RENDER_TEXT__})()" "$TEST_LABEL" | jq -r '.result')
  if [ "$ok" != "true" ]; then
    test_js "window.__OPEN_PPTX_FOR_TEST__ && window.__OPEN_PPTX_FOR_TEST__('$TMP_DIR/$FILENAME')" "$TEST_LABEL" >/dev/null 2>&1
    sleep 1
  fi
  assert_rendered
}

run_tests
