//! Channel Router
//!
//! Routes IPC messages between the frontend and various backend services.
//! Based on openvscode-server's channel routing pattern.

use std::collections::HashMap;
use std::sync::Arc;
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;

use super::channel::{ChannelContext, ServerChannel};

/// Request ID type (unique per request)
pub type RequestId = u64;

/// IPC message types
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ChannelMessage {
    /// Request a command execution
    Call {
        id: RequestId,
        channel: String,
        command: String,
        #[serde(default)]
        args: Vec<serde_json::Value>,
    },

    /// Subscribe to events from a channel
    Listen {
        id: RequestId,
        channel: String,
        event: String,
    },

    /// Response to a call
    Response {
        id: RequestId,
        #[serde(flatten)]
        result: CallResult,
    },

    /// Event emission from server to client
    Event {
        channel: String,
        event: String,
        data: serde_json::Value,
    },

    /// Cancel a pending request
    Cancel { id: RequestId },

    /// Unsubscribe from events
    Unlisten { id: RequestId },
}

/// Result of a call
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum CallResult {
    Success { data: serde_json::Value },
    Error { error: String },
}

impl CallResult {
    pub fn ok<T: Serialize>(data: T) -> Self {
        CallResult::Success {
            data: serde_json::to_value(data).unwrap_or(serde_json::Value::Null),
        }
    }

    pub fn err(message: impl Into<String>) -> Self {
        CallResult::Error {
            error: message.into(),
        }
    }

    pub fn is_success(&self) -> bool {
        matches!(self, CallResult::Success { .. })
    }

    pub fn is_error(&self) -> bool {
        matches!(self, CallResult::Error { .. })
    }

    pub fn into_result(self) -> Result<serde_json::Value, String> {
        match self {
            CallResult::Success { data } => Ok(data),
            CallResult::Error { error } => Err(error),
        }
    }
}

/// Event subscription
struct EventSubscription {
    #[allow(dead_code)]
    event: String,
    sender: mpsc::Sender<serde_json::Value>,
}

/// The channel router
pub struct ChannelRouter {
    /// Registered channels by name
    channels: RwLock<HashMap<String, Arc<dyn ServerChannel>>>,

    /// Event subscriptions by channel
    subscriptions: RwLock<HashMap<String, Vec<EventSubscription>>>,

    /// Next request ID
    next_request_id: RwLock<RequestId>,

    /// Sender for outgoing events
    event_tx: mpsc::Sender<ChannelMessage>,
}

impl ChannelRouter {
    /// Create a new channel router
    pub fn new(event_tx: mpsc::Sender<ChannelMessage>) -> Self {
        Self {
            channels: RwLock::new(HashMap::new()),
            subscriptions: RwLock::new(HashMap::new()),
            next_request_id: RwLock::new(1),
            event_tx,
        }
    }

    /// Register a channel
    pub fn register_channel(&self, channel: Arc<dyn ServerChannel>) {
        let name = channel.name().to_string();
        self.channels.write().insert(name, channel);
    }

    /// Unregister a channel
    pub fn unregister_channel(&self, name: &str) {
        self.channels.write().remove(name);
    }

    /// Get a registered channel
    pub fn get_channel(&self, name: &str) -> Option<Arc<dyn ServerChannel>> {
        self.channels.read().get(name).cloned()
    }

    /// Check if a channel is registered
    pub fn has_channel(&self, name: &str) -> bool {
        self.channels.read().contains_key(name)
    }

    /// Get all channel names
    pub fn channel_names(&self) -> Vec<String> {
        self.channels.read().keys().cloned().collect()
    }

