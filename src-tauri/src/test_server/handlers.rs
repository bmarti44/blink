//! HTTP handlers for the debug test server
//!
//! All handlers receive requests and communicate with the webview via Tauri's
//! eval functionality. Supports multiple windows via the `window` query parameter.

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use std::collections::HashSet;
use std::sync::{Arc, RwLock};
use tauri::{AppHandle, Manager, WebviewWindow, WebviewWindowBuilder, WebviewUrl};
use tokio::time::{timeout, Duration};

use super::bridge::get_bridge_script;
use super::commands::get_store;
use super::types::*;

/// Shared state for all handlers
pub struct AppState {
    pub app_handle: AppHandle,
    pub start_time: std::time::Instant,
    /// Track which windows have the bridge injected
    pub bridge_injected: Arc<RwLock<HashSet<String>>>,
    /// Track folder paths for context windows
    pub window_folders: Arc<RwLock<std::collections::HashMap<String, String>>>,
}

impl AppState {
    pub fn new(app_handle: AppHandle) -> Self {
        Self {
            app_handle,
            start_time: std::time::Instant::now(),
            bridge_injected: Arc::new(RwLock::new(HashSet::new())),
            window_folders: Arc::new(RwLock::new(std::collections::HashMap::new())),
        }
    }

    /// Get a webview window by label
    fn get_window(&self, label: &str) -> Option<WebviewWindow> {
        self.app_handle.get_webview_window(label)
    }

    /// Get all webview windows
    fn get_all_windows(&self) -> Vec<WebviewWindow> {
        self.app_handle.webview_windows().values().cloned().collect()
    }

    /// Mark a window as having the bridge injected
    pub fn mark_bridge_injected(&self, label: &str) {
        if let Ok(mut set) = self.bridge_injected.write() {
            set.insert(label.to_string());
        }
    }

    /// Check if a window has the bridge injected
    fn is_bridge_injected(&self, label: &str) -> bool {
        self.bridge_injected.read()
            .map(|set| set.contains(label))
            .unwrap_or(false)
    }

    /// Set folder for a window
    pub fn set_window_folder(&self, label: &str, folder: &str) {
        if let Ok(mut map) = self.window_folders.write() {
            map.insert(label.to_string(), folder.to_string());
        }
    }

    /// Get folder for a window
    fn get_window_folder(&self, label: &str) -> Option<String> {
        self.window_folders.read()
            .ok()
            .and_then(|map| map.get(label).cloned())
    }

    /// Inject bridge script into a window
    pub async fn inject_bridge(&self, label: &str) -> Result<(), String> {
        let window = self.get_window(label).ok_or("Window not found")?;
        let script = get_bridge_script();
        window.eval(script).map_err(|e| e.to_string())?;
        self.mark_bridge_injected(label);
        Ok(())
    }

    /// Execute JS with callback and wait for result
    async fn eval_with_callback(&self, label: &str, code: &str, timeout_ms: u64) -> Result<serde_json::Value, String> {
        let window = self.get_window(label).ok_or(format!("Window '{}' not found", label))?;
        let store = get_store();

        // Generate unique request ID
        let request_id = format!("req_{}", std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos());

        // Register for callback
        let rx = store.register(request_id.clone());

        // Execute JS that will call back with result
        let js_code = format!(
            r#"
            (async function() {{
                if (window.__TEST_BRIDGE__) {{
                    await window.__TEST_BRIDGE__.executeWithCallback({request_id}, {code});
                }} else {{
                    // Bridge not available, try direct Tauri invoke
                    try {{
                        let result = eval({code});
                        // If result is a Promise, await it
                        if (result && typeof result.then === 'function') {{
                            result = await result;
                        }}
                        if (window.__TAURI__ && window.__TAURI__.core) {{
                            await window.__TAURI__.core.invoke('test_server_callback', {{
                                requestId: {request_id},
                                result: {{ success: true, result: result, error: null }}
                            }});
                        }}
                    }} catch (e) {{
                        if (window.__TAURI__ && window.__TAURI__.core) {{
                            await window.__TAURI__.core.invoke('test_server_callback', {{
                                requestId: {request_id},
                                result: {{ success: false, result: null, error: e.message }}
                            }});
                        }}
                    }}
                }}
            }})();
            "#,
            request_id = serde_json::to_string(&request_id).unwrap_or_default(),
            code = serde_json::to_string(code).unwrap_or_default()
        );

        window.eval(&js_code).map_err(|e| e.to_string())?;

        // Wait for callback with timeout
        match timeout(Duration::from_millis(timeout_ms), rx).await {
            Ok(Ok(value)) => Ok(value),
            Ok(Err(_)) => Err("Callback channel closed".to_string()),
            Err(_) => {
                store.cancel(&request_id);
                Err(format!("Timeout waiting for callback after {}ms", timeout_ms))
            }
        }
    }
}

// ============================================================================
// Window Management Handlers
// ============================================================================

/// GET /windows - List all open windows
pub async fn list_windows(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let windows = state.get_all_windows();
    let mut window_infos = Vec::new();
    let mut active_window = None;

    for window in windows {
        let label = window.label().to_string();
        let is_focused = window.is_focused().unwrap_or(false);

        if is_focused {
            active_window = Some(label.clone());
        }

        window_infos.push(WindowInfo {
            label: label.clone(),
            title: window.title().ok(),
            url: None, // Can't easily get URL without JS execution
            folder: state.get_window_folder(&label),
            is_visible: window.is_visible().unwrap_or(true),
            is_focused,
            bridge_injected: state.is_bridge_injected(&label),
        });
    }

    let count = window_infos.len();
    Json(WindowsListResponse {
        windows: window_infos,
        count,
        active: active_window,
    })
}

