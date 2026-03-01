#!/bin/bash
# Uninstall UI Update Test
#
# This test verifies that the UI properly updates after clicking uninstall.
# Specifically tests the following issues:
#   1. UI doesn't reflect uninstall state changes (list not refreshing)
#   2. Loading indicator continues animating after uninstall
#   3. Duplicate entries appearing in @installed list
#
# Usage:
#   ./02-uninstall-ui-update.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../lib/test-client.sh"

# Test extension - Ruby Test Runner
TEST_EXTENSION="mateuszdrewniak.ruby-test-runner"
TEST_EXTENSION_NAME="ruby test runner"

# ============================================================================
# Setup: Ensure Consistent Starting State
# ============================================================================
test_00_setup_clean_state() {
    echo "  Setting up consistent starting state..."

    # First, uninstall any existing installation
    echo "  Step 1: Uninstalling if currently installed..."
    ui_search_installed
    sleep 2

    if ui_is_extension_visible "$TEST_EXTENSION"; then
        echo "    Found existing installation, removing..."
        ui_click_uninstall "$TEST_EXTENSION"
        sleep 3
    else
        echo "    Extension not installed, good."
    fi

    # Verify it's uninstalled
    ui_search_installed
    sleep 2
    local api_count=$(curl -s "$TEST_SERVER/extensions" | jq '.count // 0')
    echo "    Backend extension count after cleanup: $api_count"

    # Now install the extension fresh
    echo "  Step 2: Installing extension fresh..."
    ui_search_extension "$TEST_EXTENSION_NAME"
    sleep 3

    local install_result=$(ui_click_install "$TEST_EXTENSION")
    local install_status=$(echo "$install_result" | jq -r '.result // "unknown"')
    echo "    Install click result: $install_status"

    # Wait for installation to complete
    local timeout=60
    local elapsed=0
    echo -n "    Waiting for installation to complete..."
    while [ $elapsed -lt $timeout ]; do
        # Check backend API for installation status
        if curl -s "$TEST_SERVER/extensions" | jq -e ".extensions[] | select(.id == \"$TEST_EXTENSION\")" > /dev/null 2>&1; then
            echo -e " ${GREEN}installed${NC}"
            break
        fi
        sleep 2
        ((elapsed+=2))
        echo -n "."
    done

    if [ $elapsed -ge $timeout ]; then
        echo -e " ${RED}timeout${NC}"
        echo -e "  ${RED}✗${NC} Failed to install extension during setup"
        ((TESTS_FAILED++))
        return 1
    fi

    # Check that progress bar is not stuck after install (with retry)
    echo -n "    Checking progress bar clears after install..."
    local progress_cleared=false
    for i in 1 2 3 4 5; do
        local progress_check=$(test_js "(function() {
            const longRunning = document.querySelectorAll('.monaco-progress-container.infinite-long-running');
            const active = document.querySelectorAll('.monaco-progress-container.active');
            return JSON.stringify({ longRunning: longRunning.length, active: active.length });
        })()" | jq -r '.result')

        local long_running=$(echo "$progress_check" | jq -r '.longRunning // 0')
        local active=$(echo "$progress_check" | jq -r '.active // 0')

        if [ "$long_running" = "0" ] && [ "$active" = "0" ]; then
            progress_cleared=true
            echo -e " ${GREEN}cleared after ${i}s${NC}"
            break
        fi
        sleep 1
    done

    if [ "$progress_cleared" != "true" ]; then
        echo -e " ${RED}still animating${NC}"
        echo "    WARNING: Progress bar still active after install"
    fi

    # Verify extension is now installed and shows in UI
    echo "  Step 3: Verifying installation..."
    ui_search_installed
    sleep 2

    if ui_is_extension_visible "$TEST_EXTENSION"; then
        echo -e "  ${GREEN}✓${NC} Setup complete - extension installed and visible"
        ((TESTS_PASSED++))
    else
        echo -e "  ${RED}✗${NC} Setup failed - extension installed but not visible in UI"
        ((TESTS_FAILED++))
        return 1
    fi
}

