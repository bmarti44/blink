#!/bin/bash
# Diagnostic test for Extensions Panel INSTALLED visibility
#
# This test investigates WHY the INSTALLED dropdown is not showing
# by gathering detailed information about the extensions panel structure.

source "$(dirname "$0")/../lib/test-client.sh"

# ============================================================================
# Diagnostic: Gather Extensions Panel Structure
# ============================================================================
test_01_diagnostic_panel_structure() {
    echo "  Gathering extensions panel structure..."

    # First open extensions view
    local click_result=$(test_js "(function() {
        // Click Extensions in VS Code's activity bar
        const activityBar = document.querySelector('.activitybar');
        if (!activityBar) return 'no-activitybar';

        const extensionsIcon = activityBar.querySelector('.codicon-extensions-view-icon');
        if (extensionsIcon) {
            extensionsIcon.closest('.action-item')?.click();
            return 'clicked-extensions-icon';
        }

        // Try clicking any extensions-related item
        const allItems = activityBar.querySelectorAll('.action-item');
        for (const item of allItems) {
            const label = item.getAttribute('aria-label') || item.textContent || '';
            if (label.toLowerCase().includes('extension')) {
                item.click();
                return 'clicked-item: ' + label;
            }
        }
        return 'no-extensions-icon-found';
    })()")

    echo "    Click result: $(echo "$click_result" | jq -r '.result')"
    sleep 2

    # Get detailed panel structure
    local structure=$(test_js "(function() {
        const viewlet = document.querySelector('.extensions-viewlet');
        if (!viewlet) {
            return {
                hasViewlet: false,
                sidebar: document.querySelector('.sidebar')?.className || 'not-found',
                composite: document.querySelector('.composite')?.className || 'not-found',
                allPanels: Array.from(document.querySelectorAll('[class*=\"viewlet\"], [class*=\"panel\"]'))
                    .map(e => e.className).slice(0, 10)
            };
        }

        // Get all pane headers (sections like INSTALLED, RECOMMENDED, etc.)
        const paneHeaders = Array.from(viewlet.querySelectorAll('.pane-header'))
            .map(h => ({
                title: h.querySelector('.title')?.textContent || '',
                ariaLabel: h.getAttribute('aria-label') || '',
                expanded: !h.classList.contains('collapsed'),
                visible: h.offsetParent !== null,
                classes: h.className
            }));

        // Get search box info
        const searchBox = viewlet.querySelector('.suggest-input-container, .search-box, input[type=\"text\"]');
        const searchInfo = searchBox ? {
            found: true,
            type: searchBox.className,
            placeholder: searchBox.querySelector('input')?.placeholder || 'N/A'
        } : { found: false };

        // Get filter buttons
        const filterButtons = Array.from(viewlet.querySelectorAll('.codicon-filter, [title*=\"Filter\"], .filter-action'))
            .map(b => ({
                title: b.getAttribute('title') || b.textContent || '',
                ariaLabel: b.getAttribute('aria-label') || ''
            }));

        // Get all section headers text
        const allText = viewlet.textContent || '';
        const hasInstalledText = allText.toLowerCase().includes('installed');
        const hasRecommendedText = allText.toLowerCase().includes('recommended');

        // Get extension list items
        const extensionItems = viewlet.querySelectorAll('.extension-list-item, .monaco-list-row');

        return {
            hasViewlet: true,
            viewletClasses: viewlet.className,
            viewletVisible: viewlet.offsetParent !== null,
            viewletDimensions: {
                width: viewlet.offsetWidth,
                height: viewlet.offsetHeight
            },
            paneHeaders: paneHeaders,
            searchBox: searchInfo,
            filterButtons: filterButtons,
            hasInstalledText: hasInstalledText,
            hasRecommendedText: hasRecommendedText,
            extensionItemCount: extensionItems.length,
            allInnerHTML: viewlet.innerHTML.substring(0, 500)
        };
    })()")

    echo ""
    echo "    === Extensions Panel Structure ==="
    echo "$structure" | jq -r '.result | if type == "object" then . else {error: .} end' | head -60

    local hasViewlet=$(echo "$structure" | jq -r '.result.hasViewlet // false')
    local hasInstalledText=$(echo "$structure" | jq -r '.result.hasInstalledText // false')
    local paneCount=$(echo "$structure" | jq -r '.result.paneHeaders | length // 0')

    echo ""
    echo "    === Summary ==="
    echo "    Has viewlet: $hasViewlet"
    echo "    Has 'Installed' text: $hasInstalledText"
    echo "    Pane header count: $paneCount"

    if [ "$hasViewlet" = "true" ]; then
        if [ "$hasInstalledText" = "true" ] || [ "$paneCount" -gt 0 ]; then
            echo -e "  ${GREEN}✓${NC} Extensions viewlet has content"
            ((TESTS_PASSED++))
        else
            echo -e "  ${RED}✗${NC} Extensions viewlet exists but has no INSTALLED section"
            ((TESTS_FAILED++))
            return 1
        fi
    else
        echo -e "  ${RED}✗${NC} Extensions viewlet not found"
        ((TESTS_FAILED++))
        return 1
    fi
}