/// POST /windows/open - Open a new context window
pub async fn open_window(
    State(state): State<Arc<AppState>>,
    Json(request): Json<OpenWindowRequest>,
) -> impl IntoResponse {
    // Generate window label
    let label = request.label.unwrap_or_else(|| {
        format!("context-{}", std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() % 100000)
    });

    // Determine folder path - if not provided, caller should use /windows/pick first
    let folder_path = request.folder;

    // If no folder specified and dialog not supported in this context, return error
    let folder = match folder_path {
        Some(f) => f,
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(OpenWindowResponse {
                    success: false,
                    label: None,
                    folder: None,
                    error: Some("No folder specified. Use POST /windows/pick to open folder picker, or provide 'folder' in request.".to_string()),
                }),
            );
        }
    };

    // Create new window
    let title = request.title.unwrap_or_else(|| format!("Blink - {}", folder.split('/').last().unwrap_or("Context")));

    // Build the URL with folder parameter
    let url = format!("http://localhost:8000/#/vscode?folder={}", urlencoding::encode(&folder));

    match WebviewWindowBuilder::new(
        &state.app_handle,
        &label,
        WebviewUrl::External(url.parse().unwrap())
    )
    .title(&title)
    .inner_size(1200.0, 800.0)
    .build()
    {
        Ok(_window) => {
            // Store the folder association
            state.set_window_folder(&label, &folder);

            // Inject bridge after a delay
            let state_clone = state.clone();
            let label_clone = label.clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(Duration::from_secs(3)).await;
                if let Err(e) = state_clone.inject_bridge(&label_clone).await {
                    eprintln!("[TestServer] Failed to inject bridge into {}: {}", label_clone, e);
                } else {
                    println!("[TestServer] Bridge injected into window: {}", label_clone);
                }
            });

            (
                StatusCode::OK,
                Json(OpenWindowResponse {
                    success: true,
                    label: Some(label),
                    folder: Some(folder),
                    error: None,
                }),
            )
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(OpenWindowResponse {
                success: false,
                label: None,
                folder: None,
                error: Some(e.to_string()),
            }),
        ),
    }
}

/// POST /windows/pick - Open folder picker dialog and return selected path
pub async fn pick_folder(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    use tauri_plugin_dialog::DialogExt;
    use tokio::sync::oneshot;

    let (tx, rx) = oneshot::channel();

    state.app_handle.dialog()
        .file()
        .set_title("Select folder for new window")
        .pick_folder(move |folder_path| {
            let _ = tx.send(folder_path.map(|p| p.to_string()));
        });

    match timeout(Duration::from_secs(120), rx).await {
        Ok(Ok(Some(path))) => (
            StatusCode::OK,
            Json(serde_json::json!({
                "success": true,
                "folder": path,
            })),
        ),
        Ok(Ok(None)) => (
            StatusCode::OK,
            Json(serde_json::json!({
                "success": false,
                "error": "User cancelled folder selection",
            })),
        ),
        Ok(Err(_)) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({
                "success": false,
                "error": "Dialog channel closed",
            })),
        ),
        Err(_) => (
            StatusCode::REQUEST_TIMEOUT,
            Json(serde_json::json!({
                "success": false,
                "error": "Folder picker timed out",
            })),
        ),
    }
}

/// DELETE /windows/:label - Close a window
pub async fn close_window(
    State(state): State<Arc<AppState>>,
    Path(label): Path<String>,
) -> impl IntoResponse {
    // Don't allow closing main window
    if label == "main" {
        return (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({
                "success": false,
                "error": "Cannot close main window via test server",
            })),
        );
    }

    match state.get_window(&label) {
        Some(window) => {
            match window.close() {
                Ok(_) => {
                    // Clean up tracking
                    if let Ok(mut set) = state.bridge_injected.write() {
                        set.remove(&label);
                    }
                    if let Ok(mut map) = state.window_folders.write() {
                        map.remove(&label);
                    }

                    (
                        StatusCode::OK,
                        Json(serde_json::json!({
                            "success": true,
                            "closed": label,
                        })),
                    )
                }
                Err(e) => (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({
                        "success": false,
                        "error": e.to_string(),
                    })),
                ),
            }
        }
        None => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({
                "success": false,
                "error": format!("Window '{}' not found", label),
            })),
        ),
    }
}

/// POST /windows/:label/focus - Focus a window
pub async fn focus_window(
    State(state): State<Arc<AppState>>,
    Path(label): Path<String>,
) -> impl IntoResponse {
    match state.get_window(&label) {
        Some(window) => {
            match window.set_focus() {
                Ok(_) => (
                    StatusCode::OK,
                    Json(serde_json::json!({ "success": true })),
                ),
                Err(e) => (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({
                        "success": false,
                        "error": e.to_string(),
                    })),
                ),
            }
        }
        None => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({
                "success": false,
                "error": format!("Window '{}' not found", label),
            })),
        ),
    }
}

/// POST /windows/:label/inject - Inject bridge into a window
pub async fn inject_bridge_handler(
    State(state): State<Arc<AppState>>,
    Path(label): Path<String>,
) -> impl IntoResponse {
    match state.inject_bridge(&label).await {
        Ok(_) => (
            StatusCode::OK,
            Json(serde_json::json!({
                "success": true,
                "message": format!("Bridge injected into window '{}'", label),
            })),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({
                "success": false,
                "error": e,
            })),
        ),
    }
}

// ============================================================================
// JavaScript Execution Handlers (with window parameter)
// ============================================================================

/// POST /js - Execute JavaScript code
pub async fn execute_js(
    State(state): State<Arc<AppState>>,
    Query(window_query): Query<WindowQuery>,
    Json(request): Json<JsRequest>,
) -> impl IntoResponse {
    let window_label = window_query.window;

    match state.eval_with_callback(&window_label, &request.code, 5000).await {
        Ok(value) => {
            let success = value.get("success").and_then(|v| v.as_bool()).unwrap_or(false);
            let result = value.get("result").cloned();
            let error = value.get("error").and_then(|v| v.as_str()).map(String::from);

            (
                StatusCode::OK,
                Json(JsResponse {
                    success,
                    result,
                    error,
                }),
            )
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(JsResponse {
                success: false,
                result: None,
                error: Some(e),
            }),
        ),
    }
}

