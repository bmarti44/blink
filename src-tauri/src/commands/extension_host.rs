//! Extension Host Sidecar Management (DEPRECATED)
//!
//! This module manages the Node.js extension host sidecar process for running
//! VS Code extensions that require Node.js runtime.
//!
//! DEPRECATION NOTICE: This module is deprecated in favor of the manager-based
//! approach in `services/extension_host_manager.rs` and the singleton commands
//! in `commands/channel_router.rs`. The commands here will be removed in a
//! future release. Use the `*_default_*` commands instead:
//!
//! - `start_extension_host` -> `start_default_extension_host`
//! - `stop_extension_host` -> `stop_default_extension_host`
//! - `is_extension_host_ready` -> `is_default_extension_host_ready`
//! - `activate_extension` -> `activate_default_extension`
//! - etc.

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, Command, Stdio};
use std::sync::Arc;
use std::thread;
use tauri::{AppHandle, Emitter, Manager, State};

/// Position in a document
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DocumentPosition {
    pub line: u32,
    pub character: u32,
}

/// Range in a document
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DocumentRange {
    pub start: DocumentPosition,
    pub end: DocumentPosition,
}

/// Message sent to the extension host sidecar
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type")]
pub enum ExtensionHostRequest {
    #[serde(rename = "ping")]
    Ping { id: String },

    #[serde(rename = "setWorkspaceFolder")]
    SetWorkspaceFolder { id: String, path: String },

    #[serde(rename = "activateExtension")]
    ActivateExtension {
        id: String,
        #[serde(rename = "extensionPath")]
        extension_path: String,
        #[serde(rename = "extensionId")]
        extension_id: String,
    },

    #[serde(rename = "deactivateExtension")]
    DeactivateExtension {
        id: String,
        #[serde(rename = "extensionId")]
        extension_id: String,
    },

    #[serde(rename = "executeCommand")]
    ExecuteCommand {
        id: String,
        command: String,
        args: Vec<serde_json::Value>,
    },

    #[serde(rename = "getActivatedExtensions")]
    GetActivatedExtensions { id: String },

    // Document management
    #[serde(rename = "openDocument")]
    OpenDocument {
        id: String,
        path: String,
    },

    #[serde(rename = "updateDocument")]
    UpdateDocument {
        id: String,
        uri: String,
        content: String,
        #[serde(default)]
        changes: Option<Vec<serde_json::Value>>,
    },

    #[serde(rename = "closeDocument")]
    CloseDocument {
        id: String,
        uri: String,
    },

    // Configuration
    #[serde(rename = "setConfiguration")]
    SetConfiguration {
        id: String,
        section: String,
        values: serde_json::Value,
    },

    // Provider requests
    #[serde(rename = "provideCompletion")]
    ProvideCompletion {
        id: String,
        uri: String,
        position: DocumentPosition,
        #[serde(default)]
        trigger_kind: Option<u32>,
        #[serde(default)]
        trigger_character: Option<String>,
    },

    #[serde(rename = "provideHover")]
    ProvideHover {
        id: String,
        uri: String,
        position: DocumentPosition,
    },

    #[serde(rename = "provideDefinition")]
    ProvideDefinition {
        id: String,
        uri: String,
        position: DocumentPosition,
    },

    #[serde(rename = "provideTypeDefinition")]
    ProvideTypeDefinition {
        id: String,
        uri: String,
        position: DocumentPosition,
    },

    #[serde(rename = "provideImplementation")]
    ProvideImplementation {
        id: String,
        uri: String,
        position: DocumentPosition,
    },

    #[serde(rename = "provideReferences")]
    ProvideReferences {
        id: String,
        uri: String,
        position: DocumentPosition,
        #[serde(default)]
        include_declaration: bool,
    },

    #[serde(rename = "provideDocumentSymbols")]
    ProvideDocumentSymbols {
        id: String,
        uri: String,
    },

    #[serde(rename = "provideCodeActions")]
    ProvideCodeActions {
        id: String,
        uri: String,
        range: DocumentRange,
        #[serde(default)]
        only: Option<Vec<String>>,
    },

    #[serde(rename = "provideFormatting")]
    ProvideFormatting {
        id: String,
        uri: String,
        #[serde(default)]
        tab_size: Option<u32>,
        #[serde(default)]
        insert_spaces: Option<bool>,
    },

    #[serde(rename = "provideSignatureHelp")]
    ProvideSignatureHelp {
        id: String,
        uri: String,
        position: DocumentPosition,
    },

    // Resolve additional details
    #[serde(rename = "resolveCompletionItem")]
    ResolveCompletionItem {
        id: String,
        item: serde_json::Value,
    },

