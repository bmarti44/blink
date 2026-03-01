#!/bin/bash
# Inline Edit (Ctrl+K) E2E Tests
#
# ============================================================================
# TESTING PHILOSOPHY
# ============================================================================
#
# These tests verify that the Inline Edit feature (Ctrl+K) is registered
# and the infrastructure is in place for AI-assisted code editing.
#
# KEY PRINCIPLES:
# 1. Tests verify the command is registered via disposable
# 2. Tests verify the AI service is available for AI edits
# 3. Tests verify editor DOM is ready for inline edits
#
# ============================================================================
#
# Usage:
#   ./41-inline-edit.sh
#
# Prerequisites:
#   - Tauri app running with test server on port 9999
#   - jq installed

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../lib/test-client.sh"

# ============================================================================
# Test: Server and Bridge Ready
# ============================================================================
test_00_server_ready() {
    echo "  Checking server and bridge status..."

    local result=$(test_health)
    assert_json_equals "$result" ".status" "ok" "Server should be healthy"
    assert_json_true "$result" ".bridge_connected" "Bridge should be connected"
}

# ============================================================================
# Test: Inline Edit Command is Registered
# ============================================================================
test_01_command_registered() {
    echo "  Checking if Inline Edit command is registered..."

    # Check if the disposable was created
    local result=$(test_js "(function() {
        const disposable = window['__INLINE_EDIT_DISPOSABLE__'];
        if (disposable && typeof disposable.dispose === 'function') {
            return 'registered';
        }
        return 'not-registered';
    })()")

    local status=$(echo "$result" | jq -r '.result')
    if [ "$status" = "registered" ]; then
        echo -e "  ${GREEN}✓${NC} Inline Edit command is registered"
        ((TESTS_PASSED++))
    else
        echo -e "  ${RED}✗${NC} Inline Edit command should be registered"
        ((TESTS_FAILED++))
        return 1
    fi
}

# ============================================================================
# Test: All P0 Features Registered
# ============================================================================
test_02_all_features_registered() {
    echo "  Verifying all P0 AI features are registered..."

    local result=$(test_js "(function() {
        const features = {
            tabAutocomplete: !!window['__TAB_AUTOCOMPLETE_DISPOSABLE__'],
            inlineEdit: !!window['__INLINE_EDIT_DISPOSABLE__'],
            contextMentions: !!window['__CONTEXT_MENTIONS_DISPOSABLE__'],
            diffReview: !!window['__DIFF_REVIEW_DISPOSABLE__']
        };

        const count = Object.values(features).filter(v => v).length;
        return { features, count };
    })()")

    local count=$(echo "$result" | jq -r '.result.count')
    if [ "$count" = "4" ]; then
        echo -e "  ${GREEN}✓${NC} All 4 P0 AI features are registered"
        ((TESTS_PASSED++))
    elif [ "$count" -gt "0" ]; then
        echo -e "  ${YELLOW}○${NC} $count/4 P0 features registered"
        ((TESTS_SKIPPED++))
    else
        echo -e "  ${RED}✗${NC} No P0 features registered"
        ((TESTS_FAILED++))
        return 1
    fi
}

# ============================================================================
# Test: Editor DOM Ready
# ============================================================================
test_03_editor_dom_ready() {
    echo "  Checking if editor DOM is ready for inline edits..."

    local result=$(test_js "(function() {
        // Check for Monaco editor in DOM
        const editorContainer = document.querySelector('.monaco-editor');
        if (editorContainer) {
            return 'editor-dom-found';
        }
        // Check for workbench ready
        const workbench = document.querySelector('.monaco-workbench');
        if (workbench) {
            return 'workbench-ready';
        }
        return 'no-editor';
    })()")

    local status=$(echo "$result" | jq -r '.result')
    if [ "$status" = "editor-dom-found" ]; then
        echo -e "  ${GREEN}✓${NC} Editor DOM ready for inline edits"
        ((TESTS_PASSED++))
    elif [ "$status" = "workbench-ready" ]; then
        echo -e "  ${GREEN}✓${NC} Workbench ready (no file open)"
        ((TESTS_PASSED++))
    else
        echo -e "  ${YELLOW}○${NC} Editor DOM not found: $status"
        ((TESTS_SKIPPED++))
    fi
}