/// POST /query - Query DOM elements
pub async fn query_dom(
    State(state): State<Arc<AppState>>,
    Query(window_query): Query<WindowQuery>,
    Json(request): Json<QueryRequest>,
) -> impl IntoResponse {
    let window_label = window_query.window;
    let code = format!(
        r#"window.__TEST_BRIDGE__ ? window.__TEST_BRIDGE__.query({}) : []"#,
        serde_json::to_string(&request.selector).unwrap_or_default()
    );

    match state.eval_with_callback(&window_label, &code, 5000).await {
        Ok(value) => {
            let result = value.get("result").cloned().unwrap_or(serde_json::Value::Array(vec![]));
            let elements: Vec<ElementInfo> = serde_json::from_value(result).unwrap_or_default();
            let count = elements.len();

            (
                StatusCode::OK,
                Json(QueryResponse {
                    found: count > 0,
                    count,
                    elements,
                }),
            )
        }
        Err(_) => (
            StatusCode::OK,
            Json(QueryResponse {
                found: false,
                count: 0,
                elements: vec![],
            }),
        ),
    }
}

/// GET /dom - Get full DOM snapshot
pub async fn get_dom(
    State(state): State<Arc<AppState>>,
    Query(window_query): Query<WindowQuery>,
) -> impl IntoResponse {
    let window_label = window_query.window;

    let window = match state.get_window(&window_label) {
        Some(w) => w,
        None => {
            return (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(DomSnapshot {
                    html: String::new(),
                    title: String::new(),
                    url: String::new(),
                }),
            );
        }
    };

    let code = r#"
        if (window.__TEST_BRIDGE__) {
            window.__TEST_BRIDGE__.getDom();
        } else {
            { html: document.documentElement.outerHTML, title: document.title, url: location.href }
        }
    "#;

    let _ = window.eval(code);

    (
        StatusCode::OK,
        Json(DomSnapshot {
            html: "<html>...</html>".to_string(),
            title: "Blink".to_string(),
            url: "http://localhost:8000".to_string(),
        }),
    )
}

/// POST /styles - Get computed styles
pub async fn get_styles(
    State(state): State<Arc<AppState>>,
    Query(window_query): Query<WindowQuery>,
    Json(request): Json<StylesRequest>,
) -> impl IntoResponse {
    let window_label = window_query.window;

    let window = match state.get_window(&window_label) {
        Some(w) => w,
        None => {
            return (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(StylesResponse {
                    found: false,
                    styles: std::collections::HashMap::new(),
                }),
            );
        }
    };

    let code = format!(
        r#"
        if (window.__TEST_BRIDGE__) {{
            window.__TEST_BRIDGE__.getStyles({selector}, {properties});
        }}
        "#,
        selector = serde_json::to_string(&request.selector).unwrap_or_default(),
        properties = serde_json::to_string(&request.properties).unwrap_or_default()
    );

    let _ = window.eval(&code);

    (
        StatusCode::OK,
        Json(StylesResponse {
            found: true,
            styles: std::collections::HashMap::new(),
        }),
    )
}

/// POST /invoke - Invoke Tauri commands
pub async fn invoke_command(
    State(state): State<Arc<AppState>>,
    Query(window_query): Query<WindowQuery>,
    Json(request): Json<InvokeRequest>,
) -> impl IntoResponse {
    let window_label = window_query.window;
    let timeout_ms = request.timeout.unwrap_or(10000);

    let window = match state.get_window(&window_label).or_else(|| state.get_window("main")) {
        Some(w) => w,
        None => {
            return (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(InvokeResponse {
                    success: false,
                    result: None,
                    error: Some(format!("Window '{}' not found and no fallback available", window_label)),
                }),
            );
        }
    };

    let store = get_store();

    // Generate unique request ID
    let request_id = format!("invoke_{}", std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos());

    // Register for callback
    let rx = store.register(request_id.clone());

    // Build the invoke code that calls back with result after await
    let code = format!(
        r#"
        (async function() {{
            try {{
                const result = await window.__TAURI__.core.invoke({command}, {args});
                await window.__TAURI__.core.invoke('test_server_callback', {{
                    requestId: {request_id},
                    result: {{ success: true, result: result, error: null }}
                }});
            }} catch (e) {{
                await window.__TAURI__.core.invoke('test_server_callback', {{
                    requestId: {request_id},
                    result: {{ success: false, result: null, error: e.message || String(e) }}
                }});
            }}
        }})();
        "#,
        command = serde_json::to_string(&request.command).unwrap_or_default(),
        args = serde_json::to_string(&request.args).unwrap_or_default(),
        request_id = serde_json::to_string(&request_id).unwrap_or_default()
    );

    if let Err(e) = window.eval(&code) {
        store.cancel(&request_id);
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(InvokeResponse {
                success: false,
                result: None,
                error: Some(e.to_string()),
            }),
        );
    }

    // Wait for callback with timeout
    match tokio::time::timeout(std::time::Duration::from_millis(timeout_ms), rx).await {
        Ok(Ok(value)) => {
            // The callback returns {success, result, error} directly
            let success = value.get("success").and_then(|v| v.as_bool()).unwrap_or(false);
            let result = value.get("result").cloned();
            let error = value.get("error").and_then(|v| v.as_str()).map(String::from);

            (
                StatusCode::OK,
                Json(InvokeResponse {
                    success,
                    result,
                    error,
                }),
            )
        }
        Ok(Err(_)) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(InvokeResponse {
                success: false,
                result: None,
                error: Some("Callback channel closed".to_string()),
            }),
        ),
        Err(_) => {
            store.cancel(&request_id);
            (
                StatusCode::GATEWAY_TIMEOUT,
                Json(InvokeResponse {
                    success: false,
                    result: None,
                    error: Some("Invoke timed out".to_string()),
                }),
            )
        }
    }
}

// ============================================================================
// Log Handlers (with window parameter)
// ============================================================================

