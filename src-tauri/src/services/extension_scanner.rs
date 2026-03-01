//! Extension Scanner Service
//!
//! Scans directories for VS Code extensions and parses their manifests.
//! Based on openvscode-server's remoteExtensionsScanner.ts.

use std::any::Any;
use std::collections::HashMap;
use std::path::PathBuf;
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};

use super::registry::Service;

/// Activation events supported by extensions
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum ActivationEvent {
    /// Activate on startup (*)
    OnStartup,
    /// Activate when startup is finished
    OnStartupFinished,
    /// Activate when a specific language file is opened
    OnLanguage(String),
    /// Activate when a specific command is executed
    OnCommand(String),
    /// Activate when debugging starts
    OnDebug(String),
    /// Activate when a custom file scheme is accessed
    OnFileSystem(String),
    /// Activate when a specific view is opened
    OnView(String),
    /// Activate when a custom URI scheme is opened
    OnUri,
    /// Activate when workspace contains specific files
    WorkspaceContains(String),
    /// Activate when a custom editor is opened
    OnCustomEditor(String),
    /// Activate for authentication provider
    OnAuthenticationRequest(String),
    /// Activate for notebook type
    OnNotebook(String),
    /// Activate for task type
    OnTaskType(String),
    /// Activate when terminal profile is created
    OnTerminalProfile(String),
    /// Activate when walkthrough step is completed
    OnWalkthrough,
}

impl ActivationEvent {
    /// Parse an activation event string into an ActivationEvent
    pub fn parse(s: &str) -> Option<Self> {
        if s == "*" {
            return Some(Self::OnStartup);
        }
        if s == "onUri" {
            return Some(Self::OnUri);
        }
        if s == "onStartupFinished" {
            return Some(Self::OnStartupFinished);
        }
        if s == "onWalkthrough" {
            return Some(Self::OnWalkthrough);
        }

        // Parse "prefix:value" format
        let parts: Vec<&str> = s.splitn(2, ':').collect();
        if parts.len() != 2 {
            return None;
        }

        let (prefix, value) = (parts[0], parts[1].to_string());

        match prefix {
            "onLanguage" => Some(Self::OnLanguage(value)),
            "onCommand" => Some(Self::OnCommand(value)),
            "onDebug" | "onDebugResolve" | "onDebugDynamicConfigurations"
            | "onDebugInitialConfigurations" => Some(Self::OnDebug(value)),
            "onFileSystem" => Some(Self::OnFileSystem(value)),
            "onView" => Some(Self::OnView(value)),
            "workspaceContains" => Some(Self::WorkspaceContains(value)),
            "onCustomEditor" => Some(Self::OnCustomEditor(value)),
            "onAuthenticationRequest" => Some(Self::OnAuthenticationRequest(value)),
            "onNotebook" => Some(Self::OnNotebook(value)),
            "onTaskType" => Some(Self::OnTaskType(value)),
            "onTerminalProfile" => Some(Self::OnTerminalProfile(value)),
            _ => None,
        }
    }
}

/// Extension manifest (package.json)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionManifest {
    pub name: String,
    pub publisher: String,
    pub version: String,
    #[serde(default)]
    pub display_name: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub categories: Vec<String>,
    #[serde(default)]
    pub keywords: Vec<String>,
    #[serde(default)]
    pub activation_events: Option<Vec<String>>,
    #[serde(default)]
    pub main: Option<String>,
    #[serde(default)]
    pub browser: Option<String>,
    #[serde(default)]
    pub contributes: Option<serde_json::Value>,
    #[serde(default)]
    pub engines: HashMap<String, String>,
    #[serde(default)]
    pub extension_dependencies: Option<Vec<String>>,
    #[serde(default)]
    pub extension_pack: Option<Vec<String>>,
    #[serde(default)]
    pub capabilities: Option<ExtensionCapabilities>,
}

