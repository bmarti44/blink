#!/bin/bash
# Run all Blink Tauri E2E tests
# Usage: ./testing/tauri/run-tests.sh [options]
#
# Options:
#   --quick     Run only health checks
#   --verbose   Show detailed output
#   --help      Show this help

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/test-client.sh"
source "$SCRIPT_DIR/utils.sh"

# Parse arguments
QUICK_MODE=false
VERBOSE=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --quick)
            QUICK_MODE=true
            shift
            ;;
        --verbose)
            VERBOSE=true
            shift
            ;;
        --help)
            echo "Usage: $0 [options]"
            echo ""
            echo "Options:"
            echo "  --quick     Run only health checks"
            echo "  --verbose   Show detailed output"
            echo "  --help      Show this help"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

# Track overall results
TOTAL_PASSED=0
TOTAL_FAILED=0
TOTAL_SKIPPED=0
SUITE_FAILED=0

echo ""
echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║           Blink Tauri E2E Test Suite                   ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""

# Check if test server is running
echo "Checking test server..."
if ! wait_for_server 5; then
    echo ""
    echo -e "${RED}Error: Test server is not running${NC}"
    echo "Start the application first with: ./scripts/dev.sh"
    exit 1
fi

# Wait for bridge connection
if ! wait_for_bridge 10; then
    echo -e "${YELLOW}Warning: Bridge may not be fully connected${NC}"
fi

echo ""

# Define test suites
if [ "$QUICK_MODE" = true ]; then
    TEST_SUITES=(
        "01-health.sh"
    )
else
    TEST_SUITES=(
        "01-health.sh"
        "02-workbench.sh"
        "03-extensions.sh"
        "04-editor.sh"
        "05-error-check.sh"
        "06-docx-open.sh"
        "07-docx-no-binary-warning.sh"
        "08-docx-intercept.sh"
        "09-docx-backend-render.sh"
        "17-docx-tiptap-flag.sh"
        "18-docx-tiptap-ready.sh"
        "19-docx-tab-rendered.sh"
        "20-docx-webview-content.sh"
        "22-ai-service.sh"
        "23-ai-auth-flow.sh"
        "24-ai-chat-ui.sh"
        "25-ai-streaming.sh"
        "33-extension-install-flow.sh"
        "34-installed-dropdown-verify.sh"
        "35-extension-details-tabs.sh"
        # UI E2E tests (P0/P1 AI features)
        "ui-e2e/40-tab-autocomplete.sh"
        "ui-e2e/41-inline-edit.sh"
        "ui-e2e/42-context-mentions.sh"
        "ui-e2e/43-diff-review.sh"
        "ui-e2e/44-terminal-ai.sh"
        "ui-e2e/45-plan-mode.sh"
        "ui-e2e/46-chat-slash-commands.sh"
    )

fi

# Run each test suite
for suite in "${TEST_SUITES[@]}"; do
    # Handle both functional/ and ui-e2e/ paths
    if [[ "$suite" == ui-e2e/* ]]; then
        suite_path="$SCRIPT_DIR/tests/$suite"
    else
        suite_path="$SCRIPT_DIR/tests/functional/$suite"
    fi

    if [ -f "$suite_path" ]; then
        echo ""
        echo -e "${BLUE}▶ Running: $suite${NC}"
        echo ""

        # Run the suite and capture output
        suite_output=$(bash "$suite_path" 2>&1)
        suite_exit_code=$?

        # Display the output
        echo "$suite_output"

        # Parse the TEST_RESULTS line to get counts
        results_line=$(echo "$suite_output" | grep "^TEST_RESULTS:")
        if [ -n "$results_line" ]; then
            passed=$(echo "$results_line" | sed 's/.*passed=\([0-9]*\).*/\1/')
            failed=$(echo "$results_line" | sed 's/.*failed=\([0-9]*\).*/\1/')
            skipped=$(echo "$results_line" | sed 's/.*skipped=\([0-9]*\).*/\1/')
            TOTAL_PASSED=$((TOTAL_PASSED + passed))
            TOTAL_FAILED=$((TOTAL_FAILED + failed))
            TOTAL_SKIPPED=$((TOTAL_SKIPPED + skipped))
        fi

        if [ $suite_exit_code -ne 0 ]; then
            ((SUITE_FAILED++))
        fi
    else
        echo -e "${YELLOW}Warning: Test suite not found: $suite${NC}"
    fi
done

# Print final summary
echo ""
echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║                      Test Results                              ║"
echo "╠═══════════════════════════════════════════════════════════════╣"
echo -e "║  Passed:            ${GREEN}$TOTAL_PASSED${NC}"
echo -e "║  Failed:            ${RED}$TOTAL_FAILED${NC}"
echo -e "║  Skipped:           ${YELLOW}$TOTAL_SKIPPED${NC}"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""

# Generate report
generate_report "$TOTAL_PASSED" "$TOTAL_FAILED" "$TOTAL_SKIPPED" "/tmp/blink-test-report.json"

# Exit with appropriate code
if [ $TOTAL_FAILED -gt 0 ]; then
    echo -e "${RED}Some tests failed!${NC}"
    exit 1
else
    echo -e "${GREEN}All tests passed!${NC}"
    exit 0
fi
