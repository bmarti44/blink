//! Extension Host Error Types
//!
//! This module provides strongly-typed error handling for extension host operations.
//! Uses the `thiserror` crate for derive-based error implementations.

use thiserror::Error;

/// Errors that can occur during extension host operations
#[derive(Error, Debug)]
pub enum ExtensionHostError {
    /// Extension host process is not running
    #[error("Extension host not running")]
    NotRunning,

    /// The specified connection was not found
    #[error("Connection not found: {0}")]
    ConnectionNotFound(String),

    /// Failed to spawn the extension host process
    #[error("Failed to spawn extension host process: {0}")]
    SpawnFailed(#[from] std::io::Error),

    /// Extension host failed to become ready within the timeout
    #[error("Extension host '{connection_id}' failed to become ready within {timeout_secs} seconds")]
    ReadyTimeout {
        connection_id: String,
        timeout_secs: u64,
    },

    /// The ready signal was cancelled (channel dropped)
    #[error("Extension host '{0}' ready signal cancelled")]
    ReadyCancelled(String),

    /// Error during IPC communication with the sidecar
    #[error("IPC error: {0}")]
    IpcError(String),

    /// Request to extension host timed out
    #[error("Request timed out after {0} seconds")]
    RequestTimeout(u64),

    /// Request was cancelled (channel dropped)
    #[error("Request cancelled")]
    RequestCancelled,

    /// Failed to send message to extension host
    #[error("Failed to send message: {0}")]
    SendFailed(String),

    /// Extension activation failed
    #[error("Extension activation failed for '{extension_id}': {message}")]
    ActivationFailed {
        extension_id: String,
        message: String,
    },

    /// Extension deactivation failed
    #[error("Extension deactivation failed for '{extension_id}': {message}")]
    DeactivationFailed {
        extension_id: String,
        message: String,
    },

    /// Command execution failed
    #[error("Command '{command}' failed: {message}")]
    CommandFailed { command: String, message: String },

    /// Invalid response from extension host
    #[error("Invalid response from extension host: {0}")]
    InvalidResponse(String),

    /// Extension host crashed
    #[error("Extension host '{0}' crashed")]
    Crashed(String),

    /// Maximum restart attempts exceeded
    #[error("Extension host '{connection_id}' crashed {restart_count} times, giving up")]
    MaxRestartsExceeded {
        connection_id: String,
        restart_count: u32,
    },

    /// JSON serialization/deserialization error
    #[error("JSON error: {0}")]
    JsonError(#[from] serde_json::Error),

    /// Generic error with message
    #[error("{0}")]
    Other(String),
}

impl ExtensionHostError {
    /// Create a new IPC error
    pub fn ipc(message: impl Into<String>) -> Self {
        Self::IpcError(message.into())
    }

    /// Create a new send failed error
    pub fn send_failed(message: impl Into<String>) -> Self {
        Self::SendFailed(message.into())
    }

    /// Create an activation failed error
    pub fn activation_failed(extension_id: impl Into<String>, message: impl Into<String>) -> Self {
        Self::ActivationFailed {
            extension_id: extension_id.into(),
            message: message.into(),
        }
    }

    /// Create a deactivation failed error
    pub fn deactivation_failed(
        extension_id: impl Into<String>,
        message: impl Into<String>,
    ) -> Self {
        Self::DeactivationFailed {
            extension_id: extension_id.into(),
            message: message.into(),
        }
    }

    /// Create a command failed error
    pub fn command_failed(command: impl Into<String>, message: impl Into<String>) -> Self {
        Self::CommandFailed {
            command: command.into(),
            message: message.into(),
        }
    }
}

/// Convert ExtensionHostError to String for Tauri command compatibility
impl From<ExtensionHostError> for String {
    fn from(e: ExtensionHostError) -> String {
        e.to_string()
    }
}

/// Result type alias for extension host operations
pub type ExtensionHostResult<T> = Result<T, ExtensionHostError>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_error_display() {
        let err = ExtensionHostError::NotRunning;
        assert_eq!(err.to_string(), "Extension host not running");

        let err = ExtensionHostError::ConnectionNotFound("conn-123".to_string());
        assert_eq!(err.to_string(), "Connection not found: conn-123");

        let err = ExtensionHostError::ReadyTimeout {
            connection_id: "conn-123".to_string(),
            timeout_secs: 10,
        };
        assert_eq!(
            err.to_string(),
            "Extension host 'conn-123' failed to become ready within 10 seconds"
        );

        let err = ExtensionHostError::ActivationFailed {
            extension_id: "ext.test".to_string(),
            message: "module not found".to_string(),
        };
        assert_eq!(
            err.to_string(),
            "Extension activation failed for 'ext.test': module not found"
        );
    }

    #[test]
    fn test_error_to_string_conversion() {
        let err = ExtensionHostError::NotRunning;
        let s: String = err.into();
        assert_eq!(s, "Extension host not running");
    }

    #[test]
    fn test_error_constructors() {
        let err = ExtensionHostError::ipc("connection lost");
        assert!(matches!(err, ExtensionHostError::IpcError(_)));

        let err = ExtensionHostError::activation_failed("ext.test", "failed");
        assert!(matches!(err, ExtensionHostError::ActivationFailed { .. }));
    }
}