/// Extension capabilities
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionCapabilities {
    #[serde(default)]
    pub untrusted_workspaces: Option<UntrustedWorkspacesCapability>,
    #[serde(default)]
    pub virtual_workspaces: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UntrustedWorkspacesCapability {
    pub supported: bool,
    #[serde(default)]
    pub restricted_configurations: Option<Vec<String>>,
}

/// A scanned extension with its manifest and metadata
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScannedExtension {
    /// Full extension ID (publisher.name)
    pub id: String,
    /// Path to extension directory
    pub path: String,
    /// Parsed manifest
    pub manifest: ExtensionManifest,
    /// Whether this is a builtin extension
    pub is_builtin: bool,
    /// Whether this is under development (symlinked)
    pub is_under_development: bool,
}

impl ScannedExtension {
    /// Get the main entry point for Node.js extensions
    pub fn main_path(&self) -> Option<PathBuf> {
        self.manifest
            .main
            .as_ref()
            .map(|main| PathBuf::from(&self.path).join(main))
    }

    /// Get the browser entry point
    pub fn browser_path(&self) -> Option<PathBuf> {
        self.manifest
            .browser
            .as_ref()
            .map(|browser| PathBuf::from(&self.path).join(browser))
    }

    /// Check if extension runs in Node.js
    pub fn is_node(&self) -> bool {
        self.manifest.main.is_some()
    }

    /// Check if extension runs in browser
    pub fn is_browser(&self) -> bool {
        self.manifest.browser.is_some()
    }

    /// Get display name or fall back to name
    pub fn display_name(&self) -> &str {
        self.manifest
            .display_name
            .as_deref()
            .unwrap_or(&self.manifest.name)
    }

    /// Parse activation events
    pub fn activation_events(&self) -> Vec<ActivationEvent> {
        self.manifest
            .activation_events
            .as_ref()
            .map(|events| events.iter().filter_map(|e| ActivationEvent::parse(e)).collect())
            .unwrap_or_default()
    }
}

/// Extension scanner service
pub struct ExtensionScannerService {
    /// Builtin extensions directory
    builtin_dir: PathBuf,
    /// User extensions directory
    user_dir: PathBuf,
    /// Development extensions directory (optional)
    dev_dir: Option<PathBuf>,
    /// Cached scan results
    cache: RwLock<Option<Vec<ScannedExtension>>>,
    /// Activation event index: event -> extension IDs
    activation_index: RwLock<HashMap<String, Vec<String>>>,
}

impl Service for ExtensionScannerService {
    fn as_any(&self) -> &dyn Any {
        self
    }

    fn service_id(&self) -> &'static str {
        "IExtensionsScannerService"
    }
}

impl ExtensionScannerService {
    /// Create a new extension scanner
    pub fn new(builtin_dir: PathBuf, user_dir: PathBuf, dev_dir: Option<PathBuf>) -> Self {
        Self {
            builtin_dir,
            user_dir,
            dev_dir,
            cache: RwLock::new(None),
            activation_index: RwLock::new(HashMap::new()),
        }
    }

    /// Scan all extension directories and return all found extensions
    pub fn scan_all(&self) -> Vec<ScannedExtension> {
        // Check cache first
        if let Some(cached) = self.cache.read().as_ref() {
            return cached.clone();
        }

        let mut all_extensions = Vec::new();

        // Scan builtin extensions
        if self.builtin_dir.exists() {
            let builtin = self.scan_directory(&self.builtin_dir, true, false);
            all_extensions.extend(builtin);
        }

        // Scan user extensions
        if self.user_dir.exists() {
            let user = self.scan_directory(&self.user_dir, false, false);
            all_extensions.extend(user);
        }

        // Scan development extensions
        if let Some(ref dev_dir) = self.dev_dir {
            if dev_dir.exists() {
                let dev = self.scan_directory(dev_dir, false, true);
                all_extensions.extend(dev);
            }
        }

        // Deduplicate (user/dev override builtin)
        let deduped = self.deduplicate_extensions(all_extensions);

        // Build activation index
        self.build_activation_index(&deduped);

        // Cache results
        *self.cache.write() = Some(deduped.clone());

        deduped
    }

    /// Scan a single directory for extensions
    fn scan_directory(
        &self,
        dir: &PathBuf,
        is_builtin: bool,
        is_dev: bool,
    ) -> Vec<ScannedExtension> {
        let mut extensions = Vec::new();

        let entries = match std::fs::read_dir(dir) {
            Ok(e) => e,
            Err(e) => {
                eprintln!(
                    "[ExtensionScanner] Failed to read {}: {}",
                    dir.display(),
                    e
                );
                return extensions;
            }
        };

        for entry in entries.flatten() {
            let path = entry.path();

            // Skip non-directories
            if !path.is_dir() {
                continue;
            }

            // Look for package.json
            let manifest_path = path.join("package.json");
            if !manifest_path.exists() {
                continue;
            }

            // Read and parse manifest
            let manifest_content = match std::fs::read_to_string(&manifest_path) {
                Ok(c) => c,
                Err(e) => {
                    eprintln!(
                        "[ExtensionScanner] Failed to read {}: {}",
                        manifest_path.display(),
                        e
                    );
                    continue;
                }
            };

            let manifest: ExtensionManifest = match serde_json::from_str(&manifest_content) {
                Ok(m) => m,
                Err(e) => {
                    eprintln!(
                        "[ExtensionScanner] Failed to parse {}: {}",
                        manifest_path.display(),
                        e
                    );
                    continue;
                }
            };

            // Build extension ID
            let id = format!("{}.{}", manifest.publisher, manifest.name);

            extensions.push(ScannedExtension {
                id,
                path: path.to_string_lossy().to_string(),
                manifest,
                is_builtin,
                is_under_development: is_dev,
            });
        }

        extensions
    }

    /// Remove duplicates, preferring user/dev over builtin
    fn deduplicate_extensions(&self, extensions: Vec<ScannedExtension>) -> Vec<ScannedExtension> {
        let mut seen: HashMap<String, usize> = HashMap::new();
        let mut result = Vec::new();

        for ext in extensions {
            if let Some(&idx) = seen.get(&ext.id) {
                // Replace if this is a user extension overriding builtin
                if !ext.is_builtin || ext.is_under_development {
                    result[idx] = ext;
                }
            } else {
                seen.insert(ext.id.clone(), result.len());
                result.push(ext);
            }
        }

        result
    }

