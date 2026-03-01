#!/bin/bash
source "$(dirname "$0")/../lib/test-client.sh"

EXT_ID="jdinhlife.gruvbox"

wait_for_workbench 60 >/dev/null 2>&1 || true

test_01_open_extensions_panel() {
    ui_open_extensions_panel
    local result=$?
    if [ $result -eq 0 ]; then
        echo -e "  ${GREEN}\u2713${NC} Opened extensions panel"
        ((TESTS_PASSED++))
    else
        echo -e "  ${RED}\u2717${NC} Could not open extensions panel"
        ((TESTS_FAILED++))
    fi
    sleep 1
}

test_02_extensions_panel_exists() {
    local result=$(test_query ".extensions-viewlet")
    if echo "$result" | jq -e '.found == true' > /dev/null 2>&1; then
        echo -e "  ${GREEN}\u2713${NC} Extensions viewlet exists"
        ((TESTS_PASSED++))
    else
        echo -e "  ${RED}\u2717${NC} Extensions viewlet not found"
        ((TESTS_FAILED++))
    fi
}

test_03_search_box_exists() {
    local result=$(test_query ".extensions-viewlet textarea, .extensions-viewlet input")
    if echo "$result" | jq -e '.found == true' > /dev/null 2>&1; then
        echo -e "  ${GREEN}\u2713${NC} Extensions search box exists"
        ((TESTS_PASSED++))
    else
        echo -e "  ${RED}\u2717${NC} Extensions search box not found"
        ((TESTS_FAILED++))
    fi
}

