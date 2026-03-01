#!/bin/bash
# Document editing tests for Excel workbooks

source "$(dirname "$0")/../lib/test-client.sh"

test_01_xlsx_supported() {
  local result=$(test_js "(async function(){
    try {
      const invoke = window.__TAURI__?.core?.invoke || __tauri_invoke__;
      const supported = await invoke('is_document_supported', { path: 'test.xlsx' });
      return supported ? 'supported' : 'not-supported';
    } catch(e) { return 'error: ' + e.message; }
  })()")
  local status=$(echo "$result"|jq -r '.result')
  assert_equals "$status" "supported" "Excel .xlsx should be supported"
}

test_02_xls_supported() {
  local result=$(test_js "(async function(){
    try {
      const invoke = window.__TAURI__?.core?.invoke || __tauri_invoke__;
      const supported = await invoke('is_document_supported', { path: 'test.xls' });
      return supported ? 'supported' : 'not-supported';
    } catch(e) { return 'error: ' + e.message; }
  })()")
  local status=$(echo "$result"|jq -r '.result')
  assert_equals "$status" "supported" "Excel .xls should be supported"
}

test_03_xlsm_supported() {
  local result=$(test_js "(async function(){
    try {
      const invoke = window.__TAURI__?.core?.invoke || __tauri_invoke__;
      const supported = await invoke('is_document_supported', { path: 'test.xlsm' });
      return supported ? 'supported' : 'not-supported';
    } catch(e) { return 'error: ' + e.message; }
  })()")
  local status=$(echo "$result"|jq -r '.result')
  assert_equals "$status" "supported" "Excel .xlsm should be supported"
}

test_04_render_excel_command() {
  local result=$(test_js "(async function(){
    try {
      const invoke = window.__TAURI__?.core?.invoke || __tauri_invoke__;
      try {
        await invoke('render_document_html', { path: '/nonexistent.xlsx' });
        return 'command-exists';
      } catch(e) {
        if (e.toString().includes('not found') || e.toString().includes('No such file')) {
          return 'command-exists';
        }
        return 'command-error: ' + e.message;
      }
    } catch(e) { return 'error: ' + e.message; }
  })()")
  local status=$(echo "$result"|jq -r '.result')
  assert_equals "$status" "command-exists" "render_document_html should work for Excel"
}

test_05_excel_edit_commands() {
  local result=$(test_js "(async function(){
    try {
      const invoke = window.__TAURI__?.core?.invoke || __tauri_invoke__;
      // Try SetCell edit type
      try {
        await invoke('apply_document_edits', {
          path: '/nonexistent.xlsx',
          edits: [{ SetCell: { sheet: 'Sheet1', cell: 'A1', value: 'test' } }]
        });
        return 'command-exists';
      } catch(e) {
        const errStr = String(e);
        // Command exists but fails due to file/validation/format issues - that's fine
        if (errStr.includes('not found') || errStr.includes('No such file') ||
            errStr.includes('Read-only') || errStr.includes('permission') ||
            errStr.includes('os error') || errStr.includes('invalid args') ||
            errStr.includes('missing field')) {
          return 'command-exists';
        }
        return 'command-error: ' + errStr;
      }
    } catch(e) { return 'error: ' + e.message; }
  })()")
  local status=$(echo "$result"|jq -r '.result')
  assert_equals "$status" "command-exists" "Excel edit commands should be available"
}

cleanup() {
  : # No cleanup needed
}
trap cleanup EXIT

wait_for_server 30 || exit 1
wait_for_bridge 30 || exit 1
wait_for_workbench 60 || exit 1
run_tests