# ============================================================================
# Test: Confirm Extension is Installed (after setup)
# ============================================================================
test_01_extension_installed() {
    echo "  Confirming Ruby Test Runner is installed..."

    ui_search_installed
    sleep 2

    if ui_is_extension_visible "$TEST_EXTENSION"; then
        echo -e "  ${GREEN}✓${NC} Ruby Test Runner is visible in @installed"
        ((TESTS_PASSED++))
    else
        echo -e "  ${RED}✗${NC} Ruby Test Runner not found in @installed list"
        ((TESTS_FAILED++))
        return 1
    fi
}

# ============================================================================
# Test: Check Extension State Before Uninstall
# ============================================================================
test_02_check_state_before_uninstall() {
    echo "  Checking extension state before uninstall..."

    ui_search_installed
    sleep 1

    local result=$(test_js "(function() {
        const rows = document.querySelectorAll('.extensions-viewlet .monaco-list-row');
        for (const row of rows) {
            const name = row.querySelector('.name')?.textContent?.toLowerCase() || '';
            if (name.includes('ruby') && name.includes('test')) {
                const manageBtn = row.querySelector('.extension-action.manage:not(.hide)');
                const uninstallBtn = row.querySelector('.extension-action.uninstall:not(.hide)');
                const installBtn = row.querySelector('.extension-action.install:not(.hide):not(.disabled)');
                const installLocallyBtn = row.querySelector('.extension-action.install-other-server:not(.hide):not(.disabled)');

                return JSON.stringify({
                    hasManage: !!manageBtn,
                    hasUninstall: !!uninstallBtn,
                    hasInstall: !!installBtn,
                    hasInstallLocally: !!installLocallyBtn,
                    allButtons: Array.from(row.querySelectorAll('.extension-action:not(.hide)')).map(b => b.textContent?.trim() || b.className)
                });
            }
        }
        return 'not-found';
    })()")

    local state=$(echo "$result" | jq -r '.result')
    echo "  State before uninstall: $state"

    if echo "$state" | jq -e '.hasManage == true' > /dev/null 2>&1; then
        echo -e "  ${GREEN}✓${NC} Extension shows Manage button (installed state)"
        ((TESTS_PASSED++))
    else
        echo -e "  ${RED}✗${NC} Extension should show Manage button"
        ((TESTS_FAILED++))
    fi
}

