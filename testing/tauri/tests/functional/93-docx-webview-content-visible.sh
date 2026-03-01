#!/bin/bash
# Test that DOCX webview content is actually rendered and visible to the user
# This catches issues where the webview exists but content isn't displayed

source "$(dirname "$0")/../lib/test-client.sh"

TEST_LABEL="docx-webview-content-visible"
TMP_DIR=""
FILENAME="content-visible-test.docx"

setup() {
  TMP_DIR=$(mktemp -d /tmp/ob-docx-content-XXXXXX)
  test_invoke "create_document" "{\"path\": \"$TMP_DIR/$FILENAME\"}" > /dev/null 2>&1
  test_invoke "apply_document_edits" "{\"path\": \"$TMP_DIR/$FILENAME\", \"edits\":[{\"type\":\"InsertParagraph\",\"text\":\"UNIQUE_MARKER_12345 Test Content\",\"position\":\"Start\",\"style\":null}]}" > /dev/null 2>&1
  OPEN_RESP=$(open_context_window "$TMP_DIR" "$TEST_LABEL" "DOCX Content Visible")
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

# Test 1: Verify render was called with content
tries=0
render_text=""
while [ $tries -lt 40 ]; do
  render_text=$(test_js "(window.__DOCX_LAST_RENDER_TEXT__||'')" "$TEST_LABEL" | jq -r '.result')
  if [[ "$render_text" == *"UNIQUE_MARKER"* ]]; then
    break
  fi
  sleep 0.5
  tries=$((tries+1))
done

if [[ "$render_text" != *"UNIQUE_MARKER"* ]]; then
  echo "TEST FAILED: Render text doesn't contain expected marker" >&2
  echo "Got: ${render_text:0:100}" >&2
  exit 1
fi
echo "  [0;32m✓[0m Backend rendered content with marker"

# Test 2: Verify renderAck was received (webview processed the message)
render_len=$(test_js "(window.__DOCX_LAST_RENDER_LENGTH__||0)" "$TEST_LABEL" | jq -r '.result')
if [[ ! "$render_len" =~ ^[0-9]+$ ]] || [ "$render_len" -eq 0 ]; then
  echo "TEST FAILED: No renderAck received - webview didn't process render message" >&2
  echo "Render length: $render_len" >&2
  echo "" >&2
  echo "DIAGNOSIS: The webview iframe exists but the HTML content isn't being injected." >&2
  echo "The postMessage to render content isn't being received by the webview script." >&2
  echo "" >&2
  echo "Check:" >&2
  echo "1. webview.html must be set on the webview object" >&2
  echo "2. The webview HTML must include script to handle 'render' message type" >&2
  echo "3. CSP settings must allow script execution" >&2
  exit 1
fi
echo "  [0;32m✓[0m Webview acknowledged render (length: $render_len)"

# Test 3: Verify webview iframe has content (not just dimensions)
webview_has_content=$(test_js "(function(){
  var iframes = document.querySelectorAll('iframe.webview');
  for(var i=0; i<iframes.length; i++) {
    try {
      var doc = iframes[i].contentDocument;
      if(doc && doc.body) {
        var text = doc.body.innerText || '';
        if(text.includes('UNIQUE_MARKER')) return 'content-found';
        // Check for doc element
        var docEl = doc.getElementById('doc');
        if(docEl && docEl.innerHTML && docEl.innerHTML.length > 10) return 'doc-has-content';
        // Check for any substantial content
        if(doc.body.innerHTML && doc.body.innerHTML.length > 200) return 'body-has-content';
      }
    } catch(e) {}
  }
  return 'no-content';
})()" "$TEST_LABEL" | jq -r '.result')

if [ "$webview_has_content" = "no-content" ]; then
  echo "TEST FAILED: Webview iframe has no visible content" >&2
  echo "" >&2
  echo "DIAGNOSIS: The webview HTML wasn't properly set or loaded." >&2
  echo "The monaco webview container loaded but our custom HTML isn't inside it." >&2
  echo "" >&2
  echo "Common causes:" >&2
  echo "1. init.html in openWebview() isn't being used" >&2
  echo "2. webview.html needs to be set explicitly after openWebview()" >&2
  echo "3. Monaco webview service requires different initialization" >&2
  exit 1
fi
echo "  [0;32m✓[0m Webview iframe contains document content"

# Test 4: Verify the webview is in the editor area (not hidden)
webview_visible=$(test_js "(function(){
  var wv = document.querySelector('iframe.webview.ready');
  if(!wv) return 'no-ready-webview';
  if(wv.offsetWidth < 50 || wv.offsetHeight < 50) return 'too-small:' + wv.offsetWidth + 'x' + wv.offsetHeight;
  var style = getComputedStyle(wv);
  if(style.display === 'none') return 'display-none';
  if(style.visibility === 'hidden') return 'visibility-hidden';
  return 'visible:' + wv.offsetWidth + 'x' + wv.offsetHeight;
})()" "$TEST_LABEL" | jq -r '.result')

if [[ "$webview_visible" != visible:* ]]; then
  echo "TEST FAILED: Webview not visible to user" >&2
  echo "Status: $webview_visible" >&2
  exit 1
fi
echo "  [0;32m✓[0m Webview is visible in editor area: $webview_visible"

echo ""
echo "TEST_RESULTS:passed=4,failed=0,skipped=0"
