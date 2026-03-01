#!/bin/bash
source "$(dirname "$0")/../lib/test-client.sh"

TEST_LABEL="docx-tab-rendered"
TMP_DIR=""
FILENAME="rendered.docx"

setup() {
  TMP_DIR=$(mktemp -d /tmp/ob-docx-tab-XXXXXX)
  test_invoke "create_document" "{\"path\": \"$TMP_DIR/$FILENAME\"}" > /dev/null 2>&1
  open_context_window "$TMP_DIR" "$TEST_LABEL" "DOCX Tab Rendered" >/dev/null 2>&1
  wait_for_window_bridge "$TEST_LABEL" 30 >/dev/null 2>&1
  wait_for_workbench 60 "$TEST_LABEL" >/dev/null 2>&1
}

teardown() {
  [ -n "$TEST_LABEL" ] && close_window "$TEST_LABEL" >/dev/null 2>&1
  [ -n "$TMP_DIR" ] && rm -rf "$TMP_DIR" >/dev/null 2>&1
}

trap teardown EXIT
setup

# Open the DOCX via test hook
test_js "window.__OPEN_DOCX_FOR_TEST__ && window.__OPEN_DOCX_FOR_TEST__('$TMP_DIR/$FILENAME')" "$TEST_LABEL" >/dev/null 2>&1

# Wait up to 10s for any tab to appear
found=""
for i in {1..20}; do
  count=$(test_js "document.querySelectorAll('.tabs-container .tab, [role=tab]').length" "$TEST_LABEL" | jq -r '.result')
  if [[ "$count" =~ ^[0-9]+$ && "$count" -gt 0 ]]; then
    found="yes"
    break
  fi
  sleep 0.5
done

if [ -z "$found" ]; then
  echo "No tabs found" >&2
  exit 1
fi

# Assert render metric is non-empty (wait for text or renderAck length)
tries=0
render_txt=""
render_len="0"
while [ $tries -lt 30 ]; do
  render_txt=$(test_js "(window.__DOCX_LAST_RENDER_TEXT__||'')" "$TEST_LABEL" | jq -r '.result')
  render_len=$(test_js "(window.__DOCX_LAST_RENDER_LENGTH__||0)" "$TEST_LABEL" | jq -r '.result')
  if { [ -n "$render_txt" ] && [ "$render_txt" != "null" ]; } || { [[ "$render_len" =~ ^[0-9]+$ ]] && [ "$render_len" -gt 0 ]; }; then break; fi
  sleep 0.3
  tries=$((tries+1))
done
if { [ -z "$render_txt" ] || [ "$render_txt" = "null" ]; } && { ! [[ "$render_len" =~ ^[0-9]+$ ]] || [ "$render_len" -le 0 ]; }; then
  echo "Rendered text empty" >&2
  exit 1
fi

echo "TEST_RESULTS:passed=2,failed=0,skipped=0"
