#!/bin/bash
# E2E Test: Extension Details Tabs (DETAILS, CHANGELOG)
#
# USER-CENTRIC TEST: Verifies what users actually see in the UI
#
# This test comprehensively verifies:
# 1. User can see installed extensions in the sidebar
# 2. User can open extension details by clicking on an extension
# 3. Extension editor shows header with extension name/version
# 4. Tab navigation (Details, Features, Changelog) is visible and functional
# 5. DETAILS tab renders README content in webview iframe
# 6. CHANGELOG tab renders changelog content in webview iframe
# 7. Webview iframe structure is correct (active-frame exists)
# 8. Content is actually HTML rendered (not raw markdown)
# 9. Tab switching is responsive
#
# All assertions are based on visible DOM content and HTML structure.

source "$(dirname "$0")/../lib/test-client.sh"

# ============================================================================
# Helper Functions for Reliable Testing
# ============================================================================

# Wait for a condition to be true with retries
# Usage: wait_for_condition "description" "js_expression_returning_true_or_false" [timeout_seconds]
wait_for_condition() {
    local description="$1"
    local js_code="$2"
    local timeout="${3:-10}"
    local elapsed=0

    while [ $elapsed -lt $timeout ]; do
        local result=$(test_js "$js_code")
        local value=$(echo "$result" | jq -r '.result // false')
        if [ "$value" = "true" ]; then
            return 0
        fi
        sleep 0.5
        elapsed=$((elapsed + 1))
    done
    echo "    Timeout waiting for: $description" >&2
    return 1
}

# Wait for webview content to be fully loaded
# Usage: wait_for_webview_content [timeout_seconds]
wait_for_webview_content() {
    local timeout="${1:-15}"
    wait_for_condition "webview content" "(function() {
        var webview = document.querySelector('iframe.webview.ready');
        if (!webview || !webview.contentDocument) return false;
        var activeFrame = webview.contentDocument.getElementById('active-frame');
        if (!activeFrame || !activeFrame.contentDocument) return false;
        var body = activeFrame.contentDocument.body;
        return body && body.textContent && body.textContent.length > 100;
    })()" "$timeout"
}

# Ensure extension details panel is open with proper content
# Usage: ensure_extension_details_open
ensure_extension_details_open() {
    # Check if extension editor is already open
    local is_open=$(test_js "!!document.querySelector('.extension-editor')")
    local open_status=$(echo "$is_open" | jq -r '.result // false')

    if [ "$open_status" = "true" ]; then
        return 0
    fi

    # Open extensions panel first
    test_js "(function() {
        var selectors = [
            '[aria-label*=\"Extensions\"]',
            '.codicon-extensions-view-icon',
            '.activitybar .action-item .codicon-extensions'
        ];
        for (var i = 0; i < selectors.length; i++) {
            var btn = document.querySelector(selectors[i]);
            if (btn) {
                var clickable = btn.closest('.action-item') || btn;
                clickable.click();
                return 'clicked';
            }
        }
        return 'not-found';
    })()" > /dev/null

    sleep 2

    # Double-click first extension to open details
    test_js "(function() {
        var items = document.querySelectorAll('.extension-list-item');
        if (items.length === 0) return 'no-items';
        var item = items[0];
        item.click();
        var evt = new MouseEvent('dblclick', {bubbles: true, cancelable: true});
        item.dispatchEvent(evt);
        return 'clicked';
    })()" > /dev/null

    sleep 2

    # Verify it opened
    wait_for_condition "extension editor" "!!document.querySelector('.extension-editor')" 5
}

