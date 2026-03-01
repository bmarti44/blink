//! Extension Host Manager
//!
//! Manages Node.js extension host processes that run VS Code extensions.
//! Based on openvscode-server's extensionHostConnection.ts.

use std::any::Any;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, Command, Stdio};
use std::sync::Arc;
use std::thread;
use parking_lot::{Mutex, RwLock};
use serde::{Deserialize, Serialize};
use tokio::sync::{mpsc, oneshot};

use super::registry::Service;

/// Extension host process state
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExtHostState {
    /// Process is starting
    Starting,
    /// Process is ready to receive requests
    Ready,
    /// Process exited normally
    Terminated,
    /// Process crashed
    Crashed,
}

/// Events emitted by extension host processes
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ExtHostEvent {
    /// Extension host is ready
    Ready { connection_id: String },
    /// Extension host exited
    Exit {
        connection_id: String,
        code: Option<i32>,
    },
    /// Notification from extension
    Notification { level: String, message: String },
    /// Output from extension
    Output { channel: String, text: String },
    /// Diagnostics published
    Diagnostics {
        uri: String,
        diagnostics: serde_json::Value,
    },
    /// Provider registered
    ProviderRegistered {
        kind: String,
        id: String,
        selector: serde_json::Value,
    },
    /// Command registered
    CommandRegistered { command: String },
}

/// Message sent to extension host
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ExtHostRequest {
    /// Ping to check if alive
    Ping { id: String },
    /// Set workspace folder
    SetWorkspaceFolder { id: String, path: String },
    /// Activate extension
    ActivateExtension {
        id: String,
        #[serde(rename = "extensionPath")]
        extension_path: String,
        #[serde(rename = "extensionId")]
        extension_id: String,
    },
    /// Deactivate extension
    DeactivateExtension {
        id: String,
        #[serde(rename = "extensionId")]
        extension_id: String,
    },
    /// Execute command
    ExecuteCommand {
        id: String,
        command: String,
        args: Vec<serde_json::Value>,
    },
    /// Get activated extensions
    GetActivatedExtensions { id: String },
    /// Open document
    OpenDocument { id: String, path: String },
    /// Update document content
    UpdateDocument {
        id: String,
        uri: String,
        content: String,
    },
    /// Close document
    CloseDocument { id: String, uri: String },
    /// Request completions
    ProvideCompletion {
        id: String,
        uri: String,
        line: u32,
        character: u32,
        #[serde(skip_serializing_if = "Option::is_none")]
        trigger_character: Option<String>,
    },
    /// Request hover
    ProvideHover {
        id: String,
        uri: String,
        line: u32,
        character: u32,
    },
    /// Request definition
    ProvideDefinition {
        id: String,
        uri: String,
        line: u32,
        character: u32,
    },
    /// Request references
    ProvideReferences {
        id: String,
        uri: String,
        line: u32,
        character: u32,
        include_declaration: bool,
    },
    /// Request document symbols
    ProvideDocumentSymbols { id: String, uri: String },
    /// Request code actions
    ProvideCodeActions {
        id: String,
        uri: String,
        start_line: u32,
        start_character: u32,
        end_line: u32,
        end_character: u32,
        #[serde(skip_serializing_if = "Option::is_none")]
        only: Option<Vec<String>>,
    },
    /// Request formatting
    ProvideFormatting {
        id: String,
        uri: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        tab_size: Option<u32>,
        #[serde(skip_serializing_if = "Option::is_none")]
        insert_spaces: Option<bool>,
    },
    /// Request signature help
    ProvideSignatureHelp {
        id: String,
        uri: String,
        line: u32,
        character: u32,
    },
    /// Set configuration
    SetConfiguration {
        id: String,
        section: String,
        values: serde_json::Value,
    },
}

