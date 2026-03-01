# Tauri E2E Testing

End-to-end testing utilities for Blink Tauri application.

## Quick Start

```bash
# 1. Start the application (from project root)
npm run tauri:dev

# 2. Wait for "compiled successfully" message

# 3. Run tests
./testing/tauri/run-tests.sh
```

## Structure

```
testing/tauri/
├── README.md           # This file
├── lib/
│   └── test-client.sh  # Core test client library
├── tests/
│   ├── 01-health.sh    # Server health tests
│   ├── 02-workbench.sh # Workbench loading tests
│   ├── 03-extensions.sh# Extension management tests
│   └── 04-editor.sh    # Editor functionality tests
├── run-tests.sh        # Run all tests
└── utils.sh            # Utility functions
```

## Usage

### Run All Tests
```bash
./testing/tauri/run-tests.sh
```

### Run Specific Test Suite
```bash
./testing/tauri/tests/01-health.sh
./testing/tauri/tests/03-extensions.sh
```

### Interactive Testing
```bash
source testing/tauri/lib/test-client.sh

# Now you can use functions directly:
test_js "document.title"
test_query ".monaco-workbench"
test_console 10
```

## Writing Tests

See `tests/` folder for examples. Each test file should:

1. Source the test client: `source "$(dirname "$0")/../lib/test-client.sh"`
2. Define test functions prefixed with `test_`
3. Use `assert_*` functions for assertions
4. Call `run_tests` at the end

Example:
```bash
#!/bin/bash
source "$(dirname "$0")/../lib/test-client.sh"

test_workbench_loaded() {
    local result=$(test_query ".monaco-workbench")
    assert_json_equals "$result" ".found" "true" "Monaco workbench should be present"
}

run_tests
```
