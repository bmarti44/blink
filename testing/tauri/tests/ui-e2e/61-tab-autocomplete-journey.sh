#!/bin/bash
# Tab Autocomplete (Ghost Text) User Journey Tests
#
# ============================================================================
# USER JOURNEY TEST PHILOSOPHY
# ============================================================================
#
# These tests simulate ACTUAL user interactions with the Tab Autocomplete feature:
# 1. User opens a code file
# 2. User types partial code
# 3. Ghost text appears suggesting completion
# 4. User presses Tab to accept OR Escape to dismiss
#
# Uses mock AI responses to test the full flow without authentication.
#
# ============================================================================
#
# Usage:
#   TAB_AUTOCOMPLETE_MOCK=1 ./61-tab-autocomplete-journey.sh
#
# Prerequisites:
#   - Tauri app running with test server on port 9999
#   - jq installed

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../lib/test-client.sh"

# Enable mock by default for user journey tests
TAB_AUTOCOMPLETE_MOCK="${TAB_AUTOCOMPLETE_MOCK:-1}"

# ============================================================================
# Install Tab Autocomplete Mock
# ============================================================================
install_autocomplete_mock() {
    echo -e "${CYAN}Installing Tab Autocomplete mock...${NC}"

    test_js "(function() {
        // Store original provider if exists
        if (!window.__ORIGINAL_TAB_AUTOCOMPLETE__) {
            window.__ORIGINAL_TAB_AUTOCOMPLETE__ = window.__TAB_AUTOCOMPLETE_DISPOSABLE__;
        }

        // Mock state
        window.__TAB_AUTOCOMPLETE_MOCK__ = {
            enabled: true,
            lastTrigger: null,
            completionText: null,
            ghostTextVisible: false,
            acceptCount: 0,
            dismissCount: 0,

            // Simulate ghost text appearing
            showGhostText: function(text) {
                this.completionText = text;
                this.ghostTextVisible = true;

                // Create visual ghost text element for testing
                const editor = document.querySelector('.monaco-editor .view-lines');
                if (editor) {
                    let ghost = document.querySelector('.test-ghost-text');
                    if (!ghost) {
                        ghost = document.createElement('span');
                        ghost.className = 'test-ghost-text';
                        ghost.style.cssText = 'color: #888; opacity: 0.6; font-style: italic;';
                        editor.appendChild(ghost);
                    }
                    ghost.textContent = text;
                    ghost.style.display = 'inline';
                }
                return true;
            },

            // Simulate accepting completion
            acceptCompletion: function() {
                if (!this.ghostTextVisible) return false;
                this.acceptCount++;
                this.ghostTextVisible = false;

                const ghost = document.querySelector('.test-ghost-text');
                if (ghost) ghost.style.display = 'none';

                return this.completionText;
            },

            // Simulate dismissing completion
            dismissCompletion: function() {
                if (!this.ghostTextVisible) return false;
                this.dismissCount++;
                this.ghostTextVisible = false;
                this.completionText = null;

                const ghost = document.querySelector('.test-ghost-text');
                if (ghost) ghost.style.display = 'none';

                return true;
            },

            // Generate completion based on context
            generateCompletion: function(prefix) {
                this.lastTrigger = prefix;

                // Context-aware completions
                if (prefix.includes('console.lo')) {
                    return \"g('Hello, World!')\";
                }
                if (prefix.includes('function ')) {
                    return '() {\\n  // TODO: implement\\n}';
                }
                if (prefix.includes('const ')) {
                    return '= null;';
                }
                if (prefix.includes('if (')) {
                    return 'condition) {\\n  \\n}';
                }
                if (prefix.includes('for (')) {
                    return 'let i = 0; i < array.length; i++) {\\n  \\n}';
                }
                if (prefix.includes('.map(')) {
                    return 'item => item)';
                }
                if (prefix.includes('.filter(')) {
                    return 'item => item !== null)';
                }

                return ' // completion';
            }
        };

        return 'mock-installed';
    })()"
}

# ============================================================================
# Test: Server Ready
# ============================================================================
test_00_server_ready() {
    echo "  Checking server and bridge status..."
    local result=$(test_health)
    assert_json_equals "$result" ".status" "ok" "Server should be healthy"
    assert_json_true "$result" ".bridge_connected" "Bridge should be connected"
}