impl ExtHostRequest {
    /// Get the request ID
    pub fn id(&self) -> &str {
        match self {
            Self::Ping { id } => id,
            Self::SetWorkspaceFolder { id, .. } => id,
            Self::ActivateExtension { id, .. } => id,
            Self::DeactivateExtension { id, .. } => id,
            Self::ExecuteCommand { id, .. } => id,
            Self::GetActivatedExtensions { id } => id,
            Self::OpenDocument { id, .. } => id,
            Self::UpdateDocument { id, .. } => id,
            Self::CloseDocument { id, .. } => id,
            Self::ProvideCompletion { id, .. } => id,
            Self::ProvideHover { id, .. } => id,
            Self::ProvideDefinition { id, .. } => id,
            Self::ProvideReferences { id, .. } => id,
            Self::ProvideDocumentSymbols { id, .. } => id,
            Self::ProvideCodeActions { id, .. } => id,
            Self::ProvideFormatting { id, .. } => id,
            Self::ProvideSignatureHelp { id, .. } => id,
            Self::SetConfiguration { id, .. } => id,
        }
    }
}

/// Response from extension host
#[derive(Debug, Clone, Deserialize)]
pub struct ExtHostResponse {
    pub id: Option<String>,
    #[serde(rename = "type")]
    pub msg_type: String,
    #[serde(flatten)]
    pub data: serde_json::Value,
}

/// A single extension host connection
struct ExtHostConnection {
    /// Unique connection ID
    id: String,
    /// Current state
    state: ExtHostState,
    /// Child process handle
    process: Option<Child>,
    /// Stdin for sending messages
    stdin: Option<std::process::ChildStdin>,
    /// Pending requests awaiting response
    pending: HashMap<String, oneshot::Sender<serde_json::Value>>,
    /// Ready signal sender (consumed when ready message is received)
    ready_signal: Option<oneshot::Sender<()>>,
}

impl ExtHostConnection {
    fn new(id: String, ready_signal: oneshot::Sender<()>) -> Self {
        Self {
            id,
            state: ExtHostState::Starting,
            process: None,
            stdin: None,
            pending: HashMap::new(),
            ready_signal: Some(ready_signal),
        }
    }
}

/// Extension host manager
pub struct ExtensionHostManager {
    /// All connections by ID
    connections: RwLock<HashMap<String, Arc<Mutex<ExtHostConnection>>>>,
    /// Path to sidecar script
    sidecar_path: RwLock<String>,
    /// Event sender
    event_tx: mpsc::Sender<ExtHostEvent>,
    /// Default workspace folder
    default_workspace: RwLock<Option<String>>,
}

impl Service for ExtensionHostManager {
    fn as_any(&self) -> &dyn Any {
        self
    }

    fn service_id(&self) -> &'static str {
        "IExtensionHostManager"
    }
}

impl ExtensionHostManager {
    /// Create a new extension host manager
    pub fn new(sidecar_path: String, event_tx: mpsc::Sender<ExtHostEvent>) -> Self {
        Self {
            connections: RwLock::new(HashMap::new()),
            sidecar_path: RwLock::new(sidecar_path),
            event_tx,
            default_workspace: RwLock::new(None),
        }
    }

    /// Set the sidecar path
    pub fn set_sidecar_path(&self, path: String) {
        *self.sidecar_path.write() = path;
    }

    /// Set default workspace folder for new extension hosts
    pub fn set_default_workspace(&self, path: Option<String>) {
        *self.default_workspace.write() = path;
    }