    /// Build activation event index
    fn build_activation_index(&self, extensions: &[ScannedExtension]) {
        let mut index: HashMap<String, Vec<String>> = HashMap::new();

        for ext in extensions {
            if let Some(events) = &ext.manifest.activation_events {
                for event in events {
                    index.entry(event.clone()).or_default().push(ext.id.clone());
                }
            }
        }

        *self.activation_index.write() = index;
    }

    /// Get extensions that should activate for a given event string
    pub fn get_extensions_for_event(&self, event: &str) -> Vec<String> {
        let index = self.activation_index.read();

        // Check for exact match
        if let Some(ids) = index.get(event) {
            return ids.clone();
        }

        // Check for * (activate on startup)
        if let Some(ids) = index.get("*") {
            return ids.clone();
        }

        Vec::new()
    }

    /// Get extensions that activate on a specific language
    pub fn get_extensions_for_language(&self, language_id: &str) -> Vec<String> {
        self.get_extensions_for_event(&format!("onLanguage:{}", language_id))
    }

    /// Get extensions that activate on a specific command
    pub fn get_extensions_for_command(&self, command: &str) -> Vec<String> {
        self.get_extensions_for_event(&format!("onCommand:{}", command))
    }

    /// Get a specific extension by ID
    pub fn get_extension(&self, id: &str) -> Option<ScannedExtension> {
        self.scan_all().into_iter().find(|e| e.id == id)
    }

    /// Invalidate cache (call after installing/uninstalling extensions)
    pub fn invalidate_cache(&self) {
        *self.cache.write() = None;
        self.activation_index.write().clear();
    }

    /// Get all extension IDs
    pub fn get_all_extension_ids(&self) -> Vec<String> {
        self.scan_all().into_iter().map(|e| e.id).collect()
    }

    /// Get extensions that have a main entry point (Node.js)
    pub fn get_node_extensions(&self) -> Vec<ScannedExtension> {
        self.scan_all().into_iter().filter(|e| e.is_node()).collect()
    }

    /// Get extensions that have a browser entry point
    pub fn get_browser_extensions(&self) -> Vec<ScannedExtension> {
        self.scan_all()
            .into_iter()
            .filter(|e| e.is_browser())
            .collect()
    }

    /// Get builtin extensions only
    pub fn get_builtin_extensions(&self) -> Vec<ScannedExtension> {
        self.scan_all()
            .into_iter()
            .filter(|e| e.is_builtin)
            .collect()
    }

    /// Get user-installed extensions only
    pub fn get_user_extensions(&self) -> Vec<ScannedExtension> {
        self.scan_all()
            .into_iter()
            .filter(|e| !e.is_builtin)
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_activation_event_parse() {
        assert_eq!(ActivationEvent::parse("*"), Some(ActivationEvent::OnStartup));
        assert_eq!(
            ActivationEvent::parse("onStartupFinished"),
            Some(ActivationEvent::OnStartupFinished)
        );
        assert_eq!(ActivationEvent::parse("onUri"), Some(ActivationEvent::OnUri));

        assert_eq!(
            ActivationEvent::parse("onLanguage:python"),
            Some(ActivationEvent::OnLanguage("python".to_string()))
        );
        assert_eq!(
            ActivationEvent::parse("onCommand:extension.test"),
            Some(ActivationEvent::OnCommand("extension.test".to_string()))
        );
        assert_eq!(
            ActivationEvent::parse("workspaceContains:**/*.py"),
            Some(ActivationEvent::WorkspaceContains("**/*.py".to_string()))
        );

        assert_eq!(ActivationEvent::parse("invalid"), None);
        assert_eq!(ActivationEvent::parse("unknownPrefix:value"), None);
    }

    #[test]
    fn test_scanned_extension() {
        let manifest = ExtensionManifest {
            name: "test".to_string(),
            publisher: "test-publisher".to_string(),
            version: "1.0.0".to_string(),
            display_name: Some("Test Extension".to_string()),
            description: None,
            categories: vec![],
            keywords: vec![],
            activation_events: Some(vec!["onLanguage:python".to_string()]),
            main: Some("./out/extension.js".to_string()),
            browser: None,
            contributes: None,
            engines: HashMap::new(),
            extension_dependencies: None,
            extension_pack: None,
            capabilities: None,
        };

        let ext = ScannedExtension {
            id: "test-publisher.test".to_string(),
            path: "/extensions/test".to_string(),
            manifest,
            is_builtin: false,
            is_under_development: false,
        };

        assert!(ext.is_node());
        assert!(!ext.is_browser());
        assert_eq!(ext.display_name(), "Test Extension");

        let events = ext.activation_events();
        assert_eq!(events.len(), 1);
        assert_eq!(
            events[0],
            ActivationEvent::OnLanguage("python".to_string())
        );
    }
}
