//! Types for the debug test server
//!
//! This module is only compiled in debug builds.

use serde::{Deserialize, Serialize};

// ============================================================================
// Window Management Types
// ============================================================================

/// Query parameter for window selection
#[derive(Debug, Deserialize, Default)]
pub struct WindowQuery {
    /// The window label to target (defaults to "main")
    #[serde(default = "default_window")]
    pub window: String,
}

fn default_window() -> String {
    "main".to_string()
}

/// Information about an open window
#[derive(Debug, Serialize)]
pub struct WindowInfo {
    pub label: String,
    pub title: Option<String>,
    pub url: Option<String>,
    pub folder: Option<String>,
    pub is_visible: bool,
    pub is_focused: bool,
    pub bridge_injected: bool,
}

/// Response for GET /windows
#[derive(Debug, Serialize)]
pub struct WindowsListResponse {
    pub windows: Vec<WindowInfo>,
    pub count: usize,
    pub active: Option<String>,
}

/// Request to open a new window
#[derive(Debug, Deserialize)]
pub struct OpenWindowRequest {
    /// Optional folder path. If not provided, opens a folder picker dialog.
    pub folder: Option<String>,
    /// Optional custom label for the window
    pub label: Option<String>,
    /// Optional window title
    pub title: Option<String>,
}

/// Response when opening a new window
#[derive(Debug, Serialize)]
pub struct OpenWindowResponse {
    pub success: bool,
    pub label: Option<String>,
    pub folder: Option<String>,
    pub error: Option<String>,
}

// ============================================================================

/// JavaScript code to execute
#[derive(Debug, Deserialize)]
pub struct JsRequest {
    pub code: String,
}

/// Result of JavaScript execution
#[derive(Debug, Serialize)]
pub struct JsResponse {
    pub success: bool,
    pub result: Option<serde_json::Value>,
    pub error: Option<String>,
}

/// DOM query request
#[derive(Debug, Deserialize)]
pub struct QueryRequest {
    pub selector: String,
}

/// DOM query response
#[derive(Debug, Serialize)]
pub struct QueryResponse {
    pub found: bool,
    pub count: usize,
    pub elements: Vec<ElementInfo>,
}

/// Information about a DOM element
#[derive(Debug, Serialize, Deserialize, Default)]
pub struct ElementInfo {
    #[serde(default)]
    pub tag: String,
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub classes: Vec<String>,
    #[serde(default)]
    pub text: Option<String>,
    #[serde(default)]
    pub attributes: std::collections::HashMap<String, String>,
}

/// Tauri command invocation request
#[derive(Debug, Deserialize)]
pub struct InvokeRequest {
    pub command: String,
    pub args: serde_json::Value,
    #[serde(default)]
    pub timeout: Option<u64>,
}

/// Tauri command invocation response
#[derive(Debug, Serialize)]
pub struct InvokeResponse {
    pub success: bool,
    pub result: Option<serde_json::Value>,
    pub error: Option<String>,
}

/// Console log entry
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ConsoleEntry {
    #[serde(default)]
    pub level: String, // "log", "warn", "error", "info", "debug"
    #[serde(default)]
    pub message: String,
    #[serde(default)]
    pub timestamp: u64,
    #[serde(default)]
    pub args: Vec<serde_json::Value>,
}

/// Error entry
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ErrorEntry {
    #[serde(default)]
    pub message: String,
    #[serde(default)]
    pub source: Option<String>,
    #[serde(default)]
    pub lineno: Option<u32>,
    #[serde(default)]
    pub colno: Option<u32>,
    #[serde(default)]
    pub stack: Option<String>,
    #[serde(default)]
    pub timestamp: u64,
}

/// Network request entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetworkEntry {
    pub method: String,
    pub url: String,
    pub status: Option<u16>,
    pub duration_ms: Option<u64>,
    pub request_headers: std::collections::HashMap<String, String>,
    pub response_headers: std::collections::HashMap<String, String>,
    pub timestamp: u64,
}

/// Custom event entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EventEntry {
    pub name: String,
    pub detail: serde_json::Value,
    pub timestamp: u64,
}

/// Collected logs response
#[derive(Debug, Serialize)]
pub struct LogsResponse<T> {
    pub entries: Vec<T>,
    pub total: usize,
}

/// Health check response
#[derive(Debug, Serialize)]
pub struct HealthResponse {
    pub status: String,
    pub bridge_connected: bool,
    pub uptime_seconds: u64,
}

/// DOM snapshot for /dom endpoint
#[derive(Debug, Serialize)]
pub struct DomSnapshot {
    pub html: String,
    pub title: String,
    pub url: String,
}