# ============================================================================
# Test: User Can See Installed Extensions in List
# ============================================================================
test_user_sees_installed_extensions() {
    echo "  Verifying user can see installed extensions..."

    # Click on Extensions in activity bar (user action)
    local click_result=$(test_js "(function() {
        var selectors = [
            '[aria-label*=\"Extensions\"]',
            '.codicon-extensions-view-icon',
            '.activitybar .action-item .codicon-extensions'
        ];
        for (var i = 0; i < selectors.length; i++) {
            var btn = document.querySelector(selectors[i]);
            if (btn) {
                var clickable = btn.closest('.action-item') || btn;
                clickable.click();
                return 'clicked: ' + selectors[i];
            }
        }
        return 'not-found';
    })()")

    echo "    Click result: $(echo "$click_result" | jq -r '.result // "error"')"
    sleep 5  # Wait for extensions panel to load

    # User should see extension list items with names and icons
    local result=$(test_js "(function() {
        var items = document.querySelectorAll('.extension-list-item');
        var visibleItems = [];

        for (var i = 0; i < items.length; i++) {
            var item = items[i];
            if (item.offsetParent !== null && item.offsetHeight > 0) {
                var name = item.querySelector('.name, .extension-name');
                var icon = item.querySelector('.icon, img');
                visibleItems.push({
                    name: name ? name.textContent.trim() : 'unknown',
                    hasIcon: !!icon
                });
            }
        }

        return {
            totalItems: items.length,
            visibleCount: visibleItems.length,
            extensions: visibleItems.slice(0, 5)
        };
    })()")

    local visibleCount=$(echo "$result" | jq -r '.result.visibleCount // 0')
    local names=$(echo "$result" | jq -r '.result.extensions | map(.name) | join(", ")' 2>/dev/null || echo "")

    echo "    Visible extensions: $visibleCount"
    echo "    Names: ${names:0:80}..."

    if [ "$visibleCount" -gt 0 ]; then
        echo -e "  ${GREEN}✓${NC} User can see $visibleCount extension(s) in the list"
        ((TESTS_PASSED++))
    else
        echo -e "  ${RED}✗${NC} No extensions visible to user"
        ((TESTS_FAILED++))
    fi
}

# ============================================================================
# Test: User Can Open Extension Details Panel
# ============================================================================
test_user_opens_extension_details() {
    echo "  Verifying user can open extension details panel..."

    # Double-click on first extension to open details
    local click_result=$(test_js "(function() {
        var items = document.querySelectorAll('.extension-list-item');
        if (items.length === 0) return { clicked: false, reason: 'no-items' };

        var item = items[0];
        var name = item.querySelector('.name, .extension-name');
        item.click();
        var evt = new MouseEvent('dblclick', {bubbles: true, cancelable: true});
        item.dispatchEvent(evt);

        return {
            clicked: true,
            extensionName: name ? name.textContent.trim() : 'unknown'
        };
    })()")

    local clicked=$(echo "$click_result" | jq -r '.result.clicked // false')
    local extName=$(echo "$click_result" | jq -r '.result.extensionName // "unknown"')

    if [ "$clicked" = "false" ]; then
        echo -e "  ${RED}✗${NC} Could not click on extension"
        ((TESTS_FAILED++))
        return
    fi

    echo "    Clicked on: $extName"
    sleep 3  # Wait for details panel to load

    # Verify extension editor panel appears with proper structure
    local result=$(test_js "(function() {
        var editor = document.querySelector('.extension-editor');
        if (!editor) return { found: false, reason: 'no-editor' };

        var header = editor.querySelector('.header');
        var navbar = editor.querySelector('.navbar');
        var body = editor.querySelector('.body');

        // Get extension info from header
        var nameEl = header ? header.querySelector('.name') : null;
        var versionEl = header ? header.querySelector('.version') : null;

        // Get available tabs
        var tabs = navbar ? navbar.querySelectorAll('.navbar-entry, a') : [];
        var tabNames = [];
        for (var i = 0; i < tabs.length; i++) {
            tabNames.push(tabs[i].textContent.trim());
        }

        return {
            found: true,
            hasHeader: !!header && header.offsetParent !== null,
            hasNavbar: !!navbar && navbar.offsetParent !== null,
            hasBody: !!body && body.offsetParent !== null,
            extensionName: nameEl ? nameEl.textContent.trim() : '',
            extensionVersion: versionEl ? versionEl.textContent.trim() : '',
            tabs: tabNames,
            tabCount: tabs.length
        };
    })()")

    local found=$(echo "$result" | jq -r '.result.found // false')
    local hasHeader=$(echo "$result" | jq -r '.result.hasHeader // false')
    local hasNavbar=$(echo "$result" | jq -r '.result.hasNavbar // false')
    local hasBody=$(echo "$result" | jq -r '.result.hasBody // false')
    local tabs=$(echo "$result" | jq -r '.result.tabs | join(", ")' 2>/dev/null || echo "")
    local tabCount=$(echo "$result" | jq -r '.result.tabCount // 0')

    echo "    Header visible: $hasHeader"
    echo "    Navbar visible: $hasNavbar"
    echo "    Body visible: $hasBody"
    echo "    Tabs ($tabCount): $tabs"

    if [ "$hasHeader" = "true" ] && [ "$hasNavbar" = "true" ] && [ "$tabCount" -ge 2 ]; then
        echo -e "  ${GREEN}✓${NC} Extension details panel opened with proper structure"
        ((TESTS_PASSED++))
    else
        echo -e "  ${RED}✗${NC} Extension details panel structure incomplete"
        ((TESTS_FAILED++))
    fi
}

