#!/bin/bash
source "$(dirname "$0")/../lib/test-client.sh"

TEST_LABEL="xlsx-edit"
TMP_DIR=""
FILENAME="edit.xlsx"

setup() {
  TMP_DIR=$(mktemp -d /tmp/ob-xlsx-edit-XXXXXX)
  test_invoke "create_document" "{\"path\": \"$TMP_DIR/$FILENAME\"}" > /dev/null 2>&1
  open_context_window "$TMP_DIR" "$TEST_LABEL" "XLSX Edit" >/dev/null 2>&1
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

test_01_edit_cell_via_hook() {
  test_js "window.__OPEN_XLSX_FOR_TEST__ && window.__OPEN_XLSX_FOR_TEST__('$TMP_DIR/$FILENAME')" "$TEST_LABEL" >/dev/null 2>&1
  sleep 1
  local res=$(test_js "(async function(){if(window.__XLSX_SET_CELL_FOR_TEST__){return await window.__XLSX_SET_CELL_FOR_TEST__('$TMP_DIR/$FILENAME','Sheet1','C1','Edited');}return 'no-hook';})()" "$TEST_LABEL")
  local ok=$(echo "$res" | jq -r '.result // ""')
  assert_not_empty "$ok" "set cell hook should return truthy"
  sleep 1
  local txt=$(test_js "window.__XLSX_LAST_RENDER_TEXT__ || ''" "$TEST_LABEL" | jq -r '.result')
  assert_contains "$txt" "Edited" "rendered text should include Edited"
  local html=$(test_invoke "render_document_html" "{\"path\": \"$TMP_DIR/$FILENAME\"}")
  local body=$(echo "$html" | jq -r '.result // ""')
  assert_contains "$body" ">Edited<" "backend render should include Edited"
}

run_tests