    #[serde(rename = "resolveCodeAction")]
    ResolveCodeAction {
        id: String,
        action: serde_json::Value,
    },
}

/// Message received from the extension host sidecar
#[derive(Debug, Clone, Deserialize)]
pub struct ExtensionHostResponse {
    pub id: Option<String>,
    #[serde(rename = "type")]
    pub msg_type: String,
    // Response fields
    pub success: Option<bool>,
    pub error: Option<String>,
    pub extensions: Option<Vec<String>>,
    pub pong: Option<bool>,
    // Notification fields
    pub level: Option<String>,
    pub message: Option<String>,
    // Output channel fields
    pub channel: Option<String>,
    pub text: Option<String>,
    // Diagnostics fields
    pub uri: Option<String>,
    pub diagnostics: Option<serde_json::Value>,
    // Provider registration
    pub kind: Option<String>,
    pub selector: Option<serde_json::Value>,
    pub triggers: Option<Vec<String>>,
    // Command registration
    pub command: Option<String>,
}

/// State for managing the extension host sidecar
pub struct ExtensionHostState {
    process: Arc<Mutex<Option<Child>>>,
    stdin: Arc<Mutex<Option<std::process::ChildStdin>>>,
    is_ready: Arc<Mutex<bool>>,
}

impl ExtensionHostState {
    pub fn new() -> Self {
        Self {
            process: Arc::new(Mutex::new(None)),
            stdin: Arc::new(Mutex::new(None)),
            is_ready: Arc::new(Mutex::new(false)),
        }
    }
}

impl Default for ExtensionHostState {
    fn default() -> Self {
        Self::new()
    }
}

/// Start the extension host sidecar process
#[tauri::command]
pub async fn start_extension_host(
    app: AppHandle,
    state: State<'_, ExtensionHostState>,
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
        .join("extension-host-sidecar.js");

    // Fall back to development path (src-tauri/binaries in dev)
    let sidecar_path = if sidecar_path.exists() {
        sidecar_path
    } else {
        let dev_path = std::env::current_dir()
            .map_err(|e| format!("Failed to get current dir: {}", e))?
            .join("src-tauri")
            .join("binaries")
            .join("extension-host-sidecar.js");

        if dev_path.exists() {
            dev_path
        } else {
            // Also try without src-tauri prefix
            std::env::current_dir()
                .map_err(|e| format!("Failed to get current dir: {}", e))?
                .join("binaries")
                .join("extension-host-sidecar.js")
        }
    };

    if !sidecar_path.exists() {
        return Err(format!(
            "Extension host sidecar not found at: {:?}",
            sidecar_path
        ));
    }

    // Spawn Node.js with the sidecar script
    let mut child = Command::new("node")
        .arg(&sidecar_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .map_err(|e| format!("Failed to spawn extension host: {}", e))?;

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
                    if let Ok(response) = serde_json::from_str::<ExtensionHostResponse>(&line) {
                        match response.msg_type.as_str() {
                            "ready" => {
                                *is_ready.lock() = true;
                                let _ = app_clone.emit("extension-host-ready", ());
                            }
                            "response" => {
                                if let Some(id) = &response.id {
                                    let _ = app_clone.emit(
                                        &format!("extension-host-response-{}", id),
                                        serde_json::json!({
                                            "success": response.success,
                                            "error": response.error,
                                            "extensions": response.extensions,
                                            "pong": response.pong
                                        }),
                                    );
                                }
                            }
                            "notification" => {
                                let _ = app_clone.emit(
                                    "extension-host-notification",
                                    serde_json::json!({
                                        "level": response.level,
                                        "message": response.message
                                    }),
                                );
                            }
                            "output" => {
                                let _ = app_clone.emit(
                                    "extension-host-output",
                                    serde_json::json!({
                                        "channel": response.channel,
                                        "text": response.text
                                    }),
                                );
                            }
                            "diagnostics" => {
                                let _ = app_clone.emit(
                                    "extension-host-diagnostics",
                                    serde_json::json!({
                                        "uri": response.uri,
                                        "diagnostics": response.diagnostics
                                    }),
                                );
                            }
                            "registerProvider" => {
                                let _ = app_clone.emit(
                                    "extension-host-register-provider",
                                    serde_json::json!({
                                        "kind": response.kind,
                                        "selector": response.selector,
                                        "triggers": response.triggers
                                    }),
                                );
                            }
                            "registerCommand" => {
                                let _ = app_clone.emit(
                                    "extension-host-register-command",
                                    serde_json::json!({
                                        "command": response.command
                                    }),
                                );
                            }
                            "executeCommand" => {
                                // Extension wants to execute a VS Code command
                                let _ = app_clone.emit(
                                    "extension-host-execute-command",
                                    serde_json::json!({
                                        "command": response.command
                                    }),
                                );
                            }
                            _ => {}
                        }
                    }
                }
                Err(e) => {
                    eprintln!("Error reading extension host output: {}", e);
                    break;
                }
            }
        }

        let _ = app_clone.emit("extension-host-exit", ());
    });

    Ok(())
}