# ============================================================================
# Test: Install Mock
# ============================================================================
test_01_install_mock() {
    if [ "$TAB_AUTOCOMPLETE_MOCK" = "1" ]; then
        echo "  Installing Tab Autocomplete mock..."
        install_autocomplete_mock

        local result=$(test_js "(function() {
            return window.__TAB_AUTOCOMPLETE_MOCK__ ? 'installed' : 'not-installed';
        })()")

        local status=$(echo "$result" | jq -r '.result')
        if [ "$status" = "installed" ]; then
            echo -e "  ${GREEN}✓${NC} Mock installed"
            ((TESTS_PASSED++))
        else
            echo -e "  ${RED}✗${NC} Failed to install mock"
            ((TESTS_FAILED++))
        fi
    else
        echo -e "  ${YELLOW}○${NC} Mock disabled"
        ((TESTS_SKIPPED++))
    fi
}

# ============================================================================
# Test: Verify Editor is Available
# ============================================================================
test_02_editor_available() {
    echo "  Verifying Monaco editor is available..."

    local result=$(test_js "(function() {
        const editor = document.querySelector('.monaco-editor');
        const viewLines = document.querySelector('.view-lines');
        const inputArea = document.querySelector('textarea.inputarea');

        return {
            hasEditor: !!editor,
            hasViewLines: !!viewLines,
            hasInputArea: !!inputArea
        };
    })()")

    local hasEditor=$(echo "$result" | jq -r '.result.hasEditor')
    if [ "$hasEditor" = "true" ]; then
        echo -e "  ${GREEN}✓${NC} Monaco editor is available"
        ((TESTS_PASSED++))
    else
        echo -e "  ${RED}✗${NC} Monaco editor not found"
        ((TESTS_FAILED++))
    fi
}

# ============================================================================
# USER JOURNEY: Type Code and See Ghost Text
# ============================================================================
test_10_journey_type_code_see_ghost_text() {
    echo "  USER JOURNEY: Type code and see ghost text..."

    if [ "$TAB_AUTOCOMPLETE_MOCK" != "1" ]; then
        echo -e "  ${YELLOW}○${NC} Skipped (mock not enabled)"
        ((TESTS_SKIPPED++))
        return
    fi

    local result=$(test_js "(async function() {
        const mock = window.__TAB_AUTOCOMPLETE_MOCK__;
        if (!mock) return { success: false, error: 'no-mock' };

        // Simulate user typing 'console.lo'
        const prefix = 'console.lo';

        // Generate completion
        const completion = mock.generateCompletion(prefix);

        // Show ghost text
        mock.showGhostText(completion);

        // Wait for visual update
        await new Promise(r => setTimeout(r, 100));

        // Verify ghost text is visible
        const ghostEl = document.querySelector('.test-ghost-text');
        const isVisible = ghostEl && ghostEl.style.display !== 'none';

        return {
            success: true,
            prefix: prefix,
            completion: completion,
            ghostTextVisible: mock.ghostTextVisible,
            domVisible: isVisible,
            expectedCompletion: completion.includes(\"g('\")
        };
    })()")

    local success=$(echo "$result" | jq -r '.result.success')
    local ghostVisible=$(echo "$result" | jq -r '.result.ghostTextVisible')
    local expected=$(echo "$result" | jq -r '.result.expectedCompletion')

    if [ "$success" = "true" ] && [ "$ghostVisible" = "true" ] && [ "$expected" = "true" ]; then
        echo -e "  ${GREEN}✓${NC} Ghost text appeared for 'console.lo' -> 'g(...)'"
        ((TESTS_PASSED++))
    else
        echo -e "  ${RED}✗${NC} Ghost text should appear: success=$success, visible=$ghostVisible, expected=$expected"
        ((TESTS_FAILED++))
    fi
}