# ============================================================================
# Diagnostic: Check VS Code Extension Views Configuration
# ============================================================================
test_02_diagnostic_views_config() {
    echo "  Checking VS Code views configuration..."

    local config=$(test_js "(function() {
        // Check if VS Code's view containers are registered
        const viewContainers = document.querySelectorAll('.composite-bar .action-item');
        const items = Array.from(viewContainers).map(v => ({
            id: v.getAttribute('data-action-id') || v.querySelector('.action-label')?.className || '',
            title: v.getAttribute('title') || v.getAttribute('aria-label') || '',
            active: v.classList.contains('checked') || v.classList.contains('active')
        }));

        // Check activity bar actions
        const activityActions = document.querySelectorAll('.activitybar .action-item');
        const activityItems = Array.from(activityActions).map(a => ({
            icon: a.querySelector('[class*=\"codicon\"]')?.className || '',
            title: a.getAttribute('title') || a.getAttribute('aria-label') || '',
            active: a.classList.contains('checked') || a.classList.contains('focus')
        }));

        return {
            viewContainerCount: items.length,
            viewContainers: items.slice(0, 10),
            activityBarItems: activityItems,
            hasExtensionsContainer: items.some(v => v.title.toLowerCase().includes('extension')) ||
                                   activityItems.some(a => a.title.toLowerCase().includes('extension'))
        };
    })()")

    echo "$config" | jq -r '.result' | head -40

    local hasExtensions=$(echo "$config" | jq -r '.result.hasExtensionsContainer // false')
    if [ "$hasExtensions" = "true" ]; then
        echo -e "  ${GREEN}✓${NC} Extensions view container is registered"
        ((TESTS_PASSED++))
    else
        echo -e "  ${YELLOW}○${NC} Extensions container status unclear"
        ((TESTS_SKIPPED++))
    fi
}

# ============================================================================
# Diagnostic: Check for INSTALLED-specific Elements
# ============================================================================
test_03_diagnostic_installed_elements() {
    echo "  Checking for INSTALLED-specific elements..."

    # Ensure extensions panel is open
    test_js "document.querySelector('.codicon-extensions-view-icon')?.closest('.action-item')?.click()" > /dev/null
    sleep 1

    local elements=$(test_js "(function() {
        const viewlet = document.querySelector('.extensions-viewlet');
        if (!viewlet) return { error: 'no viewlet' };

        // Look for elements that could represent INSTALLED section
        const installedCandidates = [];

        // 1. Check for pane headers with 'Installed' text
        viewlet.querySelectorAll('.pane-header').forEach(h => {
            const title = h.querySelector('.title')?.textContent || h.textContent;
            if (title && title.toLowerCase().includes('install')) {
                installedCandidates.push({
                    type: 'pane-header',
                    text: title.substring(0, 50),
                    expanded: !h.classList.contains('collapsed'),
                    visible: h.offsetParent !== null
                });
            }
        });

        // 2. Check for dropdown/filter with '@installed' option
        viewlet.querySelectorAll('select, [role=\"listbox\"], .dropdown').forEach(d => {
            const options = Array.from(d.querySelectorAll('option, [role=\"option\"]')).map(o => o.textContent);
            if (options.some(o => o && o.toLowerCase().includes('install'))) {
                installedCandidates.push({
                    type: 'dropdown',
                    options: options.slice(0, 10)
                });
            }
        });

        // 3. Check for filter input with @installed capability
        const searchInput = viewlet.querySelector('.suggest-input-container input, .extensions-search-input');
        if (searchInput) {
            installedCandidates.push({
                type: 'search-input',
                value: searchInput.value || '',
                placeholder: searchInput.placeholder || ''
            });
        }

        // 4. Check for filter badge/chip showing installed count
        viewlet.querySelectorAll('.badge, .count, [class*=\"badge\"]').forEach(b => {
            const text = b.textContent || '';
            if (b.closest('.extensions-viewlet')) {
                installedCandidates.push({
                    type: 'badge',
                    text: text,
                    classes: b.className
                });
            }
        });

        // 5. Check the split button/dropdown for view modes
        const viewModeButtons = viewlet.querySelectorAll('.codicon-list-flat, .codicon-list-tree, [title*=\"View\"]');
        const viewModes = Array.from(viewModeButtons).map(b => b.getAttribute('title') || b.className);

        return {
            installedCandidates: installedCandidates,
            viewModes: viewModes,
            totalElements: viewlet.querySelectorAll('*').length
        };
    })()")

    echo "$elements" | jq -r '.result' | head -50

    local candidateCount=$(echo "$elements" | jq -r '.result.installedCandidates | length // 0')

    if [ "$candidateCount" -gt 0 ]; then
        echo -e "  ${GREEN}✓${NC} Found $candidateCount INSTALLED-related elements"
        ((TESTS_PASSED++))
    else
        echo -e "  ${RED}✗${NC} No INSTALLED-related elements found!"
        echo "    The extensions panel may be missing the INSTALLED dropdown/section"
        ((TESTS_FAILED++))
        return 1
    fi
}

