//! Channel Router Commands
//!
//! Provides Tauri commands for the channel-based IPC system.
//! This integrates the openvscode-server style channel routing with Tauri.

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::mpsc;

use crate::channels::{
    CallResult, ChannelContext, ChannelMessage, ChannelRouter, ExtensionHostChannel,
};
use crate::services::{ExtHostEvent, ExtensionHostManager};

/// Default connection ID for singleton extension host
/// Using a constant ensures consistent connection ID across frontend and backend
pub const DEFAULT_CONNECTION_ID: &str = "default-extension-host";

/// State for the channel router
pub struct ChannelRouterState {
    router: Arc<ChannelRouter>,
    extension_host_manager: Arc<ExtensionHostManager>,
    event_receiver: Arc<Mutex<Option<mpsc::Receiver<ExtHostEvent>>>>,
}

impl ChannelRouterState {
    pub fn new(sidecar_path: String) -> Self {
        // Create extension host event channel
        let (ext_tx, ext_rx) = mpsc::channel::<ExtHostEvent>(256);
        let manager = Arc::new(ExtensionHostManager::new(sidecar_path, ext_tx));

        // Create router event channel
        let (router_tx, _router_rx) = mpsc::channel::<ChannelMessage>(256);
        let router = Arc::new(ChannelRouter::new(router_tx));

        Self {
            router,
            extension_host_manager: manager,
            event_receiver: Arc::new(Mutex::new(Some(ext_rx))),
        }
    }

    pub fn manager(&self) -> Arc<ExtensionHostManager> {
        self.extension_host_manager.clone()
    }
}

/// Request to call a channel method
#[derive(Debug, Clone, Deserialize)]
pub struct ChannelCallRequest {
    pub channel: String,
    pub command: String,
    pub args: Vec<Value>,
    #[serde(default)]
    pub session_id: Option<String>,
}

/// Response from a channel call
#[derive(Debug, Clone, Serialize)]
pub struct ChannelCallResponse {
    pub success: bool,
    pub data: Option<Value>,
    pub error: Option<String>,
}

impl From<CallResult> for ChannelCallResponse {
    fn from(result: CallResult) -> Self {
        match result {
            CallResult::Success { data } => Self {
                success: true,
                data: Some(data),
                error: None,
            },
            CallResult::Error { error } => Self {
                success: false,
                data: None,
                error: Some(error),
            },
        }
    }
}

/// Initialize the channel router with all channels
#[tauri::command]
pub async fn init_channel_router(
    app: AppHandle,
    state: State<'_, ChannelRouterState>,
) -> Result<(), String> {
    // Register the extension host channel
    let channel = ExtensionHostChannel::new(state.extension_host_manager.clone());
    state.router.register_channel(Arc::new(channel));

    // Start event forwarding from extension host to Tauri
    let mut rx_guard = state.event_receiver.lock();
    if let Some(rx) = rx_guard.take() {
        let app_clone = app.clone();
        tokio::spawn(async move {
            forward_extension_host_events(app_clone, rx).await;
        });
    }

    Ok(())
}

/// Forward extension host events to Tauri event system
async fn forward_extension_host_events(app: AppHandle, mut rx: mpsc::Receiver<ExtHostEvent>) {
    while let Some(event) = rx.recv().await {
        match event {
            ExtHostEvent::Ready { connection_id } => {
                let _ = app.emit(
                    "extension-host-ready",
                    serde_json::json!({ "connectionId": connection_id }),
                );
            }
            ExtHostEvent::Exit { connection_id, code } => {
                let _ = app.emit(
                    "extension-host-exit",
                    serde_json::json!({
                        "connectionId": connection_id,
                        "code": code
                    }),
                );
            }
            ExtHostEvent::Notification { level, message } => {
                let _ = app.emit(
                    "extension-host-notification",
                    serde_json::json!({
                        "level": level,
                        "message": message
                    }),
                );
            }
            ExtHostEvent::Output { channel, text } => {
                let _ = app.emit(
                    "extension-host-output",
                    serde_json::json!({
                        "channel": channel,
                        "text": text
                    }),
                );
            }
            ExtHostEvent::Diagnostics { uri, diagnostics } => {
                let _ = app.emit(
                    "extension-host-diagnostics",
                    serde_json::json!({
                        "uri": uri,
                        "diagnostics": diagnostics
                    }),
                );
            }
            ExtHostEvent::ProviderRegistered { kind, id, selector } => {
                let _ = app.emit(
                    "extension-host-register-provider",
                    serde_json::json!({
                        "kind": kind,
                        "id": id,
                        "selector": selector
                    }),
                );
            }
            ExtHostEvent::CommandRegistered { command } => {
                let _ = app.emit(
                    "extension-host-register-command",
                    serde_json::json!({
                        "command": command
                    }),
                );
            }
        }
    }
}

