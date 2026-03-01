#!/bin/bash
source "$(dirname "$0")/../lib/test-client.sh"

TMP_DIR=""
FILENAME="sheet.xlsx"

setup() {
  TMP_DIR=$(mktemp -d /tmp/ob-xlsx-backend-XXXXXX)
  test_invoke "create_document" "{\"path\": \"$TMP_DIR/$FILENAME\"}" > /dev/null 2>&1
  test_invoke "apply_document_edits" "{\"path\": \"$TMP_DIR/$FILENAME\", \"edits\":[{\"type\":\"SetCell\",\"sheet\":\"Sheet1\",\"cell\":\"A1\",\"value\":\"Hello\"},{\"type\":\"SetCell\",\"sheet\":\"Sheet1\",\"cell\":\"B1\",\"value\":\"123\"}]}" > /dev/null 2>&1
}

teardown() {
  [ -n "$TMP_DIR" ] && rm -rf "$TMP_DIR" >/dev/null 2>&1
}

trap teardown EXIT
setup

test_01_render_document_html_contains_excel_table() {
  local res=$(test_invoke "render_document_html" "{\"path\": \"$TMP_DIR/$FILENAME\"}")
  local html=$(echo "$res" | jq -r '.result // ""')
  assert_contains "$html" "excel-table" "render_document_html should contain excel table"
  assert_contains "$html" ">Hello<" "render_document_html should contain cell text"
  assert_contains "$html" ">123<" "render_document_html should contain number"
}

run_tests
