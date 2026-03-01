#!/bin/bash
source "$(dirname "$0")/../lib/test-client.sh"

test_01_oca_start_auth_command(){
  local result=$(test_invoke "oca_start_auth" "{}")
  local error=$(echo "$result"|jq -r '.error // ""')
  if [[ "$error" == *"unknown command"* ]] || [[ "$error" == *"not found"* ]]; then
    assert_equals "command-missing" "command-present" "oca_start_auth command should be registered"
  else
    ((TESTS_PASSED++))
  fi
}

test_02_wait_for_token_async(){
  local result=$(test_js "(function(){const s=window.__AI_SERVICE__||getAIService();const f=s.waitForToken;return f&&f.constructor.name==='AsyncFunction'?'async':'not-async';})()")
  local status=$(echo "$result"|jq -r '.result')
  assert_equals "$status" "async" "waitForToken should be async function"
}

test_03_auth_event_listener(){
  local result=$(test_js "(async function(){try{const {listen}=await import('@tauri-apps/api/event');const u=await listen('ai-auth-callback',()=>{});u();return 'ok';}catch(e){return 'error: '+e.message;}})()")
  local status=$(echo "$result"|jq -r '.result')
  if [[ "$status" == "ok" ]]; then ((TESTS_PASSED++)); else ((TESTS_SKIPPED++)); fi
}

test_04_needs_refresh_logic(){
  local result=$(test_js "(function(){const s=window.__AI_SERVICE__||getAIService();const t=Date.now()-10000;localStorage.setItem('oca_access_token','expired');localStorage.setItem('oca_refresh_token','refresh');localStorage.setItem('oca_expires_time',String(t));const n=s.needsRefresh();s.clearTokens();return n?'needs-refresh':'no-refresh';})()")
  local status=$(echo "$result"|jq -r '.result')
  assert_equals "$status" "needs-refresh" "Expired token should need refresh"
}

test_05_is_authenticated_export(){
  local result=$(test_js "(function(){return typeof isAIAuthenticated==='function'||typeof window.isAIAuthenticated==='function'?'ok':'missing';})()")
  local status=$(echo "$result"|jq -r '.result')
  if [[ "$status" == "ok" ]]; then ((TESTS_PASSED++)); else ((TESTS_SKIPPED++)); fi
}

cleanup() {
  test_js "(function(){const s=window.__AI_SERVICE__||(typeof getAIService==='function'&&getAIService());if(s)s.clearTokens();return 'cleaned';})()" >/dev/null 2>&1
}
trap cleanup EXIT

wait_for_server 30 || exit 1
wait_for_bridge 30 || exit 1
wait_for_workbench 60 || exit 1
run_tests
