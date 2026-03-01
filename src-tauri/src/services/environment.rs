//! Environment Service
//!
//! Provides centralized access to all application paths and environment configuration.
//! Based on openvscode-server's serverEnvironmentService.ts.
//!
//! Key paths:
//! - User data: ~/Library/Application Support/blink/user-data (macOS)
//! - Extensions: ~/Library/Application Support/blink/extensions
//! - Logs: ~/Library/Application Support/blink/logs

use std::any::Any;
use std::path::PathBuf;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri::Manager;

use super::registry::Service;

/// Telemetry level configuration
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum TelemetryLevel {
    #[default]
    Off,
    Crash,
    Error,
    All,
}

/// Complete environment configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvironmentConfig {
    /// Application name
    pub app_name: String,
    /// Application version
    pub app_version: String,
    /// User data directory (settings, state, etc.)
    pub user_data_dir: PathBuf,
    /// User extensions directory
    pub extensions_dir: PathBuf,
    /// Built-in extensions directory
    pub builtin_extensions_dir: PathBuf,
    /// Logs directory
    pub logs_dir: PathBuf,
    /// Machine settings file path
    pub machine_settings_path: PathBuf,
    /// User settings file path
    pub user_settings_path: PathBuf,
    /// Keybindings file path
    pub keybindings_path: PathBuf,
    /// Snippets directory
    pub snippets_dir: PathBuf,
    /// Connection token for server auth (None = no auth)
    pub connection_token: Option<String>,
    /// Telemetry level
    pub telemetry_level: TelemetryLevel,
    /// Default workspace folder URI
    pub default_folder_uri: Option<String>,
    /// Is running in development mode
    pub is_development: bool,
}

/// Environment service implementation
pub struct EnvironmentService {
    config: EnvironmentConfig,
}

impl Service for EnvironmentService {
    fn as_any(&self) -> &dyn Any {
        self
    }

    fn service_id(&self) -> &'static str {
        "IEnvironmentService"
    }
}

impl EnvironmentService {
    /// Create environment service from Tauri app handle
    pub fn new(app: &AppHandle) -> Result<Self, String> {
        let app_data_dir = app
            .path()
            .app_data_dir()
            .map_err(|e| format!("Failed to get app data dir: {}", e))?;

        let resource_dir = app
            .path()
            .resource_dir()
            .map_err(|e| format!("Failed to get resource dir: {}", e))?;

        // Create all required directories
        let user_data_dir = app_data_dir.join("user-data");
        let extensions_dir = app_data_dir.join("extensions").join("installed");
        let builtin_extensions_dir = resource_dir.join("extensions").join("builtin");
        let logs_dir = app_data_dir.join("logs");

        // User subdirectories
        let user_dir = user_data_dir.join("User");
        let machine_dir = user_data_dir.join("Machine");

        // Create directories
        for dir in [
            &user_data_dir,
            &extensions_dir,
            &logs_dir,
            &user_dir,
            &machine_dir,
        ] {
            std::fs::create_dir_all(dir)
                .map_err(|e| format!("Failed to create {}: {}", dir.display(), e))?;
        }

        // Get app info from package info
        let package_info = app.package_info();

        let config = EnvironmentConfig {
            app_name: package_info.name.clone(),
            app_version: package_info.version.to_string(),
            user_data_dir: user_data_dir.clone(),
            extensions_dir,
            builtin_extensions_dir,
            logs_dir,
            machine_settings_path: machine_dir.join("settings.json"),
            user_settings_path: user_dir.join("settings.json"),
            keybindings_path: user_dir.join("keybindings.json"),
            snippets_dir: user_dir.join("snippets"),
            connection_token: None,
            telemetry_level: TelemetryLevel::Off,
            default_folder_uri: None,
            is_development: cfg!(debug_assertions),
        };

        Ok(Self { config })
    }

    /// Create with custom configuration (for testing)
    pub fn with_config(config: EnvironmentConfig) -> Self {
        Self { config }
    }

    // ===== Getters =====

    pub fn config(&self) -> &EnvironmentConfig {
        &self.config
    }

    pub fn user_data_dir(&self) -> &PathBuf {
        &self.config.user_data_dir
    }

    pub fn extensions_dir(&self) -> &PathBuf {
        &self.config.extensions_dir
    }

