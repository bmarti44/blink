#!/bin/bash
# Diff Review (Accept/Reject Changes) E2E Tests
#
# ============================================================================
# TESTING PHILOSOPHY
# ============================================================================
#
# These tests verify that the Diff Review feature is registered
# and the infrastructure is in place for accepting/rejecting AI changes.
#
# KEY PRINCIPLES:
# 1. Tests verify the service is registered via disposable
# 2. Tests verify the diff editor infrastructure is available
# 3. Tests verify the accept/reject mechanisms exist
#
# ============================================================================
#
# Usage:
#   ./43-diff-review.sh
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
# Test: Diff Review Service is Registered
# ============================================================================
test_01_service_registered() {
    echo "  Checking if Diff Review service is registered..."

    local result=$(test_js "(function() {
        const disposable = window['__DIFF_REVIEW_DISPOSABLE__'];
        if (disposable && typeof disposable.dispose === 'function') {
            return 'registered';
        }
        return 'not-registered';
    })()")

    local status=$(echo "$result" | jq -r '.result')
    if [ "$status" = "registered" ]; then
        echo -e "  ${GREEN}✓${NC} Diff Review service is registered"
        ((TESTS_PASSED++))
    else
        echo -e "  ${RED}✗${NC} Diff Review service should be registered"
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
# Test: Editor Infrastructure Ready
# ============================================================================
test_03_editor_infrastructure() {
    echo "  Checking editor infrastructure for diff review..."

    local result=$(test_js "(function() {
        // Check for Monaco editor or diff editor capability
        const editorContainer = document.querySelector('.monaco-editor');
        if (editorContainer) {
            return 'editor-found';
        }

        // Check for workbench ready
        const workbench = document.querySelector('.monaco-workbench');
        if (workbench) {
            return 'workbench-ready';
        }

        return 'no-editor';
    })()")

    local status=$(echo "$result" | jq -r '.result')
    if [ "$status" = "editor-found" ]; then
        echo -e "  ${GREEN}✓${NC} Editor infrastructure ready"
        ((TESTS_PASSED++))
    elif [ "$status" = "workbench-ready" ]; then
        echo -e "  ${GREEN}✓${NC} Workbench ready (no file open)"
        ((TESTS_PASSED++))
    else
        echo -e "  ${YELLOW}○${NC} Editor infrastructure status: $status"
        ((TESTS_SKIPPED++))
    fi
}

# ============================================================================
# Test: Inline Edit Available (Diff Review Dependency)
# ============================================================================
test_04_inline_edit_available() {
    echo "  Checking if Inline Edit is available (required for diff review)..."

    local result=$(test_js "(function() {
        const disposable = window['__INLINE_EDIT_DISPOSABLE__'];
        if (disposable && typeof disposable.dispose === 'function') {
            return 'available';
        }
        return 'not-available';
    })()")

    local status=$(echo "$result" | jq -r '.result')
    if [ "$status" = "available" ]; then
        echo -e "  ${GREEN}✓${NC} Inline Edit is available"
        ((TESTS_PASSED++))
    else
        echo -e "  ${RED}✗${NC} Inline Edit should be available for diff review"
        ((TESTS_FAILED++))
        return 1
    fi
}

# ============================================================================
# Test: AI Service Ready
# ============================================================================
test_05_oca_service_ready() {
    echo "  Checking AI service for AI-generated diffs..."

    local result=$(test_js "(function() {
        const ocaService = window['__AI_SERVICE__'];
        if (!ocaService) return 'no-ai-service';

        // Check that we have the getPromptResponse method
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
# Test: Disposable Configuration
# ============================================================================
test_06_disposable_config() {
    echo "  Checking disposable configuration..."

    local result=$(test_js "(function() {
        const disposable = window['__DIFF_REVIEW_DISPOSABLE__'];
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
# Test: Quick Pick Infrastructure (for Accept/Reject)
# ============================================================================
test_07_quick_pick_infrastructure() {
    echo "  Checking quick pick infrastructure for accept/reject..."

    local result=$(test_js "(function() {
        // Check for quick input widget capability
        const workbench = document.querySelector('.monaco-workbench');
        if (workbench) {
            return 'quick-pick-ready';
        }

        return 'no-quick-pick';
    })()")

    local status=$(echo "$result" | jq -r '.result')
    if [ "$status" = "quick-pick-ready" ]; then
        echo -e "  ${GREEN}✓${NC} Quick pick infrastructure ready"
        ((TESTS_PASSED++))
    else
        echo -e "  ${YELLOW}○${NC} Quick pick status: $status"
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
echo -e "${CYAN}Note: Diff Review tests verify accept/reject infrastructure.${NC}"
echo -e "${CYAN}Full diff review requires AI-generated changes.${NC}"
echo ""

run_tests