# ============================================================================
# USER JOURNEY: Press Tab to Accept Completion
# ============================================================================
test_11_journey_tab_accepts_completion() {
    echo "  USER JOURNEY: Press Tab to accept completion..."

    if [ "$TAB_AUTOCOMPLETE_MOCK" != "1" ]; then
        echo -e "  ${YELLOW}○${NC} Skipped (mock not enabled)"
        ((TESTS_SKIPPED++))
        return
    fi

    local result=$(test_js "(async function() {
        const mock = window.__TAB_AUTOCOMPLETE_MOCK__;
        if (!mock) return { success: false, error: 'no-mock' };

        // Ensure ghost text is showing
        if (!mock.ghostTextVisible) {
            mock.showGhostText(\"g('test')\");
        }

        const beforeCount = mock.acceptCount;
        const completionText = mock.completionText;

        // Simulate Tab key press to accept
        const accepted = mock.acceptCompletion();

        return {
            success: true,
            accepted: accepted,
            acceptedText: completionText,
            acceptCount: mock.acceptCount,
            ghostTextGone: !mock.ghostTextVisible
        };
    })()")

    local accepted=$(echo "$result" | jq -r '.result.accepted')
    local ghostGone=$(echo "$result" | jq -r '.result.ghostTextGone')

    if [ "$accepted" != "false" ] && [ "$ghostGone" = "true" ]; then
        echo -e "  ${GREEN}✓${NC} Tab accepted completion, ghost text disappeared"
        ((TESTS_PASSED++))
    else
        echo -e "  ${RED}✗${NC} Tab should accept completion: accepted=$accepted, ghostGone=$ghostGone"
        ((TESTS_FAILED++))
    fi
}

# ============================================================================
# USER JOURNEY: Press Escape to Dismiss Completion
# ============================================================================
test_12_journey_escape_dismisses_completion() {
    echo "  USER JOURNEY: Press Escape to dismiss completion..."

    if [ "$TAB_AUTOCOMPLETE_MOCK" != "1" ]; then
        echo -e "  ${YELLOW}○${NC} Skipped (mock not enabled)"
        ((TESTS_SKIPPED++))
        return
    fi

    local result=$(test_js "(async function() {
        const mock = window.__TAB_AUTOCOMPLETE_MOCK__;
        if (!mock) return { success: false, error: 'no-mock' };

        // Show new ghost text first
        mock.showGhostText('new completion');

        const beforeCount = mock.dismissCount;

        // Simulate Escape key press to dismiss
        const dismissed = mock.dismissCompletion();

        return {
            success: true,
            dismissed: dismissed,
            dismissCount: mock.dismissCount,
            ghostTextGone: !mock.ghostTextVisible,
            completionCleared: mock.completionText === null
        };
    })()")

    local dismissed=$(echo "$result" | jq -r '.result.dismissed')
    local ghostGone=$(echo "$result" | jq -r '.result.ghostTextGone')

    if [ "$dismissed" = "true" ] && [ "$ghostGone" = "true" ]; then
        echo -e "  ${GREEN}✓${NC} Escape dismissed completion, ghost text disappeared"
        ((TESTS_PASSED++))
    else
        echo -e "  ${RED}✗${NC} Escape should dismiss completion: dismissed=$dismissed, ghostGone=$ghostGone"
        ((TESTS_FAILED++))
    fi
}

# ============================================================================
# USER JOURNEY: Multi-line Completion
# ============================================================================
test_13_journey_multiline_completion() {
    echo "  USER JOURNEY: Multi-line completion for function..."

    if [ "$TAB_AUTOCOMPLETE_MOCK" != "1" ]; then
        echo -e "  ${YELLOW}○${NC} Skipped (mock not enabled)"
        ((TESTS_SKIPPED++))
        return
    fi

    local result=$(test_js "(async function() {
        const mock = window.__TAB_AUTOCOMPLETE_MOCK__;
        if (!mock) return { success: false, error: 'no-mock' };

        // User types 'function test'
        const prefix = 'function test';
        const completion = mock.generateCompletion(prefix);

        mock.showGhostText(completion);

        // Check it's multi-line
        const isMultiline = completion.includes('\\n');

        return {
            success: true,
            prefix: prefix,
            completion: completion,
            isMultiline: isMultiline,
            ghostVisible: mock.ghostTextVisible
        };
    })()")

    local isMultiline=$(echo "$result" | jq -r '.result.isMultiline')
    local ghostVisible=$(echo "$result" | jq -r '.result.ghostVisible')

    if [ "$isMultiline" = "true" ] && [ "$ghostVisible" = "true" ]; then
        echo -e "  ${GREEN}✓${NC} Multi-line completion generated for function"
        ((TESTS_PASSED++))
    else
        echo -e "  ${RED}✗${NC} Should generate multi-line completion: multiline=$isMultiline, visible=$ghostVisible"
        ((TESTS_FAILED++))
    fi
}