/// Call a channel method
#[tauri::command]
pub async fn channel_call(
    state: State<'_, ChannelRouterState>,
    request: ChannelCallRequest,
) -> Result<ChannelCallResponse, String> {
    let context = ChannelContext {
        session_id: request.session_id.unwrap_or_else(|| "default".to_string()),
        remote_authority: None,
        workspace_folder: None,
    };

    // Build a ChannelMessage::Call
    let request_id = state.router.next_request_id();
    let message = ChannelMessage::Call {
        id: request_id,
        channel: request.channel,
        command: request.command,
        args: request.args,
    };

    // Route the message
    let response = state.router.route(message, &context).await;

    // Extract the result
    match response {
        Some(ChannelMessage::Response { result, .. }) => Ok(result.into()),
        _ => Ok(ChannelCallResponse {
            success: false,
            data: None,
            error: Some("No response from channel".to_string()),
        }),
    }
}

/// Spawn a new extension host connection
#[tauri::command]
pub async fn spawn_extension_host_connection(
    state: State<'_, ChannelRouterState>,
    connection_id: Option<String>,
) -> Result<String, String> {
    let id = connection_id.unwrap_or_else(|| {
        format!(
            "conn-{}-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis())
                .unwrap_or(0),
            uuid::Uuid::new_v4()
                .to_string()
                .split('-')
                .next()
                .unwrap_or("0000")
        )
    });

    state
        .extension_host_manager
        .spawn(id.clone())
        .await
        .map_err(|e| e.to_string())?;

    Ok(id)
}

/// Terminate an extension host connection
#[tauri::command]
pub async fn terminate_extension_host_connection(
    state: State<'_, ChannelRouterState>,
    connection_id: String,
) -> Result<(), String> {
    state
        .extension_host_manager
        .terminate(&connection_id)
        .await
        .map_err(|e| e.to_string())
}

/// Check if an extension host connection is ready
#[tauri::command]
pub fn is_extension_host_connection_ready(
    state: State<'_, ChannelRouterState>,
    connection_id: String,
) -> bool {
    state.extension_host_manager.is_ready(&connection_id)
}

/// Get list of active extension host connections
#[tauri::command]
pub fn list_extension_host_connections(state: State<'_, ChannelRouterState>) -> Vec<String> {
    state.extension_host_manager.get_connections()
}

// =============================================================================
// Singleton extension host commands (use default connection ID)
// These provide a simpler interface when only one extension host is needed
// =============================================================================

/// Start the singleton extension host
/// Terminates any existing connection and spawns a new one with the default ID
#[tauri::command]
pub async fn start_default_extension_host(
    state: State<'_, ChannelRouterState>,
) -> Result<String, String> {
    // Terminate existing connection if any
    let _ = state
        .extension_host_manager
        .terminate(DEFAULT_CONNECTION_ID)
        .await;

    // Spawn new connection with default ID
    state
        .extension_host_manager
        .spawn(DEFAULT_CONNECTION_ID.to_string())
        .await?;

    Ok(DEFAULT_CONNECTION_ID.to_string())
}

/// Check if the singleton extension host is ready
#[tauri::command]
pub fn is_default_extension_host_ready(state: State<'_, ChannelRouterState>) -> bool {
    state.extension_host_manager.is_ready(DEFAULT_CONNECTION_ID)
}

/// Stop the singleton extension host
#[tauri::command]
pub async fn stop_default_extension_host(
    state: State<'_, ChannelRouterState>,
) -> Result<(), String> {
    state
        .extension_host_manager
        .terminate(DEFAULT_CONNECTION_ID)
        .await
}

/// Set workspace folder for the singleton extension host
#[tauri::command]
pub async fn set_default_extension_host_workspace(
    state: State<'_, ChannelRouterState>,
    path: String,
) -> Result<(), String> {
    use crate::services::ExtHostRequest;

    state
        .extension_host_manager
        .send_request(
            DEFAULT_CONNECTION_ID,
            ExtHostRequest::SetWorkspaceFolder {
                id: uuid::Uuid::new_v4().to_string(),
                path,
            },
        )
        .await
        .map(|_| ())
}

/// Activate an extension in the singleton extension host
#[tauri::command]
pub async fn activate_default_extension(
    state: State<'_, ChannelRouterState>,
    extension_path: String,
    extension_id: String,
) -> Result<serde_json::Value, String> {
    use crate::services::ExtHostRequest;

    state
        .extension_host_manager
        .send_request(
            DEFAULT_CONNECTION_ID,
            ExtHostRequest::ActivateExtension {
                id: uuid::Uuid::new_v4().to_string(),
                extension_path,
                extension_id,
            },
        )
        .await
}

