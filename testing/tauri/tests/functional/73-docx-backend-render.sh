#!/bin/bash
source "$(dirname "$0")/../lib/test-client.sh"

TEST_LABEL="docx-backend"
TMP_DIR=""
FILENAME="valid.docx"

setup() {
  TMP_DIR=$(mktemp -d /tmp/ob-docx-backend-XXXXXX)
  test_invoke "create_document" "{\"path\": \"$TMP_DIR/$FILENAME\"}" > /dev/null 2>&1
  test_invoke "apply_document_edits" "{\"path\": \"$TMP_DIR/$FILENAME\", \"edits\":[{\"type\":\"InsertHeading\",\"text\":\"Hello\",\"level\":1,\"position\":\"Start\"},{\"type\":\"InsertParagraph\",\"text\":\"World\",\"position\":\"End\",\"style\":null}]}" > /dev/null 2>&1
}

teardown() {
  [ -n "$TMP_DIR" ] && rm -rf "$TMP_DIR" >/dev/null 2>&1
}

trap teardown EXIT
setup

test_01_render_document_html_contains_text() {
  local res=$(test_invoke "render_document_html" "{\"path\": \"$TMP_DIR/$FILENAME\"}" "$TEST_LABEL")
  local html=$(echo "$res" | jq -r '.result // ""')
  assert_contains "$html" "Hello" "render_document_html should contain Hello"
  assert_contains "$html" "World" "render_document_html should contain World"
}

run_tests