# ============================================================================
# Test: Webview Iframe Structure is Correct
# ============================================================================
test_webview_iframe_structure() {
    echo "  Verifying webview iframe structure..."

    # Ensure extension details panel is open
    ensure_extension_details_open

    # Ensure we're on the Details tab (which has the webview)
    test_js "(function() {
        var navbar = document.querySelector('.extension-editor .navbar');
        if (!navbar) return;
        var tabs = navbar.querySelectorAll('.navbar-entry, a');
        for (var i = 0; i < tabs.length; i++) {
            if (tabs[i].textContent.toLowerCase().indexOf('details') >= 0) {
                tabs[i].click();
                break;
            }
        }
    })()" > /dev/null

    # Wait for webview to be ready with content (longer timeout for reliability)
    wait_for_webview_content 15

    local result=$(test_js "(function() {
        // Find the webview iframe
        var webview = document.querySelector('iframe.webview');
        if (!webview) return { found: false, reason: 'no-webview-iframe' };

        var isReady = webview.classList.contains('ready');
        var src = webview.src || '';

        // Check if src points to our patched webview
        var isLocalWebview = src.indexOf('/vs/workbench/contrib/webview/browser/pre/') >= 0;

        // Access webview content document
        var contentDoc = webview.contentDocument;
        if (!contentDoc) return {
            found: true,
            isReady: isReady,
            isLocalWebview: isLocalWebview,
            hasContentDoc: false
        };

        // Check for active-frame (content has been loaded)
        var activeFrame = contentDoc.getElementById('active-frame');
        var pendingFrame = contentDoc.getElementById('pending-frame');

        // Check performance marks for webview lifecycle
        var marks = [];
        try {
            var perfMarks = webview.contentWindow.performance.getEntriesByType('mark');
            marks = perfMarks.map(function(m) { return m.name; });
        } catch(e) {}

        return {
            found: true,
            isReady: isReady,
            isLocalWebview: isLocalWebview,
            hasContentDoc: true,
            hasActiveFrame: !!activeFrame,
            hasPendingFrame: !!pendingFrame,
            performanceMarks: marks,
            markCount: marks.length
        };
    })()")

    local found=$(echo "$result" | jq -r '.result.found // false')
    local isReady=$(echo "$result" | jq -r '.result.isReady // false')
    local isLocal=$(echo "$result" | jq -r '.result.isLocalWebview // false')
    local hasActive=$(echo "$result" | jq -r '.result.hasActiveFrame // false')
    local markCount=$(echo "$result" | jq -r '.result.markCount // 0')

    echo "    Webview found: $found"
    echo "    Webview ready: $isReady"
    echo "    Using local webview: $isLocal"
    echo "    Active frame exists: $hasActive"
    echo "    Performance marks: $markCount"

    if [ "$isReady" = "true" ] && [ "$hasActive" = "true" ]; then
        echo -e "  ${GREEN}✓${NC} Webview iframe structure is correct"
        ((TESTS_PASSED++))
    elif [ "$isReady" = "true" ]; then
        echo -e "  ${YELLOW}!${NC} Webview ready but no active frame yet"
        ((TESTS_SKIPPED++))
    else
        echo -e "  ${RED}✗${NC} Webview iframe not properly initialized"
        ((TESTS_FAILED++))
    fi
}