/// GET /errors - Get captured errors
pub async fn get_errors(
    State(state): State<Arc<AppState>>,
    Query(window_query): Query<WindowQuery>,
) -> impl IntoResponse {
    let window_label = window_query.window;
    let code = r#"window.__TEST_BRIDGE__ ? window.__TEST_BRIDGE__.getErrors() : []"#;

    match state.eval_with_callback(&window_label, code, 5000).await {
        Ok(value) => {
            let result = value.get("result").cloned().unwrap_or(serde_json::Value::Array(vec![]));
            let entries: Vec<ErrorEntry> = serde_json::from_value(result).unwrap_or_default();
            let total = entries.len();

            (
                StatusCode::OK,
                Json(LogsResponse::<ErrorEntry> { entries, total }),
            )
        }
        Err(_) => (
            StatusCode::OK,
            Json(LogsResponse::<ErrorEntry> {
                entries: vec![],
                total: 0,
            }),
        ),
    }
}

/// GET /console - Get captured console logs
pub async fn get_console(
    State(state): State<Arc<AppState>>,
    Query(window_query): Query<WindowQuery>,
) -> impl IntoResponse {
    let window_label = window_query.window;
    let code = r#"window.__TEST_BRIDGE__ ? window.__TEST_BRIDGE__.getConsoleLogs() : []"#;

    match state.eval_with_callback(&window_label, code, 5000).await {
        Ok(value) => {
            let result = value.get("result").cloned().unwrap_or(serde_json::Value::Array(vec![]));
            let entries: Vec<ConsoleEntry> = serde_json::from_value(result).unwrap_or_default();
            let total = entries.len();

            (
                StatusCode::OK,
                Json(LogsResponse::<ConsoleEntry> { entries, total }),
            )
        }
        Err(_) => (
            StatusCode::OK,
            Json(LogsResponse::<ConsoleEntry> {
                entries: vec![],
                total: 0,
            }),
        ),
    }
}

/// GET /network - Get captured network requests
pub async fn get_network(
    State(state): State<Arc<AppState>>,
    Query(window_query): Query<WindowQuery>,
) -> impl IntoResponse {
    let window_label = window_query.window;

    let window = match state.get_window(&window_label) {
        Some(w) => w,
        None => {
            return (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(LogsResponse::<NetworkEntry> {
                    entries: vec![],
                    total: 0,
                }),
            );
        }
    };

    let code = r#"
        if (window.__TEST_BRIDGE__) {
            window.__TEST_BRIDGE__.getNetworkRequests();
        }
    "#;

    let _ = window.eval(code);

    (
        StatusCode::OK,
        Json(LogsResponse::<NetworkEntry> {
            entries: vec![],
            total: 0,
        }),
    )
}

/// GET /events - Get captured custom events
pub async fn get_events(
    State(state): State<Arc<AppState>>,
    Query(window_query): Query<WindowQuery>,
) -> impl IntoResponse {
    let window_label = window_query.window;

    let window = match state.get_window(&window_label) {
        Some(w) => w,
        None => {
            return (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(LogsResponse::<EventEntry> {
                    entries: vec![],
                    total: 0,
                }),
            );
        }
    };

    let code = r#"
        if (window.__TEST_BRIDGE__) {
            window.__TEST_BRIDGE__.getEvents();
        }
    "#;

    let _ = window.eval(code);

    (
        StatusCode::OK,
        Json(LogsResponse::<EventEntry> {
            entries: vec![],
            total: 0,
        }),
    )
}

// ============================================================================
// Health and Clear Handlers
// ============================================================================

/// GET /health - Health check endpoint
pub async fn health_check(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let windows = state.get_all_windows();
    let bridge_connected = windows.iter().any(|w| state.is_bridge_injected(w.label()));
    let uptime = state.start_time.elapsed().as_secs();
    let window_count = windows.len();

    Json(serde_json::json!({
        "status": "ok",
        "bridge_connected": bridge_connected,
        "uptime_seconds": uptime,
        "window_count": window_count,
        "windows": windows.iter().map(|w| w.label().to_string()).collect::<Vec<_>>(),
    }))
}

/// DELETE /console - Clear console logs
pub async fn clear_console(
    State(state): State<Arc<AppState>>,
    Query(window_query): Query<WindowQuery>,
) -> impl IntoResponse {
    let window_label = window_query.window;
    if let Some(window) = state.get_window(&window_label) {
        let _ = window.eval("if (window.__TEST_BRIDGE__) { window.__TEST_BRIDGE__.clearConsoleLogs(); }");
    }
    StatusCode::NO_CONTENT
}

/// DELETE /errors - Clear errors
pub async fn clear_errors(
    State(state): State<Arc<AppState>>,
    Query(window_query): Query<WindowQuery>,
) -> impl IntoResponse {
    let window_label = window_query.window;
    if let Some(window) = state.get_window(&window_label) {
        let _ = window.eval("if (window.__TEST_BRIDGE__) { window.__TEST_BRIDGE__.clearErrors(); }");
    }
    StatusCode::NO_CONTENT
}

/// DELETE /network - Clear network logs
pub async fn clear_network(
    State(state): State<Arc<AppState>>,
    Query(window_query): Query<WindowQuery>,
) -> impl IntoResponse {
    let window_label = window_query.window;
    if let Some(window) = state.get_window(&window_label) {
        let _ = window.eval("if (window.__TEST_BRIDGE__) { window.__TEST_BRIDGE__.clearNetworkRequests(); }");
    }
    StatusCode::NO_CONTENT
}

/// DELETE /events - Clear events
pub async fn clear_events(
    State(state): State<Arc<AppState>>,
    Query(window_query): Query<WindowQuery>,
) -> impl IntoResponse {
    let window_label = window_query.window;
    if let Some(window) = state.get_window(&window_label) {
        let _ = window.eval("if (window.__TEST_BRIDGE__) { window.__TEST_BRIDGE__.clearEvents(); }");
    }
    StatusCode::NO_CONTENT
}

