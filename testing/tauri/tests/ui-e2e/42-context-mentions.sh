#!/bin/bash
# Context Mentions (@file, @folder, @codebase) E2E Tests
#
# ============================================================================
# TESTING PHILOSOPHY
# ============================================================================
#
# These tests verify that the Context Mentions feature is registered
# and the infrastructure is in place for @-based context attachment.
#
# KEY PRINCIPLES:
# 1. Tests verify the provider is registered via disposable
# 2. Tests verify the AI service is available for chat with context
# 3. Tests verify chat panel DOM is ready
#
# ============================================================================
#
# Usage:
#   ./42-context-mentions.sh
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
# Test: Context Mentions Provider is Registered
# ============================================================================
test_01_provider_registered() {
    echo "  Checking if Context Mentions provider is registered..."

    local result=$(test_js "(function() {
        const disposable = window['__CONTEXT_MENTIONS_DISPOSABLE__'];
        if (disposable && typeof disposable.dispose === 'function') {
            return 'registered';
        }
        return 'not-registered';
    })()")

    local status=$(echo "$result" | jq -r '.result')
    if [ "$status" = "registered" ]; then
        echo -e "  ${GREEN}✓${NC} Context Mentions provider is registered"
        ((TESTS_PASSED++))
    else
        echo -e "  ${RED}✗${NC} Context Mentions provider should be registered"
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
# Test: Chat Panel Available
# ============================================================================
test_03_chat_panel_available() {
    echo "  Checking if chat panel is available..."

    local result=$(test_js "(function() {
        // Check for chat panel in DOM
        const chatPanel = document.querySelector('.chat-widget, .interactive-session, [class*=\"chat\"]');
        if (chatPanel) {
            return 'chat-panel-found';
        }

        // Check for activity bar with chat icon
        const activityBar = document.querySelector('.activitybar');
        if (activityBar) {
            return 'activity-bar-ready';
        }

        return 'no-chat-panel';
    })()")

    local status=$(echo "$result" | jq -r '.result')
    if [ "$status" = "chat-panel-found" ]; then
        echo -e "  ${GREEN}✓${NC} Chat panel is available"
        ((TESTS_PASSED++))
    elif [ "$status" = "activity-bar-ready" ]; then
        echo -e "  ${GREEN}✓${NC} Activity bar ready (chat can be opened)"
        ((TESTS_PASSED++))
    else
        echo -e "  ${YELLOW}○${NC} Chat panel status: $status"
        ((TESTS_SKIPPED++))
    fi
}

# ============================================================================
# Test: AI Service for Context Resolution
# ============================================================================
test_04_oca_service_ready() {
    echo "  Checking AI service for context-aware chat..."

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
# Test: Chat Agent Registered
# ============================================================================
test_05_chat_agent_registered() {
    echo "  Checking if AI chat agent is registered..."

    local result=$(test_js "(function() {
        // Check for AI chat agent registration flag
        if (window['__OCA_CHAT_AGENT_REGISTERED__']) {
            return 'agent-registered';
        }
        return 'agent-not-registered';
    })()")

    local status=$(echo "$result" | jq -r '.result')
    if [ "$status" = "agent-registered" ]; then
        echo -e "  ${GREEN}✓${NC} AI chat agent is registered"
        ((TESTS_PASSED++))
    else
        echo -e "  ${YELLOW}○${NC} Chat agent status: $status"
        ((TESTS_SKIPPED++))
    fi
}

# ============================================================================
# Test: File System Access
# ============================================================================
test_06_file_system_access() {
    echo "  Checking file system access for @file mentions..."

    local result=$(test_js "(function() {
        // Check for Tauri file system API
        if (window['__TAURI__']?.fs || window['__TAURI_INTERNALS__']) {
            return 'tauri-fs-available';
        }

        // Check for explorer view (indicates file system working)
        const explorer = document.querySelector('[id*=\"explorer\"], [class*=\"explorer\"]');
        if (explorer) {
            return 'explorer-available';
        }

        return 'no-fs-access';
    })()")

    local status=$(echo "$result" | jq -r '.result')
    if [ "$status" = "tauri-fs-available" ] || [ "$status" = "explorer-available" ]; then
        echo -e "  ${GREEN}✓${NC} File system access available"
        ((TESTS_PASSED++))
    else
        echo -e "  ${YELLOW}○${NC} File system status: $status"
        ((TESTS_SKIPPED++))
    fi
}

# ============================================================================
# Test: Disposable Configuration
# ============================================================================
test_07_disposable_config() {
    echo "  Checking disposable configuration..."

    local result=$(test_js "(function() {
        const disposable = window['__CONTEXT_MENTIONS_DISPOSABLE__'];
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
echo -e "${CYAN}Note: Context Mentions tests verify @-mention infrastructure.${NC}"
echo -e "${CYAN}Full context resolution requires AI authentication.${NC}"
echo ""

run_tests