# ============================================================================
# Test: Click Uninstall and Monitor UI Changes
# ============================================================================
test_03_click_uninstall_and_monitor() {
    echo "  Clicking uninstall and monitoring UI changes..."

    ui_search_installed
    sleep 1

    # Capture state before
    local before=$(test_js "(function() {
        const rows = document.querySelectorAll('.extensions-viewlet .monaco-list-row');
        for (const row of rows) {
            const name = row.querySelector('.name')?.textContent?.toLowerCase() || '';
            if (name.includes('ruby') && name.includes('test')) {
                return row.outerHTML.length;
            }
        }
        return 0;
    })()" | jq -r '.result')
    echo "  HTML size before: $before"

    # Click uninstall via manage menu
    echo "  Opening manage dropdown..."
    test_js "(function() {
        const rows = document.querySelectorAll('.extensions-viewlet .monaco-list-row');
        for (const row of rows) {
            const name = row.querySelector('.name')?.textContent?.toLowerCase() || '';
            if (name.includes('ruby') && name.includes('test')) {
                const manageBtn = row.querySelector('.extension-action.manage:not(.hide)');
                if (manageBtn) {
                    manageBtn.click();
                    return 'clicked-manage';
                }
            }
        }
        return 'not-found';
    })()"

    sleep 0.5

    echo "  Clicking uninstall in menu..."
    local uninstall_result=$(test_js "(function() {
        const menus = document.querySelectorAll('.context-view, .monaco-menu');
        for (const menu of menus) {
            const items = menu.querySelectorAll('.action-item, .action-menu-item, li.action-item');
            for (const item of items) {
                const labelEl = item.querySelector('.action-label, a');
                const text = labelEl?.textContent?.toLowerCase() || item.textContent?.toLowerCase() || '';
                if (text === 'uninstall') {
                    // Use proper mouse events - VS Code's action handlers require this
                    const target = labelEl || item;
                    const rect = target.getBoundingClientRect();
                    const centerX = rect.left + rect.width / 2;
                    const centerY = rect.top + rect.height / 2;

                    // Dispatch mousedown, mouseup, and click with proper coordinates
                    ['mousedown', 'mouseup', 'click'].forEach(eventType => {
                        const event = new MouseEvent(eventType, {
                            bubbles: true,
                            cancelable: true,
                            view: window,
                            button: 0,
                            buttons: eventType === 'mousedown' ? 1 : 0,
                            clientX: centerX,
                            clientY: centerY
                        });
                        target.dispatchEvent(event);
                    });
                    return 'clicked-uninstall';
                }
            }
        }
        return 'uninstall-not-found';
    })()")

    echo "  Uninstall click result: $(echo "$uninstall_result" | jq -r '.result')"

    if echo "$uninstall_result" | jq -r '.result' | grep -q "clicked"; then
        echo -e "  ${GREEN}✓${NC} Clicked uninstall button"
        ((TESTS_PASSED++))
    else
        echo -e "  ${RED}✗${NC} Failed to click uninstall"
        ((TESTS_FAILED++))
        return 1
    fi

    # Wait and check for UI changes
    echo "  Waiting for UI to update..."
    for i in 1 2 3 4 5; do
        sleep 1
        local after=$(test_js "(function() {
            const rows = document.querySelectorAll('.extensions-viewlet .monaco-list-row');
            for (const row of rows) {
                const name = row.querySelector('.name')?.textContent?.toLowerCase() || '';
                if (name.includes('ruby') && name.includes('test')) {
                    const manageBtn = row.querySelector('.extension-action.manage:not(.hide)');
                    const installBtn = row.querySelector('.extension-action.install:not(.hide):not(.disabled)');
                    const installLocallyBtn = row.querySelector('.extension-action.install-other-server:not(.hide):not(.disabled)');
                    return JSON.stringify({
                        stillHasManage: !!manageBtn,
                        hasInstall: !!installBtn,
                        hasInstallLocally: !!installLocallyBtn,
                        htmlSize: row.outerHTML.length
                    });
                }
            }
            return 'extension-gone';
        })()" | jq -r '.result')

        echo "  After ${i}s: $after"

        # Check if UI updated
        if [ "$after" = "extension-gone" ]; then
            echo -e "  ${GREEN}✓${NC} Extension removed from UI"
            ((TESTS_PASSED++))
            return 0
        fi

        if echo "$after" | jq -e '.stillHasManage == false' > /dev/null 2>&1; then
            echo -e "  ${GREEN}✓${NC} UI updated - Manage button removed"
            ((TESTS_PASSED++))

            # Check that progress bar clears after uninstall (with retry)
            # Allow up to 15 seconds for progress bar to clear
            local progress_timeout=15
            local progress_elapsed=0
            local progress_cleared=false
            echo -n "  Waiting for progress bar to clear..."
            while [ $progress_elapsed -lt $progress_timeout ]; do
                local progress_after=$(test_js "(function() {
                    const longRunning = document.querySelectorAll('.monaco-progress-container.infinite-long-running');
                    const active = document.querySelectorAll('.monaco-progress-container.active.infinite');
                    return JSON.stringify({ longRunning: longRunning.length, active: active.length });
                })()" | jq -r '.result')

                local long_running_count=$(echo "$progress_after" | jq -r '.longRunning // 0')
                if [ "$long_running_count" = "0" ]; then
                    progress_cleared=true
                    echo -e " ${GREEN}cleared after ${progress_elapsed}s${NC}"
                    break
                fi
                sleep 1
                ((progress_elapsed++))
                echo -n "."
            done

            if [ "$progress_cleared" = "true" ]; then
                echo -e "  ${GREEN}✓${NC} Progress bar cleared after uninstall"
                ((TESTS_PASSED++))
            else
                echo -e " ${RED}timeout${NC}"
                echo -e "  ${RED}✗${NC} Progress bar is still infinite-long-running after ${progress_timeout}s!"
                local final_state=$(test_js "(function() {
                    const longRunning = document.querySelectorAll('.monaco-progress-container.infinite-long-running');
                    return JSON.stringify({ count: longRunning.length });
                })()" | jq -r '.result')
                echo "  Final state: $final_state"
                ((TESTS_FAILED++))
            fi
            return 0
        fi
    done

    echo -e "  ${RED}✗${NC} UI did not update after uninstall - Manage button still visible"
    ((TESTS_FAILED++))

    # Additional diagnostics
    echo ""
    echo "  DIAGNOSTIC: Checking current extension state..."
    test_js "(function() {
        const rows = document.querySelectorAll('.extensions-viewlet .monaco-list-row');
        for (const row of rows) {
            const name = row.querySelector('.name')?.textContent?.toLowerCase() || '';
            if (name.includes('ruby') && name.includes('test')) {
                const buttons = Array.from(row.querySelectorAll('.extension-action'));
                return JSON.stringify(buttons.map(b => ({
                    text: b.textContent?.trim(),
                    classes: b.className,
                    hidden: b.classList.contains('hide'),
                    disabled: b.classList.contains('disabled')
                })), null, 2);
            }
        }
        return 'not-found';
    })()" | jq -r '.result'
}