    /// Spawn a new extension host process
    ///
    /// This method blocks until the sidecar sends a "ready" message, ensuring
    /// the extension host is fully initialized before returning.
    pub async fn spawn(&self, connection_id: String) -> Result<(), String> {
        eprintln!("[EXTHOST:{}] Spawning process", connection_id);

        // Create oneshot channel for ready signal
        let (ready_tx, ready_rx) = oneshot::channel::<()>();

        // Create connection entry with ready signal
        let connection = Arc::new(Mutex::new(ExtHostConnection::new(connection_id.clone(), ready_tx)));
        self.connections
            .write()
            .insert(connection_id.clone(), connection.clone());

        let sidecar_path = self.sidecar_path.read().clone();

        // Spawn Node.js process
        let mut child = Command::new("node")
            .arg(&sidecar_path)
            .arg("--type=extensionHost")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .map_err(|e| format!("Failed to spawn extension host: {}", e))?;

        let stdin = child.stdin.take().ok_or("Failed to get stdin")?;
        let stdout = child.stdout.take().ok_or("Failed to get stdout")?;

        // Store process handles
        {
            let mut conn = connection.lock();
            conn.process = Some(child);
            conn.stdin = Some(stdin);
        }

        // Spawn reader thread
        let event_tx = self.event_tx.clone();
        let conn_id = connection_id.clone();
        let conn_clone = connection.clone();

        thread::spawn(move || {
            let reader = BufReader::new(stdout);

            for line in reader.lines() {
                match line {
                    Ok(line) => {
                        // Parse JSON response
                        if let Ok(response) = serde_json::from_str::<ExtHostResponse>(&line) {
                            // Check if this is a response to a pending request
                            if let Some(id) = &response.id {
                                let sender = conn_clone.lock().pending.remove(id);
                                if let Some(tx) = sender {
                                    let _ = tx.send(response.data.clone());
                                    continue;
                                }
                            }

                            // Otherwise, emit as event
                            match response.msg_type.as_str() {
                                "ready" => {
                                    eprintln!("[EXTHOST:{}] Reader received: ready", conn_id);
                                    let mut conn = conn_clone.lock();
                                    conn.state = ExtHostState::Ready;
                                    // Send ready signal to unblock spawn()
                                    if let Some(tx) = conn.ready_signal.take() {
                                        eprintln!("[EXTHOST:{}] Ready signal sent", conn_id);
                                        let _ = tx.send(());
                                    }
                                    drop(conn); // Release lock before blocking send
                                    let _ = event_tx.blocking_send(ExtHostEvent::Ready {
                                        connection_id: conn_id.clone(),
                                    });
                                }
                                "notification" => {
                                    let level = response
                                        .data
                                        .get("level")
                                        .and_then(|v| v.as_str())
                                        .unwrap_or("info")
                                        .to_string();
                                    let message = response
                                        .data
                                        .get("message")
                                        .and_then(|v| v.as_str())
                                        .unwrap_or("")
                                        .to_string();
                                    let _ = event_tx.blocking_send(ExtHostEvent::Notification {
                                        level,
                                        message,
                                    });
                                }
                                "output" => {
                                    let channel = response
                                        .data
                                        .get("channel")
                                        .and_then(|v| v.as_str())
                                        .unwrap_or("")
                                        .to_string();
                                    let text = response
                                        .data
                                        .get("text")
                                        .and_then(|v| v.as_str())
                                        .unwrap_or("")
                                        .to_string();
                                    let _ = event_tx
                                        .blocking_send(ExtHostEvent::Output { channel, text });
                                }
                                "diagnostics" => {
                                    let uri = response
                                        .data
                                        .get("uri")
                                        .and_then(|v| v.as_str())
                                        .unwrap_or("")
                                        .to_string();
                                    let diagnostics = response
                                        .data
                                        .get("diagnostics")
                                        .cloned()
                                        .unwrap_or(serde_json::Value::Array(vec![]));
                                    let _ = event_tx.blocking_send(ExtHostEvent::Diagnostics {
                                        uri,
                                        diagnostics,
                                    });
                                }
                                "registerProvider" => {
                                    let kind = response
                                        .data
                                        .get("kind")
                                        .and_then(|v| v.as_str())
                                        .unwrap_or("")
                                        .to_string();
                                    let id = response
                                        .data
                                        .get("id")
                                        .and_then(|v| v.as_str())
                                        .unwrap_or("")
                                        .to_string();
                                    let selector =
                                        response.data.get("selector").cloned().unwrap_or_default();
                                    let _ =
                                        event_tx.blocking_send(ExtHostEvent::ProviderRegistered {
                                            kind,
                                            id,
                                            selector,
                                        });
                                }
                                "registerCommand" => {
                                    let command = response
                                        .data
                                        .get("command")
                                        .and_then(|v| v.as_str())
                                        .unwrap_or("")
                                        .to_string();
                                    let _ = event_tx
                                        .blocking_send(ExtHostEvent::CommandRegistered { command });
                                }
                                _ => {}
                            }
                        }
                    }
                    Err(_) => break,
                }
            }

            // Process exited
            let mut conn = conn_clone.lock();
            let code = conn
                .process
                .as_mut()
                .and_then(|p| p.wait().ok().and_then(|s| s.code()));
            conn.state = if code == Some(0) {
                ExtHostState::Terminated
            } else {
                ExtHostState::Crashed
            };

            let _ = event_tx.blocking_send(ExtHostEvent::Exit {
                connection_id: conn_id,
                code,
            });
        });

        // Wait for ready signal with timeout (10 seconds)
        eprintln!("[EXTHOST:{}] Waiting for ready signal...", connection_id);
        tokio::time::timeout(std::time::Duration::from_secs(10), ready_rx)
            .await
            .map_err(|_| format!("Extension host '{}' failed to become ready within 10 seconds", connection_id))?
            .map_err(|_| format!("Extension host '{}' ready signal cancelled", connection_id))?;

        eprintln!("[EXTHOST:{}] spawn() complete - sidecar is ready", connection_id);

        // Set workspace folder if configured
        // Clone the workspace outside the async block to avoid holding the lock across await
        let workspace = self.default_workspace.read().clone();
        if let Some(workspace_path) = workspace {
            self.send_request(
                &connection_id,
                ExtHostRequest::SetWorkspaceFolder {
                    id: uuid::Uuid::new_v4().to_string(),
                    path: workspace_path,
                },
            )
            .await?;
        }

        Ok(())
    }

