//! AI Chat Sidecar Management
//!
//! This module manages the Node.js AI sidecar process for handling
//! AI chat requests using @gbu/rapid-machine-learning.

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, Command, Stdio};
use std::sync::Arc;
use std::thread;
use tauri::{AppHandle, Emitter, Manager, State};

/// Message sent to the sidecar
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type")]
pub enum SidecarRequest {
    #[serde(rename = "chat")]
    Chat {
        id: String,
        message: String,
        context: Option<ChatContext>,
        history: Option<Vec<ChatHistoryItem>>,
        #[serde(rename = "workingDirectory")]
        working_directory: Option<String>,
    },
    #[serde(rename = "cancel")]
    Cancel { id: String },
    #[serde(rename = "ping")]
    Ping { id: String },
}

/// Chat context with file contents
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatContext {
    pub files: Option<Vec<FileContext>>,
    #[serde(rename = "selectedCode")]
    pub selected_code: Option<SelectedCode>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileContext {
    pub name: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SelectedCode {
    pub file: String,
    pub code: String,
    #[serde(rename = "startLine")]
    pub start_line: u32,
    #[serde(rename = "endLine")]
    pub end_line: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatHistoryItem {
    pub role: String,
    pub content: String,
}

/// Message received from the sidecar
#[derive(Debug, Clone, Deserialize)]
pub struct SidecarResponse {
    pub id: Option<String>,
    #[serde(rename = "type")]
    pub msg_type: String,
    pub content: Option<String>,
    pub error: Option<String>,
    // Tool-related fields
    pub tool: Option<String>,
    pub parameters: Option<serde_json::Value>,
    pub success: Option<bool>,
    pub result: Option<serde_json::Value>,
    // Tauri invoke fields
    pub command: Option<String>,
    pub args: Option<serde_json::Value>,
    #[serde(rename = "invokeId")]
    pub invoke_id: Option<String>,
    // Document edit fields
    pub file: Option<String>,
    pub edits: Option<serde_json::Value>,
}

/// State for managing the AI sidecar
pub struct AISidecarState {
    process: Arc<Mutex<Option<Child>>>,
    stdin: Arc<Mutex<Option<std::process::ChildStdin>>>,
    is_ready: Arc<Mutex<bool>>,
    pending_requests: Arc<Mutex<HashMap<String, bool>>>,
}

impl AISidecarState {
    pub fn new() -> Self {
        Self {
            process: Arc::new(Mutex::new(None)),
            stdin: Arc::new(Mutex::new(None)),
            is_ready: Arc::new(Mutex::new(false)),
            pending_requests: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

impl Default for AISidecarState {
    fn default() -> Self {
        Self::new()
    }
}

/// Start the AI sidecar process
#[tauri::command]
pub async fn start_ai_sidecar(
    app: AppHandle,
    state: State<'_, AISidecarState>,
) -> Result<(), String> {
    let mut process_guard = state.process.lock();

    // Check if already running
    if process_guard.is_some() {
        return Ok(());
    }

    // Get the path to the sidecar script
    let sidecar_path = app
        .path()
        .resource_dir()
        .map_err(|e| format!("Failed to get resource dir: {}", e))?
        .join("binaries")
        .join("ai-sidecar.js");

    // Fall back to development path
    let sidecar_path = if sidecar_path.exists() {
        sidecar_path
    } else {
        std::env::current_dir()
            .map_err(|e| format!("Failed to get current dir: {}", e))?
            .join("binaries")
            .join("ai-sidecar.js")
    };

    if !sidecar_path.exists() {
        return Err(format!("Sidecar not found at: {:?}", sidecar_path));
    }

    // Spawn Node.js with the sidecar script
    // Use stderr inherit so we can see sidecar debug logs in the terminal
    let mut child = Command::new("node")
        .arg(&sidecar_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit()) // Inherit stderr to see debug logs
        .spawn()
        .map_err(|e| format!("Failed to spawn sidecar: {}", e))?;

    let stdin = child.stdin.take().ok_or("Failed to get stdin")?;
    let stdout = child.stdout.take().ok_or("Failed to get stdout")?;

    *process_guard = Some(child);
    *state.stdin.lock() = Some(stdin);

    // Spawn thread to read stdout and emit events
    let app_clone = app.clone();
    let is_ready = state.is_ready.clone();

    thread::spawn(move || {
        let reader = BufReader::new(stdout);

        for line in reader.lines() {
            match line {
                Ok(line) => {
                    if let Ok(response) = serde_json::from_str::<SidecarResponse>(&line) {
                        match response.msg_type.as_str() {
                            "ready" => {
                                *is_ready.lock() = true;
                                let _ = app_clone.emit("ai-sidecar-ready", ());
                            }
                            "token" => {
                                if let (Some(id), Some(content)) = (&response.id, &response.content)
                                {
                                    let _ =
                                        app_clone.emit(&format!("ai-token-{}", id), content.clone());
                                }
                            }
                            "complete" => {
                                if let Some(id) = &response.id {
                                    let _ = app_clone.emit(
                                        &format!("ai-complete-{}", id),
                                        response.content.clone(),
                                    );
                                }
                            }
                            "error" => {
                                if let Some(id) = &response.id {
                                    let _ = app_clone.emit(
                                        &format!("ai-error-{}", id),
                                        response.error.clone(),
                                    );
                                }
                            }
                            "cancelled" => {
                                if let Some(id) = &response.id {
                                    let _ = app_clone.emit(&format!("ai-cancelled-{}", id), ());
                                }
                            }
                            "tool_use" => {
                                if let Some(id) = &response.id {
                                    let _ = app_clone.emit(
                                        &format!("ai-tool-use-{}", id),
                                        serde_json::json!({
                                            "tool": response.tool,
                                            "parameters": response.parameters
                                        }),
                                    );
                                }
                            }
                            "tool_result" => {
                                if let Some(id) = &response.id {
                                    let _ = app_clone.emit(
                                        &format!("ai-tool-result-{}", id),
                                        serde_json::json!({
                                            "tool": response.tool,
                                            "success": response.success,
                                            "result": response.result,
                                            "error": response.error
                                        }),
                                    );
                                }
                            }
                            "document_edit" => {
                                if let Some(id) = &response.id {
                                    let _ = app_clone.emit(
                                        &format!("ai-document-edit-{}", id),
                                        serde_json::json!({
                                            "file": response.file,
                                            "edits": response.edits
                                        }),
                                    );
                                }
                            }
                            _ => {}
                        }
                    }
                }
                Err(e) => {
                    eprintln!("Error reading sidecar output: {}", e);
                    break;
                }
            }
        }

        let _ = app_clone.emit("ai-sidecar-exit", ());
    });

    Ok(())
}

/// Stop the AI sidecar process
#[tauri::command]
pub fn stop_ai_sidecar(state: State<'_, AISidecarState>) -> Result<(), String> {
    let mut process_guard = state.process.lock();

    if let Some(mut child) = process_guard.take() {
        let _ = child.kill();
    }

    *state.stdin.lock() = None;
    *state.is_ready.lock() = false;

    Ok(())
}

/// Check if sidecar is ready
#[tauri::command]
pub fn is_ai_sidecar_ready(state: State<'_, AISidecarState>) -> bool {
    *state.is_ready.lock()
}

/// Send a chat message to the AI sidecar
#[tauri::command]
pub fn send_ai_chat(
    state: State<'_, AISidecarState>,
    request_id: String,
    message: String,
    context: Option<ChatContext>,
    history: Option<Vec<ChatHistoryItem>>,
    working_directory: Option<String>,
) -> Result<(), String> {
    let mut stdin_guard = state.stdin.lock();

    let stdin = stdin_guard
        .as_mut()
        .ok_or("Sidecar not running")?;

    let request = SidecarRequest::Chat {
        id: request_id.clone(),
        message,
        context,
        history,
        working_directory,
    };

    let json = serde_json::to_string(&request)
        .map_err(|e| format!("Failed to serialize request: {}", e))?;

    writeln!(stdin, "{}", json).map_err(|e| format!("Failed to write to sidecar: {}", e))?;

    stdin
        .flush()
        .map_err(|e| format!("Failed to flush: {}", e))?;

    state.pending_requests.lock().insert(request_id, true);

    Ok(())
}

/// Cancel an AI chat request
#[tauri::command]
pub fn cancel_ai_chat(state: State<'_, AISidecarState>, request_id: String) -> Result<(), String> {
    let mut stdin_guard = state.stdin.lock();

    let stdin = stdin_guard
        .as_mut()
        .ok_or("Sidecar not running")?;

    let request = SidecarRequest::Cancel { id: request_id };

    let json = serde_json::to_string(&request)
        .map_err(|e| format!("Failed to serialize request: {}", e))?;

    writeln!(stdin, "{}", json).map_err(|e| format!("Failed to write to sidecar: {}", e))?;

    stdin
        .flush()
        .map_err(|e| format!("Failed to flush: {}", e))?;

    Ok(())
}
