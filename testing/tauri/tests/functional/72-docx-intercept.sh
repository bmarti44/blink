#!/bin/bash
source "$(dirname "$0")/../lib/test-client.sh"

TEST_LABEL="docx-intercept"
FILENAME="valid.docx"
ERR_MSG="The file is not displayed in the text editor because it is either binary or uses an unsupported text encoding."

setup() {
  TMP_DIR=$(mktemp -d /tmp/ob-docx-int-XXXXXX)
  test_invoke "create_document" "{\"path\": \"$TMP_DIR/$FILENAME\"}" > /dev/null 2>&1
  test_invoke "apply_document_edits" "{\"path\": \"$TMP_DIR/$FILENAME\", \"edits\":[{\"type\":\"InsertHeading\",\"text\":\"Hello\",\"level\":1,\"position\":\"Start\"},{\"type\":\"InsertParagraph\",\"text\":\"World\",\"position\":\"End\",\"style\":null}]}" > /dev/null 2>&1
  open_context_window "$TMP_DIR" "$TEST_LABEL" "Docx Intercept" >/dev/null 2>&1
  wait_for_window_bridge "$TEST_LABEL" 30 >/dev/null 2>&1
  wait_for_workbench 60 "$TEST_LABEL" >/dev/null 2>&1
}

teardown() {
  [ -n "$TEST_LABEL" ] && close_window "$TEST_LABEL" >/dev/null 2>&1
  [ -n "$TMP_DIR" ] && rm -rf "$TMP_DIR" >/dev/null 2>&1
}

open_docx_via_command() {
  open_view explorer "$TEST_LABEL" > /dev/null 2>&1
  wait_for_element ".explorer-viewlet" 10 "$TEST_LABEL" || true
  test_js "(function(){const rows=Array.from(document.querySelectorAll('.explorer-viewlet .monaco-list-row'));for(const row of rows){const label=row.querySelector('.label-name')?.textContent?.trim()||row.textContent?.trim();if(label==='$FILENAME'){['mousedown','mouseup','click','dblclick'].forEach(t=>row.dispatchEvent(new MouseEvent(t,{bubbles:true,cancelable:true,button:0})));return 'opened';}}return 'not-found';})()" "$TEST_LABEL"
}

assert_intercepted() {
  local logs=$(test_console 200 "$TEST_LABEL")
  echo "$logs" | jq -r '.[].message // ""' | grep -q "DocxResolver" && return 0 || return 1
}

assert_no_binary_warning() {
  local res=$(test_js "document.body.textContent.includes('$ERR_MSG') ? 'present' : 'absent'" "$TEST_LABEL")
  assert_json_equals "$res" ".result" "absent" "Binary/encoding warning should NOT be visible (intercept)"
  local tries=0
  local txt=""
  while [ $tries -lt 10 ]; do
    local html=$(test_js "(function(){return (window.__DOCX_LAST_RENDER_TEXT__||'').slice(0,200)})()" "$TEST_LABEL")
    txt=$(echo "$html" | jq -r '.result')
    if [ -n "$txt" ] && [ "$txt" != "null" ]; then break; fi
    sleep 0.3
    tries=$((tries+1))
  done
  assert_not_empty "$txt" "Rendered DOCX should not be empty (intercept)"
}

trap teardown EXIT
setup

test_01_intercept_logs_present() {
  open_docx_via_command >/dev/null 2>&1
  sleep 1
  test_js "window.__OPEN_DOCX_FOR_TEST__ && window.__OPEN_DOCX_FOR_TEST__('$TMP_DIR/$FILENAME')" "$TEST_LABEL" >/dev/null 2>&1
  sleep 1
  if assert_intercepted; then
    echo "  $(printf '\033[0;32m✓\033[0m') DocxResolver logs present"
    ((TESTS_PASSED++))
  else
    echo "  $(printf '\033[0;31m✗\033[0m') DocxResolver logs not found"
    ((TESTS_FAILED++))
  fi
}

test_02_no_binary_warning_after_intercept() {
  open_docx_via_command >/dev/null 2>&1
  sleep 1
  assert_no_binary_warning
}

run_tests