    /// Send a message to an extension host (no response expected)
    pub async fn send_message(
        &self,
        connection_id: &str,
        request: ExtHostRequest,
    ) -> Result<(), String> {
        let connection = self
            .connections
            .read()
            .get(connection_id)
            .cloned()
            .ok_or("Connection not found")?;

        let mut conn = connection.lock();
        let stdin = conn.stdin.as_mut().ok_or("No stdin")?;

        let json = serde_json::to_string(&request)
            .map_err(|e| format!("Failed to serialize: {}", e))?;

        writeln!(stdin, "{}", json).map_err(|e| format!("Failed to write: {}", e))?;

        stdin.flush().map_err(|e| format!("Failed to flush: {}", e))?;

        Ok(())
    }

    /// Send a request and wait for response
    pub async fn send_request(
        &self,
        connection_id: &str,
        request: ExtHostRequest,
    ) -> Result<serde_json::Value, String> {
        let request_id = request.id().to_string();

        // Create oneshot channel for response
        let (tx, rx) = oneshot::channel();

        // Register pending request
        {
            let connection = self
                .connections
                .read()
                .get(connection_id)
                .cloned()
                .ok_or("Connection not found")?;
            connection.lock().pending.insert(request_id.clone(), tx);
        }

        // Send the request
        self.send_message(connection_id, request).await?;

        // Wait for response with timeout
        tokio::time::timeout(std::time::Duration::from_secs(30), rx)
            .await
            .map_err(|_| "Request timed out")?
            .map_err(|_| "Request cancelled".to_string())
    }

    /// Terminate an extension host
    pub async fn terminate(&self, connection_id: &str) -> Result<(), String> {
        let connection = self.connections.write().remove(connection_id);

        if let Some(conn) = connection {
            let mut conn = conn.lock();
            if let Some(mut process) = conn.process.take() {
                let _ = process.kill();
                let _ = process.wait();
            }
        }

        Ok(())
    }

    /// Terminate all extension hosts
    pub async fn terminate_all(&self) {
        let ids: Vec<String> = self.connections.read().keys().cloned().collect();
        for id in ids {
            let _ = self.terminate(&id).await;
        }
    }

    /// Get connection state
    pub fn get_state(&self, connection_id: &str) -> Option<ExtHostState> {
        self.connections
            .read()
            .get(connection_id)
            .map(|c| c.lock().state)
    }

    /// Check if connection is ready
    pub fn is_ready(&self, connection_id: &str) -> bool {
        self.get_state(connection_id) == Some(ExtHostState::Ready)
    }

    /// Get all connection IDs
    pub fn get_connections(&self) -> Vec<String> {
        self.connections.read().keys().cloned().collect()
    }

    /// Generate a new request ID
    pub fn new_request_id(&self) -> String {
        uuid::Uuid::new_v4().to_string()
    }

    /// Get the number of active connections
    pub fn connection_count(&self) -> usize {
        self.connections.read().len()
    }