# ============================================================================
# Test: Verify No Duplicate Entries in @installed
# ============================================================================
test_04_no_duplicate_entries() {
    echo "  Checking for duplicate entries in @installed..."

    ui_search_installed
    sleep 2

    local result=$(test_js "(function() {
        const rows = document.querySelectorAll('.extensions-viewlet .monaco-list-row');
        const names = [];
        const duplicates = [];

        for (const row of rows) {
            const name = row.querySelector('.name')?.textContent?.toLowerCase() || '';
            if (name) {
                if (names.includes(name)) {
                    duplicates.push(name);
                } else {
                    names.push(name);
                }
            }
        }

        return JSON.stringify({
            totalRows: rows.length,
            uniqueNames: names.length,
            duplicates: duplicates,
            hasDuplicates: duplicates.length > 0
        });
    })()")

    local state=$(echo "$result" | jq -r '.result')
    echo "  Extension list state: $state"

    if echo "$state" | jq -e '.hasDuplicates == false' > /dev/null 2>&1; then
        echo -e "  ${GREEN}✓${NC} No duplicate entries found"
        ((TESTS_PASSED++))
    else
        local dups=$(echo "$state" | jq -r '.duplicates | join(", ")')
        echo -e "  ${RED}✗${NC} Found duplicate entries: $dups"
        ((TESTS_FAILED++))
    fi
}

# ============================================================================
# Test: Verify Loading Indicator Clears After Uninstall
# ============================================================================
test_05_loading_indicator_clears() {
    echo "  Checking that loading indicator is not stuck..."

    ui_search_installed
    sleep 1

    local result=$(test_js "(function() {
        // Check for VS Code's progress indicator in the extensions panel
        const progressBar = document.querySelector('.extensions-viewlet .monaco-progress-container .progress-bit');
        const isAnimating = progressBar && window.getComputedStyle(progressBar).animationName !== 'none';

        // Also check for any visible loading spinners
        const spinners = document.querySelectorAll('.extensions-viewlet .codicon-loading, .extensions-viewlet .codicon-sync');
        const hasSpinners = spinners.length > 0;

        // Check for any 'loading' class on extension items
        const loadingItems = document.querySelectorAll('.extensions-viewlet .extension-list-item.loading, .extensions-viewlet .monaco-list-row.loading');

        return JSON.stringify({
            hasProgressBar: !!progressBar,
            isAnimating: isAnimating,
            hasSpinners: hasSpinners,
            loadingItemCount: loadingItems.length,
            isStuck: isAnimating || hasSpinners || loadingItems.length > 0
        });
    })()")

    local state=$(echo "$result" | jq -r '.result')
    echo "  Loading state: $state"

    if echo "$state" | jq -e '.isStuck == false' > /dev/null 2>&1; then
        echo -e "  ${GREEN}✓${NC} No stuck loading indicators"
        ((TESTS_PASSED++))
    else
        echo -e "  ${RED}✗${NC} Loading indicator appears to be stuck"
        ((TESTS_FAILED++))
    fi
}

