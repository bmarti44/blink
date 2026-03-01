//! Extension Host Channel
//!
//! IPC channel for extension host communication.
//! Based on openvscode-server's extension host channel pattern.

use std::sync::Arc;
use async_trait::async_trait;
use serde_json::Value;

use super::channel::{ChannelContext, ServerChannel};
use super::router::CallResult;
use crate::services::extension_host_manager::{ExtHostRequest, ExtensionHostManager};

/// Extension host channel
pub struct ExtensionHostChannel {
    manager: Arc<ExtensionHostManager>,
}

impl ExtensionHostChannel {
    pub fn new(manager: Arc<ExtensionHostManager>) -> Self {
        Self { manager }
    }

    /// Helper to extract string argument
    fn get_string_arg(args: &[Value], index: usize) -> Option<String> {
        args.get(index).and_then(|v| v.as_str()).map(|s| s.to_string())
    }

    /// Helper to extract u32 argument
    fn get_u32_arg(args: &[Value], index: usize) -> Option<u32> {
        args.get(index).and_then(|v| v.as_u64()).map(|n| n as u32)
    }

    /// Helper to extract bool argument
    fn get_bool_arg(args: &[Value], index: usize, default: bool) -> bool {
        args.get(index).and_then(|v| v.as_bool()).unwrap_or(default)
    }
}