// ============================================================================
// Extension Management Handlers
// ============================================================================

use super::types::{
    ExtensionInfo, ExtensionsListResponse, ExtensionHostStatus,
    InstallExtensionRequest, InstallExtensionResponse,
    SearchExtensionsRequest, SearchExtensionsResponse, OpenVSXExtension, OpenVSXFiles,
};
use crate::commands::extensions::{
    install_extension_from_data, list_installed_extensions, uninstall_extension,
};
use crate::commands::extension_host::ExtensionHostState;

/// GET /extensions - List all installed extensions
pub async fn list_extensions(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    match list_installed_extensions(state.app_handle.clone()).await {
        Ok(extensions) => {
            let extension_infos: Vec<ExtensionInfo> = extensions
                .iter()
                .map(|ext| ExtensionInfo {
                    id: ext.extension_id.clone(),
                    name: ext.manifest.name.clone(),
                    publisher: ext.manifest.publisher.clone(),
                    version: ext.manifest.version.clone(),
                    display_name: ext.manifest.display_name.clone(),
                    description: ext.manifest.description.clone(),
                    path: ext.extension_path.clone(),
                    enabled: true, // TODO: Check actual enabled state
                    categories: ext.manifest.categories.clone().unwrap_or_default(),
                    has_main: ext.manifest.main.is_some(),
                    has_browser: ext.manifest.browser.is_some(),
                })
                .collect();

            let count = extension_infos.len();
            (
                StatusCode::OK,
                Json(ExtensionsListResponse {
                    extensions: extension_infos,
                    count,
                }),
            )
        }
        Err(_) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ExtensionsListResponse {
                extensions: vec![],
                count: 0,
            }),
        ),
    }
}

/// POST /extensions/search - Search Open VSX marketplace
pub async fn search_extensions(
    Json(request): Json<SearchExtensionsRequest>,
) -> impl IntoResponse {
    let url = format!(
        "https://open-vsx.org/api/-/search?query={}&size={}&sortBy=downloadCount&sortOrder=desc",
        urlencoding::encode(&request.query),
        request.limit
    );

    match reqwest::get(&url).await {
        Ok(response) => {
            if let Ok(data) = response.json::<serde_json::Value>().await {
                let extensions: Vec<OpenVSXExtension> = data
                    .get("extensions")
                    .and_then(|e| e.as_array())
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|ext| {
                                Some(OpenVSXExtension {
                                    namespace: ext.get("namespace")?.as_str()?.to_string(),
                                    name: ext.get("name")?.as_str()?.to_string(),
                                    version: ext.get("version")?.as_str()?.to_string(),
                                    display_name: ext.get("displayName").and_then(|v| v.as_str()).map(String::from),
                                    description: ext.get("description").and_then(|v| v.as_str()).map(String::from),
                                    download_count: ext.get("downloadCount").and_then(|v| v.as_u64()),
                                    average_rating: ext.get("averageRating").and_then(|v| v.as_f64()),
                                    files: ext.get("files").map(|f| OpenVSXFiles {
                                        download: f.get("download").and_then(|v| v.as_str()).map(String::from),
                                        icon: f.get("icon").and_then(|v| v.as_str()).map(String::from),
                                        readme: f.get("readme").and_then(|v| v.as_str()).map(String::from),
                                    }),
                                })
                            })
                            .collect()
                    })
                    .unwrap_or_default();

                let count = extensions.len();
                (
                    StatusCode::OK,
                    Json(SearchExtensionsResponse { extensions, count }),
                )
            } else {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(SearchExtensionsResponse {
                        extensions: vec![],
                        count: 0,
                    }),
                )
            }
        }
        Err(_) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(SearchExtensionsResponse {
                extensions: vec![],
                count: 0,
            }),
        ),
    }
}