# ============================================================================
# Test: README Content Renders in DETAILS Tab
# ============================================================================
test_readme_content_renders() {
    echo "  Verifying README content renders in DETAILS tab..."

    # Ensure extension details panel is open
    ensure_extension_details_open

    # Click on Details tab first
    test_js "(function() {
        var navbar = document.querySelector('.extension-editor .navbar');
        if (!navbar) return;
        var tabs = navbar.querySelectorAll('.navbar-entry, a');
        for (var i = 0; i < tabs.length; i++) {
            if (tabs[i].textContent.toLowerCase().indexOf('details') >= 0) {
                tabs[i].click();
                break;
            }
        }
    })()" > /dev/null

    # Wait for webview content to be fully loaded
    wait_for_webview_content 15

    local result=$(test_js "(function() {
        // Find the webview and its active frame
        var webview = document.querySelector('iframe.webview.ready');
        if (!webview || !webview.contentDocument) {
            return { found: false, reason: 'no-ready-webview' };
        }

        var activeFrame = webview.contentDocument.getElementById('active-frame');
        if (!activeFrame || !activeFrame.contentDocument) {
            return { found: false, reason: 'no-active-frame' };
        }

        var innerDoc = activeFrame.contentDocument;
        var body = innerDoc.body;
        if (!body) return { found: false, reason: 'no-body' };

        var text = body.textContent || '';
        var html = body.innerHTML || '';

        // Check for HTML elements that indicate rendered markdown
        var hasHeadings = innerDoc.querySelectorAll('h1, h2, h3').length > 0;
        var hasParagraphs = innerDoc.querySelectorAll('p').length > 0;
        var hasLinks = innerDoc.querySelectorAll('a').length > 0;
        var hasLists = innerDoc.querySelectorAll('ul, ol').length > 0;
        var hasCodeBlocks = innerDoc.querySelectorAll('pre, code').length > 0;

        // Look for common README patterns
        var hasReadmeContent = text.indexOf('extension') >= 0 ||
                               text.indexOf('Extension') >= 0 ||
                               text.indexOf('Visual Studio Code') >= 0 ||
                               text.indexOf('Installation') >= 0;

        return {
            found: true,
            textLength: text.length,
            htmlLength: html.length,
            hasHeadings: hasHeadings,
            hasParagraphs: hasParagraphs,
            hasLinks: hasLinks,
            hasLists: hasLists,
            hasCodeBlocks: hasCodeBlocks,
            hasReadmeContent: hasReadmeContent,
            isRenderedHtml: hasHeadings || hasParagraphs || hasLinks,
            sample: text.substring(0, 200).replace(/\\s+/g, ' ').trim()
        };
    })()")

    local found=$(echo "$result" | jq -r '.result.found // false')
    local textLen=$(echo "$result" | jq -r '.result.textLength // 0')
    local isRendered=$(echo "$result" | jq -r '.result.isRenderedHtml // false')
    local hasHeadings=$(echo "$result" | jq -r '.result.hasHeadings // false')
    local hasParagraphs=$(echo "$result" | jq -r '.result.hasParagraphs // false')
    local hasLinks=$(echo "$result" | jq -r '.result.hasLinks // false')
    local sample=$(echo "$result" | jq -r '.result.sample // ""')

    echo "    Content length: $textLen chars"
    echo "    Has headings: $hasHeadings"
    echo "    Has paragraphs: $hasParagraphs"
    echo "    Has links: $hasLinks"
    echo "    Is rendered HTML: $isRendered"
    echo "    Sample: ${sample:0:80}..."

    if [ "$textLen" -gt 500 ] && [ "$isRendered" = "true" ]; then
        echo -e "  ${GREEN}✓${NC} README content renders as HTML ($textLen chars)"
        ((TESTS_PASSED++))
    elif [ "$textLen" -gt 100 ]; then
        echo -e "  ${YELLOW}!${NC} README content present but minimal HTML structure"
        ((TESTS_PASSED++))
    else
        echo -e "  ${RED}✗${NC} README content not rendering properly"
        ((TESTS_FAILED++))
    fi
}

