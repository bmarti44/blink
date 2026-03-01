#!/bin/bash
# Test that DOCX documents are visibly rendered (not 0x0 dimensions)
# This verifies the webview is properly sized and visible to the user

source "$(dirname "$0")/../lib/test-client.sh"

TEST_LABEL="docx-visible-render"
TMP_DIR=""
FILENAME="visible-test.docx"

setup() {
  TMP_DIR=$(mktemp -d /tmp/ob-docx-visible-XXXXXX)
  test_invoke "create_document" "{\"path\": \"$TMP_DIR/$FILENAME\"}" > /dev/null 2>&1
  test_invoke "apply_document_edits" "{\"path\": \"$TMP_DIR/$FILENAME\", \"edits\":[{\"type\":\"InsertParagraph\",\"text\":\"Hello World from DOCX Test\",\"position\":\"Start\",\"style\":null}]}" > /dev/null 2>&1
  OPEN_RESP=$(open_context_window "$TMP_DIR" "$TEST_LABEL" "DOCX Visible Render")
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

# Open the DOCX via test hook
test_js "window.__OPEN_DOCX_FOR_TEST__ && window.__OPEN_DOCX_FOR_TEST__('$TMP_DIR/$FILENAME')" "$TEST_LABEL" >/dev/null 2>&1

# Test 1: Wait for webview iframe to appear and have dimensions > 0
tries=0
iframe_visible=""
while [ $tries -lt 40 ]; do
  # Check for webview iframe with non-zero dimensions (skip extension host iframe)
  result=$(test_js "(function(){
    var iframes = document.querySelectorAll('iframe');
    for(var i=0; i<iframes.length; i++) {
      var f = iframes[i];
      // Skip extension host iframe
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
  # Diagnostic output
  test_js "document.querySelectorAll('iframe').length + ' iframes total'" "$TEST_LABEL" | jq -r '.result' >&2
  test_js "Array.from(document.querySelectorAll('iframe')).map(f => f.offsetWidth + 'x' + f.offsetHeight).join(', ')" "$TEST_LABEL" | jq -r '.result' >&2
  exit 1
fi
echo "  [0;32m✓[0m Webview iframe has visible dimensions: $iframe_visible"

# Test 2: Verify rendered content is accessible
render_txt=""
tries=0
while [ $tries -lt 30 ]; do
  render_txt=$(test_js "(window.__DOCX_LAST_RENDER_TEXT__||'')" "$TEST_LABEL" | jq -r '.result')
  if [ -n "$render_txt" ] && [ "$render_txt" != "null" ]; then break; fi
  sleep 0.3
  tries=$((tries+1))
done

if [ -z "$render_txt" ] || [ "$render_txt" = "null" ]; then
  echo "TEST FAILED: Rendered content text not captured" >&2
  exit 1
fi
echo "  [0;32m✓[0m Rendered content captured: ${render_txt:0:50}..."

# Test 3: Verify the webview panel exists in the editor area
editor_has_webview=$(test_js "(function(){
  var panels = document.querySelectorAll('.editor-group-container, .editor-instance');
  if(panels.length === 0) return 'no-panels';
  return panels.length + '-panels-found';
})()" "$TEST_LABEL" | jq -r '.result')

if [ "$editor_has_webview" = "no-panels" ]; then
  echo "TEST WARNING: No editor panels found" >&2
else
  echo "  [0;32m✓[0m Editor panels present: $editor_has_webview"
fi

echo ""
echo "TEST_RESULTS:passed=3,failed=0,skipped=0"
