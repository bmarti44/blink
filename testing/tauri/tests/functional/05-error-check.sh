#!/bin/bash
# Error Check Tests for Blink
#
# STRICT POLICY: These tests FAIL if ANY warning or error appears in OUTPUT.
# Do not hide issues - fix the root cause.
#
# This test must pass with ZERO warnings and ZERO errors.

source "$(dirname "$0")/../lib/test-client.sh"

# ============================================================================
# Test Functions
# ============================================================================

test_01_zero_errors_in_output() {
    echo "Checking for ZERO [error] entries in OUTPUT..."

    wait_for_workbench 60
    sleep 5  # Wait for async operations to complete

    local console=$(test_console 500)

    # Find ALL error entries - match [error] prefix or error level
    local all_errors=$(echo "$console" | jq '[.[] | select(
        .level == "error" or
        (.message != null and (.message | test("^\\[error\\]"; "i")))
    )]')
    local error_count=$(echo "$all_errors" | jq 'length')

    if [ "$error_count" -gt 0 ]; then
        echo -e "  ${RED}✗${NC} FAILED: Found $error_count errors in OUTPUT"
        echo ""
        echo "  Errors found:"
        echo "$all_errors" | jq -r '.[] | "    [" + (.level // "error") + "] " + ((.message // .args[0] // "unknown") | split("\n")[0])' 2>/dev/null | head -20
        echo ""
        echo "  FIX THE ROOT CAUSE. Do not hide these errors."
        ((TESTS_FAILED++))
        return 1
    else
        echo -e "  ${GREEN}✓${NC} PASSED: Zero errors in OUTPUT"
        ((TESTS_PASSED++))
        return 0
    fi
}

test_02_zero_warnings_in_output() {
    echo "Checking for ZERO [warning] entries in OUTPUT..."

    local console=$(test_console 500)

    # Find ALL warning entries - match [warning] prefix or warn level
    local all_warnings=$(echo "$console" | jq '[.[] | select(
        .level == "warn" or
        .level == "warning" or
        (.message != null and (.message | test("^\\[warning\\]"; "i")))
    )]')
    local warning_count=$(echo "$all_warnings" | jq 'length')

    if [ "$warning_count" -gt 0 ]; then
        echo -e "  ${RED}✗${NC} FAILED: Found $warning_count warnings in OUTPUT"
        echo ""
        echo "  Warnings found:"
        echo "$all_warnings" | jq -r '.[] | "    [" + (.level // "warning") + "] " + ((.message // .args[0] // "unknown") | split("\n")[0])' 2>/dev/null | head -20
        echo ""
        echo "  FIX THE ROOT CAUSE. Do not hide these warnings."
        ((TESTS_FAILED++))
        return 1
    else
        echo -e "  ${GREEN}✓${NC} PASSED: Zero warnings in OUTPUT"
        ((TESTS_PASSED++))
        return 0
    fi
}

test_03_zero_uncaught_exceptions() {
    echo "Checking for ZERO uncaught exceptions..."

    local errors=$(test_errors)

    # Count uncaught exceptions captured by error handler
    local exception_count=$(echo "$errors" | jq '.total // 0')

    if [ "$exception_count" -gt 0 ]; then
        echo -e "  ${RED}✗${NC} FAILED: Found $exception_count uncaught exceptions"
        echo ""
        echo "  Exceptions:"
        echo "$errors" | jq -r '.entries[0:10] | .[] | "    " + (.message // "unknown")' 2>/dev/null
        echo ""
        echo "  FIX THE ROOT CAUSE. Do not hide these exceptions."
        ((TESTS_FAILED++))
        return 1
    else
        echo -e "  ${GREEN}✓${NC} PASSED: Zero uncaught exceptions"
        ((TESTS_PASSED++))
        return 0
    fi
}

