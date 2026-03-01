#!/bin/bash
source "$(dirname "$0")/../lib/test-client.sh"

test_01_oca_service_exists() {
  local result=$(test_js "(function(){try{const svc=window.__AI_SERVICE__||(typeof getAIService==='function'&&getAIService());return svc?'loaded':'not-loaded';}catch(e){return 'error: '+e.message;}})()")
  local status=$(echo "$result"|jq -r '.result')
  assert_equals "$status" "loaded" "OCAService should be loaded"
}

test_02_token_state_initial() {
  local result=$(test_js "(function(){const svc=window.__AI_SERVICE__||getAIService();const s=svc.getTokenState();return JSON.stringify({hasAccessToken:!!s.accessToken,hasRefreshToken:!!s.refreshToken,hasExpiresTime:!!s.expiresTime});})()")
  assert_json_true "$result" ".success" "getTokenState should succeed"
}

test_03_has_valid_token() {
  local result=$(test_js "(function(){const svc=window.__AI_SERVICE__||getAIService();const v=svc.hasValidToken();return typeof v==='boolean'?'ok':'wrong-type';})()")
  local status=$(echo "$result"|jq -r '.result')
  assert_equals "$status" "ok" "hasValidToken should return boolean"
}

test_04_config_fields() {
  local result=$(test_js "(function(){const svc=window.__AI_SERVICE__||getAIService();const c=svc.config||{};const req=['endpoint','modelListEndpoint','idcsAuthUrl','model'];const missing=req.filter(k=>!c[k]);return missing.length===0?'ok':'missing: '+missing.join(', ');})()")
  local status=$(echo "$result"|jq -r '.result')
  assert_equals "$status" "ok" "Config should have all required fields"
}

test_05_token_lifecycle() {
  local set=$(test_js "(function(){const svc=window.__AI_SERVICE__||getAIService();svc.setTokens('test-access-token','test-refresh-token',3600);return svc.hasValidToken()?'has-token':'no-token';})()")
  local st=$(echo "$set"|jq -r '.result')
  assert_equals "$st" "has-token" "Should have token after setTokens"
  local clr=$(test_js "(function(){const svc=window.__AI_SERVICE__||getAIService();svc.clearTokens();return svc.hasValidToken()?'has-token':'no-token';})()")
  local cs=$(echo "$clr"|jq -r '.result')
  assert_equals "$cs" "no-token" "Should not have token after clearTokens"
}

test_06_cancel_exists() {
  local result=$(test_js "(function(){const svc=window.__AI_SERVICE__||getAIService();return typeof svc.cancel==='function'?'ok':'missing';})()")
  local status=$(echo "$result"|jq -r '.result')
  assert_equals "$status" "ok" "cancel method should exist"
}

cleanup() {
  test_js "(function(){const s=window.__AI_SERVICE__||getAIService();s.clearTokens();return 'cleaned';})()" >/dev/null 2>&1
}
trap cleanup EXIT

wait_for_server 30 || exit 1
wait_for_bridge 30 || exit 1
wait_for_workbench 60 || exit 1
run_tests
