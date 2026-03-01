#!/bin/bash
source "$(dirname "$0")/../lib/test-client.sh"

TEST_LABEL="docx-tiptap-ready"
TMP_DIR=""
FILENAME="tiptap-ready.docx"

setup() {
  TMP_DIR=$(mktemp -d /tmp/ob-docx-tiptap-ready-XXXXXX)
  test_invoke "create_document" "{\"path\": \"$TMP_DIR/$FILENAME\"}" > /dev/null 2>&1
  open_context_window "$TMP_DIR" "$TEST_LABEL" "DOCX TipTap Ready" >/dev/null 2>&1
  wait_for_window_bridge "$TEST_LABEL" 30 >/dev/null 2>&1
  wait_for_workbench 60 "$TEST_LABEL" >/dev/null 2>&1
}

teardown() {
  [ -n "$TEST_LABEL" ] && close_window "$TEST_LABEL" >/dev/null 2>&1
  [ -n "$TMP_DIR" ] && rm -rf "$TMP_DIR" >/dev/null 2>&1
}

trap teardown EXIT
setup

# Enable TipTap flag
test_js "(function(){ window.__ENABLE_TIPTAP_DOCX__ = true; return true; })()" "$TEST_LABEL" >/dev/null 2>&1

# Open the DOCX via test hook
test_js "window.__OPEN_DOCX_FOR_TEST__ && window.__OPEN_DOCX_FOR_TEST__('$TMP_DIR/$FILENAME')" "$TEST_LABEL" >/dev/null 2>&1
sleep 2

tries=0
active="false"
while [ $tries -lt 20 ]; do
  active=$(test_js "!!window.__DOCX_TIPTAP_ACTIVE__" "$TEST_LABEL" | jq -r '.result')
  [ "$active" = "true" ] && break
  sleep 0.3
  tries=$((tries+1))
done
if [ "$active" != "true" ]; then
  echo "TipTap flag not active" >&2
  exit 1
fi

tries=0
has_chain="false"
while [ $tries -lt 30 ]; do
  has_chain=$(test_js "!!window.__DOCX_TIPTAP_HAS_CHAIN__" "$TEST_LABEL" | jq -r '.result')
  [ "$has_chain" = "true" ] && break
  sleep 0.3
  tries=$((tries+1))
done
if [ "$has_chain" != "true" ]; then
  echo "TipTap chain not initialized" >&2
  exit 1
fi

tries=0
render_txt=""
while [ $tries -lt 20 ]; do
  render_txt=$(test_js "(window.__DOCX_LAST_RENDER_TEXT__||'')" "$TEST_LABEL" | jq -r '.result')
  if [ -n "$render_txt" ] && [ "$render_txt" != "null" ]; then break; fi
  sleep 0.3
  tries=$((tries+1))
done
if [ -z "$render_txt" ]; then
  echo "Rendered text empty" >&2
  exit 1
fi

echo "TEST_RESULTS:passed=3,failed=0,skipped=0"