# ============================================================================
# Test: Verify No Infinite Long-Running Progress Bar
# ============================================================================
test_05b_no_infinite_progress_bar() {
    echo "  Checking for infinite-long-running progress bar..."

    # Wait up to 15 seconds for progress bars to clear
    local timeout=15
    local elapsed=0
    local cleared=false

    echo -n "  Waiting for progress bars to clear..."
    while [ $elapsed -lt $timeout ]; do
        local result=$(test_js "(function() {
            const longRunning = document.querySelectorAll('.monaco-progress-container.infinite-long-running');
            return longRunning.length;
        })()" | jq -r '.result')

        if [ "$result" = "0" ]; then
            cleared=true
            echo -e " ${GREEN}cleared after ${elapsed}s${NC}"
            break
        fi
        sleep 1
        ((elapsed++))
        echo -n "."
    done

    if [ "$cleared" = "true" ]; then
        echo -e "  ${GREEN}✓${NC} No infinite-long-running progress bars found"
        ((TESTS_PASSED++))
    else
        echo -e " ${RED}timeout${NC}"

        # Get detailed state
        local state=$(test_js "(function() {
            const infiniteContainers = document.querySelectorAll('.monaco-progress-container.active.infinite');
            const longRunning = document.querySelectorAll('.monaco-progress-container.infinite-long-running');
            const details = [];
            for (const el of longRunning) {
                let parent = el.parentElement;
                let path = [];
                for (let i = 0; i < 3 && parent; i++) {
                    const cls = parent.className?.split(' ')[0] || parent.tagName;
                    path.push(cls);
                    parent = parent.parentElement;
                }
                details.push({ parentPath: path.join(' > ') });
            }
            return JSON.stringify({ count: longRunning.length, details: details });
        })()" | jq -r '.result')

        local count=$(echo "$state" | jq -r '.count')
        local location=$(echo "$state" | jq -r '.details[0].parentPath // "unknown"')
        echo -e "  ${RED}✗${NC} Found $count infinite-long-running progress bar(s) in: $location"
        ((TESTS_FAILED++))

        # Additional diagnostics
        echo ""
        echo "  DIAGNOSTIC: Checking what operations might be pending..."
        test_js "(function() {
            const svc = window.__extWorkbenchService;
            if (!svc) return 'no service';
            return JSON.stringify({
                installing: svc.installing?.length || 0,
                uninstalling: svc.uninstalling?.length || 0,
                localInstalling: svc.localExtensions?.installing?.length || 0,
                localUninstalling: svc.localExtensions?.uninstalling?.length || 0,
                tasksInProgress: svc.tasksInProgress?.length || 0,
                hasActivityCallback: typeof svc._activityCallBack === 'function'
            });
        })()" | jq -r '.result'

        # Check for stuck states in installed extensions
        echo "  DIAGNOSTIC: Checking extension states..."
        test_js "(function() {
            const svc = window.__extWorkbenchService;
            if (!svc) return 'no service';
            const installed = svc.installed || [];
            const stuckInstalling = installed.filter(e => e.state === 0).map(e => e.identifier?.id);
            const stuckUninstalling = installed.filter(e => e.state === 2).map(e => e.identifier?.id);
            return JSON.stringify({
                totalInstalled: installed.length,
                stuckInstalling: stuckInstalling,
                stuckUninstalling: stuckUninstalling
            });
        })()" | jq -r '.result'
    fi
}

# ============================================================================
# Test: Verify List Row Count Matches Backend Data
# ============================================================================
test_06_list_matches_backend() {
    echo "  Verifying UI list matches backend extension data..."

    ui_search_installed
    sleep 2

    # Get count from backend API
    local api_count=$(curl -s "$TEST_SERVER/extensions" | jq '.count // 0')

    # Get count from UI
    local ui_result=$(test_js "(function() {
        const rows = document.querySelectorAll('.extensions-viewlet .monaco-list-row');
        return rows.length;
    })()")
    local ui_count=$(echo "$ui_result" | jq -r '.result')

    echo "  Backend extension count: $api_count"
    echo "  UI list row count: $ui_count"

    if [ "$ui_count" = "$api_count" ]; then
        echo -e "  ${GREEN}✓${NC} UI list count matches backend ($ui_count extensions)"
        ((TESTS_PASSED++))
    else
        echo -e "  ${RED}✗${NC} UI count ($ui_count) does not match backend ($api_count)"
        ((TESTS_FAILED++))

        # Additional diagnostics
        echo ""
        echo "  DIAGNOSTIC: UI extension names:"
        test_js "(function() {
            const rows = document.querySelectorAll('.extensions-viewlet .monaco-list-row');
            return Array.from(rows).map(r => r.querySelector('.name')?.textContent || 'unknown').join(', ');
        })()" | jq -r '.result'
    fi
}

