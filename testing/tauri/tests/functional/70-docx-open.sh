#!/bin/bash
# Reproduce binary/encoding warning when opening .docx from Explorer

source "$(dirname "$0")/../lib/test-client.sh"

TEST_LABEL="docx-ctx"
TMP_DIR=""
FILENAME="sample.docx"

setup_workspace() {
  TMP_DIR=$(mktemp -d /tmp/ob-docx-XXXXXX)
  dd if=/dev/urandom of="$TMP_DIR/$FILENAME" bs=1024 count=2 >/dev/null 2>&1
  open_context_window "$TMP_DIR" "$TEST_LABEL" "Docx Test" >/dev/null 2>&1
  wait_for_window_bridge "$TEST_LABEL" 30 >/dev/null 2>&1
  wait_for_workbench 60 "$TEST_LABEL" >/dev/null 2>&1
}

teardown_workspace() {
  [ -n "$TEST_LABEL" ] && close_window "$TEST_LABEL" >/dev/null 2>&1
  [ -n "$TMP_DIR" ] && rm -rf "$TMP_DIR" >/dev/null 2>&1
}

open_file_in_explorer() {
  local name="$1"
  open_view explorer "$TEST_LABEL" > /dev/null 2>&1
  wait_for_element ".explorer-viewlet" 10 "$TEST_LABEL" || true
  test_js "(function(){const rows=Array.from(document.querySelectorAll('.explorer-viewlet .monaco-list-row'));for(const row of rows){const label=row.querySelector('.label-name')?.textContent?.trim()||row.textContent?.trim();if(label==='$name'){['mousedown','mouseup','click','dblclick'].forEach(t=>row.dispatchEvent(new MouseEvent(t,{bubbles:true,cancelable:true,button:0})));return 'clicked';}}return 'not-found';})()" "$TEST_LABEL"
}

assert_no_binary_warning() {
  local res=$(test_js "document.body.textContent.includes('The file is not displayed in the text editor because it is either binary or uses an unsupported text encoding.') ? 'present' : 'absent'" "$TEST_LABEL")
  assert_json_equals "$res" ".result" "absent" "Binary/encoding warning should NOT be visible"
}

trap teardown_workspace EXIT

setup_workspace

test_01_open_docx_opens_without_binary_warning() {
  test_js "(function(){try{return typeof require==='function'}catch(e){return 'no-require'}})()" "$TEST_LABEL" >/dev/null 2>&1 || true
  test_js "__TEST_BRIDGE__&&__TEST_BRIDGE__.clearConsoleLogs(); 'cleared'" "$TEST_LABEL" >/dev/null 2>&1
  open_file_in_explorer "$FILENAME" >/dev/null 2>&1
  sleep 1.5
  assert_no_binary_warning
}

run_tests
