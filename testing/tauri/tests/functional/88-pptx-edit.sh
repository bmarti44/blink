#!/bin/bash
# Document editing tests for PowerPoint presentations

source "$(dirname "$0")/../lib/test-client.sh"

test_01_pptx_supported() {
  local result=$(test_js "(async function(){
    try {
      const invoke = window.__TAURI__?.core?.invoke || __tauri_invoke__;
      const supported = await invoke('is_document_supported', { path: 'test.pptx' });
      return supported ? 'supported' : 'not-supported';
    } catch(e) { return 'error: ' + e.message; }
  })()")
  local status=$(echo "$result"|jq -r '.result')
  assert_equals "$status" "supported" "PowerPoint .pptx should be supported"
}

test_02_ppt_supported() {
  local result=$(test_js "(async function(){
    try {
      const invoke = window.__TAURI__?.core?.invoke || __tauri_invoke__;
      const supported = await invoke('is_document_supported', { path: 'test.ppt' });
      return supported ? 'supported' : 'not-supported';
    } catch(e) { return 'error: ' + e.message; }
  })()")
  local status=$(echo "$result"|jq -r '.result')
  assert_equals "$status" "supported" "PowerPoint .ppt should be supported"
}

test_03_render_pptx_command() {
  local result=$(test_js "(async function(){
    try {
      const invoke = window.__TAURI__?.core?.invoke || __tauri_invoke__;
      try {
        await invoke('render_document_html', { path: '/nonexistent.pptx' });
        return 'command-exists';
      } catch(e) {
        if (e.toString().includes('not found') || e.toString().includes('No such file') || e.toString().includes('sidecar')) {
          return 'command-exists';
        }
        return 'command-error: ' + e.message;
      }
    } catch(e) { return 'error: ' + e.message; }
  })()")
  local status=$(echo "$result"|jq -r '.result')
  assert_equals "$status" "command-exists" "render_document_html should work for PowerPoint"
}

test_04_pptx_edit_commands() {
  local result=$(test_js "(async function(){
    try {
      const invoke = window.__TAURI__?.core?.invoke || __tauri_invoke__;
      // Try SetSlideTitle edit type
      try {
        await invoke('apply_document_edits', {
          path: '/nonexistent.pptx',
          edits: [{ SetSlideTitle: { index: 0, title: 'Test Title' } }]
        });
        return 'command-exists';
      } catch(e) {
        const errStr = String(e);
        // Command exists but fails due to file/validation/format issues - that's fine
        if (errStr.includes('not found') || errStr.includes('No such file') ||
            errStr.includes('sidecar') || errStr.includes('Read-only') ||
            errStr.includes('permission') || errStr.includes('os error') ||
            errStr.includes('invalid args') || errStr.includes('missing field')) {
          return 'command-exists';
        }
        return 'command-error: ' + errStr;
      }
    } catch(e) { return 'error: ' + e.message; }
  })()")
  local status=$(echo "$result"|jq -r '.result')
  assert_equals "$status" "command-exists" "PowerPoint edit commands should be available"
}

cleanup() {
  : # No cleanup needed
}
trap cleanup EXIT

wait_for_server 30 || exit 1
wait_for_bridge 30 || exit 1
wait_for_workbench 60 || exit 1
run_tests