    pub fn builtin_extensions_dir(&self) -> &PathBuf {
        &self.config.builtin_extensions_dir
    }

    pub fn logs_dir(&self) -> &PathBuf {
        &self.config.logs_dir
    }

    pub fn user_settings_path(&self) -> &PathBuf {
        &self.config.user_settings_path
    }

    pub fn machine_settings_path(&self) -> &PathBuf {
        &self.config.machine_settings_path
    }

    pub fn keybindings_path(&self) -> &PathBuf {
        &self.config.keybindings_path
    }

    pub fn snippets_dir(&self) -> &PathBuf {
        &self.config.snippets_dir
    }

    pub fn is_development(&self) -> bool {
        self.config.is_development
    }

    pub fn connection_token(&self) -> Option<&str> {
        self.config.connection_token.as_deref()
    }

    pub fn app_name(&self) -> &str {
        &self.config.app_name
    }

    pub fn app_version(&self) -> &str {
        &self.config.app_version
    }

    // ===== Setters =====

    pub fn set_connection_token(&mut self, token: Option<String>) {
        self.config.connection_token = token;
    }

    pub fn set_default_folder(&mut self, folder_uri: Option<String>) {
        self.config.default_folder_uri = folder_uri;
    }

    // ===== Utility Methods =====

    /// Get path for a specific extension's data
    pub fn extension_data_dir(&self, extension_id: &str) -> PathBuf {
        self.config
            .user_data_dir
            .join("extensions-data")
            .join(extension_id)
    }

    /// Get log file path for a specific channel
    pub fn log_file_path(&self, channel: &str) -> PathBuf {
        let date = chrono::Local::now().format("%Y-%m-%d");
        self.config
            .logs_dir
            .join(format!("{}_{}.log", channel, date))
    }

    /// Get all extension directories to scan
    pub fn all_extension_dirs(&self) -> Vec<PathBuf> {
        vec![
            self.config.builtin_extensions_dir.clone(),
            self.config.extensions_dir.clone(),
        ]
    }

    /// Resolve a path relative to user data directory
    pub fn resolve_user_path(&self, relative: &str) -> PathBuf {
        self.config.user_data_dir.join(relative)
    }

    /// Get the extension host sidecar path
    pub fn extension_host_sidecar_path(&self) -> PathBuf {
        if self.config.is_development {
            // Development path
            PathBuf::from("binaries").join("extension-host-sidecar.js")
        } else {
            // Production path (in resources)
            self.config
                .user_data_dir
                .parent()
                .unwrap_or(&self.config.user_data_dir)
                .join("binaries")
                .join("extension-host-sidecar.js")
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    fn test_config() -> EnvironmentConfig {
        EnvironmentConfig {
            app_name: "test-app".to_string(),
            app_version: "1.0.0".to_string(),
            user_data_dir: PathBuf::from("/tmp/test-user-data"),
            extensions_dir: PathBuf::from("/tmp/test-extensions"),
            builtin_extensions_dir: PathBuf::from("/tmp/test-builtin"),
            logs_dir: PathBuf::from("/tmp/test-logs"),
            machine_settings_path: PathBuf::from("/tmp/test-user-data/Machine/settings.json"),
            user_settings_path: PathBuf::from("/tmp/test-user-data/User/settings.json"),
            keybindings_path: PathBuf::from("/tmp/test-user-data/User/keybindings.json"),
            snippets_dir: PathBuf::from("/tmp/test-user-data/User/snippets"),
            connection_token: None,
            telemetry_level: TelemetryLevel::Off,
            default_folder_uri: None,
            is_development: true,
        }
    }

    #[test]
    fn test_extension_data_dir() {
        let service = EnvironmentService::with_config(test_config());
        let dir = service.extension_data_dir("publisher.extension");
        assert_eq!(
            dir,
            Path::new("/tmp/test-user-data/extensions-data/publisher.extension")
        );
    }

    #[test]
    fn test_all_extension_dirs() {
        let service = EnvironmentService::with_config(test_config());
        let dirs = service.all_extension_dirs();
        assert_eq!(dirs.len(), 2);
    }

    #[test]
    fn test_resolve_user_path() {
        let service = EnvironmentService::with_config(test_config());
        let path = service.resolve_user_path("workspaces/test");
        assert_eq!(path, Path::new("/tmp/test-user-data/workspaces/test"));
    }
}