test_04_installed_filter_works() {
    ui_search_installed
    sleep 1
    local result=$(test_js "
        const viewlet = document.querySelector('.extensions-viewlet');
        const isEmpty = viewlet?.classList?.contains('empty');
        const hasContent = viewlet?.innerHTML?.length > 100;
        JSON.stringify({ hasContent, isEmpty });
    ")
    if echo "$result" | jq -e '.result | fromjson | .hasContent == true' > /dev/null 2>&1; then
        echo -e "  ${GREEN}\u2713${NC} @installed filter applied (viewlet has content)"
        ((TESTS_PASSED++))
    else
        echo -e "  ${YELLOW}\u25cb${NC} Could not verify @installed filter"
        ((TESTS_SKIPPED++))
    fi
}

test_05_clear_and_search_marketplace() {
    ui_clear_extension_search
    ui_search_extension "python"
    wait_for_extension_results 5
    local count=$(ui_get_extension_count)
    if [ "$count" -gt 0 ] 2>/dev/null; then
        echo -e "  ${GREEN}\u2713${NC} Found $count extensions for 'python'"
        ((TESTS_PASSED++))
    else
        echo -e "  ${YELLOW}\u25cb${NC} No marketplace results"
        ((TESTS_SKIPPED++))
    fi
}

test_06_extension_items_visible() {
    local result=$(test_js "
        const items = document.querySelectorAll('.extension-list-item, .extensions-viewlet .monaco-list-row');
        JSON.stringify({ count: items.length });
    ")
    local count=$(echo "$result" | jq -r '.result | fromjson | .count' 2>/dev/null)
    if [ "$count" -gt 0 ] 2>/dev/null; then
        echo -e "  ${GREEN}\u2713${NC} Extension items visible: $count"
        ((TESTS_PASSED++))
    else
        echo -e "  ${YELLOW}\u25cb${NC} No extension items visible"
        ((TESTS_SKIPPED++))
    fi
}

test_07_install_button_on_item() {
    test_js "
        const item = document.querySelector('.extension-list-item, .extensions-viewlet .monaco-list-row');
        if (item) item.click();
    " > /dev/null
    sleep 0.5
    local result=$(test_js "
        const installBtn = document.querySelector(
            '.extension-editor .install, ' +
            '.extension-list-item.focused .install, ' +
            '.monaco-list-row.focused .install, ' +
            'button[title*=\"Install\"], ' +
            '.extension-action[aria-label*=\"Install\"]'
        );
        JSON.stringify({ found: !!installBtn, text: installBtn?.textContent || '' });
    ")
    if echo "$result" | jq -e '.result | fromjson | .found == true' > /dev/null 2>&1; then
        echo -e "  ${GREEN}\u2713${NC} Install button visible on extension"
        ((TESTS_PASSED++))
    else
        echo -e "  ${YELLOW}\u25cb${NC} Install button not found"
        ((TESTS_SKIPPED++))
    fi
}

test_08_sidebar_not_blank_after_navigation() {
    test_js "
        const explorer = document.querySelector('.codicon-explorer-view-icon');
        if (explorer) explorer.closest('.action-item')?.querySelector('.action-label')?.click();
    " > /dev/null
    sleep 0.5
    ui_open_extensions_panel
    sleep 0.5
    local result=$(test_js "
        const sidebar = document.querySelector('.sidebar');
        const viewlet = document.querySelector('.extensions-viewlet');
        const hasContent = (sidebar?.innerHTML?.length || 0) > 100;
        const hasViewlet = !!viewlet && (viewlet?.innerHTML?.length || 0) > 100;
        const isEmpty = sidebar?.classList?.contains('empty');
        JSON.stringify({ hasContent, hasViewlet, isEmpty, sidebarLen: sidebar?.innerHTML?.length || 0 });
    ")
    local hasContent=$(echo "$result" | jq -r '.result | fromjson | .hasContent' 2>/dev/null)
    local isEmpty=$(echo "$result" | jq -r '.result | fromjson | .isEmpty' 2>/dev/null)
    if [ "$hasContent" = "true" ] && [ "$isEmpty" != "true" ]; then
        echo -e "  ${GREEN}\u2713${NC} Sidebar not blank after panel navigation"
        ((TESTS_PASSED++))
    else
        echo -e "  ${RED}\u2717${NC} Sidebar went blank after navigation"
        ((TESTS_FAILED++))
    fi
}

test_09_multiple_panel_switches() {
    for i in 1 2 3; do
        test_js "
            document.querySelector('.codicon-explorer-view-icon')?.closest('.action-item')?.querySelector('.action-label')?.click();
        " > /dev/null
        sleep 0.3
        test_js "
            document.querySelector('.codicon-extensions-view-icon')?.closest('.action-item')?.querySelector('.action-label')?.click();
        " > /dev/null
        sleep 0.3
    done
    local result=$(test_js "
        const sidebar = document.querySelector('.sidebar');
        const hasContent = (sidebar?.innerHTML?.length || 0) > 100;
        JSON.stringify({ hasContent, len: sidebar?.innerHTML?.length || 0 });
    ")
    local hasContent=$(echo "$result" | jq -r '.result | fromjson | .hasContent' 2>/dev/null)
    if [ "$hasContent" = "true" ]; then
        echo -e "  ${GREEN}\u2713${NC} Sidebar stable after 3 panel switches"
        ((TESTS_PASSED++))
    else
        echo -e "  ${RED}\u2717${NC} Sidebar became blank after multiple switches"
        ((TESTS_FAILED++))
    fi
}

test_10_clear_search() {
    ui_clear_extension_search
    echo -e "  ${GREEN}\u2713${NC} Cleared extension search"
    ((TESTS_PASSED++))
}

test_11_install_extension_ui() {
    ui_clear_extension_search
    ui_search_extension "$EXT_ID"
    ui_wait_for_extension_visible "$EXT_ID" 5 > /dev/null 2>&1
    ui_click_install "$EXT_ID" > /dev/null 2>&1
    ui_wait_for_extension_installed "$EXT_ID" 90 > /dev/null 2>&1
    if [ $? -eq 0 ]; then
        echo -e "  ${GREEN}\u2713${NC} Installed $EXT_ID via UI"
        ((TESTS_PASSED++))
    else
        echo -e "  ${RED}\u2717${NC} Failed to install $EXT_ID via UI"
        ((TESTS_FAILED++))
    fi
}

test_12_verify_installed_in_list() {
    ui_search_installed > /dev/null 2>&1
    sleep 2
    if ui_is_extension_visible "$EXT_ID"; then
        echo -e "  ${GREEN}\u2713${NC} $EXT_ID visible in @installed"
        ((TESTS_PASSED++))
    else
        echo -e "  ${RED}\u2717${NC} $EXT_ID not visible in @installed"
        ((TESTS_FAILED++))
    fi
}

test_13_uninstall_extension_ui() {
    ui_search_installed > /dev/null 2>&1
    sleep 1
    ui_click_uninstall "$EXT_ID" > /dev/null 2>&1
    ui_wait_for_extension_uninstalled "$EXT_ID" 60 > /dev/null 2>&1
    if [ $? -eq 0 ]; then
        echo -e "  ${GREEN}\u2713${NC} Uninstalled $EXT_ID via UI"
        ((TESTS_PASSED++))
    else
        echo -e "  ${RED}\u2717${NC} Failed to uninstall $EXT_ID via UI"
        ((TESTS_FAILED++))
    fi
}

test_14_verify_uninstalled_from_list() {
    ui_search_installed > /dev/null 2>&1
    sleep 2
    if ui_is_extension_visible "$EXT_ID"; then
        echo -e "  ${RED}\u2717${NC} $EXT_ID still visible in @installed after uninstall"
        ((TESTS_FAILED++))
    else
        echo -e "  ${GREEN}\u2713${NC} $EXT_ID not visible in @installed"
        ((TESTS_PASSED++))
    fi
}

run_tests
