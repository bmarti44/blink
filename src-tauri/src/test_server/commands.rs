//! Tauri commands for the test server
//!
//! These commands allow the JavaScript bridge to send data back to the test server.

use parking_lot::Mutex;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::oneshot;

/// Shared state for collecting test results from JavaScript
pub struct TestResultStore {
    pending: Mutex<HashMap<String, oneshot::Sender<Value>>>,
}

impl TestResultStore {
    pub fn new() -> Self {
        Self {
            pending: Mutex::new(HashMap::new()),
        }
    }

    /// Register a pending request and get a receiver for the result
    pub fn register(&self, request_id: String) -> oneshot::Receiver<Value> {
        let (tx, rx) = oneshot::channel();
        self.pending.lock().insert(request_id, tx);
        rx
    }

    /// Complete a pending request with a result
    pub fn complete(&self, request_id: &str, value: Value) -> bool {
        if let Some(tx) = self.pending.lock().remove(request_id) {
            tx.send(value).is_ok()
        } else {
            false
        }
    }

    /// Cancel a pending request
    pub fn cancel(&self, request_id: &str) {
        self.pending.lock().remove(request_id);
    }
}

/// Global test result store (lazy initialized)
static TEST_STORE: std::sync::OnceLock<Arc<TestResultStore>> = std::sync::OnceLock::new();

pub fn get_store() -> Arc<TestResultStore> {
    TEST_STORE
        .get_or_init(|| Arc::new(TestResultStore::new()))
        .clone()
}

/// Tauri command: Called by JavaScript to send test results back
#[tauri::command]
pub fn test_server_callback(request_id: String, result: Value) -> bool {
    let store = get_store();
    let completed = store.complete(&request_id, result);
    if !completed {
        eprintln!("[TestServer] No pending request for ID: {}", request_id);
    }
    completed
}

/// Tauri command: Get console logs from the bridge
#[tauri::command]
pub fn test_get_console_logs() -> Value {
    // This will be called from the test server to get logs
    // The actual implementation fetches from the bridge via JS eval
    Value::Array(vec![])
}

/// Tauri command: Get errors from the bridge
#[tauri::command]
pub fn test_get_errors() -> Value {
    Value::Array(vec![])
}

/// Tauri command: Get network requests from the bridge
#[tauri::command]
pub fn test_get_network() -> Value {
    Value::Array(vec![])
}

/// Tauri command: Get events from the bridge
#[tauri::command]
pub fn test_get_events() -> Value {
    Value::Array(vec![])
}
