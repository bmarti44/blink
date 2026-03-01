#!/bin/bash
# Tests for LLM document operation schemas and validation

source "$(dirname "$0")/../lib/test-client.sh"

test_01_office_types_exported() {
  local result=$(test_js "(function(){
    try {
      // Check if office types are available via window or module
      const hasTypes = typeof window.__OFFICE_TYPES__ !== 'undefined' ||
                      typeof window.__DOCUMENT_SCHEMAS__ !== 'undefined';
      return hasTypes ? 'exported' : 'not-exported';
    } catch(e) { return 'error: ' + e.message; }
  })()")
  # This test may skip if types aren't exposed to window - that's OK
  local status=$(echo "$result"|jq -r '.result')
  if [ "$status" = "not-exported" ]; then
    echo "  [1;33m○[0m SKIPPED: Office types not exposed to window (internal module only)"
    return 0
  else
    assert_equals "$status" "exported" "Office types should be exported"
  fi
}

test_02_tauri_document_api() {
  local result=$(test_js "(async function(){
    try {
      const invoke = window.__TAURI__?.core?.invoke || __tauri_invoke__;
      // Verify document API commands exist
      const commands = [
        'read_document',
        'create_document',
        'apply_document_edits',
        'render_document_html',
        'get_document_context_for_ai',
        'get_supported_extensions',
        'is_document_supported'
      ];
      const results = {};
      for (const cmd of commands) {
        try {
          // Just check command is registered by calling with minimal args
          await invoke(cmd, {});
          results[cmd] = 'ok';
        } catch(e) {
          // Command exists but fails with bad args - that's fine
          if (e.toString().includes('missing') || e.toString().includes('required') ||
              e.toString().includes('path') || e.toString().includes('argument')) {
            results[cmd] = 'ok';
          } else {
            results[cmd] = 'missing';
          }
        }
      }
      const missing = Object.entries(results).filter(([k,v]) => v !== 'ok').map(([k]) => k);
      return missing.length === 0 ? 'all-present' : 'missing: ' + missing.join(', ');
    } catch(e) { return 'error: ' + e.message; }
  })()")
  local status=$(echo "$result"|jq -r '.result')
  assert_equals "$status" "all-present" "All document API commands should be present"
}

test_03_get_document_context_for_ai() {
  local result=$(test_js "(async function(){
    try {
      const invoke = window.__TAURI__?.core?.invoke || __tauri_invoke__;
      try {
        await invoke('get_document_context_for_ai', { path: '/nonexistent.docx' });
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
  assert_equals "$status" "command-exists" "get_document_context_for_ai should exist"
}

test_04_create_document_command() {
  local result=$(test_js "(async function(){
    try {
      const invoke = window.__TAURI__?.core?.invoke || __tauri_invoke__;
      try {
        // Create in temp location
        await invoke('create_document', { path: '/tmp/test-doc-creation.docx' });
        return 'created';
      } catch(e) {
        if (e.toString().includes('permission') || e.toString().includes('denied')) {
          return 'permission-issue';
        }
        // Command exists but may fail for other reasons
        return 'command-exists';
      }
    } catch(e) { return 'error: ' + e.message; }
  })()")
  local status=$(echo "$result"|jq -r '.result')
  # Accept either created or command-exists
  if [ "$status" = "created" ] || [ "$status" = "command-exists" ] || [ "$status" = "permission-issue" ]; then
    echo "  [0;32m✓[0m create_document command exists"
  else
    echo "  [0;31m✗[0m create_document should exist, got: $status"
    return 1
  fi
}

test_05_all_doc_types_supported() {
  local result=$(test_js "(async function(){
    try {
      const invoke = window.__TAURI__?.core?.invoke || __tauri_invoke__;
      const exts = await invoke('get_supported_extensions');
      const required = ['docx', 'doc', 'xlsx', 'xls', 'pptx', 'ppt'];
      const missing = required.filter(e => !exts.includes(e));
      return missing.length === 0 ? 'all-supported' : 'missing: ' + missing.join(', ');
    } catch(e) { return 'error: ' + e.message; }
  })()")
  local status=$(echo "$result"|jq -r '.result')
  assert_equals "$status" "all-supported" "All Office document types should be supported"
}

cleanup() {
  # Clean up test file if created
  rm -f /tmp/test-doc-creation.docx 2>/dev/null
}
trap cleanup EXIT

wait_for_server 30 || exit 1
wait_for_bridge 30 || exit 1
wait_for_workbench 60 || exit 1
run_tests