/// POST /extensions/install - Install extension from Open VSX
/// This triggers the frontend ExtensionManager to install, which updates the UI naturally
pub async fn install_extension_handler(
    State(state): State<Arc<AppState>>,
    Query(window_query): Query<WindowQuery>,
    Json(request): Json<InstallExtensionRequest>,
) -> impl IntoResponse {
    let window_label = window_query.window;

    // Parse extension ID (format: publisher.name)
    let parts: Vec<&str> = request.extension_id.split('.').collect();
    if parts.len() < 2 {
        return (
            StatusCode::BAD_REQUEST,
            Json(InstallExtensionResponse {
                success: false,
                extension_id: Some(request.extension_id.clone()),
                version: None,
                path: None,
                error: Some("Invalid extension ID format. Expected 'publisher.name'".to_string()),
            }),
        );
    }

    let namespace = parts[0];
    let name = parts[1..].join(".");

    // Get extension info from Open VSX
    let version = request.version.clone().unwrap_or_else(|| "latest".to_string());
    let info_url = if version == "latest" {
        format!("https://open-vsx.org/api/{}/{}", namespace, name)
    } else {
        format!("https://open-vsx.org/api/{}/{}/{}", namespace, name, version)
    };

    let extension_info = match reqwest::get(&info_url).await {
        Ok(response) => {
            if !response.status().is_success() {
                return (
                    StatusCode::NOT_FOUND,
                    Json(InstallExtensionResponse {
                        success: false,
                        extension_id: Some(request.extension_id.clone()),
                        version: None,
                        path: None,
                        error: Some(format!("Extension not found on Open VSX: {}", request.extension_id)),
                    }),
                );
            }
            match response.json::<serde_json::Value>().await {
                Ok(data) => data,
                Err(e) => {
                    return (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        Json(InstallExtensionResponse {
                            success: false,
                            extension_id: Some(request.extension_id.clone()),
                            version: None,
                            path: None,
                            error: Some(format!("Failed to parse extension info: {}", e)),
                        }),
                    );
                }
            }
        }
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(InstallExtensionResponse {
                    success: false,
                    extension_id: Some(request.extension_id.clone()),
                    version: None,
                    path: None,
                    error: Some(format!("Failed to fetch extension info: {}", e)),
                }),
            );
        }
    };

    // Get download URL
    let download_url = extension_info
        .get("files")
        .and_then(|f| f.get("download"))
        .and_then(|d| d.as_str())
        .map(String::from);

    let download_url = match download_url {
        Some(url) => url,
        None => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(InstallExtensionResponse {
                    success: false,
                    extension_id: Some(request.extension_id.clone()),
                    version: None,
                    path: None,
                    error: Some("No download URL found for extension".to_string()),
                }),
            );
        }
    };

    let actual_version = extension_info
        .get("version")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown")
        .to_string();

    // Download the VSIX and install via frontend ExtensionManager
    // This ensures the UI updates naturally
    let js_code = format!(
        r#"
        (async function() {{
            try {{
                // Fetch the VSIX
                const response = await fetch({download_url});
                if (!response.ok) {{
                    return {{ success: false, error: 'Failed to download VSIX: ' + response.status }};
                }}
                const arrayBuffer = await response.arrayBuffer();
                const data = new Uint8Array(arrayBuffer);

                // Install via the ExtensionManager (which updates the UI)
                if (window.__EXTENSION_MANAGER__) {{
                    const info = await window.__EXTENSION_MANAGER__.installFromData(data, {filename});
                    return {{
                        success: true,
                        extension_id: info.id,
                        version: info.version,
                        path: info.extensionPath
                    }};
                }} else {{
                    return {{ success: false, error: 'Extension manager not available' }};
                }}
            }} catch (e) {{
                return {{ success: false, error: e.message }};
            }}
        }})()
        "#,
        download_url = serde_json::to_string(&download_url).unwrap_or_default(),
        filename = serde_json::to_string(&format!("{}.{}-{}.vsix", namespace, name, actual_version)).unwrap_or_default()
    );

    match state.eval_with_callback(&window_label, &js_code, 60000).await {
        Ok(value) => {
            let result = value.get("result").cloned().unwrap_or(serde_json::Value::Null);
            let success = result.get("success").and_then(|s| s.as_bool()).unwrap_or(false);
            let ext_id = result.get("extension_id").and_then(|v| v.as_str()).map(String::from);
            let version = result.get("version").and_then(|v| v.as_str()).map(String::from);
            let path = result.get("path").and_then(|v| v.as_str()).map(String::from);
            let error = result.get("error").and_then(|v| v.as_str()).map(String::from);

            (
                if success { StatusCode::OK } else { StatusCode::INTERNAL_SERVER_ERROR },
                Json(InstallExtensionResponse {
                    success,
                    extension_id: ext_id.or(Some(request.extension_id.clone())),
                    version: version.or(Some(actual_version)),
                    path,
                    error,
                }),
            )
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(InstallExtensionResponse {
                success: false,
                extension_id: Some(request.extension_id.clone()),
                version: Some(actual_version),
                path: None,
                error: Some(e),
            }),
        ),
    }
}

/// DELETE /extensions/:id - Uninstall an extension
pub async fn uninstall_extension_handler(
    State(state): State<Arc<AppState>>,
    Path(extension_id): Path<String>,
) -> impl IntoResponse {
    // URL decode the extension ID (it may contain dots)
    let extension_id = urlencoding::decode(&extension_id)
        .map(|s| s.into_owned())
        .unwrap_or(extension_id);

    match uninstall_extension(state.app_handle.clone(), extension_id.clone()).await {
        Ok(_) => (
            StatusCode::OK,
            Json(serde_json::json!({
                "success": true,
                "extension_id": extension_id,
            })),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({
                "success": false,
                "extension_id": extension_id,
                "error": e,
            })),
        ),
    }
}

/// GET /extensions/host/status - Get extension host status
pub async fn extension_host_status(
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    // Try to get extension host state from app
    let ext_host_state = state.app_handle.try_state::<ExtensionHostState>();

    match ext_host_state {
        Some(host_state) => {
            let is_ready = crate::commands::extension_host::is_extension_host_ready(host_state.clone());

            (
                StatusCode::OK,
                Json(ExtensionHostStatus {
                    running: is_ready,
                    ready: is_ready,
                    activated_extensions: vec![], // Would need async call to get these
                }),
            )
        }
        None => (
            StatusCode::OK,
            Json(ExtensionHostStatus {
                running: false,
                ready: false,
                activated_extensions: vec![],
            }),
        ),
    }
}

/// POST /extensions/refresh - Refresh extension list in UI
pub async fn refresh_extensions(
    State(state): State<Arc<AppState>>,
    Query(window_query): Query<WindowQuery>,
) -> impl IntoResponse {
    let window_label = window_query.window;

    // Execute JS to refresh the extension manager
    let code = r#"
        (async function() {
            if (window.__EXTENSION_MANAGER__ && window.__EXTENSION_MANAGER__.refresh) {
                await window.__EXTENSION_MANAGER__.refresh();
                return { success: true, message: 'Extensions refreshed' };
            } else if (window.__TEST_BRIDGE__ && window.__TEST_BRIDGE__.refreshExtensions) {
                return await window.__TEST_BRIDGE__.refreshExtensions();
            } else {
                return { success: false, error: 'Extension manager not available' };
            }
        })()
    "#;

    match state.eval_with_callback(&window_label, code, 10000).await {
        Ok(value) => {
            let success = value.get("result")
                .and_then(|r| r.get("success"))
                .and_then(|s| s.as_bool())
                .unwrap_or(false);

            (
                StatusCode::OK,
                Json(serde_json::json!({
                    "success": success,
                    "result": value.get("result"),
                })),
            )
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({
                "success": false,
                "error": e,
            })),
        ),
    }
}