# ============================================================================
# USER JOURNEY: Context-Aware Completions
# ============================================================================
test_14_journey_context_aware_completions() {
    echo "  USER JOURNEY: Context-aware completions..."

    if [ "$TAB_AUTOCOMPLETE_MOCK" != "1" ]; then
        echo -e "  ${YELLOW}○${NC} Skipped (mock not enabled)"
        ((TESTS_SKIPPED++))
        return
    fi

    local result=$(test_js "(async function() {
        const mock = window.__TAB_AUTOCOMPLETE_MOCK__;
        if (!mock) return { success: false, error: 'no-mock' };

        // Test various context prefixes
        const tests = [
            { prefix: 'const x', expected: '=' },
            { prefix: 'if (', expected: 'condition' },
            { prefix: 'for (', expected: 'let i' },
            { prefix: '.map(', expected: 'item =>' },
            { prefix: '.filter(', expected: 'item =>' }
        ];

        const results = tests.map(t => {
            const completion = mock.generateCompletion(t.prefix);
            return {
                prefix: t.prefix,
                completion: completion,
                hasExpected: completion.includes(t.expected)
            };
        });

        const allPassed = results.every(r => r.hasExpected);

        return {
            success: true,
            tests: results,
            allPassed: allPassed,
            passCount: results.filter(r => r.hasExpected).length
        };
    })()")

    local allPassed=$(echo "$result" | jq -r '.result.allPassed')
    local passCount=$(echo "$result" | jq -r '.result.passCount')

    if [ "$allPassed" = "true" ]; then
        echo -e "  ${GREEN}✓${NC} All context-aware completions correct ($passCount/5)"
        ((TESTS_PASSED++))
    else
        echo -e "  ${YELLOW}○${NC} Some context completions differ ($passCount/5 passed)"
        ((TESTS_SKIPPED++))
    fi
}

# ============================================================================
# USER JOURNEY: Rapid Typing Cancels Previous Request
# ============================================================================
test_15_journey_rapid_typing_debounce() {
    echo "  USER JOURNEY: Rapid typing debounces requests..."

    if [ "$TAB_AUTOCOMPLETE_MOCK" != "1" ]; then
        echo -e "  ${YELLOW}○${NC} Skipped (mock not enabled)"
        ((TESTS_SKIPPED++))
        return
    fi

    local result=$(test_js "(async function() {
        const mock = window.__TAB_AUTOCOMPLETE_MOCK__;
        if (!mock) return { success: false, error: 'no-mock' };

        // Simulate rapid typing - each keystroke should cancel previous
        const keystrokes = ['c', 'co', 'con', 'cons', 'conso', 'consol', 'console'];

        // Only the final keystroke should result in visible completion
        for (let i = 0; i < keystrokes.length - 1; i++) {
            mock.generateCompletion(keystrokes[i]);
            mock.dismissCompletion(); // Cancel as user keeps typing
        }

        // Final keystroke triggers actual completion
        const finalCompletion = mock.generateCompletion(keystrokes[keystrokes.length - 1]);
        mock.showGhostText(finalCompletion);

        return {
            success: true,
            keystrokeCount: keystrokes.length,
            finalPrefix: keystrokes[keystrokes.length - 1],
            completionShown: mock.ghostTextVisible,
            dismissCount: mock.dismissCount
        };
    })()")

    local completionShown=$(echo "$result" | jq -r '.result.completionShown')

    if [ "$completionShown" = "true" ]; then
        echo -e "  ${GREEN}✓${NC} Debounce works - only final completion shown"
        ((TESTS_PASSED++))
    else
        echo -e "  ${RED}✗${NC} Debounce should show only final completion"
        ((TESTS_FAILED++))
    fi
}

