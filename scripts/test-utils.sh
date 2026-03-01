#!/bin/bash
# Test utilities for Blink debug test server
# Usage: ./scripts/test-utils.sh <command> [args...]

TEST_SERVER="http://localhost:9999"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if test server is running
check_server() {
    if curl -s "$TEST_SERVER/health" | grep -q "ok"; then
        echo -e "${GREEN}✓ Test server is running${NC}"
        return 0
    else
        echo -e "${RED}✗ Test server is not running${NC}"
        echo "Start it with: ./scripts/dev.sh"
        return 1
    fi
}

# Execute JavaScript in the webview
js() {
    local code="$1"
    curl -s -X POST "$TEST_SERVER/js" \
        -H "Content-Type: application/json" \
        -d "{\"code\": $(echo "$code" | jq -Rs .)}" | jq .
}

# Query DOM elements
query() {
    local selector="$1"
    curl -s -X POST "$TEST_SERVER/query" \
        -H "Content-Type: application/json" \
        -d "{\"selector\": \"$selector\"}" | jq .
}

# Get console logs
console() {
    curl -s "$TEST_SERVER/console" | jq '.entries[] | "\(.level): \(.message)"' -r | head -${1:-20}
}

# Get errors
errors() {
    curl -s "$TEST_SERVER/errors" | jq '.entries[] | "[\(.source // "unknown"):\(.lineno // "?")]\n  \(.message)"' -r
}

# Get health status
health() {
    curl -s "$TEST_SERVER/health" | jq .
}

# Clear all logs
clear_logs() {
    curl -s -X DELETE "$TEST_SERVER/console" > /dev/null
    curl -s -X DELETE "$TEST_SERVER/errors" > /dev/null
    curl -s -X DELETE "$TEST_SERVER/network" > /dev/null
    curl -s -X DELETE "$TEST_SERVER/events" > /dev/null
    echo "Logs cleared"
}

# Open a specific VS Code view
open_view() {
    local view="$1"
    case "$view" in
        extensions)
            js 'document.querySelector(".codicon-extensions-view-icon")?.closest(".action-item")?.querySelector(".action-label")?.click(); "opened"'
            ;;
        explorer)
            js 'document.querySelector(".codicon-explorer-view-icon")?.closest(".action-item")?.querySelector(".action-label")?.click(); "opened"'
            ;;
        search)
            js 'document.querySelector(".codicon-search-view-icon")?.closest(".action-item")?.querySelector(".action-label")?.click(); "opened"'
            ;;
        *)
            echo "Unknown view: $view"
            echo "Available: extensions, explorer, search"
            return 1
            ;;
    esac
}

# Search extensions
search_extensions() {
    local query="$1"
    open_view extensions > /dev/null
    sleep 0.5
    js "const ta = document.querySelector('.extensions-viewlet textarea.inputarea'); ta?.focus(); document.execCommand('selectAll'); document.execCommand('insertText', false, '$query'); 'searched'"
}

# Get installed extensions
installed_extensions() {
    search_extensions "@installed"
    sleep 1
    js 'Array.from(document.querySelectorAll(".extension-list-item .name, .extensions-viewlet .extension .name")).map(e => e.innerText).filter(n => n).join("\n")' | jq -r '.result'
}

# Get document title
title() {
    js "document.title" | jq -r '.result'
}

# Check if workbench is loaded
workbench_loaded() {
    local result=$(query ".monaco-workbench" | jq '.found')
    if [ "$result" = "true" ]; then
        echo -e "${GREEN}✓ Monaco workbench is loaded${NC}"
        return 0
    else
        echo -e "${RED}✗ Monaco workbench not found${NC}"
        return 1
    fi
}

# Run a simple test suite
run_tests() {
    echo "=== Blink Test Suite ==="
    echo ""

    echo "1. Checking server..."
    check_server || exit 1
    echo ""

    echo "2. Checking workbench..."
    workbench_loaded
    echo ""

    echo "3. Document title:"
    echo "   $(title)"
    echo ""

    echo "4. Checking activity bar..."
    local activitybar=$(query ".activitybar" | jq '.found')
    if [ "$activitybar" = "true" ]; then
        echo -e "   ${GREEN}✓ Activity bar present${NC}"
    else
        echo -e "   ${RED}✗ Activity bar not found${NC}"
    fi
    echo ""

    echo "5. Error count:"
    local error_count=$(curl -s "$TEST_SERVER/errors" | jq '.total')
    if [ "$error_count" = "0" ]; then
        echo -e "   ${GREEN}✓ No errors${NC}"
    else
        echo -e "   ${YELLOW}⚠ $error_count error(s) captured${NC}"
    fi
    echo ""

    echo "6. Console log count:"
    local log_count=$(curl -s "$TEST_SERVER/console" | jq '.total')
    echo "   $log_count log entries captured"
    echo ""

    echo "=== Tests Complete ==="
}

# Show help
show_help() {
    cat << EOF
Blink Test Utilities

Usage: $0 <command> [args...]

Commands:
  health              Check test server health
  js <code>           Execute JavaScript in webview
  query <selector>    Query DOM elements
  console [n]         Show last n console logs (default: 20)
  errors              Show captured errors
  clear               Clear all captured logs
  title               Get document title
  workbench           Check if workbench is loaded

  open <view>         Open a VS Code view (extensions, explorer, search)
  search <query>      Search extensions marketplace
  installed           List installed extensions

  test                Run full test suite
  help                Show this help

Examples:
  $0 health
  $0 js "document.title"
  $0 query ".monaco-workbench"
  $0 open extensions
  $0 search "python"
  $0 installed
  $0 test
EOF
}

# Main command dispatcher
case "${1:-help}" in
    health)     health ;;
    js)         js "$2" ;;
    query)      query "$2" ;;
    console)    console "$2" ;;
    errors)     errors ;;
    clear)      clear_logs ;;
    title)      title ;;
    workbench)  workbench_loaded ;;
    open)       open_view "$2" ;;
    search)     search_extensions "$2" ;;
    installed)  installed_extensions ;;
    test)       run_tests ;;
    help|--help|-h) show_help ;;
    *)          echo "Unknown command: $1"; show_help; exit 1 ;;
esac