    /// Subscribe to extension host events
    /// Returns a receiver that will receive events for all connections
    ///
    /// Note: This is a placeholder for future event subscription support.
    /// Currently events are forwarded to Tauri via the event_tx channel.
    pub fn subscribe_events(&self) -> mpsc::Receiver<ExtHostEvent> {
        // Create a new channel for the subscriber
        let (_tx, rx) = mpsc::channel::<ExtHostEvent>(32);
        // Note: In a full implementation, we would track subscribers and
        // forward events to all of them. For now, events go through
        // the channel router's event forwarding.
        rx
    }

    /// Spawn extension host with automatic restart on crash
    ///
    /// This supervisor will automatically restart the extension host if it crashes,
    /// up to a maximum number of restarts.
    pub async fn spawn_with_supervision(
        &self,
        connection_id: String,
        max_restarts: u32,
    ) -> Result<(), String> {
        let mut restart_count = 0u32;
        let mut last_restart = std::time::Instant::now();

        loop {
            // Reset restart count if it's been more than 60 seconds since last restart
            // This prevents counting old crashes against the limit
            if last_restart.elapsed() > std::time::Duration::from_secs(60) {
                restart_count = 0;
            }

            match self.spawn(connection_id.clone()).await {
                Ok(()) => {
                    eprintln!(
                        "[EXTHOST:{}] Supervisor: started successfully (restarts: {}/{})",
                        connection_id, restart_count, max_restarts
                    );

                    // Wait for exit by polling state
                    loop {
                        tokio::time::sleep(std::time::Duration::from_millis(500)).await;

                        match self.get_state(&connection_id) {
                            Some(ExtHostState::Ready) | Some(ExtHostState::Starting) => {
                                // Still running, continue waiting
                                continue;
                            }
                            Some(ExtHostState::Terminated) => {
                                // Normal exit, don't restart
                                eprintln!(
                                    "[EXTHOST:{}] Supervisor: terminated normally",
                                    connection_id
                                );
                                return Ok(());
                            }
                            Some(ExtHostState::Crashed) => {
                                // Crashed, attempt restart
                                eprintln!(
                                    "[EXTHOST:{}] Supervisor: crashed, will attempt restart",
                                    connection_id
                                );
                                break;
                            }
                            None => {
                                // Connection was removed (terminated externally)
                                eprintln!(
                                    "[EXTHOST:{}] Supervisor: connection removed",
                                    connection_id
                                );
                                return Ok(());
                            }
                        }
                    }

                    // Handle crash
                    restart_count += 1;
                    last_restart = std::time::Instant::now();

                    if restart_count > max_restarts {
                        let msg = format!(
                            "Extension host '{}' crashed {} times, giving up",
                            connection_id, restart_count
                        );
                        eprintln!("[EXTHOST:{}] Supervisor: {}", connection_id, msg);
                        return Err(msg);
                    }

                    eprintln!(
                        "[EXTHOST:{}] Supervisor: restarting ({}/{})",
                        connection_id, restart_count, max_restarts
                    );

                    // Brief delay before restart
                    tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                }
                Err(e) => {
                    let msg = format!("Failed to spawn extension host: {}", e);
                    eprintln!("[EXTHOST:{}] Supervisor: {}", connection_id, msg);
                    return Err(msg);
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ext_host_request_id() {
        let request = ExtHostRequest::Ping {
            id: "test-id".to_string(),
        };
        assert_eq!(request.id(), "test-id");

        let request = ExtHostRequest::ActivateExtension {
            id: "activate-id".to_string(),
            extension_path: "/path".to_string(),
            extension_id: "ext.id".to_string(),
        };
        assert_eq!(request.id(), "activate-id");
    }

    #[tokio::test]
    async fn test_manager_creation() {
        let (tx, _rx) = mpsc::channel(32);
        let manager = ExtensionHostManager::new("/path/to/sidecar.js".to_string(), tx);

        assert_eq!(manager.connection_count(), 0);
        assert!(manager.get_connections().is_empty());
    }

    #[tokio::test]
    async fn test_set_workspace() {
        let (tx, _rx) = mpsc::channel(32);
        let manager = ExtensionHostManager::new("/path/to/sidecar.js".to_string(), tx);

        manager.set_default_workspace(Some("/workspace".to_string()));

        let workspace = manager.default_workspace.read().clone();
        assert_eq!(workspace, Some("/workspace".to_string()));
    }
}