/// Stop the extension host sidecar process
#[tauri::command]
pub fn stop_extension_host(state: State<'_, ExtensionHostState>) -> Result<(), String> {
    let mut process_guard = state.process.lock();

    if let Some(mut child) = process_guard.take() {
        let _ = child.kill();
    }

    *state.stdin.lock() = None;
    *state.is_ready.lock() = false;

    Ok(())
}

/// Check if extension host is ready
#[tauri::command]
pub fn is_extension_host_ready(state: State<'_, ExtensionHostState>) -> bool {
    *state.is_ready.lock()
}

/// Set the workspace folder for the extension host
#[tauri::command]
pub fn set_extension_host_workspace(
    state: State<'_, ExtensionHostState>,
    request_id: String,
    path: String,
) -> Result<(), String> {
    send_request(
        &state,
        ExtensionHostRequest::SetWorkspaceFolder {
            id: request_id,
            path,
        },
    )
}

/// Activate an extension in the extension host
#[tauri::command]
pub fn activate_extension(
    state: State<'_, ExtensionHostState>,
    request_id: String,
    extension_path: String,
    extension_id: String,
) -> Result<(), String> {
    send_request(
        &state,
        ExtensionHostRequest::ActivateExtension {
            id: request_id,
            extension_path,
            extension_id,
        },
    )
}

/// Deactivate an extension in the extension host
#[tauri::command]
pub fn deactivate_extension(
    state: State<'_, ExtensionHostState>,
    request_id: String,
    extension_id: String,
) -> Result<(), String> {
    send_request(
        &state,
        ExtensionHostRequest::DeactivateExtension {
            id: request_id,
            extension_id,
        },
    )
}

/// Execute a command registered by an extension
#[tauri::command]
pub fn execute_extension_command(
    state: State<'_, ExtensionHostState>,
    request_id: String,
    command: String,
    args: Vec<serde_json::Value>,
) -> Result<(), String> {
    send_request(
        &state,
        ExtensionHostRequest::ExecuteCommand {
            id: request_id,
            command,
            args,
        },
    )
}

/// Get list of activated extensions
#[tauri::command]
pub fn get_activated_extensions(
    state: State<'_, ExtensionHostState>,
    request_id: String,
) -> Result<(), String> {
    send_request(
        &state,
        ExtensionHostRequest::GetActivatedExtensions { id: request_id },
    )
}

// ============================================================================
// Document Management Commands
// ============================================================================

/// Open a document in the extension host
#[tauri::command]
pub fn extension_host_open_document(
    state: State<'_, ExtensionHostState>,
    request_id: String,
    path: String,
) -> Result<(), String> {
    send_request(
        &state,
        ExtensionHostRequest::OpenDocument {
            id: request_id,
            path,
        },
    )
}

/// Update document content in the extension host
#[tauri::command]
pub fn extension_host_update_document(
    state: State<'_, ExtensionHostState>,
    request_id: String,
    uri: String,
    content: String,
) -> Result<(), String> {
    send_request(
        &state,
        ExtensionHostRequest::UpdateDocument {
            id: request_id,
            uri,
            content,
            changes: None,
        },
    )
}

/// Close a document in the extension host
#[tauri::command]
pub fn extension_host_close_document(
    state: State<'_, ExtensionHostState>,
    request_id: String,
    uri: String,
) -> Result<(), String> {
    send_request(
        &state,
        ExtensionHostRequest::CloseDocument {
            id: request_id,
            uri,
        },
    )
}

// ============================================================================
// Provider Request Commands
// ============================================================================

/// Request completion items from extensions
#[tauri::command]
pub fn request_completion(
    state: State<'_, ExtensionHostState>,
    request_id: String,
    uri: String,
    line: u32,
    character: u32,
    trigger_character: Option<String>,
) -> Result<(), String> {
    send_request(
        &state,
        ExtensionHostRequest::ProvideCompletion {
            id: request_id,
            uri,
            position: DocumentPosition { line, character },
            trigger_kind: if trigger_character.is_some() { Some(1) } else { Some(0) },
            trigger_character,
        },
    )
}

