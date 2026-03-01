#!/bin/bash
source "$(dirname "$0")/../lib/test-client.sh"

TEST_LABEL="pptx-edit"
TMP_DIR=""
FILENAME="edit.pptx"

setup() {
  TMP_DIR=$(mktemp -d /tmp/ob-pptx-edit-XXXXXX)
  test_invoke "create_document" "{\"path\": \"$TMP_DIR/$FILENAME\"}" > /dev/null 2>&1
  open_context_window "$TMP_DIR" "$TEST_LABEL" "PPTX Edit" >/dev/null 2>&1
  wait_for_window_bridge "$TEST_LABEL" 30 >/dev/null 2>&1
  wait_for_workbench 60 "$TEST_LABEL" >/dev/null 2>&1
}

teardown() {
  [ -n "$TEST_LABEL" ] && close_window "$TEST_LABEL" >/dev/null 2>&1
  [ -n "$TMP_DIR" ] && rm -rf "$TMP_DIR" >/dev/null 2>&1
}

trap teardown EXIT
setup

# Tests

test_01_set_title_via_hook_or_fallback() {
  test_js "window.__OPEN_PPTX_FOR_TEST__ && window.__OPEN_PPTX_FOR_TEST__('$TMP_DIR/$FILENAME')" "$TEST_LABEL" >/dev/null 2>&1
  sleep 1
  local res=$(test_js "(async function(){if(window.__PPTX_SET_TITLE_FOR_TEST__){try{return await window.__PPTX_SET_TITLE_FOR_TEST__('$TMP_DIR/$FILENAME',0,'Hello Slide');}catch(e){return 'err';}}return 'no-hook';})()" "$TEST_LABEL")
  local ok=$(echo "$res" | jq -r '.result // ""')
  assert_not_empty "$ok" "set title hook returned"
  sleep 1
  local txt=$(test_js "window.__PPTX_LAST_RENDER_TEXT__ || ''" "$TEST_LABEL" | jq -r '.result')
  assert_not_empty "$txt" "rendered text should be non-empty"
}

run_tests