test_04_no_file_not_found_errors() {
    echo "Checking for ZERO 'file not found' errors..."

    local console=$(test_console 500)

    # Any "file not found" or "Unable to read/write file" is a failure
    local file_errors=$(echo "$console" | jq '[.[] | select(
        .message != null and (
            (.message | test("[Ff]ile not found"; "")) or
            (.message | test("[Uu]nable to read file"; "")) or
            (.message | test("[Uu]nable to write file"; "")) or
            (.message | test("FileOperationError"; ""))
        )
    )]')
    local error_count=$(echo "$file_errors" | jq 'length')

    if [ "$error_count" -gt 0 ]; then
        echo -e "  ${RED}✗${NC} FAILED: Found $error_count file operation errors"
        echo ""
        echo "  File errors:"
        echo "$file_errors" | jq -r '.[] | "    " + ((.message // "unknown") | split("\n")[0])' 2>/dev/null | head -10
        echo ""
        echo "  ROOT CAUSE: File system provider not working correctly."
        ((TESTS_FAILED++))
        return 1
    else
        echo -e "  ${GREEN}✓${NC} PASSED: Zero file operation errors"
        ((TESTS_PASSED++))
        return 0
    fi
}

test_05_no_vscode_userdata_errors() {
    echo "Checking for ZERO vscode-userdata: scheme errors..."

    local console=$(test_console 500)

    # Any vscode-userdata error is a failure
    local userdata_errors=$(echo "$console" | jq '[.[] | select(
        .message != null and (.message | test("vscode-userdata"; ""))
    )]')
    local error_count=$(echo "$userdata_errors" | jq 'length')

    if [ "$error_count" -gt 0 ]; then
        echo -e "  ${RED}✗${NC} FAILED: Found $error_count vscode-userdata errors"
        echo ""
        echo "  Errors:"
        echo "$userdata_errors" | jq -r '.[] | "    " + ((.message // "unknown") | split("\n")[0])' 2>/dev/null | head -10
        echo ""
        echo "  ROOT CAUSE: VSCodeUserDataProvider not properly registered or failing."
        ((TESTS_FAILED++))
        return 1
    else
        echo -e "  ${GREEN}✓${NC} PASSED: Zero vscode-userdata errors"
        ((TESTS_PASSED++))
        return 0
    fi
}

test_06_no_url_encoding_in_paths() {
    echo "Checking for ZERO URL-encoded path errors..."

    local console=$(test_console 500)

    # Any path with %20, %28, %29 in error context is wrong
    local encoding_errors=$(echo "$console" | jq '[.[] | select(
        .message != null and (
            (.message | test("%20"; "")) or
            (.message | test("%28"; "")) or
            (.message | test("%29"; "")) or
            (.message | test("%2F"; ""))
        )
    )]')
    local error_count=$(echo "$encoding_errors" | jq 'length')

    if [ "$error_count" -gt 0 ]; then
        echo -e "  ${RED}✗${NC} FAILED: Found $error_count URL-encoded path issues"
        echo ""
        echo "  Issues:"
        echo "$encoding_errors" | jq -r '.[] | "    " + ((.message // "unknown") | split("\n")[0])' 2>/dev/null | head -10
        echo ""
        echo "  ROOT CAUSE: Paths not being decoded before use."
        ((TESTS_FAILED++))
        return 1
    else
        echo -e "  ${GREEN}✓${NC} PASSED: Zero URL-encoded path issues"
        ((TESTS_PASSED++))
        return 0
    fi
}

test_07_final_summary() {
    echo ""
    echo "========================================"
    echo "  OUTPUT PANEL HEALTH CHECK SUMMARY"
    echo "========================================"

    local console=$(test_console 500)
    local errors=$(test_errors)

    local error_count=$(echo "$console" | jq '[.[] | select(.level == "error" or (.message != null and (.message | test("^\\[error\\]"; "i"))))] | length')
    local warning_count=$(echo "$console" | jq '[.[] | select(.level == "warn" or .level == "warning" or (.message != null and (.message | test("^\\[warning\\]"; "i"))))] | length')
    local exception_count=$(echo "$errors" | jq '.total // 0')

    echo ""
    echo "  Errors:     $error_count"
    echo "  Warnings:   $warning_count"
    echo "  Exceptions: $exception_count"
    echo ""

    local total=$((error_count + warning_count + exception_count))
    if [ "$total" -gt 0 ]; then
        echo -e "  ${RED}STATUS: UNHEALTHY${NC}"
        echo "  $total issue(s) must be fixed."
        echo ""
        echo "  Do NOT hide issues. Fix the ROOT CAUSE."
        ((TESTS_FAILED++))
        return 1
    else
        echo -e "  ${GREEN}STATUS: HEALTHY${NC}"
        echo "  No issues found in OUTPUT panel."
        ((TESTS_PASSED++))
        return 0
    fi
}

# ============================================================================
# Run Tests
# ============================================================================

run_tests