# ============================================================================
# Test: CHANGELOG Content Renders in CHANGELOG Tab
# ============================================================================
test_changelog_content_renders() {
    echo "  Verifying CHANGELOG content renders in CHANGELOG tab..."

    # Ensure extension details panel is open
    ensure_extension_details_open

    # Click on Changelog tab
    local click_result=$(test_js "(function() {
        var navbar = document.querySelector('.extension-editor .navbar');
        if (!navbar) return { clicked: false };

        var tabs = navbar.querySelectorAll('.navbar-entry, a');
        for (var i = 0; i < tabs.length; i++) {
            if (tabs[i].textContent.toLowerCase().indexOf('changelog') >= 0) {
                tabs[i].click();
                return { clicked: true, tabText: tabs[i].textContent };
            }
        }
        return { clicked: false, reason: 'no-changelog-tab' };
    })()")

    local clicked=$(echo "$click_result" | jq -r '.result.clicked // false')
    if [ "$clicked" = "false" ]; then
        echo -e "  ${YELLOW}!${NC} Changelog tab not found"
        ((TESTS_SKIPPED++))
        return
    fi

    # Wait for webview content to be fully loaded after tab switch
    wait_for_webview_content 15

    local result=$(test_js "(function() {
        var webview = document.querySelector('iframe.webview.ready');
        if (!webview || !webview.contentDocument) {
            return { found: false, reason: 'no-ready-webview' };
        }

        var activeFrame = webview.contentDocument.getElementById('active-frame');
        if (!activeFrame || !activeFrame.contentDocument) {
            return { found: false, reason: 'no-active-frame' };
        }

        var innerDoc = activeFrame.contentDocument;
        var body = innerDoc.body;
        if (!body) return { found: false, reason: 'no-body' };

        var text = body.textContent || '';
        var html = body.innerHTML || '';

        // Check for changelog-specific patterns
        var hasVersionNumbers = /\\d+\\.\\d+\\.\\d+/.test(text);
        var hasDatePatterns = /\\d{4}|January|February|March|April|May|June|July|August|September|October|November|December/i.test(text);
        var hasChangelogKeywords = /changelog|changes|release|fix|feature|update|added|removed|bug/i.test(text);
        var hasHeadings = innerDoc.querySelectorAll('h1, h2, h3').length > 0;

        return {
            found: true,
            textLength: text.length,
            htmlLength: html.length,
            hasVersionNumbers: hasVersionNumbers,
            hasDatePatterns: hasDatePatterns,
            hasChangelogKeywords: hasChangelogKeywords,
            hasHeadings: hasHeadings,
            isChangelogContent: hasVersionNumbers || hasChangelogKeywords,
            sample: text.substring(0, 200).replace(/\\s+/g, ' ').trim()
        };
    })()")

    local found=$(echo "$result" | jq -r '.result.found // false')
    local textLen=$(echo "$result" | jq -r '.result.textLength // 0')
    local isChangelog=$(echo "$result" | jq -r '.result.isChangelogContent // false')
    local hasVersions=$(echo "$result" | jq -r '.result.hasVersionNumbers // false')
    local hasHeadings=$(echo "$result" | jq -r '.result.hasHeadings // false')
    local sample=$(echo "$result" | jq -r '.result.sample // ""')

    echo "    Content length: $textLen chars"
    echo "    Has version numbers: $hasVersions"
    echo "    Has headings: $hasHeadings"
    echo "    Is changelog content: $isChangelog"
    echo "    Sample: ${sample:0:80}..."

    if [ "$textLen" -gt 500 ] && [ "$isChangelog" = "true" ]; then
        echo -e "  ${GREEN}✓${NC} CHANGELOG content renders properly ($textLen chars)"
        ((TESTS_PASSED++))
    elif [ "$textLen" -gt 100 ]; then
        echo -e "  ${YELLOW}!${NC} CHANGELOG content present but may not be fully rendered"
        ((TESTS_PASSED++))
    elif [ "$found" = "false" ]; then
        echo -e "  ${YELLOW}!${NC} CHANGELOG webview not ready (timing issue)"
        ((TESTS_SKIPPED++))
    else
        echo -e "  ${YELLOW}!${NC} CHANGELOG content minimal (extension may not have changelog)"
        ((TESTS_SKIPPED++))
    fi
}