# ============================================================================
# Test: Verify Install Button Shows After Uninstall (marketplace search)
# ============================================================================
test_07_install_button_after_uninstall() {
    echo "  Verifying Install button appears in marketplace after uninstall..."

    # After previous tests ran, extension should be uninstalled
    # Search marketplace for the extension
    ui_search_extension "$TEST_EXTENSION_NAME"
    sleep 3

    local result=$(test_js "(function() {
        const rows = document.querySelectorAll('.extensions-viewlet .monaco-list-row');
        for (const row of rows) {
            const name = row.querySelector('.name')?.textContent?.toLowerCase() || '';
            if (name.includes('ruby') && name.includes('test')) {
                const installBtn = row.querySelector('.extension-action.install:not(.hide):not(.disabled)');
                const installLocallyBtn = row.querySelector('.extension-action.install-other-server:not(.hide):not(.disabled)');
                const manageBtn = row.querySelector('.extension-action.manage:not(.hide)');

                return JSON.stringify({
                    hasInstallButton: !!(installBtn || installLocallyBtn),
                    hasManageButton: !!manageBtn,
                    installButtonText: installBtn?.textContent?.trim() || installLocallyBtn?.textContent?.trim() || '',
                    correctState: !!(installBtn || installLocallyBtn) && !manageBtn
                });
            }
        }
        return JSON.stringify({ found: false });
    })()")

    local state=$(echo "$result" | jq -r '.result')
    echo "  Button state in marketplace: $state"

    if echo "$state" | jq -e '.correctState == true' > /dev/null 2>&1; then
        echo -e "  ${GREEN}✓${NC} Install button visible, Manage button hidden (correct uninstalled state)"
        ((TESTS_PASSED++))
    elif echo "$state" | jq -e '.found == false' > /dev/null 2>&1; then
        echo -e "  ${YELLOW}○${NC} Extension not found in marketplace search"
        ((TESTS_SKIPPED++))
    else
        echo -e "  ${RED}✗${NC} UI still showing Manage button - uninstall didn't update UI properly"
        ((TESTS_FAILED++))
    fi
}

