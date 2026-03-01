#!/bin/bash
source "$(dirname "$0")/../lib/test-client.sh"

TEST_LABEL="custom-editor-docx"
TMP_DIR=""
FILENAME="custom.docx"

setup() {
  TMP_DIR=$(mktemp -d /tmp/ob-custom-editor-XXXXXX)
  test_invoke "create_document" "{\"path\": \"$TMP_DIR/$FILENAME\"}" > /dev/null 2>&1
  open_context_window "$TMP_DIR" "$TEST_LABEL" "Custom Editor DOCX" >/dev/null 2>&1
  wait_for_window_bridge "$TEST_LABEL" 30 >/dev/null 2>&1
  wait_for_workbench 60 "$TEST_LABEL" >/dev/null 2>&1
}

teardown() {
  [ -n "$TEST_LABEL" ] && close_window "$TEST_LABEL" >/dev/null 2>&1
  [ -n "$TMP_DIR" ] && rm -rf "$TMP_DIR" >/dev/null 2>&1
}

trap teardown EXIT
setup

# Bypass our legacy docx interceptor to allow the CustomEditor to take precedence
test_js "(function(){ window.__BYPASS_DOCX_INTERCEPT__ = true; return true; })()" "$TEST_LABEL" >/dev/null 2>&1

# Open via default editor flow (should activate custom editor)
test_js "window.__TEST_OPEN_DEFAULT__ && window.__TEST_OPEN_DEFAULT__('$TMP_DIR/$FILENAME')" "$TEST_LABEL" >/dev/null 2>&1

# Poll for custom editor webview content containing 'Size:'
tries=0
found=""
while [ $tries -lt 60 ]; do
  found=$(test_js "(function(){try{var ifrs=Array.from(document.querySelectorAll('iframe'));for(var i=0;i<ifrs.length;i++){var d=ifrs[i].contentDocument; if(!d) continue; var txt=(d.body && d.body.innerText || '').trim(); if(txt.includes('Size:') && txt.includes('bytes')) return txt;} }catch(e){} return ''; })()" "$TEST_LABEL" | jq -r '.result')
  if [ -n "$found" ] && [ "$found" != "null" ]; then break; fi
  sleep 0.3
  tries=$((tries+1))
done

if [[ "$found" != *"Size:"* ]]; then
  echo "Custom editor content not found" >&2
  test_js "document.body.innerText.slice(0,500)" "$TEST_LABEL" | jq -r '.result' >&2
  exit 1
fi

echo "TEST_RESULTS:passed=1,failed=0,skipped=0"