/// Request hover information from extensions
#[tauri::command]
pub fn request_hover(
    state: State<'_, ExtensionHostState>,
    request_id: String,
    uri: String,
    line: u32,
    character: u32,
) -> Result<(), String> {
    send_request(
        &state,
        ExtensionHostRequest::ProvideHover {
            id: request_id,
            uri,
            position: DocumentPosition { line, character },
        },
    )
}

/// Request definition location from extensions
#[tauri::command]
pub fn request_definition(
    state: State<'_, ExtensionHostState>,
    request_id: String,
    uri: String,
    line: u32,
    character: u32,
) -> Result<(), String> {
    send_request(
        &state,
        ExtensionHostRequest::ProvideDefinition {
            id: request_id,
            uri,
            position: DocumentPosition { line, character },
        },
    )
}

/// Request type definition location from extensions
#[tauri::command]
pub fn request_type_definition(
    state: State<'_, ExtensionHostState>,
    request_id: String,
    uri: String,
    line: u32,
    character: u32,
) -> Result<(), String> {
    send_request(
        &state,
        ExtensionHostRequest::ProvideTypeDefinition {
            id: request_id,
            uri,
            position: DocumentPosition { line, character },
        },
    )
}

/// Request references from extensions
#[tauri::command]
pub fn request_references(
    state: State<'_, ExtensionHostState>,
    request_id: String,
    uri: String,
    line: u32,
    character: u32,
    include_declaration: bool,
) -> Result<(), String> {
    send_request(
        &state,
        ExtensionHostRequest::ProvideReferences {
            id: request_id,
            uri,
            position: DocumentPosition { line, character },
            include_declaration,
        },
    )
}

/// Request document symbols from extensions
#[tauri::command]
pub fn request_document_symbols(
    state: State<'_, ExtensionHostState>,
    request_id: String,
    uri: String,
) -> Result<(), String> {
    send_request(
        &state,
        ExtensionHostRequest::ProvideDocumentSymbols {
            id: request_id,
            uri,
        },
    )
}

/// Request code actions from extensions
#[tauri::command]
pub fn request_code_actions(
    state: State<'_, ExtensionHostState>,
    request_id: String,
    uri: String,
    start_line: u32,
    start_character: u32,
    end_line: u32,
    end_character: u32,
    only: Option<Vec<String>>,
) -> Result<(), String> {
    send_request(
        &state,
        ExtensionHostRequest::ProvideCodeActions {
            id: request_id,
            uri,
            range: DocumentRange {
                start: DocumentPosition { line: start_line, character: start_character },
                end: DocumentPosition { line: end_line, character: end_character },
            },
            only,
        },
    )
}

/// Request formatting from extensions
#[tauri::command]
pub fn request_formatting(
    state: State<'_, ExtensionHostState>,
    request_id: String,
    uri: String,
    tab_size: Option<u32>,
    insert_spaces: Option<bool>,
) -> Result<(), String> {
    send_request(
        &state,
        ExtensionHostRequest::ProvideFormatting {
            id: request_id,
            uri,
            tab_size,
            insert_spaces,
        },
    )
}

/// Request signature help from extensions
#[tauri::command]
pub fn request_signature_help(
    state: State<'_, ExtensionHostState>,
    request_id: String,
    uri: String,
    line: u32,
    character: u32,
) -> Result<(), String> {
    send_request(
        &state,
        ExtensionHostRequest::ProvideSignatureHelp {
            id: request_id,
            uri,
            position: DocumentPosition { line, character },
        },
    )
}

/// Set configuration in the extension host
#[tauri::command]
pub fn set_extension_host_configuration(
    state: State<'_, ExtensionHostState>,
    request_id: String,
    section: String,
    values: serde_json::Value,
) -> Result<(), String> {
    send_request(
        &state,
        ExtensionHostRequest::SetConfiguration {
            id: request_id,
            section,
            values,
        },
    )
}

/// Helper function to send a request to the extension host
fn send_request(
    state: &State<'_, ExtensionHostState>,
    request: ExtensionHostRequest,
) -> Result<(), String> {
    let mut stdin_guard = state.stdin.lock();

    let stdin = stdin_guard
        .as_mut()
        .ok_or("Extension host not running")?;

    let json = serde_json::to_string(&request)
        .map_err(|e| format!("Failed to serialize request: {}", e))?;

    writeln!(stdin, "{}", json)
        .map_err(|e| format!("Failed to write to extension host: {}", e))?;

    stdin
        .flush()
        .map_err(|e| format!("Failed to flush: {}", e))?;

    Ok(())
}
