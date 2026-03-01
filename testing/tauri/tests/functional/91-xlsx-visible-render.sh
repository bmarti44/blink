#!/bin/bash
# Test that XLSX documents are visibly rendered (not 0x0 dimensions)

source "$(dirname "$0")/../lib/test-client.sh"

TEST_LABEL="xlsx-visible-render"
TMP_DIR=""
FILENAME="visible-test.xlsx"

setup() {
  TMP_DIR=$(mktemp -d /tmp/ob-xlsx-visible-XXXXXX)
  test_invoke "create_document" "{\"path\": \"$TMP_DIR/$FILENAME\"}" > /dev/null 2>&1
  OPEN_RESP=$(open_context_window "$TMP_DIR" "$TEST_LABEL" "XLSX Visible Render")
  echo "$OPEN_RESP" | jq -e '.success == true' >/dev/null 2>&1 || { echo "$OPEN_RESP" >&2; exit 1; }
  wait_for_window_bridge "$TEST_LABEL" 30 >/dev/null 2>&1
  wait_for_workbench 60 "$TEST_LABEL" >/dev/null 2>&1
}

teardown() {
  [ -n "$TEST_LABEL" ] && close_window "$TEST_LABEL" >/dev/null 2>&1
  [ -n "$TMP_DIR" ] && rm -rf "$TMP_DIR" >/dev/null 2>&1
}

trap teardown EXIT
setup

# Open the XLSX via test hook
test_js "window.__OPEN_XLSX_FOR_TEST__ && window.__OPEN_XLSX_FOR_TEST__('$TMP_DIR/$FILENAME')" "$TEST_LABEL" >/dev/null 2>&1

# Test 1: Wait for webview iframe to appear and have dimensions > 0
tries=0
iframe_visible=""
while [ $tries -lt 40 ]; do
  result=$(test_js "(function(){
    var iframes = document.querySelectorAll('iframe');
    for(var i=0; i<iframes.length; i++) {
      var f = iframes[i];
      if(f.className && f.className.includes('ext-host')) continue;
      if(f.offsetWidth > 50 && f.offsetHeight > 50) {
        return 'visible:' + f.offsetWidth + 'x' + f.offsetHeight;
      }
    }
    return 'no-visible-iframe';
  })()" "$TEST_LABEL" | jq -r '.result')

  if [[ "$result" == visible:* ]]; then
    iframe_visible="$result"
    break
  fi
  sleep 0.5
  tries=$((tries+1))
done

if [ -z "$iframe_visible" ]; then
  echo "TEST FAILED: No visible iframe with dimensions > 50x50" >&2
  exit 1
fi
echo "  [0;32m✓[0m Webview iframe has visible dimensions: $iframe_visible"

# Test 2: Verify tab label exists
tab_label=$(test_js "Array.from(document.querySelectorAll('.tab-label')).find(t => t.textContent.includes('xlsx') || t.textContent.includes('Excel'))?.textContent || 'not found'" "$TEST_LABEL" | jq -r '.result')
if [ "$tab_label" = "not found" ]; then
  echo "TEST FAILED: No Excel tab found" >&2
  exit 1
fi
echo "  [0;32m✓[0m Excel tab present: $tab_label"

echo ""
echo "TEST_RESULTS:passed=2,failed=0,skipped=0"