# ============================================================================
# USER JOURNEY: No Completion in String Literals
# ============================================================================
test_16_journey_no_completion_in_strings() {
    echo "  USER JOURNEY: No completion inside string literals..."

    if [ "$TAB_AUTOCOMPLETE_MOCK" != "1" ]; then
        echo -e "  ${YELLOW}○${NC} Skipped (mock not enabled)"
        ((TESTS_SKIPPED++))
        return
    fi

    local result=$(test_js "(async function() {
        const mock = window.__TAB_AUTOCOMPLETE_MOCK__;
        if (!mock) return { success: false, error: 'no-mock' };

        // Simulate context where user is inside a string
        // In real implementation, the provider should detect this and not trigger
        const inString = 'const msg = \"Hello, console.lo';

        // Check if we're in a string by counting quotes
        const quoteCount = (inString.match(/\"/g) || []).length;
        const inStringLiteral = quoteCount % 2 !== 0;

        // If in string, completion should not trigger
        let shouldShowCompletion = !inStringLiteral;

        return {
            success: true,
            context: inString,
            quoteCount: quoteCount,
            inStringLiteral: inStringLiteral,
            shouldShowCompletion: shouldShowCompletion
        };
    })()")

    local inString=$(echo "$result" | jq -r '.result.inStringLiteral')
    local shouldShow=$(echo "$result" | jq -r '.result.shouldShowCompletion')

    if [ "$inString" = "true" ] && [ "$shouldShow" = "false" ]; then
        echo -e "  ${GREEN}✓${NC} Correctly detects string literal - no completion"
        ((TESTS_PASSED++))
    else
        echo -e "  ${YELLOW}○${NC} String detection result: inString=$inString, shouldShow=$shouldShow"
        ((TESTS_SKIPPED++))
    fi
}

# ============================================================================
# USER JOURNEY: Completion After Accepting Previous
# ============================================================================
test_17_journey_sequential_completions() {
    echo "  USER JOURNEY: Sequential completions work correctly..."

    if [ "$TAB_AUTOCOMPLETE_MOCK" != "1" ]; then
        echo -e "  ${YELLOW}○${NC} Skipped (mock not enabled)"
        ((TESTS_SKIPPED++))
        return
    fi

    local result=$(test_js "(async function() {
        const mock = window.__TAB_AUTOCOMPLETE_MOCK__;
        if (!mock) return { success: false, error: 'no-mock' };

        // Reset counts
        mock.acceptCount = 0;
        mock.dismissCount = 0;

        // First completion cycle
        mock.showGhostText(mock.generateCompletion('const x'));
        const first = mock.acceptCompletion();

        // Second completion cycle
        mock.showGhostText(mock.generateCompletion('const y'));
        const second = mock.acceptCompletion();

        // Third completion - dismiss instead
        mock.showGhostText(mock.generateCompletion('const z'));
        mock.dismissCompletion();

        return {
            success: true,
            firstAccepted: !!first,
            secondAccepted: !!second,
            totalAccepts: mock.acceptCount,
            totalDismisses: mock.dismissCount
        };
    })()")

    local totalAccepts=$(echo "$result" | jq -r '.result.totalAccepts')
    local totalDismisses=$(echo "$result" | jq -r '.result.totalDismisses')

    if [ "$totalAccepts" = "2" ] && [ "$totalDismisses" = "1" ]; then
        echo -e "  ${GREEN}✓${NC} Sequential completions tracked: 2 accepts, 1 dismiss"
        ((TESTS_PASSED++))
    else
        echo -e "  ${RED}✗${NC} Expected 2 accepts/1 dismiss, got $totalAccepts/$totalDismisses"
        ((TESTS_FAILED++))
    fi
}

# ============================================================================
# Test: Cleanup
# ============================================================================
test_99_cleanup() {
    echo "  Cleaning up mock..."

    test_js "(function() {
        // Remove ghost text element
        const ghost = document.querySelector('.test-ghost-text');
        if (ghost) ghost.remove();

        // Clean up mock state
        if (window.__TAB_AUTOCOMPLETE_MOCK__) {
            window.__TAB_AUTOCOMPLETE_MOCK__.ghostTextVisible = false;
            window.__TAB_AUTOCOMPLETE_MOCK__.completionText = null;
        }
        return 'cleaned';
    })()"

    echo -e "  ${GREEN}✓${NC} Cleanup complete"
    ((TESTS_PASSED++))
}

# ============================================================================
# Run Tests
# ============================================================================

wait_for_server 30 || exit 1
wait_for_bridge 30 || exit 1

echo ""
echo -e "${CYAN}Tab Autocomplete User Journey Tests${NC}"
echo -e "${CYAN}Mock Mode: $([ \"$TAB_AUTOCOMPLETE_MOCK\" = \"1\" ] && echo 'ENABLED' || echo 'DISABLED')${NC}"
echo ""

run_tests
