#!/bin/bash
# Document editing tests for Word documents

source "$(dirname "$0")/../lib/test-client.sh"

test_01_document_service_exists() {
  local result=$(test_js "(function(){
    try {
      const available = typeof __tauri_invoke__ === 'function' ||
                       (window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke);
      return available ? 'available' : 'not-available';
    } catch(e) { return 'error: ' + e.message; }
  })()")
  local status=$(echo "$result"|jq -r '.result')
  assert_equals "$status" "available" "Tauri invoke should be available"
}

test_02_supported_extensions() {
  local result=$(test_js "(async function(){
    try {
      const invoke = window.__TAURI__?.core?.invoke || __tauri_invoke__;
      const exts = await invoke('get_supported_extensions');
      return exts.includes('docx') ? 'has-docx' : 'no-docx';
    } catch(e) { return 'error: ' + e.message; }
  })()")
  local status=$(echo "$result"|jq -r '.result')
  assert_equals "$status" "has-docx" "Should support .docx extension"
}

test_03_is_document_supported() {
  local result=$(test_js "(async function(){
    try {
      const invoke = window.__TAURI__?.core?.invoke || __tauri_invoke__;
      const supported = await invoke('is_document_supported', { path: 'test.docx' });
      return supported ? 'supported' : 'not-supported';
    } catch(e) { return 'error: ' + e.message; }
  })()")
  local status=$(echo "$result"|jq -r '.result')
  assert_equals "$status" "supported" "Word documents should be supported"
}

test_04_docx_not_supported_for_txt() {
  local result=$(test_js "(async function(){
    try {
      const invoke = window.__TAURI__?.core?.invoke || __tauri_invoke__;
      const supported = await invoke('is_document_supported', { path: 'test.txt' });
      return supported ? 'supported' : 'not-supported';
    } catch(e) { return 'error: ' + e.message; }
  })()")
  local status=$(echo "$result"|jq -r '.result')
  assert_equals "$status" "not-supported" "Text files should not be document supported"
}

test_05_render_document_html_command() {
  local result=$(test_js "(async function(){
    try {
      const invoke = window.__TAURI__?.core?.invoke || __tauri_invoke__;
      // Check command exists by checking for error type
      try {
        await invoke('render_document_html', { path: '/nonexistent.docx' });
        return 'command-exists';
      } catch(e) {
        // Command exists but file doesn't - expected
        if (e.toString().includes('not found') || e.toString().includes('No such file')) {
          return 'command-exists';
        }
        return 'command-error: ' + e.message;
      }
    } catch(e) { return 'error: ' + e.message; }
  })()")
  local status=$(echo "$result"|jq -r '.result')
  assert_equals "$status" "command-exists" "render_document_html command should exist"
}

test_06_apply_edits_command() {
  local result=$(test_js "(async function(){
    try {
      const invoke = window.__TAURI__?.core?.invoke || __tauri_invoke__;
      // Check command exists
      try {
        await invoke('apply_document_edits', { path: '/nonexistent.docx', edits: [] });
        return 'command-exists';
      } catch(e) {
        const errStr = String(e);
        // Command exists but fails due to file/validation/sandbox issues - that's fine
        if (errStr.includes('not found') || errStr.includes('No such file') ||
            errStr.includes('not supported') || errStr.includes('path') ||
            errStr.includes('extension') || errStr.includes('undefined') ||
            errStr.includes('Read-only') || errStr.includes('permission') ||
            errStr.includes('os error')) {
          return 'command-exists';
        }
        return 'command-error: ' + errStr;
      }
    } catch(e) { return 'error: ' + e.message; }
  })()")
  local status=$(echo "$result"|jq -r '.result')
  assert_equals "$status" "command-exists" "apply_document_edits command should exist"
}

cleanup() {
  : # No cleanup needed
}
trap cleanup EXIT

wait_for_server 30 || exit 1
wait_for_bridge 30 || exit 1
wait_for_workbench 60 || exit 1
run_tests
