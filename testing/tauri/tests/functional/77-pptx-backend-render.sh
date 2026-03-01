#!/bin/bash
source "$(dirname "$0")/../lib/test-client.sh"

TMP_DIR=""
FILENAME="deck.pptx"

setup() {
  TMP_DIR=$(mktemp -d /tmp/ob-pptx-backend-XXXXXX)
  test_invoke "create_document" "{\"path\": \"$TMP_DIR/$FILENAME\"}" > /dev/null 2>&1
}

teardown() {
  [ -n "$TMP_DIR" ] && rm -rf "$TMP_DIR" >/dev/null 2>&1
}

trap teardown EXIT
setup

test_01_render_document_html_returns_html_or_fallback() {
  local res=$(test_invoke "render_document_html" "{\"path\": \"$TMP_DIR/$FILENAME\"}")
  local html=$(echo "$res" | jq -r '.result // ""')
  if echo "$html" | grep -q "pptx-presentation"; then
    assert_contains "$html" "pptx-slide" "render_document_html should include slide container"
  else
    # Sidecar may be missing; ensure error string is present
    assert_contains "$html" "PowerPoint" "render_document_html should return some diagnostic output"
  fi
}

run_tests