# ============================================================================
# Test: Clear Search Box and Verify Installed List
# ============================================================================
test_08_clear_search_verify_installed() {
    echo "  Clearing search box and verifying installed list accuracy..."

    # Clear the search box by clicking the clear button (X) which VS Code provides
    echo "  Step 1: Clearing search box..."

    # VS Code's search box has a clear button - click it if present
    local clear_result=$(test_js "(function() {
        // Try to find and click the clear button in the extensions search
        const clearBtn = document.querySelector('.extensions-viewlet .search-box .action-label.codicon-search-stop, .extensions-viewlet .clear-search-results, .extensions-viewlet .codicon-close');
        if (clearBtn) {
            clearBtn.click();
            return 'clicked-clear-button';
        }

        // Alternative: Find the search box and simulate Escape key to clear
        const searchBox = document.querySelector('.extensions-viewlet .suggest-input-container');
        if (searchBox) {
            searchBox.click();
            // Triple-click to select all text
            for (let i = 0; i < 3; i++) {
                searchBox.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            }
            // Send Escape to clear
            document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', {
                key: 'Escape',
                code: 'Escape',
                bubbles: true,
                cancelable: true
            }));
            return 'sent-escape';
        }

        return 'no clear method found';
    })()")
    echo "    Clear result: $(echo "$clear_result" | jq -r '.result')"
    sleep 1

    # Verify search box is empty
    local verify_result=$(test_js "(function() {
        const input = document.querySelector('.extensions-viewlet .suggest-input-container textarea, .extensions-viewlet .suggest-input-container input');
        return input?.value || 'empty or no input';
    })()")
    echo "    Search box value after clear: $(echo "$verify_result" | jq -r '.result')"
    sleep 1

    # Type @installed to show installed extensions
    echo "  Step 2: Showing @installed view..."
    ui_search_installed
    sleep 2

    # Get backend extension count
    local api_count=$(curl -s "$TEST_SERVER/extensions" | jq '.count // 0')

    # Get UI extension count
    local ui_result=$(test_js "(function() {
        const rows = document.querySelectorAll('.extensions-viewlet .monaco-list-row');
        const names = Array.from(rows).map(r => r.querySelector('.name')?.textContent || '').filter(n => n);
        return JSON.stringify({ count: rows.length, names: names });
    })()")

    local ui_count=$(echo "$ui_result" | jq -r '.result | fromjson | .count // 0')
    local ui_names=$(echo "$ui_result" | jq -r '.result | fromjson | .names | join(", ")' 2>/dev/null || echo "parse error")

    echo "  Backend extension count: $api_count"
    echo "  UI installed count: $ui_count"
    echo "  UI extension names: $ui_names"

    # Verify counts match
    if [ "$ui_count" = "$api_count" ]; then
        echo -e "  ${GREEN}✓${NC} Installed list is accurate (backend: $api_count, UI: $ui_count)"
        ((TESTS_PASSED++))
    else
        echo -e "  ${RED}✗${NC} Installed list mismatch (backend: $api_count, UI: $ui_count)"
        ((TESTS_FAILED++))

        # Additional diagnostic - check if UI is showing stale data
        echo ""
        echo "  DIAGNOSTIC: Checking for stale UI state..."
        test_js "(function() {
            const svc = window.__extWorkbenchService;
            if (!svc) return 'no service';
            return JSON.stringify({
                installed: svc.installed?.length || 0,
                local: svc.local?.length || 0,
                localExtInstalled: svc.localExtensions?.installed?.length || 0
            });
        })()" | jq -r '.result'
    fi

    # Also verify no progress bar is running
    local progress_check=$(test_js "(function() {
        const longRunning = document.querySelectorAll('.monaco-progress-container.infinite-long-running');
        const active = document.querySelectorAll('.monaco-progress-container.active');
        return JSON.stringify({ longRunning: longRunning.length, active: active.length });
    })()" | jq -r '.result')

    local long_running=$(echo "$progress_check" | jq -r '.longRunning // 0')
    if [ "$long_running" = "0" ]; then
        echo -e "  ${GREEN}✓${NC} No infinite-long-running progress bar"
        ((TESTS_PASSED++))
    else
        echo -e "  ${RED}✗${NC} Found $long_running infinite-long-running progress bar(s)"
        ((TESTS_FAILED++))
    fi

    # CRITICAL: Verify main service caches are in sync with localExtensions
    echo "  Step 3: Checking service cache sync..."
    local sync_check=$(test_js "(function() {
        const svc = window.__extWorkbenchService;
        if (!svc) return JSON.stringify({ error: 'no service' });
        return JSON.stringify({
            mainInstalled: svc.installed?.length || 0,
            mainLocal: svc.local?.length || 0,
            localExtInstalled: svc.localExtensions?.installed?.length || 0,
            localExtLocal: svc.localExtensions?.local?.length || 0,
            extensionServersLocal: svc.extensionsServers?.[0]?.local?.length || 0
        });
    })()" | jq -r '.result')

    local main_installed=$(echo "$sync_check" | jq -r '.mainInstalled // -1')
    local local_ext_installed=$(echo "$sync_check" | jq -r '.localExtInstalled // -1')

    if [ "$main_installed" = "$local_ext_installed" ]; then
        echo -e "  ${GREEN}✓${NC} Service caches are in sync (main: $main_installed, localExt: $local_ext_installed)"
        ((TESTS_PASSED++))
    else
        echo -e "  ${RED}✗${NC} Service cache mismatch! main.installed=$main_installed, localExtensions.installed=$local_ext_installed"
        echo "  Full state: $sync_check"
        ((TESTS_FAILED++))
    fi
}

# ============================================================================
# Run Tests
# ============================================================================

wait_for_server 30 || exit 1
wait_for_bridge 30 || exit 1

echo ""
echo -e "${CYAN}Testing Uninstall UI Update Issue${NC}"
echo -e "${CYAN}Extension: Ruby Test Runner${NC}"
echo -e "${CYAN}Tests: Duplicate entries, Loading indicator, List refresh${NC}"
echo ""

run_tests