# ============================================================================
# Diagnostic: Try @installed Search
# ============================================================================
test_04_diagnostic_try_installed_search() {
    echo "  Testing @installed search capability..."

    # Try to search for @installed
    local searchResult=$(test_js "(async function() {
        const viewlet = document.querySelector('.extensions-viewlet');
        if (!viewlet) return { error: 'no viewlet' };

        // Find and focus the search input
        const searchContainer = viewlet.querySelector('.suggest-input-container');
        const inputArea = searchContainer?.querySelector('textarea.inputarea, input');

        if (!inputArea) {
            return { error: 'no search input', searchContainerExists: !!searchContainer };
        }

        // Focus and type @installed
        inputArea.focus();
        document.execCommand('selectAll');
        document.execCommand('insertText', false, '@installed');

        // Wait a bit for results
        await new Promise(r => setTimeout(r, 1500));

        // Check what happened
        const extensionItems = viewlet.querySelectorAll('.extension-list-item, .monaco-list-row');
        const noResults = viewlet.querySelector('.message, .no-extensions');

        return {
            searchPerformed: true,
            extensionCount: extensionItems.length,
            hasNoResultsMessage: !!noResults,
            noResultsText: noResults?.textContent?.substring(0, 100) || '',
            inputValue: inputArea.value || inputArea.textContent || ''
        };
    })()")

    echo "$searchResult" | jq -r '.result'

    local extCount=$(echo "$searchResult" | jq -r '.result.extensionCount // 0')
    local hasNoResults=$(echo "$searchResult" | jq -r '.result.hasNoResultsMessage // false')

    if [ "$extCount" -gt 0 ]; then
        echo -e "  ${GREEN}✓${NC} @installed search shows $extCount extensions"
        ((TESTS_PASSED++))
    elif [ "$hasNoResults" = "true" ]; then
        echo -e "  ${GREEN}✓${NC} @installed search works (no extensions installed)"
        ((TESTS_PASSED++))
    else
        echo -e "  ${YELLOW}○${NC} @installed search results unclear"
        ((TESTS_SKIPPED++))
    fi
}

# ============================================================================
# Diagnostic: Check Extension Service State
# ============================================================================
test_05_diagnostic_extension_service() {
    echo "  Checking extension service state..."

    local serviceState=$(test_js "(async function() {
        try {
            // Try to access extension-related services
            const result = {
                hasExtensionGalleryService: false,
                hasExtensionManagementService: false,
                installedExtensions: []
            };

            // Check if we can enumerate installed extensions via the window
            if (typeof window !== 'undefined') {
                // Check for exposed services
                result.hasExtensionGalleryService = !!window.__EXTENSION_GALLERY_SERVICE__;
                result.hasExtensionManagementService = !!window.__EXTENSION_MANAGEMENT_SERVICE__;

                // Try to get installed extensions list
                const viewlet = document.querySelector('.extensions-viewlet');
                if (viewlet) {
                    const items = viewlet.querySelectorAll('.extension-list-item .name, .monaco-list-row .name');
                    result.installedExtensions = Array.from(items).map(i => i.textContent).slice(0, 10);
                }
            }

            return result;
        } catch (e) {
            return { error: e.message || String(e) };
        }
    })()")

    echo "$serviceState" | jq -r '.result'

    echo -e "  ${GREEN}✓${NC} Extension service diagnostic complete"
    ((TESTS_PASSED++))
}

# ============================================================================
# Run Diagnostics
# ============================================================================

wait_for_server 30 || exit 1
wait_for_bridge 30 || exit 1

echo ""
echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}  DIAGNOSTIC: Extensions Panel INSTALLED Investigation${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"
echo ""
echo "This diagnostic gathers information about why the INSTALLED"
echo "dropdown may not be showing in the Extensions panel."
echo ""

run_tests
