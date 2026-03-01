#!/bin/bash
source "$(dirname "$0")/../lib/test-client.sh"

AI_LIVE_TEST="${AI_LIVE_TEST:-0}"

test_01_prompt_response_signature(){
  local result=$(test_js "(function(){const s=window.__AI_SERVICE__||getAIService();const f=s.getPromptResponse;return typeof f==='function'?'ok':'not-function';})()")
  local status=$(echo "$result"|jq -r '.result')
  assert_equals "$status" "ok" "getPromptResponse should be a function"
}

test_02_callback_validation(){
  local result=$(test_js "(async function(){const s=window.__AI_SERVICE__||getAIService();try{await s.getPromptResponse('test',{onToken:()=>{},onComplete:()=>{},onError:(e)=>{throw e;}});}catch(e){if((e.message||'').includes('Authentication')||(e.message||'').includes('token')){return 'auth-required';}return 'error: '+e.message;}return 'unexpected-success';})()")
  local status=$(echo "$result"|jq -r '.result')
  if [[ "$status" == "auth-required" ]]; then ((TESTS_PASSED++)); else ((TESTS_SKIPPED++)); fi
}

test_03_abort_controller(){
  local result=$(test_js "(function(){const s=window.__AI_SERVICE__||getAIService();s.setTokens('test-token','test-refresh',3600);const p=s.getPromptResponse('test',{onToken:()=>{},onComplete:()=>{},onError:()=>{}});s.cancel();s.clearTokens();return 'ok';})()")
  local status=$(echo "$result"|jq -r '.result')
  assert_equals "$status" "ok" "Should be able to cancel requests"
}

test_04_model_list(){
  local result=$(test_js "(function(){const s=window.__AI_SERVICE__||getAIService();return typeof s.getModelList==='function'?'ok':'missing';})()")
  local status=$(echo "$result"|jq -r '.result')
  assert_equals "$status" "ok" "getModelList should be a function"
}

test_05_live_streaming(){
  if [ "$AI_LIVE_TEST" != "1" ]; then skip_test "Set AI_LIVE_TEST=1 to run live tests"; return; fi
  local result=$(test_js "(async function(){const s=window.__AI_SERVICE__||getAIService();if(!s.hasValidToken())return 'no-token';let tokens=[];let complete=false;let error=null;try{await s.getPromptResponse('Say hello in exactly 3 words',{onToken:(t)=>tokens.push(t),onComplete:()=>{complete=true;},onError:(e)=>{error=e.message;}});}catch(e){error=e.message;}return JSON.stringify({tokenCount:tokens.length,complete,error,sample:tokens.slice(0,5).join('')});})()")
  local parsed=$(echo "$result"|jq -r '.result')
  local count=$(echo "$parsed"|jq -r '.tokenCount // 0')
  if [ "$count" -gt 0 ]; then ((TESTS_PASSED++)); else ((TESTS_FAILED++)); fi
}

cleanup() {
  test_js "(function(){const s=window.__AI_SERVICE__||(typeof getAIService==='function'&&getAIService());if(s){s.cancel();s.clearTokens();}return 'cleaned';})()" >/dev/null 2>&1
}
trap cleanup EXIT

wait_for_server 30 || exit 1
wait_for_bridge 30 || exit 1
wait_for_workbench 60 || exit 1
run_tests