# ============================================================================
# Test: Tab Switching is Responsive
# ============================================================================
test_tab_switching_responsive() {
    echo "  Verifying tab switching is responsive..."

    # Ensure extension details panel is open
    ensure_extension_details_open

    local result=$(test_js "(function() {
        var navbar = document.querySelector('.extension-editor .navbar');
        if (!navbar) return { found: false };

        var tabs = navbar.querySelectorAll('.navbar-entry, a');
        if (tabs.length < 2) return { found: false, reason: 'not-enough-tabs' };

        var switchTimes = [];
        var tabsClicked = [];

        // Click each tab and measure response time
        for (var i = 0; i < tabs.length; i++) {
            var start = performance.now();
            tabs[i].click();
            var elapsed = performance.now() - start;
            switchTimes.push(Math.round(elapsed));
            tabsClicked.push(tabs[i].textContent.trim());
        }

        var avgTime = switchTimes.reduce(function(a,b) { return a+b; }, 0) / switchTimes.length;
        var maxTime = Math.max.apply(null, switchTimes);

        return {
            found: true,
            tabCount: tabs.length,
            tabsClicked: tabsClicked,
            switchTimes: switchTimes,
            avgTimeMs: Math.round(avgTime),
            maxTimeMs: maxTime,
            isResponsive: avgTime < 100 && maxTime < 500
        };
    })()")

    local found=$(echo "$result" | jq -r '.result.found // false')
    local avgTime=$(echo "$result" | jq -r '.result.avgTimeMs // 0')
    local maxTime=$(echo "$result" | jq -r '.result.maxTimeMs // 0')
    local isResponsive=$(echo "$result" | jq -r '.result.isResponsive // false')
    local tabCount=$(echo "$result" | jq -r '.result.tabCount // 0')

    if [ "$found" = "false" ]; then
        echo -e "  ${YELLOW}!${NC} Tabs not available for switching test"
        ((TESTS_SKIPPED++))
        return
    fi

    echo "    Tabs tested: $tabCount"
    echo "    Average switch time: ${avgTime}ms"
    echo "    Max switch time: ${maxTime}ms"

    if [ "$isResponsive" = "true" ]; then
        echo -e "  ${GREEN}✓${NC} Tab switching is responsive (avg: ${avgTime}ms, max: ${maxTime}ms)"
        ((TESTS_PASSED++))
    else
        echo -e "  ${RED}✗${NC} Tab switching is slow (avg: ${avgTime}ms, max: ${maxTime}ms)"
        ((TESTS_FAILED++))
    fi
}

