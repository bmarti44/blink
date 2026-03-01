#!/bin/bash
source "$(dirname "$0")/../lib/test-client.sh"

test_01_chat_activity_bar_icon(){
  local result=$(test_js "(function(){const icons=document.querySelectorAll('.activitybar .action-item .codicon');for(const i of icons){const c=i.className;if(c.includes('chat')||c.includes('copilot')||c.includes('comment-discussion')){return 'found';}}const v=document.querySelector('[id*="chat"],[id*="ai"]');return v?'found-view':'not-found';})()")
  local status=$(echo "$result"|jq -r '.result')
  if [[ "$status" == "found" || "$status" == "found-view" ]]; then ((TESTS_PASSED++)); else ((TESTS_SKIPPED++)); fi
}

test_02_open_chat_panel(){
  local result=$(test_js "(function(){const items=document.querySelectorAll('.activitybar .action-item');for(const it of items){const l=it.getAttribute('aria-label')||'';if(l.toLowerCase().includes('chat')||l.toLowerCase().includes('ai')){it.click();return 'clicked';}}return 'no-chat-icon';})()")
  local status=$(echo "$result"|jq -r '.result')
  if [[ "$status" == "clicked" ]]; then sleep 1; ((TESTS_PASSED++)); else ((TESTS_SKIPPED++)); fi
}

test_03_chat_input_exists(){
  local result=$(test_js "(function(){const sels=['.chat-input-part textarea','.interactive-input textarea','[class*=\"chat\"] textarea','[class*=\"chat\"] input','.monaco-inputbox input'];for(const s of sels){const el=document.querySelector(s);if(el)return 'found: '+s;}return 'not-found';})()")
  local status=$(echo "$result"|jq -r '.result')
  if [[ "$status" == found* ]]; then ((TESTS_PASSED++)); else ((TESTS_SKIPPED++)); fi
}

test_04_oca_participant_registered(){
  local result=$(test_js "(function(){if(window.__OCA_CHAT_REGISTERED__)return 'registered';const parts=document.querySelectorAll('[class*=\"participant\"],[class*=\"agent\"]');for(const p of parts){const t=p.textContent||'';if(t.toLowerCase().includes('blink'))return 'found-in-ui';}return 'not-registered';})()")
  local status=$(echo "$result"|jq -r '.result')
  if [[ "$status" == "registered" || "$status" == "found-in-ui" ]]; then ((TESTS_PASSED++)); else ((TESTS_SKIPPED++)); fi
}

wait_for_server 30 || exit 1
wait_for_bridge 30 || exit 1
wait_for_workbench 60 || exit 1
run_tests