/// POST /extensions/host/restart - Restart the extension host
pub async fn restart_extension_host(
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let ext_host_state = state.app_handle.try_state::<ExtensionHostState>();

    match ext_host_state {
        Some(host_state) => {
            // Stop the extension host
            if let Err(e) = crate::commands::extension_host::stop_extension_host(host_state.clone()) {
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({
                        "success": false,
                        "error": format!("Failed to stop extension host: {}", e),
                    })),
                );
            }

            // Wait a moment for cleanup
            tokio::time::sleep(Duration::from_millis(500)).await;

            // Start the extension host
            match crate::commands::extension_host::start_extension_host(
                state.app_handle.clone(),
                host_state,
            ).await {
                Ok(_) => {
                    // Wait for it to be ready
                    tokio::time::sleep(Duration::from_secs(2)).await;

                    (
                        StatusCode::OK,
                        Json(serde_json::json!({
                            "success": true,
                            "message": "Extension host restarted",
                        })),
                    )
                }
                Err(e) => (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({
                        "success": false,
                        "error": format!("Failed to start extension host: {}", e),
                    })),
                ),
            }
        }
        None => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({
                "success": false,
                "error": "Extension host state not available",
            })),
        ),
    }
}

// ============================================================================
// Terminal Management Handlers
// ============================================================================

use super::types::{
    CreateTerminalRequest, CreateTerminalResponse, TerminalsListResponse,
    TerminalWriteRequest, TerminalResizeRequest, TerminalOperationResponse,
    AvailableShellsResponse, ShellInfo as TestShellInfo,
    ReadFileRequest, ReadFileResponse, WriteFileRequest, WriteFileResponse,
    ListDirRequest, ListDirResponse, DirEntry, FileStatResponse,
    TerminalInfo as TestTerminalInfo,
};
use crate::commands::terminal::TerminalState;

/// GET /terminals - List all active terminals
pub async fn list_terminals_handler(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let terminal_state = state.app_handle.try_state::<TerminalState>();

    match terminal_state {
        Some(term_state) => {
            let terminals = crate::commands::terminal::list_terminals(term_state);
            let infos: Vec<TestTerminalInfo> = terminals
                .iter()
                .map(|t| TestTerminalInfo {
                    id: t.id.clone(),
                    shell: t.shell.clone(),
                    cwd: t.cwd.clone(),
                    cols: t.cols,
                    rows: t.rows,
                })
                .collect();
            let count = infos.len();

            (
                StatusCode::OK,
                Json(TerminalsListResponse {
                    terminals: infos,
                    count,
                }),
            )
        }
        None => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(TerminalsListResponse {
                terminals: vec![],
                count: 0,
            }),
        ),
    }
}

/// POST /terminals - Create a new terminal
pub async fn create_terminal_handler(
    State(state): State<Arc<AppState>>,
    Json(request): Json<CreateTerminalRequest>,
) -> impl IntoResponse {
    let terminal_state = state.app_handle.try_state::<TerminalState>();

    match terminal_state {
        Some(term_state) => {
            match crate::commands::terminal::spawn_terminal(
                state.app_handle.clone(),
                term_state,
                request.shell,
                request.cwd,
                Some(80),
                Some(24),
            ).await {
                Ok(info) => (
                    StatusCode::OK,
                    Json(CreateTerminalResponse {
                        success: true,
                        terminal: Some(TestTerminalInfo {
                            id: info.id,
                            shell: info.shell,
                            cwd: info.cwd,
                            cols: info.cols,
                            rows: info.rows,
                        }),
                        error: None,
                    }),
                ),
                Err(e) => (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(CreateTerminalResponse {
                        success: false,
                        terminal: None,
                        error: Some(e),
                    }),
                ),
            }
        }
        None => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(CreateTerminalResponse {
                success: false,
                terminal: None,
                error: Some("Terminal state not available".to_string()),
            }),
        ),
    }
}

/// POST /terminals/write - Write to a terminal
pub async fn write_terminal_handler(
    State(state): State<Arc<AppState>>,
    Json(request): Json<TerminalWriteRequest>,
) -> impl IntoResponse {
    let terminal_state = state.app_handle.try_state::<TerminalState>();

    match terminal_state {
        Some(term_state) => {
            match crate::commands::terminal::write_to_terminal(
                term_state,
                request.terminal_id,
                request.data,
            ) {
                Ok(_) => (
                    StatusCode::OK,
                    Json(TerminalOperationResponse {
                        success: true,
                        error: None,
                    }),
                ),
                Err(e) => (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(TerminalOperationResponse {
                        success: false,
                        error: Some(e),
                    }),
                ),
            }
        }
        None => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(TerminalOperationResponse {
                success: false,
                error: Some("Terminal state not available".to_string()),
            }),
        ),
    }
}

/// POST /terminals/resize - Resize a terminal
pub async fn resize_terminal_handler(
    State(state): State<Arc<AppState>>,
    Json(request): Json<TerminalResizeRequest>,
) -> impl IntoResponse {
    let terminal_state = state.app_handle.try_state::<TerminalState>();

    match terminal_state {
        Some(term_state) => {
            match crate::commands::terminal::resize_terminal(
                term_state,
                request.terminal_id,
                request.cols,
                request.rows,
            ) {
                Ok(_) => (
                    StatusCode::OK,
                    Json(TerminalOperationResponse {
                        success: true,
                        error: None,
                    }),
                ),
                Err(e) => (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(TerminalOperationResponse {
                        success: false,
                        error: Some(e),
                    }),
                ),
            }
        }
        None => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(TerminalOperationResponse {
                success: false,
                error: Some("Terminal state not available".to_string()),
            }),
        ),
    }
}

/// DELETE /terminals/:id - Kill a terminal
pub async fn kill_terminal_handler(
    State(state): State<Arc<AppState>>,
    Path(terminal_id): Path<String>,
) -> impl IntoResponse {
    let terminal_state = state.app_handle.try_state::<TerminalState>();

    match terminal_state {
        Some(term_state) => {
            match crate::commands::terminal::kill_terminal(term_state, terminal_id.clone()) {
                Ok(_) => (
                    StatusCode::OK,
                    Json(serde_json::json!({
                        "success": true,
                        "terminal_id": terminal_id,
                    })),
                ),
                Err(e) => (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({
                        "success": false,
                        "terminal_id": terminal_id,
                        "error": e,
                    })),
                ),
            }
        }
        None => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({
                "success": false,
                "error": "Terminal state not available",
            })),
        ),
    }
}