    /// Route an incoming message
    pub async fn route(
        &self,
        message: ChannelMessage,
        context: &ChannelContext,
    ) -> Option<ChannelMessage> {
        match message {
            ChannelMessage::Call {
                id,
                channel,
                command,
                args,
            } => {
                let channel_handler = self.channels.read().get(&channel).cloned();

                let result = match channel_handler {
                    Some(handler) => handler.call(&command, args, context).await,
                    None => CallResult::err(format!("Channel not found: {}", channel)),
                };

                Some(ChannelMessage::Response { id, result })
            }

            ChannelMessage::Listen { id, channel, event } => {
                // Create subscription
                let (tx, _rx) = mpsc::channel(32);

                {
                    let mut subs = self.subscriptions.write();
                    subs.entry(channel.clone())
                        .or_default()
                        .push(EventSubscription {
                            event: event.clone(),
                            sender: tx,
                        });
                }

                // Notify channel of new listener
                if let Some(handler) = self.channels.read().get(&channel) {
                    handler.listen(&event, context);
                }

                // Return acknowledgment
                Some(ChannelMessage::Response {
                    id,
                    result: CallResult::ok(true),
                })
            }

            ChannelMessage::Cancel { id: _ } => {
                // Cancel handling would go here
                None
            }

            ChannelMessage::Unlisten { id: _ } => {
                // Unlisten handling would go here
                None
            }

            // These are outgoing messages, not handled in routing
            ChannelMessage::Response { .. } | ChannelMessage::Event { .. } => None,
        }
    }

    /// Emit an event to all subscribers
    pub async fn emit_event(&self, channel: &str, event: &str, data: serde_json::Value) {
        let message = ChannelMessage::Event {
            channel: channel.to_string(),
            event: event.to_string(),
            data,
        };

        let _ = self.event_tx.send(message).await;
    }

    /// Generate a unique request ID
    pub fn next_request_id(&self) -> RequestId {
        let mut id = self.next_request_id.write();
        let current = *id;
        *id += 1;
        current
    }

    /// Dispose all channels
    pub fn dispose(&self) {
        for channel in self.channels.read().values() {
            channel.dispose();
        }
        self.channels.write().clear();
        self.subscriptions.write().clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use async_trait::async_trait;

    struct EchoChannel;

    #[async_trait]
    impl ServerChannel for EchoChannel {
        fn name(&self) -> &'static str {
            "echo"
        }

        async fn call(
            &self,
            command: &str,
            args: Vec<serde_json::Value>,
            _context: &ChannelContext,
        ) -> CallResult {
            match command {
                "echo" => {
                    let msg = args
                        .first()
                        .and_then(|v| v.as_str())
                        .unwrap_or("no message");
                    CallResult::ok(msg)
                }
                "add" => {
                    let a = args.first().and_then(|v| v.as_i64()).unwrap_or(0);
                    let b = args.get(1).and_then(|v| v.as_i64()).unwrap_or(0);
                    CallResult::ok(a + b)
                }
                _ => CallResult::err(format!("Unknown command: {}", command)),
            }
        }
    }

    #[tokio::test]
    async fn test_channel_registration() {
        let (tx, _rx) = mpsc::channel(32);
        let router = ChannelRouter::new(tx);

        assert!(!router.has_channel("echo"));

        router.register_channel(Arc::new(EchoChannel));

        assert!(router.has_channel("echo"));
        assert!(router.get_channel("echo").is_some());
    }

    #[tokio::test]
    async fn test_route_call() {
        let (tx, _rx) = mpsc::channel(32);
        let router = ChannelRouter::new(tx);
        router.register_channel(Arc::new(EchoChannel));

        let context = ChannelContext::default();
        let message = ChannelMessage::Call {
            id: 1,
            channel: "echo".to_string(),
            command: "echo".to_string(),
            args: vec![serde_json::json!("hello")],
        };

        let response = router.route(message, &context).await;
        assert!(response.is_some());

        if let Some(ChannelMessage::Response { id, result }) = response {
            assert_eq!(id, 1);
            assert!(result.is_success());
            if let CallResult::Success { data } = result {
                assert_eq!(data, serde_json::json!("hello"));
            }
        } else {
            panic!("Expected Response message");
        }
    }

    #[tokio::test]
    async fn test_route_unknown_channel() {
        let (tx, _rx) = mpsc::channel(32);
        let router = ChannelRouter::new(tx);

        let context = ChannelContext::default();
        let message = ChannelMessage::Call {
            id: 1,
            channel: "unknown".to_string(),
            command: "test".to_string(),
            args: vec![],
        };

        let response = router.route(message, &context).await;
        if let Some(ChannelMessage::Response { result, .. }) = response {
            assert!(result.is_error());
        } else {
            panic!("Expected Response message");
        }
    }

    #[test]
    fn test_call_result() {
        let success = CallResult::ok(42);
        assert!(success.is_success());
        assert!(!success.is_error());

        let error = CallResult::err("failed");
        assert!(error.is_error());
        assert!(!error.is_success());
    }
}