#[async_trait]
impl ServerChannel for ExtensionHostChannel {
    fn name(&self) -> &'static str {
        "extensionHost"
    }

    async fn call(&self, command: &str, args: Vec<Value>, context: &ChannelContext) -> CallResult {
        let connection_id = &context.session_id;
        let request_id = self.manager.new_request_id();

        match command {
            // ========== Extension Lifecycle ==========

            "activateExtension" => {
                let extension_path = match Self::get_string_arg(&args, 0) {
                    Some(p) => p,
                    None => return CallResult::err("Missing extension path"),
                };
                let extension_id = match Self::get_string_arg(&args, 1) {
                    Some(id) => id,
                    None => return CallResult::err("Missing extension ID"),
                };

                let result = self
                    .manager
                    .send_request(
                        connection_id,
                        ExtHostRequest::ActivateExtension {
                            id: request_id,
                            extension_path,
                            extension_id,
                        },
                    )
                    .await;

                match result {
                    Ok(data) => CallResult::ok(data),
                    Err(e) => CallResult::err(e),
                }
            }

            "deactivateExtension" => {
                let extension_id = match Self::get_string_arg(&args, 0) {
                    Some(id) => id,
                    None => return CallResult::err("Missing extension ID"),
                };

                let result = self
                    .manager
                    .send_request(
                        connection_id,
                        ExtHostRequest::DeactivateExtension {
                            id: request_id,
                            extension_id,
                        },
                    )
                    .await;

                match result {
                    Ok(data) => CallResult::ok(data),
                    Err(e) => CallResult::err(e),
                }
            }

            "getActivatedExtensions" => {
                let result = self
                    .manager
                    .send_request(
                        connection_id,
                        ExtHostRequest::GetActivatedExtensions { id: request_id },
                    )
                    .await;

                match result {
                    Ok(data) => CallResult::ok(data),
                    Err(e) => CallResult::err(e),
                }
            }

            // ========== Command Execution ==========

            "executeCommand" => {
                let cmd = match Self::get_string_arg(&args, 0) {
                    Some(c) => c,
                    None => return CallResult::err("Missing command"),
                };
                let cmd_args: Vec<Value> = args
                    .get(1)
                    .and_then(|v| v.as_array())
                    .cloned()
                    .unwrap_or_default();

                let result = self
                    .manager
                    .send_request(
                        connection_id,
                        ExtHostRequest::ExecuteCommand {
                            id: request_id,
                            command: cmd,
                            args: cmd_args,
                        },
                    )
                    .await;

                match result {
                    Ok(data) => CallResult::ok(data),
                    Err(e) => CallResult::err(e),
                }
            }

            // ========== Document Management ==========

            "openDocument" => {
                let path = match Self::get_string_arg(&args, 0) {
                    Some(p) => p,
                    None => return CallResult::err("Missing path"),
                };

                let result = self
                    .manager
                    .send_request(
                        connection_id,
                        ExtHostRequest::OpenDocument {
                            id: request_id,
                            path,
                        },
                    )
                    .await;

                match result {
                    Ok(data) => CallResult::ok(data),
                    Err(e) => CallResult::err(e),
                }
            }

            "updateDocument" => {
                let uri = match Self::get_string_arg(&args, 0) {
                    Some(u) => u,
                    None => return CallResult::err("Missing URI"),
                };
                let content = match Self::get_string_arg(&args, 1) {
                    Some(c) => c,
                    None => return CallResult::err("Missing content"),
                };

                let result = self
                    .manager
                    .send_request(
                        connection_id,
                        ExtHostRequest::UpdateDocument {
                            id: request_id,
                            uri,
                            content,
                        },
                    )
                    .await;

                match result {
                    Ok(data) => CallResult::ok(data),
                    Err(e) => CallResult::err(e),
                }
            }

            "closeDocument" => {
                let uri = match Self::get_string_arg(&args, 0) {
                    Some(u) => u,
                    None => return CallResult::err("Missing URI"),
                };

                let result = self
                    .manager
                    .send_request(
                        connection_id,
                        ExtHostRequest::CloseDocument {
                            id: request_id,
                            uri,
                        },
                    )
                    .await;

                match result {
                    Ok(data) => CallResult::ok(data),
                    Err(e) => CallResult::err(e),
                }
            }

            // ========== Language Providers ==========

            "provideCompletionItems" => {
                let uri = Self::get_string_arg(&args, 0).unwrap_or_default();
                let line = Self::get_u32_arg(&args, 1).unwrap_or(0);
                let character = Self::get_u32_arg(&args, 2).unwrap_or(0);
                let trigger_character = Self::get_string_arg(&args, 3);

                let result = self
                    .manager
                    .send_request(
                        connection_id,
                        ExtHostRequest::ProvideCompletion {
                            id: request_id,
                            uri,
                            line,
                            character,
                            trigger_character,
                        },
                    )
                    .await;

                match result {
                    Ok(data) => CallResult::ok(data),
                    Err(e) => CallResult::err(e),
                }
            }

            "provideHover" => {
                let uri = Self::get_string_arg(&args, 0).unwrap_or_default();
                let line = Self::get_u32_arg(&args, 1).unwrap_or(0);
                let character = Self::get_u32_arg(&args, 2).unwrap_or(0);

                let result = self
                    .manager
                    .send_request(
                        connection_id,
                        ExtHostRequest::ProvideHover {
                            id: request_id,
                            uri,
                            line,
                            character,
                        },
                    )
                    .await;

                match result {
                    Ok(data) => CallResult::ok(data),
                    Err(e) => CallResult::err(e),
                }
            }

            "provideDefinition" => {
                let uri = Self::get_string_arg(&args, 0).unwrap_or_default();
                let line = Self::get_u32_arg(&args, 1).unwrap_or(0);
                let character = Self::get_u32_arg(&args, 2).unwrap_or(0);

                let result = self
                    .manager
                    .send_request(
                        connection_id,
                        ExtHostRequest::ProvideDefinition {
                            id: request_id,
                            uri,
                            line,
                            character,
                        },
                    )
                    .await;

                match result {
                    Ok(data) => CallResult::ok(data),
                    Err(e) => CallResult::err(e),
                }
            }

            "provideReferences" => {
                let uri = Self::get_string_arg(&args, 0).unwrap_or_default();
                let line = Self::get_u32_arg(&args, 1).unwrap_or(0);
                let character = Self::get_u32_arg(&args, 2).unwrap_or(0);
                let include_declaration = Self::get_bool_arg(&args, 3, true);

                let result = self
                    .manager
                    .send_request(
                        connection_id,
                        ExtHostRequest::ProvideReferences {
                            id: request_id,
                            uri,
                            line,
                            character,
                            include_declaration,
                        },
                    )
                    .await;

                match result {
                    Ok(data) => CallResult::ok(data),
                    Err(e) => CallResult::err(e),
                }
            }

            "provideDocumentSymbols" => {
                let uri = Self::get_string_arg(&args, 0).unwrap_or_default();

                let result = self
                    .manager
                    .send_request(
                        connection_id,
                        ExtHostRequest::ProvideDocumentSymbols {
                            id: request_id,
                            uri,
                        },
                    )
                    .await;

                match result {
                    Ok(data) => CallResult::ok(data),
                    Err(e) => CallResult::err(e),
                }
            }

            "provideCodeActions" => {
                let uri = Self::get_string_arg(&args, 0).unwrap_or_default();
                let start_line = Self::get_u32_arg(&args, 1).unwrap_or(0);
                let start_character = Self::get_u32_arg(&args, 2).unwrap_or(0);
                let end_line = Self::get_u32_arg(&args, 3).unwrap_or(0);
                let end_character = Self::get_u32_arg(&args, 4).unwrap_or(0);
                let only: Option<Vec<String>> = args.get(5).and_then(|v| {
                    v.as_array().map(|arr| {
                        arr.iter()
                            .filter_map(|v| v.as_str().map(|s| s.to_string()))
                            .collect()
                    })
                });

                let result = self
                    .manager
                    .send_request(
                        connection_id,
                        ExtHostRequest::ProvideCodeActions {
                            id: request_id,
                            uri,
                            start_line,
                            start_character,
                            end_line,
                            end_character,
                            only,
                        },
                    )
                    .await;

                match result {
                    Ok(data) => CallResult::ok(data),
                    Err(e) => CallResult::err(e),
                }
            }

            "provideFormatting" => {
                let uri = Self::get_string_arg(&args, 0).unwrap_or_default();
                let tab_size = Self::get_u32_arg(&args, 1);
                let insert_spaces = args.get(2).and_then(|v| v.as_bool());

                let result = self
                    .manager
                    .send_request(
                        connection_id,
                        ExtHostRequest::ProvideFormatting {
                            id: request_id,
                            uri,
                            tab_size,
                            insert_spaces,
                        },
                    )
                    .await;

                match result {
                    Ok(data) => CallResult::ok(data),
                    Err(e) => CallResult::err(e),
                }
            }

            "provideSignatureHelp" => {
                let uri = Self::get_string_arg(&args, 0).unwrap_or_default();
                let line = Self::get_u32_arg(&args, 1).unwrap_or(0);
                let character = Self::get_u32_arg(&args, 2).unwrap_or(0);

                let result = self
                    .manager
                    .send_request(
                        connection_id,
                        ExtHostRequest::ProvideSignatureHelp {
                            id: request_id,
                            uri,
                            line,
                            character,
                        },
                    )
                    .await;

                match result {
                    Ok(data) => CallResult::ok(data),
                    Err(e) => CallResult::err(e),
                }
            }

            // ========== Configuration ==========

            "setConfiguration" => {
                let section = match Self::get_string_arg(&args, 0) {
                    Some(s) => s,
                    None => return CallResult::err("Missing section"),
                };
                let values = args.get(1).cloned().unwrap_or(Value::Object(Default::default()));

                let result = self
                    .manager
                    .send_request(
                        connection_id,
                        ExtHostRequest::SetConfiguration {
                            id: request_id,
                            section,
                            values,
                        },
                    )
                    .await;

                match result {
                    Ok(data) => CallResult::ok(data),
                    Err(e) => CallResult::err(e),
                }
            }

            // ========== Workspace ==========

            "setWorkspaceFolder" => {
                let path = match Self::get_string_arg(&args, 0) {
                    Some(p) => p,
                    None => return CallResult::err("Missing path"),
                };

                let result = self
                    .manager
                    .send_request(
                        connection_id,
                        ExtHostRequest::SetWorkspaceFolder {
                            id: request_id,
                            path,
                        },
                    )
                    .await;

                match result {
                    Ok(data) => CallResult::ok(data),
                    Err(e) => CallResult::err(e),
                }
            }

            // ========== Status ==========

            "ping" => {
                let result = self
                    .manager
                    .send_request(connection_id, ExtHostRequest::Ping { id: request_id })
                    .await;

                match result {
                    Ok(data) => CallResult::ok(data),
                    Err(e) => CallResult::err(e),
                }
            }

            "isReady" => {
                let ready = self.manager.is_ready(connection_id);
                CallResult::ok(ready)
            }

            "getState" => {
                let state = self.manager.get_state(connection_id);
                CallResult::ok(format!("{:?}", state))
            }

            _ => CallResult::err(format!("Unknown command: {}", command)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::sync::mpsc;
    use crate::services::extension_host_manager::ExtHostEvent;

    #[test]
    fn test_get_string_arg() {
        let args = vec![
            serde_json::json!("hello"),
            serde_json::json!(42),
            serde_json::json!(true),
        ];

        assert_eq!(
            ExtensionHostChannel::get_string_arg(&args, 0),
            Some("hello".to_string())
        );
        assert_eq!(ExtensionHostChannel::get_string_arg(&args, 1), None);
        assert_eq!(ExtensionHostChannel::get_string_arg(&args, 5), None);
    }

    #[test]
    fn test_get_u32_arg() {
        let args = vec![
            serde_json::json!("hello"),
            serde_json::json!(42),
            serde_json::json!(true),
        ];

        assert_eq!(ExtensionHostChannel::get_u32_arg(&args, 0), None);
        assert_eq!(ExtensionHostChannel::get_u32_arg(&args, 1), Some(42));
        assert_eq!(ExtensionHostChannel::get_u32_arg(&args, 5), None);
    }

    #[tokio::test]
    async fn test_channel_name() {
        let (tx, _rx) = mpsc::channel::<ExtHostEvent>(32);
        let manager = Arc::new(ExtensionHostManager::new("/test/sidecar.js".to_string(), tx));
        let channel = ExtensionHostChannel::new(manager);

        assert_eq!(channel.name(), "extensionHost");
    }
}