/// Deactivate an extension in the singleton extension host
#[tauri::command]
pub async fn deactivate_default_extension(
    state: State<'_, ChannelRouterState>,
    extension_id: String,
) -> Result<serde_json::Value, String> {
    use crate::services::ExtHostRequest;

    state
        .extension_host_manager
        .send_request(
            DEFAULT_CONNECTION_ID,
            ExtHostRequest::DeactivateExtension {
                id: uuid::Uuid::new_v4().to_string(),
                extension_id,
            },
        )
        .await
}

/// Execute a command in the singleton extension host
#[tauri::command]
pub async fn execute_default_extension_command(
    state: State<'_, ChannelRouterState>,
    command: String,
    args: Vec<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    use crate::services::ExtHostRequest;

    state
        .extension_host_manager
        .send_request(
            DEFAULT_CONNECTION_ID,
            ExtHostRequest::ExecuteCommand {
                id: uuid::Uuid::new_v4().to_string(),
                command,
                args,
            },
        )
        .await
}

/// Get list of activated extensions from the singleton extension host
#[tauri::command]
pub async fn get_default_activated_extensions(
    state: State<'_, ChannelRouterState>,
) -> Result<serde_json::Value, String> {
    use crate::services::ExtHostRequest;

    state
        .extension_host_manager
        .send_request(
            DEFAULT_CONNECTION_ID,
            ExtHostRequest::GetActivatedExtensions {
                id: uuid::Uuid::new_v4().to_string(),
            },
        )
        .await
}

// =============================================================================
// Document Management Commands (using singleton extension host)
// =============================================================================

/// Open a document in the singleton extension host
#[tauri::command]
pub async fn open_default_document(
    state: State<'_, ChannelRouterState>,
    path: String,
) -> Result<serde_json::Value, String> {
    use crate::services::ExtHostRequest;

    state
        .extension_host_manager
        .send_request(
            DEFAULT_CONNECTION_ID,
            ExtHostRequest::OpenDocument {
                id: uuid::Uuid::new_v4().to_string(),
                path,
            },
        )
        .await
}

/// Update document content in the singleton extension host
#[tauri::command]
pub async fn update_default_document(
    state: State<'_, ChannelRouterState>,
    uri: String,
    content: String,
) -> Result<serde_json::Value, String> {
    use crate::services::ExtHostRequest;

    state
        .extension_host_manager
        .send_request(
            DEFAULT_CONNECTION_ID,
            ExtHostRequest::UpdateDocument {
                id: uuid::Uuid::new_v4().to_string(),
                uri,
                content,
            },
        )
        .await
}

/// Close a document in the singleton extension host
#[tauri::command]
pub async fn close_default_document(
    state: State<'_, ChannelRouterState>,
    uri: String,
) -> Result<serde_json::Value, String> {
    use crate::services::ExtHostRequest;

    state
        .extension_host_manager
        .send_request(
            DEFAULT_CONNECTION_ID,
            ExtHostRequest::CloseDocument {
                id: uuid::Uuid::new_v4().to_string(),
                uri,
            },
        )
        .await
}

/// Set configuration in the singleton extension host
#[tauri::command]
pub async fn set_default_configuration(
    state: State<'_, ChannelRouterState>,
    section: String,
    values: serde_json::Value,
) -> Result<serde_json::Value, String> {
    use crate::services::ExtHostRequest;

    state
        .extension_host_manager
        .send_request(
            DEFAULT_CONNECTION_ID,
            ExtHostRequest::SetConfiguration {
                id: uuid::Uuid::new_v4().to_string(),
                section,
                values,
            },
        )
        .await
}

// =============================================================================
// Language Provider Commands (using singleton extension host)
// =============================================================================

/// Request completion items from the singleton extension host
#[tauri::command]
pub async fn request_default_completion(
    state: State<'_, ChannelRouterState>,
    uri: String,
    line: u32,
    character: u32,
    trigger_character: Option<String>,
) -> Result<serde_json::Value, String> {
    use crate::services::ExtHostRequest;

    state
        .extension_host_manager
        .send_request(
            DEFAULT_CONNECTION_ID,
            ExtHostRequest::ProvideCompletion {
                id: uuid::Uuid::new_v4().to_string(),
                uri,
                line,
                character,
                trigger_character,
            },
        )
        .await
}

