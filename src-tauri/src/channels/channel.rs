//! Base Channel Trait
//!
//! Defines the interface that all IPC channels must implement.
//! Based on openvscode-server's IServerChannel pattern.

use async_trait::async_trait;
use serde_json::Value;

use super::router::CallResult;

/// Context for channel operations
pub struct ChannelContext {
    /// Unique session ID for this connection
    pub session_id: String,
    /// Remote authority (e.g., "localhost:8080")
    pub remote_authority: Option<String>,
    /// Workspace folder URI
    pub workspace_folder: Option<String>,
}

impl ChannelContext {
    pub fn new(session_id: String) -> Self {
        Self {
            session_id,
            remote_authority: None,
            workspace_folder: None,
        }
    }

    pub fn with_workspace(mut self, workspace: String) -> Self {
        self.workspace_folder = Some(workspace);
        self
    }

    pub fn with_authority(mut self, authority: String) -> Self {
        self.remote_authority = Some(authority);
        self
    }
}

impl Default for ChannelContext {
    fn default() -> Self {
        Self::new(uuid::Uuid::new_v4().to_string())
    }
}

/// Server channel trait
///
/// All IPC channels must implement this trait to handle commands and events.
#[async_trait]
pub trait ServerChannel: Send + Sync {
    /// Get the channel name (e.g., "extensionHost", "terminal", "files")
    fn name(&self) -> &'static str;

    /// Handle a command call
    ///
    /// # Arguments
    /// * `command` - The command name to execute
    /// * `args` - Arguments passed to the command
    /// * `context` - The connection context
    ///
    /// # Returns
    /// Result of the command execution
    async fn call(
        &self,
        command: &str,
        args: Vec<Value>,
        context: &ChannelContext,
    ) -> CallResult;

    /// Handle event subscription
    ///
    /// Called when a client subscribes to an event from this channel.
    fn listen(&self, _event: &str, _context: &ChannelContext) {
        // Default: no-op
    }

    /// Handle event unsubscription
    fn unlisten(&self, _event: &str, _context: &ChannelContext) {
        // Default: no-op
    }

    /// Dispose of the channel (cleanup resources)
    fn dispose(&self) {
        // Default: no-op
    }
}

/// Utility macro for implementing channel commands
#[macro_export]
macro_rules! channel_commands {
    ($self:ident, $command:ident, $args:ident, $context:ident, {
        $($name:literal => $handler:expr),* $(,)?
    }) => {
        match $command {
            $($name => $handler,)*
            _ => $crate::channels::router::CallResult::err(format!("Unknown command: {}", $command))
        }
    };
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TestChannel;

    #[async_trait]
    impl ServerChannel for TestChannel {
        fn name(&self) -> &'static str {
            "test"
        }

        async fn call(
            &self,
            command: &str,
            _args: Vec<Value>,
            _context: &ChannelContext,
        ) -> CallResult {
            match command {
                "ping" => CallResult::ok("pong"),
                _ => CallResult::err(format!("Unknown command: {}", command)),
            }
        }
    }

    #[tokio::test]
    async fn test_channel_call() {
        let channel = TestChannel;
        let context = ChannelContext::default();

        let result = channel.call("ping", vec![], &context).await;
        match result {
            CallResult::Success { data } => {
                assert_eq!(data, serde_json::json!("pong"));
            }
            CallResult::Error { .. } => panic!("Expected success"),
        }
    }

    #[tokio::test]
    async fn test_unknown_command() {
        let channel = TestChannel;
        let context = ChannelContext::default();

        let result = channel.call("unknown", vec![], &context).await;
        match result {
            CallResult::Error { error } => {
                assert!(error.contains("Unknown command"));
            }
            CallResult::Success { .. } => panic!("Expected error"),
        }
    }
}
