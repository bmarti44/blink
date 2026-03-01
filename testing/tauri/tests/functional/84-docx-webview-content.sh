#!/bin/bash
source "$(dirname "$0")/../lib/test-client.sh"

TEST_LABEL="docx-webview-content"
TMP_DIR=""
FILENAME="content.docx"

setup() {
  TMP_DIR=$(mktemp -d /tmp/ob-docx-webview-XXXXXX)
  test_invoke "create_document" "{\"path\": \"$TMP_DIR/$FILENAME\"}" > /dev/null 2>&1
  test_invoke "apply_document_edits" "{\"path\": \"$TMP_DIR/$FILENAME\", \"edits\":[{\"type\":\"InsertHeading\",\"text\":\"Hello\",\"level\":1,\"position\":\"Start\"},{\"type\":\"InsertParagraph\",\"text\":\"World\",\"position\":\"End\",\"style\":null}]}" > /dev/null 2>&1
  OPEN_RESP=$(open_context_window "$TMP_DIR" "$TEST_LABEL" "DOCX Webview Content")
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

# Enable TipTap and open the DOCX via test hook
test_js "(function(){ window.__ENABLE_TIPTAP_DOCX__ = true; return true; })()" "$TEST_LABEL" >/dev/null 2>&1
test_js "window.__OPEN_DOCX_FOR_TEST__ && window.__OPEN_DOCX_FOR_TEST__('$TMP_DIR/$FILENAME')" "$TEST_LABEL" >/dev/null 2>&1

# Wait for render and read from webview iframe DOM (searches shadow roots)
tries=0
inner=""
while [ $tries -lt 60 ]; do
  # First, ask each iframe via postMessage to reply with text
  test_js "(function(){try{var ifrs=Array.from(document.querySelectorAll('iframe')); for(var i=0;i<ifrs.length;i++){ var w=ifrs[i].contentWindow; if(w && w.postMessage) { try{ w.postMessage({type:'ob:getText'}, '*'); }catch(e){} } } }catch(e){} return true;})()" "$TEST_LABEL" >/dev/null 2>&1
  inner=$(test_js "(window.__DOCX_WEBVIEW_BRIDGE_TEXT__||'')" "$TEST_LABEL" | jq -r '.result')
  if [[ -z "$inner" || "$inner" = "null" ]]; then
    inner=$(test_js "(function(){try{if(typeof window.__DOCX_GET_WEBVIEW_TEXT__==='function'){var s=window.__DOCX_GET_WEBVIEW_TEXT__(); if(s && s.includes('Hello') && s.includes('World')) return s;} }catch(e){} return ''})()" "$TEST_LABEL" | jq -r '.result')
  fi
  if [ -z "$inner" ] || [ "$inner" = "null" ]; then
    inner=$(test_js "(function(){try{var ifr=Array.from(document.querySelectorAll('iframe'));for(var i=0;i<ifr.length;i++){var d=ifr[i].contentDocument; if(!d) continue; var t=d.getElementById('tiptap-editor'); var dd=d.getElementById('doc'); var txt=(t&&t.textContent||'').trim(); if(!txt) txt=(dd&&dd.textContent||'').trim(); if(!txt && d.body) txt=(d.body.innerText||'').trim(); if(txt && txt.includes('Hello') && txt.includes('World')) return txt;} }catch(e){} return '';} )()" "$TEST_LABEL" | jq -r '.result')
  fi
  if [ -n "$inner" ] && [ "$inner" != "null" ]; then break; fi
  sleep 0.3
  tries=$((tries+1))
done

if [[ "$inner" != *"Hello"* ]] || [[ "$inner" != *"World"* ]]; then
  echo "Webview content missing expected text" >&2
  echo "--- Diagnostics ---" >&2
  test_js "(typeof window.__OPEN_DOCX_FOR_TEST__)" "$TEST_LABEL" | jq -r '.result' >&2
  test_js "(window.__DOCX_WEBVIEW_OPEN__===true)" "$TEST_LABEL" | jq -r '.result' >&2
  test_js "(window.__DOCX_OPEN_REQUESTED_PATH__||'')" "$TEST_LABEL" | jq -r '.result' >&2
  test_js "(window.__DOCX_IFRAME_COUNT__||0)" "$TEST_LABEL" | jq -r '.result' >&2
  test_js "(typeof window.__DOCX_LIST_IFRAMES__==='function'?window.__DOCX_LIST_IFRAMES__():'[]')" "$TEST_LABEL" | jq -r '.result' >&2
  test_js "(window.__DOCX_LAST_RENDER_LENGTH__||0)" "$TEST_LABEL" | jq -r '.result' >&2
  test_js "(window.__DOCX_WEBVIEW_INNER_TEXT__||'')" "$TEST_LABEL" | jq -r '.result' >&2
  test_js "(window.__DOCX_WEBVIEW_BRIDGE_TEXT__||'')" "$TEST_LABEL" | jq -r '.result' >&2
  exit 1
fi

echo "TEST_RESULTS:passed=1,failed=0,skipped=0"
