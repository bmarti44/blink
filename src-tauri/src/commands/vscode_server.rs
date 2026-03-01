//! VSCode Server Management
//!
//! This module manages the VSCode server using Coder's code-server.
//! Code-server is an open-source VS Code server that runs in the browser.

use std::process::{Child, Command, Stdio};
use std::sync::Arc;
use tauri::{AppHandle, Manager, State};
use tokio::sync::RwLock;

/// State for managing the code-server process
pub struct VscodeServerState {
    process: Arc<RwLock<Option<Child>>>,
    port: Arc<RwLock<u16>>,
}

impl VscodeServerState {
    pub fn new() -> Self {
        Self {
            process: Arc::new(RwLock::new(None)),
            port: Arc::new(RwLock::new(8080)),
        }
    }
}

impl Default for VscodeServerState {
    fn default() -> Self {
        Self::new()
    }
}

/// Server info returned to frontend
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeServerInfo {
    server_url: String,
    port: u16,
    auth: String,
}

/// Initialize and start code-server
#[tauri::command]
pub async fn start_vscode_server(
    app: AppHandle,
    state: State<'_, VscodeServerState>,
) -> Result<serde_json::Value, String> {
    // Check if already running
    {
        let guard = state.process.read().await;
        if guard.is_some() {
            let port = *state.port.read().await;
            let info = CodeServerInfo {
                server_url: format!("http://127.0.0.1:{}", port),
                port,
                auth: "none".to_string(),
            };
            return serde_json::to_value(info).map_err(|e| e.to_string());
        }
    }

    // Get app data directory for code-server data
    let user_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?
        .join("code-server-data");

    // Create directory if it doesn't exist
    std::fs::create_dir_all(&user_data_dir)
        .map_err(|e| format!("Failed to create data dir: {}", e))?;

    let port: u16 = 8080;

    // Find code-server executable
    // First try local node_modules, then global install
    let code_server_path = {
        // Try project's node_modules/.bin first
        let project_root = std::env::current_dir().unwrap_or_default();
        let local_bin = project_root.join("node_modules/.bin/code-server");

        if local_bin.exists() {
            Ok(local_bin)
        } else {
            // Try parent directory (in case we're in src-tauri)
            let parent_bin = project_root.parent()
                .map(|p| p.join("node_modules/.bin/code-server"))
                .filter(|p| p.exists());

            if let Some(path) = parent_bin {
                Ok(path)
            } else {
                // Fall back to global install
                which::which("code-server")
            }
        }
    }
    .map_err(|_| {
        "code-server not found. Install locally with: npm install code-server".to_string()
    })?;

    eprintln!("[CodeServer] Starting code-server from: {:?}", code_server_path);
    eprintln!("[CodeServer] User data dir: {:?}", user_data_dir);

    // Start code-server process
    let child = Command::new(code_server_path)
        .args([
            "--bind-addr",
            &format!("127.0.0.1:{}", port),
            "--auth",
            "none",
            "--disable-telemetry",
            "--user-data-dir",
            user_data_dir.to_str().unwrap_or("/tmp/code-server"),
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start code-server: {}", e))?;

    // Store the process
    {
        let mut guard = state.process.write().await;
        *guard = Some(child);
    }
    {
        let mut port_guard = state.port.write().await;
        *port_guard = port;
    }

    eprintln!("[CodeServer] Server started on port {}", port);

    // Wait a moment for server to start
    tokio::time::sleep(tokio::time::Duration::from_millis(1000)).await;

    let info = CodeServerInfo {
        server_url: format!("http://127.0.0.1:{}", port),
        port,
        auth: "none".to_string(),
    };

    serde_json::to_value(info).map_err(|e| e.to_string())
}

/// Get information about the code-server
#[tauri::command]
pub async fn get_vscode_server_info(
    state: State<'_, VscodeServerState>,
) -> Result<Option<serde_json::Value>, String> {
    let guard = state.process.read().await;
    if guard.is_some() {
        let port = *state.port.read().await;
        let info = CodeServerInfo {
            server_url: format!("http://127.0.0.1:{}", port),
            port,
            auth: "none".to_string(),
        };
        Ok(Some(serde_json::to_value(info).map_err(|e| e.to_string())?))
    } else {
        Ok(None)
    }
}

/// Stop code-server
#[tauri::command]
pub async fn stop_vscode_server(state: State<'_, VscodeServerState>) -> Result<(), String> {
    let process_opt = {
        let mut guard = state.process.write().await;
        guard.take()
    };

    if let Some(mut child) = process_opt {
        child.kill().map_err(|e| format!("Failed to kill code-server: {}", e))?;
        child.wait().map_err(|e| format!("Failed to wait for code-server: {}", e))?;
    }

    eprintln!("[CodeServer] Server stopped");
    Ok(())
}

/// Restart code-server
#[tauri::command]
pub async fn restart_vscode_server(
    app: AppHandle,
    state: State<'_, VscodeServerState>,
) -> Result<serde_json::Value, String> {
    // Stop first
    stop_vscode_server(state.clone()).await?;

    // Then start
    start_vscode_server(app, state).await
}

/// Check if code-server is running
#[tauri::command]
pub async fn is_vscode_server_running(state: State<'_, VscodeServerState>) -> Result<bool, String> {
    let mut guard = state.process.write().await;
    if let Some(ref mut child) = *guard {
        // Check if process is still running
        match child.try_wait() {
            Ok(Some(_)) => {
                // Process has exited
                *guard = None;
                Ok(false)
            }
            Ok(None) => {
                // Still running
                Ok(true)
            }
            Err(_) => Ok(false),
        }
    } else {
        Ok(false)
    }
}