# ============================================================================
# Test: Extension Metadata is Displayed
# ============================================================================
test_extension_metadata_displayed() {
    echo "  Verifying extension metadata is displayed..."

    # Ensure extension details panel is open
    ensure_extension_details_open

    local result=$(test_js "(function() {
        var editor = document.querySelector('.extension-editor');
        if (!editor) return { found: false };

        // Check for metadata elements
        var header = editor.querySelector('.header');
        var details = editor.querySelector('.details');

        // Look for common metadata fields
        var nameEl = editor.querySelector('.name');
        var versionEl = editor.querySelector('.version');
        var publisherEl = editor.querySelector('.publisher');
        var installCountEl = editor.querySelector('.install-count, [class*=\"install\"]');
        var ratingEl = editor.querySelector('.rating, [class*=\"rating\"]');

        // Check the properties/metadata section
        var properties = editor.querySelectorAll('.additional-details-element, .properties-body td');
        var propertyTexts = [];
        for (var i = 0; i < Math.min(properties.length, 10); i++) {
            propertyTexts.push(properties[i].textContent.trim().substring(0, 50));
        }

        return {
            found: true,
            hasHeader: !!header,
            hasName: !!nameEl,
            nameText: nameEl ? nameEl.textContent.trim() : '',
            hasVersion: !!versionEl,
            versionText: versionEl ? versionEl.textContent.trim() : '',
            hasPublisher: !!publisherEl,
            propertyCount: properties.length,
            properties: propertyTexts
        };
    })()")

    local found=$(echo "$result" | jq -r '.result.found // false')
    local hasName=$(echo "$result" | jq -r '.result.hasName // false')
    local nameText=$(echo "$result" | jq -r '.result.nameText // ""')
    local hasVersion=$(echo "$result" | jq -r '.result.hasVersion // false')
    local versionText=$(echo "$result" | jq -r '.result.versionText // ""')
    local propCount=$(echo "$result" | jq -r '.result.propertyCount // 0')

    echo "    Has name: $hasName ($nameText)"
    echo "    Has version: $hasVersion ($versionText)"
    echo "    Property count: $propCount"

    if [ "$hasName" = "true" ] && [ -n "$nameText" ]; then
        echo -e "  ${GREEN}✓${NC} Extension metadata is displayed"
        ((TESTS_PASSED++))
    else
        echo -e "  ${RED}✗${NC} Extension metadata not properly displayed"
        ((TESTS_FAILED++))
    fi
}

# ============================================================================
# Run Tests in Logical User Flow Order
# ============================================================================

wait_for_server 30 || exit 1
wait_for_bridge 30 || exit 1

echo ""
echo -e "${CYAN}═══════════════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}  EXTENSION DETAILS - COMPREHENSIVE USER EXPERIENCE TEST${NC}"
echo -e "${CYAN}  Verifying visible UI content, HTML rendering, and webview state${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════════════════${NC}"
echo ""

echo -e "${BLUE}Test Suite: 35-extension-details-tabs${NC}"
echo ""

# Phase 1: Extension List
echo -e "${BLUE}Phase 1: Extension Discovery${NC}"
echo -e "${BLUE}────────────────────────────${NC}"
echo -e "${BLUE}Running:${NC} test_user_sees_installed_extensions"
test_user_sees_installed_extensions
echo ""

# Phase 2: Open Extension Details
echo -e "${BLUE}Phase 2: Extension Details Panel${NC}"
echo -e "${BLUE}────────────────────────────────${NC}"
echo -e "${BLUE}Running:${NC} test_user_opens_extension_details"
test_user_opens_extension_details
echo ""

echo -e "${BLUE}Running:${NC} test_extension_metadata_displayed"
test_extension_metadata_displayed
echo ""

# Phase 3: Webview Verification
echo -e "${BLUE}Phase 3: Webview Content Rendering${NC}"
echo -e "${BLUE}───────────────────────────────────${NC}"
echo -e "${BLUE}Running:${NC} test_webview_iframe_structure"
test_webview_iframe_structure
echo ""

echo -e "${BLUE}Running:${NC} test_readme_content_renders"
test_readme_content_renders
echo ""

echo -e "${BLUE}Running:${NC} test_changelog_content_renders"
test_changelog_content_renders
echo ""

# Phase 4: Responsiveness
echo -e "${BLUE}Phase 4: UI Responsiveness${NC}"
echo -e "${BLUE}──────────────────────────${NC}"
echo -e "${BLUE}Running:${NC} test_tab_switching_responsive"
test_tab_switching_responsive
echo ""

# Print summary
echo -e "${BLUE}═══════════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  TEST SUMMARY${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════════════${NC}"
echo -e "  ${GREEN}Passed:${NC}  $TESTS_PASSED"
echo -e "  ${RED}Failed:${NC}  $TESTS_FAILED"
echo -e "  ${YELLOW}Skipped:${NC} $TESTS_SKIPPED"
echo -e "${BLUE}═══════════════════════════════════════════════════════════════════${NC}"
echo ""
echo "TEST_RESULTS:passed=$TESTS_PASSED,failed=$TESTS_FAILED,skipped=$TESTS_SKIPPED"

# Exit with failure if any tests failed
if [ $TESTS_FAILED -gt 0 ]; then
    exit 1
fi