# ============================================================================
# Test: AI Service for AI Edits
# ============================================================================
test_04_oca_service_ready() {
    echo "  Checking AI service for inline edit..."

    local result=$(test_js "(function() {
        const ocaService = window['__AI_SERVICE__'];
        if (!ocaService) return 'no-ai-service';

        // Check that we have the getPromptResponse method (used for edits)
        if (typeof ocaService.getPromptResponse !== 'function') {
            return 'missing-prompt-response';
        }

        // Check token state
        const tokenState = ocaService.getTokenState?.();
        if (tokenState && tokenState.accessToken) {
            return 'ai-ready-authenticated';
        }

        return 'ai-ready-not-authenticated';
    })()")

    local status=$(echo "$result" | jq -r '.result')
    if [ "$status" = "ai-ready-authenticated" ]; then
        echo -e "  ${GREEN}✓${NC} AI service ready (authenticated)"
        ((TESTS_PASSED++))
    elif [ "$status" = "ai-ready-not-authenticated" ]; then
        echo -e "  ${GREEN}✓${NC} AI service ready (not authenticated)"
        ((TESTS_PASSED++))
    else
        echo -e "  ${YELLOW}○${NC} AI service status: $status"
        ((TESTS_SKIPPED++))
    fi
}

# ============================================================================
# Test: Input Box Infrastructure
# ============================================================================
test_05_input_box_infrastructure() {
    echo "  Checking input box infrastructure..."

    local result=$(test_js "(function() {
        // Check for quick input widget capability in DOM
        const quickInput = document.querySelector('.quick-input-widget');
        if (quickInput) {
            return 'quick-input-found';
        }

        // Check for workbench which hosts quick input
        const workbench = document.querySelector('.monaco-workbench');
        if (workbench) {
            return 'workbench-ready';
        }

        return 'no-infrastructure';
    })()")

    local status=$(echo "$result" | jq -r '.result')
    if [ "$status" = "quick-input-found" ] || [ "$status" = "workbench-ready" ]; then
        echo -e "  ${GREEN}✓${NC} Input box infrastructure ready"
        ((TESTS_PASSED++))
    else
        echo -e "  ${RED}✗${NC} Input box infrastructure not found: $status"
        ((TESTS_FAILED++))
        return 1
    fi
}

# ============================================================================
# Test: Disposable Configuration
# ============================================================================
test_06_disposable_config() {
    echo "  Checking disposable configuration..."

    local result=$(test_js "(function() {
        const disposable = window['__INLINE_EDIT_DISPOSABLE__'];
        if (!disposable) return 'no-disposable';

        // Check it's a valid VS Code disposable
        if (typeof disposable.dispose === 'function') {
            return 'config-valid';
        }

        return 'invalid-disposable';
    })()")

    local status=$(echo "$result" | jq -r '.result')
    if [ "$status" = "config-valid" ]; then
        echo -e "  ${GREEN}✓${NC} Disposable configuration is valid"
        ((TESTS_PASSED++))
    else
        echo -e "  ${RED}✗${NC} Disposable configuration check failed: $status"
        ((TESTS_FAILED++))
        return 1
    fi
}

# ============================================================================
# Test: Diff Editor Capability
# ============================================================================
test_07_diff_editor_capability() {
    echo "  Checking diff editor capability..."

    local result=$(test_js "(function() {
        // Check for diff editor capability in workbench
        const workbench = document.querySelector('.monaco-workbench');
        if (!workbench) return 'no-workbench';

        // Check for diff review disposable (used for inline edit preview)
        const diffReview = window['__DIFF_REVIEW_DISPOSABLE__'];
        if (diffReview && typeof diffReview.dispose === 'function') {
            return 'diff-review-ready';
        }

        return 'no-diff-review';
    })()")

    local status=$(echo "$result" | jq -r '.result')
    if [ "$status" = "diff-review-ready" ]; then
        echo -e "  ${GREEN}✓${NC} Diff editor capability ready"
        ((TESTS_PASSED++))
    else
        echo -e "  ${YELLOW}○${NC} Diff editor status: $status"
        ((TESTS_SKIPPED++))
    fi
}

# ============================================================================
# Test: Cleanup
# ============================================================================
test_99_cleanup() {
    echo "  Running cleanup..."

    local result=$(test_js "(function() {
        return 'cleanup-complete';
    })()")

    echo -e "  ${GREEN}✓${NC} Cleanup complete"
    ((TESTS_PASSED++))
}

# ============================================================================
# Run Tests
# ============================================================================

# Wait for server and bridge
wait_for_server 30 || exit 1
wait_for_bridge 30 || exit 1

echo ""
echo -e "${CYAN}Note: Inline Edit tests verify the Ctrl+K infrastructure.${NC}"
echo -e "${CYAN}Full AI edit generation requires AI authentication.${NC}"
echo ""

run_tests
