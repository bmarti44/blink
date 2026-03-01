#!/bin/bash
# Utility functions for Blink Tauri testing
# Source this file to use utility functions in test scripts

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# ============================================================================
# Application Control
# ============================================================================

# Start the Tauri application in development mode
# Usage: start_app [log_file]
start_app() {
    local log_file="${1:-/tmp/blink-test.log}"

    echo "Starting Blink application..."

    # Kill any existing instance
    stop_app 2>/dev/null

    # Start the app
    echo "Project root: $PROJECT_ROOT"
    echo "Working dir before start: $(pwd)"
    cd "$PROJECT_ROOT"
    echo "Working dir after cd: $(pwd)"
    TAURI_TEST_PORT=${TAURI_TEST_PORT:-9999} RUST_LOG=${RUST_LOG:-info} ./scripts/dev.sh > "$log_file" 2>&1 &
    local pid=$!

    echo "Started with PID $pid, logging to $log_file"
    echo $pid > /tmp/blink-test.pid

    return 0
}

# Stop the Tauri application
# Usage: stop_app
stop_app() {
    if [ -f /tmp/blink-test.pid ]; then
        local pid=$(cat /tmp/blink-test.pid)
        kill $pid 2>/dev/null
        rm -f /tmp/blink-test.pid
        echo "Stopped application (PID $pid)"
    fi

    # Also kill any orphaned processes
    pkill -f "blink" 2>/dev/null
    pkill -f "cargo run" 2>/dev/null
}

# Wait for the application to be fully ready
# Usage: wait_for_app [timeout_seconds]
wait_for_app() {
    local timeout="${1:-120}"
    local log_file="${2:-/tmp/blink-test.log}"
    local elapsed=0

    echo -n "Waiting for test server (8000/9999)..."
    while [ $elapsed -lt $timeout ]; do
        if curl -s "http://localhost:9999/health" | grep -q '"status":"ok"'; then
            echo " ready"
            return 0
        fi
        if nc -z localhost 8000 2>/dev/null && nc -z localhost 9999 2>/dev/null; then
            if curl -s "http://localhost:9999/health" | grep -q '"status":"ok"'; then
                echo " ready"
                return 0
            fi
        fi
        if grep -q "\[TestServer\] Starting debug test server" "$log_file" 2>/dev/null; then
            sleep 2
            if curl -s "http://localhost:9999/health" | grep -q '"status":"ok"'; then
                echo " ready"
                return 0
            fi
        fi
        sleep 2
        ((elapsed+=2))
        echo -n "."
    done

    echo " timeout waiting for test server"
    echo "Last 100 lines of log ($log_file):"
    tail -n 100 "$log_file" 2>/dev/null || true
    echo "Port 8000 status: $(nc -z localhost 8000 && echo up || echo down)"
    echo "Port 9999 status: $(nc -z localhost 9999 && echo up || echo down)"
    return 1
}


# ============================================================================
# Log Analysis
# ============================================================================

# Check if there are critical errors in the log
# Usage: check_for_errors [log_file]
check_for_errors() {
    local log_file="${1:-/tmp/blink-test.log}"

    if grep -qi "panic\|fatal\|crash" "$log_file" 2>/dev/null; then
        echo "Critical errors found in log:"
        grep -i "panic\|fatal\|crash" "$log_file"
        return 1
    fi

    return 0
}

# Get webpack build status from log
# Usage: get_build_status [log_file]
get_build_status() {
    local log_file="${1:-/tmp/blink-test.log}"

    if grep -q "compiled successfully" "$log_file" 2>/dev/null; then
        echo "success"
    elif grep -q "failed to compile\|ERROR" "$log_file" 2>/dev/null; then
        echo "failed"
    else
        echo "pending"
    fi
}

# ============================================================================
# Test Environment
# ============================================================================

# Check if all dependencies are available
# Usage: check_dependencies
check_dependencies() {
    local missing=0

    for cmd in curl jq npm cargo; do
        if ! command -v "$cmd" &>/dev/null; then
            echo "Missing dependency: $cmd"
            ((missing++))
        fi
    done

    if [ $missing -gt 0 ]; then
        echo "Please install missing dependencies"
        return 1
    fi

    echo "All dependencies available"
    return 0
}

# Create a temporary test workspace
# Usage: create_test_workspace
create_test_workspace() {
    local workspace="/tmp/blink-test-workspace"
    rm -rf "$workspace"
    mkdir -p "$workspace"

    # Create some test files
    echo "console.log('Hello, World!');" > "$workspace/test.js"
    echo "def hello():\n    print('Hello')" > "$workspace/test.py"
    echo "# Test README" > "$workspace/README.md"

    echo "$workspace"
}

# Clean up test artifacts
# Usage: cleanup_tests
cleanup_tests() {
    rm -rf /tmp/blink-test-workspace
    rm -f /tmp/blink-test.log
    rm -f /tmp/blink-test.pid
    echo "Cleaned up test artifacts"
}

# ============================================================================
# Report Generation
# ============================================================================

# Generate a test report in JSON format
# Usage: generate_report "$passed" "$failed" "$skipped" "output_file"
generate_report() {
    local passed="$1"
    local failed="$2"
    local skipped="$3"
    local output="${4:-/tmp/test-report.json}"

    local timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
    local total=$((passed + failed + skipped))

    cat > "$output" << EOF
{
    "timestamp": "$timestamp",
    "summary": {
        "total": $total,
        "passed": $passed,
        "failed": $failed,
        "skipped": $skipped
    },
    "success": $([ $failed -eq 0 ] && echo "true" || echo "false")
}
EOF

    echo "Report saved to $output"
}

# Print a formatted test section header
# Usage: section "Section Name"
section() {
    local name="$1"
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "  $name"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
}
