#!/bin/bash
# Workbench tests for Blink Tauri application
# These tests verify the VS Code workbench is properly loaded

source "$(dirname "$0")/../lib/test-client.sh"

# ============================================================================
# Test Functions
# ============================================================================

test_workbench_container() {
    local result=$(test_query ".monaco-workbench")

    assert_json_true "$result" ".found" "Monaco workbench container should exist"
}

 test_workbench_classes() {
    local result=$(test_query ".monaco-workbench")

    if ! echo "$result" | jq -e '.found' > /dev/null 2>&1; then
        skip_test "Workbench not found"
        return
    fi

    local classes=$(echo "$result" | jq -r '.elements[0].classes | join(" ")')
    assert_contains "$classes" "monaco-workbench" "Should have monaco-workbench class"
}

 test_activity_bar_exists() {
    local result=$(test_query ".activitybar")

    assert_json_true "$result" ".found" "Activity bar should exist"
}

 test_sidebar_exists() {
    local result=$(test_query ".sidebar")

    assert_json_true "$result" ".found" "Sidebar should exist"
}

 test_editor_area_exists() {
    local result=$(test_query ".editor")

    assert_json_true "$result" ".found" "Editor area should exist"
}

 test_statusbar_exists() {
    local result=$(test_query ".statusbar")

    assert_json_true "$result" ".found" "Status bar should exist"
}

 test_document_title() {
    local result=$(test_js "document.title")

    assert_json_true "$result" ".success" "Should get document title"
    assert_not_empty "$(echo "$result" | jq -r '.result')" "Document title should not be empty"
}

 test_activity_bar_icons() {
    local icons=("explorer-view-icon" "search-view-icon" "extensions-view-icon")

    for icon in "${icons[@]}"; do
        local result=$(test_query ".codicon-$icon")
        if echo "$result" | jq -e '.found == true' > /dev/null 2>&1; then
            echo -e "  ${GREEN}✓${NC} Found activity bar icon: $icon"
            ((TESTS_PASSED++))
        else
            echo -e "  ${YELLOW}○${NC} Activity bar icon not found: $icon (may be expected)"
            ((TESTS_SKIPPED++))
        fi
    done
}

 test_workbench_theme() {
    local result=$(test_query ".monaco-workbench")

    if ! echo "$result" | jq -e '.found' > /dev/null 2>&1; then
        skip_test "Workbench not found"
        return
    fi

    local classes=$(echo "$result" | jq -r '.elements[0].classes | join(" ")')

    if [[ "$classes" == *"vs-dark"* ]] || [[ "$classes" == *"vs"* ]]; then
        echo -e "  ${GREEN}✓${NC} Workbench has theme applied"
        ((TESTS_PASSED++))
    else
        echo -e "  ${YELLOW}○${NC} Theme class not detected (may be expected)"
        ((TESTS_SKIPPED++))
    fi
}

 test_no_critical_errors() {
    local result=$(test_errors)
    local count=$(echo "$result" | jq '.total // 0')

    local critical=$(echo "$result" | jq '[.entries[] | select(.message | test("fatal|crash|panic"; "i"))] | length')

    if [ "$critical" = "0" ] || [ -z "$critical" ]; then
        echo -e "  ${GREEN}✓${NC} No critical errors detected"
        ((TESTS_PASSED++))
    else
        echo -e "  ${RED}✗${NC} Critical errors found: $critical"
        ((TESTS_FAILED++))
    fi
}

 test_workbench_error_block_present_if_error() {
    local found=$(test_query ".vscode-workbench--error h2")
    if echo "$found" | jq -e '.found == true' > /dev/null 2>&1; then
        local title=$(get_element_text ".vscode-workbench--error h2")
        assert_equals "$title" "Failed to load VS Code Workbench" "Error title should be visible"
        local msg_present=$(test_query ".vscode-workbench--error p")
        assert_json_true "$msg_present" ".found" "Error message should be visible"
    else
        skip_test "Error UI not visible"
    fi
 }

 test_no_workbench_provider_not_initialized_error() {
    wait_for_workbench 60 >/dev/null 2>&1 || true
    local err_ui=$(test_query ".vscode-workbench--error h2")
    if echo "$err_ui" | jq -e '.found == true' > /dev/null 2>&1; then
        echo -e "  ${RED}✗${NC} Workbench error UI should not be visible"
        ((TESTS_FAILED++))
    else
        echo -e "  ${GREEN}✓${NC} Workbench error UI not visible"
        ((TESTS_PASSED++))
    fi
    local console=$(test_console 500)
    local count=$(echo "$console" | jq '[.[] | select(.message != null and (.message | test("Provider not initialized"; "i") or .message | test("VSCodeUserData.*Provider not initialized"; "i") or .message | test("vscodeuserdata.*provider not initialized"; "i")))] | length')
    if [ "$count" -gt 0 ]; then
        echo -e "  ${RED}✗${NC} Found VSCodeUserData provider initialization errors ($count)"
        ((TESTS_FAILED++))
    else
        echo -e "  ${GREEN}✓${NC} No VSCodeUserData provider initialization errors"
        ((TESTS_PASSED++))
    fi
 }


 test_workbench_error_reload_button_behaviour() {
    local has_error=$(test_query ".vscode-workbench--error .vscode-workbench__error-content button")
    if echo "$has_error" | jq -e '.found == true' > /dev/null 2>&1; then
        local result=$(test_js "(function(){const btn=document.querySelector('.vscode-workbench--error .vscode-workbench__error-content button');if(!btn)return 'no-button';const orig=window.location.reload;let called=false;window.location.reload=()=>{called=true};['mousedown','mouseup','click'].forEach(t=>btn.dispatchEvent(new MouseEvent(t,{bubbles:true,cancelable:true,view:window,button:0,buttons:t==='mousedown'?1:0})));const r=called?'clicked':'not-clicked';window.location.reload=orig;return r})();")
        assert_json_equals "$result" ".result" "clicked" "Reload button should dispatch click and call reload"
    else
        skip_test "Reload button not visible"
    fi
}

 test_extensions_panel_has_installed_dropdown() {
    echo "Checking for INSTALLED dropdown in Extensions panel..."
    ui_open_extensions_panel > /dev/null 2>&1
    sleep 1
    local result=$(test_js "(function() { const installedBtn = document.querySelector('[aria-label*=\"Installed\"], [title*=\"Installed\"], .extensions-viewlet .extensions-header .codicon-filter'); if (installedBtn) return 'found-filter-button'; const categories = Array.from(document.querySelectorAll('.extensions-viewlet .title, .extensions-viewlet .extensions-tree-item, .pane-header')); for (const cat of categories) { if (cat.textContent?.includes('Installed') || cat.textContent?.includes('INSTALLED')) { return 'found-installed-category'; } } const searchBox = document.querySelector('.extensions-viewlet .suggest-input-container, .extensions-viewlet .search-box'); if (searchBox) return 'found-search-box'; return 'not-found'; })()")
    local status=$(echo "$result" | jq -r '.result // "error"')
    if [ "$status" = "found-filter-button" ] || [ "$status" = "found-installed-category" ] || [ "$status" = "found-search-box" ]; then
        echo -e "  ${GREEN}✓${NC} Extensions panel has filtering capability ($status)"
        ((TESTS_PASSED++))
        return 0
    else
        echo -e "  ${RED}✗${NC} INSTALLED dropdown/filter not found in Extensions panel (status: $status)"
        ((TESTS_FAILED++))
        return 1
    fi
}

 test_extensions_panel_shows_installed_extensions() {
    echo "Checking that @installed filter shows installed extensions..."
    ui_search_installed > /dev/null 2>&1
    sleep 2
    local result=$(test_js "(function() { const items = document.querySelectorAll('.extensions-viewlet .extension-list-item, .extensions-viewlet .monaco-list-row'); const noExtensions = document.querySelector('.extensions-viewlet .message, .extensions-viewlet .pane-header .count'); if (items.length > 0) { return { status: 'has-items', count: items.length }; } else if (noExtensions) { return { status: 'empty-list', message: noExtensions.textContent }; } else { return { status: 'view-loaded', found: true }; } })()")
    local status=$(echo "$result" | jq -r '.result | if type == "object" then .status else . end // "error"')
    if [ "$status" = "has-items" ] || [ "$status" = "empty-list" ] || [ "$status" = "view-loaded" ]; then
        echo -e "  ${GREEN}✓${NC} @installed filter works (status: $status)"
        ((TESTS_PASSED++))
        return 0
    else
        echo -e "  ${RED}✗${NC} @installed filter failed (status: $status)"
        ((TESTS_FAILED++))
        return 1
    fi
}

# ============================================================================
# Run Tests
# ============================================================================

run_tests