/// Computed styles response
#[derive(Debug, Deserialize)]
pub struct StylesRequest {
    pub selector: String,
    pub properties: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct StylesResponse {
    pub found: bool,
    pub styles: std::collections::HashMap<String, String>,
}

// ============================================================================
// Extension Management Types
// ============================================================================

/// Request to install an extension from Open VSX
#[derive(Debug, Deserialize)]
pub struct InstallExtensionRequest {
    /// Extension ID in format "publisher.name" (e.g., "esbenp.prettier-vscode")
    pub extension_id: String,
    /// Optional specific version to install
    pub version: Option<String>,
}

/// Response for extension installation
#[derive(Debug, Serialize)]
pub struct InstallExtensionResponse {
    pub success: bool,
    pub extension_id: Option<String>,
    pub version: Option<String>,
    pub path: Option<String>,
    pub error: Option<String>,
}

/// Information about an installed extension
#[derive(Debug, Clone, Serialize)]
pub struct ExtensionInfo {
    pub id: String,
    pub name: String,
    pub publisher: String,
    pub version: String,
    pub display_name: Option<String>,
    pub description: Option<String>,
    pub path: String,
    pub enabled: bool,
    pub categories: Vec<String>,
    pub has_main: bool,
    pub has_browser: bool,
}

/// Response for listing extensions
#[derive(Debug, Serialize)]
pub struct ExtensionsListResponse {
    pub extensions: Vec<ExtensionInfo>,
    pub count: usize,
}

/// Extension host status
#[derive(Debug, Serialize)]
pub struct ExtensionHostStatus {
    pub running: bool,
    pub ready: bool,
    pub activated_extensions: Vec<String>,
}

/// Search extensions request
#[derive(Debug, Deserialize)]
pub struct SearchExtensionsRequest {
    pub query: String,
    #[serde(default = "default_limit")]
    pub limit: usize,
}

fn default_limit() -> usize {
    20
}

/// Open VSX extension info (from marketplace)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenVSXExtension {
    pub namespace: String,
    pub name: String,
    pub version: String,
    #[serde(default)]
    pub display_name: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub download_count: Option<u64>,
    #[serde(default)]
    pub average_rating: Option<f64>,
    #[serde(default)]
    pub files: Option<OpenVSXFiles>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct OpenVSXFiles {
    pub download: Option<String>,
    pub icon: Option<String>,
    pub readme: Option<String>,
}

/// Search response from Open VSX
#[derive(Debug, Serialize)]
pub struct SearchExtensionsResponse {
    pub extensions: Vec<OpenVSXExtension>,
    pub count: usize,
}

// ============================================================================
// Terminal Management Types
// ============================================================================

/// Request to create a new terminal
#[derive(Debug, Deserialize)]
pub struct CreateTerminalRequest {
    /// Optional shell path (defaults to system default)
    pub shell: Option<String>,
    /// Optional working directory
    pub cwd: Option<String>,
    /// Terminal name
    pub name: Option<String>,
}

/// Terminal session information
#[derive(Debug, Clone, Serialize)]
pub struct TerminalInfo {
    pub id: String,
    pub shell: String,
    pub cwd: String,
    pub cols: u16,
    pub rows: u16,
}

/// Response for terminal creation
#[derive(Debug, Serialize)]
pub struct CreateTerminalResponse {
    pub success: bool,
    pub terminal: Option<TerminalInfo>,
    pub error: Option<String>,
}

/// Response for listing terminals
#[derive(Debug, Serialize)]
pub struct TerminalsListResponse {
    pub terminals: Vec<TerminalInfo>,
    pub count: usize,
}

/// Request to write to terminal
#[derive(Debug, Deserialize)]
pub struct TerminalWriteRequest {
    pub terminal_id: String,
    pub data: String,
}

/// Request to resize terminal
#[derive(Debug, Deserialize)]
pub struct TerminalResizeRequest {
    pub terminal_id: String,
    pub cols: u16,
    pub rows: u16,
}

/// Response for terminal operations
#[derive(Debug, Serialize)]
pub struct TerminalOperationResponse {
    pub success: bool,
    pub error: Option<String>,
}

/// Available shells response
#[derive(Debug, Serialize)]
pub struct AvailableShellsResponse {
    pub shells: Vec<ShellInfo>,
    pub default_shell: String,
}

/// Shell information
#[derive(Debug, Clone, Serialize)]
pub struct ShellInfo {
    pub name: String,
    pub path: String,
    pub is_default: bool,
}

// ============================================================================
// File System Types
// ============================================================================

/// Request to read a file
#[derive(Debug, Deserialize)]
pub struct ReadFileRequest {
    pub path: String,
}

/// Response for file read
#[derive(Debug, Serialize)]
pub struct ReadFileResponse {
    pub success: bool,
    pub content: Option<String>,
    pub size: Option<u64>,
    pub error: Option<String>,
}

/// Request to write a file
#[derive(Debug, Deserialize)]
pub struct WriteFileRequest {
    pub path: String,
    pub content: String,
}

/// Response for file write
#[derive(Debug, Serialize)]
pub struct WriteFileResponse {
    pub success: bool,
    pub bytes_written: Option<usize>,
    pub error: Option<String>,
}

/// Request to list directory
#[derive(Debug, Deserialize)]
pub struct ListDirRequest {
    pub path: String,
}

/// Directory entry
#[derive(Debug, Clone, Serialize)]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub is_directory: bool,
    pub is_file: bool,
    pub size: Option<u64>,
}

/// Response for directory listing
#[derive(Debug, Serialize)]
pub struct ListDirResponse {
    pub success: bool,
    pub entries: Vec<DirEntry>,
    pub error: Option<String>,
}

/// File stat response
#[derive(Debug, Serialize)]
pub struct FileStatResponse {
    pub success: bool,
    pub exists: bool,
    pub is_directory: bool,
    pub is_file: bool,
    pub size: Option<u64>,
    pub modified: Option<u64>,
    pub error: Option<String>,
}