/// GET /terminals/shells - Get available shells
pub async fn get_shells_handler() -> impl IntoResponse {
    let shells = crate::commands::terminal::get_available_shells();
    let default = crate::commands::terminal::get_default_shell();

    let shell_infos: Vec<TestShellInfo> = shells
        .iter()
        .map(|s| TestShellInfo {
            name: s.name.clone(),
            path: s.path.clone(),
            is_default: s.is_default,
        })
        .collect();

    Json(AvailableShellsResponse {
        shells: shell_infos,
        default_shell: default,
    })
}

// ============================================================================
// File System Handlers
// ============================================================================

/// POST /fs/read - Read a file
pub async fn read_file_handler(
    Json(request): Json<ReadFileRequest>,
) -> impl IntoResponse {
    match tokio::fs::read(&request.path).await {
        Ok(content) => {
            let size = content.len() as u64;
            match String::from_utf8(content) {
                Ok(text) => (
                    StatusCode::OK,
                    Json(ReadFileResponse {
                        success: true,
                        content: Some(text),
                        size: Some(size),
                        error: None,
                    }),
                ),
                Err(_) => (
                    StatusCode::OK,
                    Json(ReadFileResponse {
                        success: false,
                        content: None,
                        size: Some(size),
                        error: Some("File is not valid UTF-8".to_string()),
                    }),
                ),
            }
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ReadFileResponse {
                success: false,
                content: None,
                size: None,
                error: Some(e.to_string()),
            }),
        ),
    }
}

/// POST /fs/write - Write a file
pub async fn write_file_handler(
    Json(request): Json<WriteFileRequest>,
) -> impl IntoResponse {
    let path = std::path::Path::new(&request.path);

    // Create parent directories if they don't exist
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            if let Err(e) = tokio::fs::create_dir_all(parent).await {
                // Only fail if the error is not "already exists"
                if e.kind() != std::io::ErrorKind::AlreadyExists {
                    return (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        Json(WriteFileResponse {
                            success: false,
                            bytes_written: None,
                            error: Some(format!("Failed to create parent directories: {}", e)),
                        }),
                    );
                }
            }
        }
    }

    let bytes = request.content.as_bytes();
    match tokio::fs::write(&request.path, bytes).await {
        Ok(_) => (
            StatusCode::OK,
            Json(WriteFileResponse {
                success: true,
                bytes_written: Some(bytes.len()),
                error: None,
            }),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(WriteFileResponse {
                success: false,
                bytes_written: None,
                error: Some(e.to_string()),
            }),
        ),
    }
}

/// POST /fs/list - List directory contents
pub async fn list_dir_handler(
    Json(request): Json<ListDirRequest>,
) -> impl IntoResponse {
    match tokio::fs::read_dir(&request.path).await {
        Ok(mut entries) => {
            let mut result = Vec::new();
            while let Ok(Some(entry)) = entries.next_entry().await {
                let path = entry.path();
                let metadata = entry.metadata().await.ok();
                result.push(DirEntry {
                    name: entry.file_name().to_string_lossy().to_string(),
                    path: path.to_string_lossy().to_string(),
                    is_directory: metadata.as_ref().map(|m| m.is_dir()).unwrap_or(false),
                    is_file: metadata.as_ref().map(|m| m.is_file()).unwrap_or(false),
                    size: metadata.as_ref().map(|m| m.len()),
                });
            }
            (
                StatusCode::OK,
                Json(ListDirResponse {
                    success: true,
                    entries: result,
                    error: None,
                }),
            )
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ListDirResponse {
                success: false,
                entries: vec![],
                error: Some(e.to_string()),
            }),
        ),
    }
}

/// GET /fs/stat - Get file/directory stats
pub async fn stat_file_handler(
    Query(params): Query<std::collections::HashMap<String, String>>,
) -> impl IntoResponse {
    let path = params.get("path").cloned().unwrap_or_default();

    match tokio::fs::metadata(&path).await {
        Ok(metadata) => {
            let modified = metadata.modified().ok().and_then(|t| {
                t.duration_since(std::time::UNIX_EPOCH).ok().map(|d| d.as_secs())
            });
            (
                StatusCode::OK,
                Json(FileStatResponse {
                    success: true,
                    exists: true,
                    is_directory: metadata.is_dir(),
                    is_file: metadata.is_file(),
                    size: Some(metadata.len()),
                    modified,
                    error: None,
                }),
            )
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => (
            StatusCode::OK,
            Json(FileStatResponse {
                success: true,
                exists: false,
                is_directory: false,
                is_file: false,
                size: None,
                modified: None,
                error: None,
            }),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(FileStatResponse {
                success: false,
                exists: false,
                is_directory: false,
                is_file: false,
                size: None,
                modified: None,
                error: Some(e.to_string()),
            }),
        ),
    }
}

/// DELETE /fs - Delete a file or directory
pub async fn delete_file_handler(
    Query(params): Query<std::collections::HashMap<String, String>>,
) -> impl IntoResponse {
    let path = params.get("path").cloned().unwrap_or_default();
    let recursive = params.get("recursive").map(|s| s == "true").unwrap_or(false);

    let result = if recursive {
        tokio::fs::remove_dir_all(&path).await
    } else {
        // Try file first, then directory
        match tokio::fs::remove_file(&path).await {
            Ok(_) => Ok(()),
            Err(_) => tokio::fs::remove_dir(&path).await,
        }
    };

    match result {
        Ok(_) => (
            StatusCode::OK,
            Json(serde_json::json!({
                "success": true,
                "path": path,
            })),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({
                "success": false,
                "path": path,
                "error": e.to_string(),
            })),
        ),
    }
}