/// Request hover information from the singleton extension host
#[tauri::command]
pub async fn request_default_hover(
    state: State<'_, ChannelRouterState>,
    uri: String,
    line: u32,
    character: u32,
) -> Result<serde_json::Value, String> {
    use crate::services::ExtHostRequest;

    state
        .extension_host_manager
        .send_request(
            DEFAULT_CONNECTION_ID,
            ExtHostRequest::ProvideHover {
                id: uuid::Uuid::new_v4().to_string(),
                uri,
                line,
                character,
            },
        )
        .await
}

/// Request definition location from the singleton extension host
#[tauri::command]
pub async fn request_default_definition(
    state: State<'_, ChannelRouterState>,
    uri: String,
    line: u32,
    character: u32,
) -> Result<serde_json::Value, String> {
    use crate::services::ExtHostRequest;

    state
        .extension_host_manager
        .send_request(
            DEFAULT_CONNECTION_ID,
            ExtHostRequest::ProvideDefinition {
                id: uuid::Uuid::new_v4().to_string(),
                uri,
                line,
                character,
            },
        )
        .await
}

/// Request references from the singleton extension host
#[tauri::command]
pub async fn request_default_references(
    state: State<'_, ChannelRouterState>,
    uri: String,
    line: u32,
    character: u32,
    include_declaration: bool,
) -> Result<serde_json::Value, String> {
    use crate::services::ExtHostRequest;

    state
        .extension_host_manager
        .send_request(
            DEFAULT_CONNECTION_ID,
            ExtHostRequest::ProvideReferences {
                id: uuid::Uuid::new_v4().to_string(),
                uri,
                line,
                character,
                include_declaration,
            },
        )
        .await
}

/// Request document symbols from the singleton extension host
#[tauri::command]
pub async fn request_default_document_symbols(
    state: State<'_, ChannelRouterState>,
    uri: String,
) -> Result<serde_json::Value, String> {
    use crate::services::ExtHostRequest;

    state
        .extension_host_manager
        .send_request(
            DEFAULT_CONNECTION_ID,
            ExtHostRequest::ProvideDocumentSymbols {
                id: uuid::Uuid::new_v4().to_string(),
                uri,
            },
        )
        .await
}

/// Request code actions from the singleton extension host
#[tauri::command]
pub async fn request_default_code_actions(
    state: State<'_, ChannelRouterState>,
    uri: String,
    start_line: u32,
    start_character: u32,
    end_line: u32,
    end_character: u32,
    only: Option<Vec<String>>,
) -> Result<serde_json::Value, String> {
    use crate::services::ExtHostRequest;

    state
        .extension_host_manager
        .send_request(
            DEFAULT_CONNECTION_ID,
            ExtHostRequest::ProvideCodeActions {
                id: uuid::Uuid::new_v4().to_string(),
                uri,
                start_line,
                start_character,
                end_line,
                end_character,
                only,
            },
        )
        .await
}

/// Request formatting from the singleton extension host
#[tauri::command]
pub async fn request_default_formatting(
    state: State<'_, ChannelRouterState>,
    uri: String,
    tab_size: Option<u32>,
    insert_spaces: Option<bool>,
) -> Result<serde_json::Value, String> {
    use crate::services::ExtHostRequest;

    state
        .extension_host_manager
        .send_request(
            DEFAULT_CONNECTION_ID,
            ExtHostRequest::ProvideFormatting {
                id: uuid::Uuid::new_v4().to_string(),
                uri,
                tab_size,
                insert_spaces,
            },
        )
        .await
}

/// Request signature help from the singleton extension host
#[tauri::command]
pub async fn request_default_signature_help(
    state: State<'_, ChannelRouterState>,
    uri: String,
    line: u32,
    character: u32,
) -> Result<serde_json::Value, String> {
    use crate::services::ExtHostRequest;

    state
        .extension_host_manager
        .send_request(
            DEFAULT_CONNECTION_ID,
            ExtHostRequest::ProvideSignatureHelp {
                id: uuid::Uuid::new_v4().to_string(),
                uri,
                line,
                character,
            },
        )
        .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_channel_call_response_from_success() {
        let result = CallResult::Success {
            data: serde_json::json!({"test": true}),
        };
        let response: ChannelCallResponse = result.into();

        assert!(response.success);
        assert!(response.data.is_some());
        assert!(response.error.is_none());
    }

    #[test]
    fn test_channel_call_response_from_error() {
        let result = CallResult::Error {
            error: "test error".to_string(),
        };
        let response: ChannelCallResponse = result.into();

        assert!(!response.success);
        assert!(response.data.is_none());
        assert_eq!(response.error, Some("test error".to_string()));
    }
}
