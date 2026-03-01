#!/bin/bash
# Feature Verification Script
# Usage: ./scripts/verify-feature.sh [feature-name|all]
#
# Examples:
#   ./scripts/verify-feature.sh tab-autocomplete
#   ./scripts/verify-feature.sh inline-edit
#   ./scripts/verify-feature.sh all

set -e

FEATURE="${1:-all}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}=== Feature Verification: $FEATURE ===${NC}"
echo ""

# Track overall status
ERRORS=0

# Step 1: Build
echo -e "${CYAN}Step 1: Building...${NC}"
cd "$PROJECT_ROOT"
if npm run build > /tmp/build-output.txt 2>&1; then
    echo -e "${GREEN}✓ Build passed${NC}"
else
    echo -e "${RED}❌ Build failed${NC}"
    cat /tmp/build-output.txt
    exit 1
fi

# Step 2: Check if app is running, start if needed
echo -e "${CYAN}Step 2: Checking app status...${NC}"
if curl -s http://localhost:9999/health > /dev/null 2>&1; then
    echo -e "${GREEN}✓ App is running${NC}"
else
    echo -e "${YELLOW}App not running, starting...${NC}"
    echo "Run 'npm run tauri:dev' in another terminal and wait for it to start"
    echo "Then re-run this script"
    exit 1
fi

# Step 3: Verify health
echo -e "${CYAN}Step 3: Checking health...${NC}"
HEALTH=$(curl -s http://localhost:9999/health)
if echo "$HEALTH" | jq -e '.status == "ok"' > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Health check passed${NC}"
    echo "  Bridge connected: $(echo "$HEALTH" | jq -r '.bridge_connected')"
    echo "  Window count: $(echo "$HEALTH" | jq -r '.window_count')"
else
    echo -e "${RED}❌ Health check failed${NC}"
    echo "$HEALTH" | jq .
    exit 1
fi

# Step 4: Run feature-specific tests
echo -e "${CYAN}Step 4: Running tests...${NC}"

TEST_RESULT=0
if [ "$FEATURE" = "all" ]; then
    "$PROJECT_ROOT/testing/tauri/run-tests.sh" || TEST_RESULT=$?
else
    # Find matching test files
    TEST_FILES=$(find "$PROJECT_ROOT/testing/tauri/tests" -name "*${FEATURE}*.sh" -type f 2>/dev/null)

    if [ -z "$TEST_FILES" ]; then
        echo -e "${YELLOW}⚠️ No test files found matching: $FEATURE${NC}"
        echo "Available tests:"
        ls "$PROJECT_ROOT/testing/tauri/tests/functional/" "$PROJECT_ROOT/testing/tauri/tests/ui-e2e/" 2>/dev/null | grep -E "\.sh$"
    else
        for test_file in $TEST_FILES; do
            echo "Running: $(basename "$test_file")"
            chmod +x "$test_file"
            if "$test_file"; then
                echo -e "${GREEN}✓ $(basename "$test_file") passed${NC}"
            else
                echo -e "${RED}❌ $(basename "$test_file") failed${NC}"
                TEST_RESULT=1
            fi
        done
    fi
fi

if [ $TEST_RESULT -ne 0 ]; then
    echo -e "${RED}❌ Some tests failed${NC}"
    ERRORS=$((ERRORS + 1))
else
    echo -e "${GREEN}✓ All tests passed${NC}"
fi

# Step 5: Check for console errors
echo -e "${CYAN}Step 5: Checking for errors...${NC}"
ERROR_RESPONSE=$(curl -s http://localhost:9999/errors 2>/dev/null || echo '{"errors":[]}')
ERROR_COUNT=$(echo "$ERROR_RESPONSE" | jq '.errors | length' 2>/dev/null || echo "0")

if [ "$ERROR_COUNT" -gt 0 ]; then
    echo -e "${YELLOW}⚠️ $ERROR_COUNT errors found in console:${NC}"
    echo "$ERROR_RESPONSE" | jq '.errors[:5]' 2>/dev/null || echo "$ERROR_RESPONSE"
else
    echo -e "${GREEN}✓ No errors in console${NC}"
fi

# Step 6: Check for warnings in console
echo -e "${CYAN}Step 6: Checking console logs...${NC}"
CONSOLE_RESPONSE=$(curl -s http://localhost:9999/console 2>/dev/null || echo '{"logs":[]}')
WARNING_COUNT=$(echo "$CONSOLE_RESPONSE" | jq '[.logs[] | select(contains("warn") or contains("WARN"))] | length' 2>/dev/null || echo "0")

if [ "$WARNING_COUNT" -gt 0 ]; then
    echo -e "${YELLOW}⚠️ $WARNING_COUNT warnings found${NC}"
else
    echo -e "${GREEN}✓ No warnings${NC}"
fi

# Summary
echo ""
echo -e "${CYAN}=== Verification Summary ===${NC}"
if [ $ERRORS -eq 0 ] && [ $TEST_RESULT -eq 0 ]; then
    echo -e "${GREEN}✓ All checks passed!${NC}"
    echo ""
    echo "Feature '$FEATURE' is ready."
    exit 0
else
    echo -e "${RED}❌ Verification failed${NC}"
    echo ""
    echo "Issues found:"
    [ $TEST_RESULT -ne 0 ] && echo "  - Test failures"
    [ "$ERROR_COUNT" -gt 0 ] && echo "  - Console errors ($ERROR_COUNT)"
    exit 1
fi
