#!/bin/bash
# Health check tests for Blink Tauri test server
# These tests verify the basic functionality of the test server itself

source "$(dirname "$0")/../lib/test-client.sh"

# ============================================================================
# Test Functions
# ============================================================================

test_server_health() {
    local result=$(test_health)

    assert_json_equals "$result" ".status" "ok" "Server status should be 'ok'"
}

test_bridge_connected() {
    local result=$(test_health)

    assert_json_true "$result" ".bridge_connected" "Bridge should be connected"
}

test_server_uptime() {
    local result=$(test_health)
    local uptime=$(echo "$result" | jq -r '.uptime_seconds')

    assert_greater_than "$uptime" "-1" "Uptime should be non-negative"
}

test_js_execution() {
    local result=$(test_js "1 + 1")

    assert_json_true "$result" ".success" "JS execution should succeed"
    assert_json_equals "$result" ".result" "2" "1 + 1 should equal 2"
}

test_js_string_result() {
    local result=$(test_js "'hello' + ' ' + 'world'")

    assert_json_true "$result" ".success" "String concatenation should succeed"
    assert_json_equals "$result" ".result" "hello world" "String should be 'hello world'"
}

test_js_object_result() {
    local result=$(test_js "JSON.stringify({a: 1, b: 2})")

    assert_json_true "$result" ".success" "Object creation should succeed"

    local parsed=$(echo "$result" | jq -r '.result | fromjson | .a')
    assert_equals "$parsed" "1" "Object.a should be 1"
}

test_js_error_handling() {
    local result=$(test_js "throw new Error('test error')")

    # Should still return a response, but with error info
    assert_not_empty "$result" "Should return a response even for errors"
}

test_dom_query_exists() {
    local result=$(test_query "body")

    assert_json_true "$result" ".found" "Body element should exist"
}

test_dom_query_not_exists() {
    local result=$(test_query ".nonexistent-element-12345")

    assert_json_false "$result" ".found" "Nonexistent element should not be found"
}

test_console_endpoint() {
    local result=$(curl -s "$TEST_SERVER/console")

    assert_not_empty "$result" "Console endpoint should return data"

    local has_entries=$(echo "$result" | jq 'has("entries")')
    assert_equals "$has_entries" "true" "Response should have entries field"
}

test_errors_endpoint() {
    local result=$(curl -s "$TEST_SERVER/errors")

    assert_not_empty "$result" "Errors endpoint should return data"

    local has_entries=$(echo "$result" | jq 'has("entries")')
    assert_equals "$has_entries" "true" "Response should have entries field"
}

test_network_endpoint() {
    local result=$(curl -s "$TEST_SERVER/network")

    assert_not_empty "$result" "Network endpoint should return data"
}

# ============================================================================
# Run Tests
# ============================================================================

run_tests
