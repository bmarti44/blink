//! Extension management commands
//!
//! Handles installation, uninstallation, and management of VS Code extensions.
//! VSIX files are ZIP archives that contain extension code and metadata.
//!
//! Based on openvscode-server architecture patterns for extension scanning and management.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};
use zip::ZipArchive;

// ============================================================================
// Extension Manifest (package.json) - Full structure from VS Code
// ============================================================================

/// Extension manifest (package.json) structure
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionManifest {
    pub name: String,
    pub version: String,
    pub publisher: String,
    #[serde(default)]
    pub display_name: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub categories: Option<Vec<String>>,
    #[serde(default)]
    pub main: Option<String>,
    #[serde(default)]
    pub browser: Option<String>,
    #[serde(default)]
    pub activation_events: Option<Vec<String>>,
    #[serde(default)]
    pub contributes: Option<ExtensionContributions>,
    #[serde(default)]
    pub engines: Option<ExtensionEngines>,
    #[serde(default)]
    pub dependencies: Option<HashMap<String, String>>,
    #[serde(default)]
    pub dev_dependencies: Option<HashMap<String, String>>,
    #[serde(default)]
    pub extension_kind: Option<Vec<String>>,
    #[serde(default)]
    pub extension_pack: Option<Vec<String>>,
    #[serde(default)]
    pub extension_dependencies: Option<Vec<String>>,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub repository: Option<serde_json::Value>,
    #[serde(default)]
    pub keywords: Option<Vec<String>>,
}

/// Engine requirements (e.g., vscode version)
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ExtensionEngines {
    #[serde(default)]
    pub vscode: Option<String>,
    #[serde(default)]
    pub node: Option<String>,
}

/// Extension contribution points - what the extension contributes to VS Code
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionContributions {
    #[serde(default)]
    pub commands: Option<Vec<ContributedCommand>>,
    #[serde(default)]
    pub languages: Option<Vec<ContributedLanguage>>,
    #[serde(default)]
    pub grammars: Option<Vec<ContributedGrammar>>,
    #[serde(default)]
    pub themes: Option<Vec<ContributedTheme>>,
    #[serde(default)]
    pub icon_themes: Option<Vec<ContributedIconTheme>>,
    #[serde(default)]
    pub snippets: Option<Vec<ContributedSnippet>>,
    #[serde(default)]
    pub keybindings: Option<Vec<ContributedKeybinding>>,
    #[serde(default)]
    pub menus: Option<HashMap<String, Vec<ContributedMenuItem>>>,
    #[serde(default)]
    pub submenus: Option<Vec<ContributedSubmenu>>,
    #[serde(default)]
    pub views: Option<HashMap<String, Vec<ContributedView>>>,
    #[serde(default)]
    pub view_containers: Option<ContributedViewContainers>,
    #[serde(default)]
    pub configuration: Option<serde_json::Value>,
    #[serde(default)]
    pub configuration_defaults: Option<HashMap<String, serde_json::Value>>,
    #[serde(default)]
    pub task_definitions: Option<Vec<ContributedTaskDefinition>>,
    #[serde(default)]
    pub problem_matchers: Option<Vec<serde_json::Value>>,
    #[serde(default)]
    pub problem_patterns: Option<Vec<serde_json::Value>>,
    #[serde(default)]
    pub debuggers: Option<Vec<ContributedDebugger>>,
    #[serde(default)]
    pub breakpoints: Option<Vec<ContributedBreakpoint>>,
    #[serde(default)]
    pub custom_editors: Option<Vec<ContributedCustomEditor>>,
    #[serde(default)]
    pub notebooks: Option<Vec<serde_json::Value>>,
    #[serde(default)]
    pub terminal: Option<serde_json::Value>,
    #[serde(default)]
    pub walkthroughs: Option<Vec<serde_json::Value>>,
    // Catch any unknown contributions as raw JSON
    #[serde(flatten)]
    pub other: Option<HashMap<String, serde_json::Value>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContributedCommand {
    pub command: String,
    pub title: String,
    #[serde(default)]
    pub category: Option<String>,
    #[serde(default)]
    pub icon: Option<serde_json::Value>,
    #[serde(default)]
    pub enablement: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContributedLanguage {
    pub id: String,
    #[serde(default)]
    pub aliases: Option<Vec<String>>,
    #[serde(default)]
    pub extensions: Option<Vec<String>>,
    #[serde(default)]
    pub filenames: Option<Vec<String>>,
    #[serde(default)]
    pub filenamePatterns: Option<Vec<String>>,
    #[serde(default)]
    pub first_line: Option<String>,
    #[serde(default)]
    pub configuration: Option<String>,
    #[serde(default)]
    pub mimetypes: Option<Vec<String>>,
    #[serde(default)]
    pub icon: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContributedGrammar {
    pub language: Option<String>,
    pub scope_name: String,
    pub path: String,
    #[serde(default)]
    pub embedded_languages: Option<HashMap<String, String>>,
    #[serde(default)]
    pub token_types: Option<HashMap<String, String>>,
    #[serde(default)]
    pub injections: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContributedTheme {
    pub label: String,
    pub path: String,
    #[serde(default)]
    pub ui_theme: Option<String>,
    #[serde(default)]
    pub id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContributedIconTheme {
    pub id: String,
    pub label: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContributedSnippet {
    #[serde(default)]
    pub language: Option<String>,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContributedKeybinding {
    #[serde(default)]
    pub command: Option<String>,
    #[serde(default)]
    pub key: Option<String>,
    #[serde(default)]
    pub mac: Option<String>,
    #[serde(default)]
    pub linux: Option<String>,
    #[serde(default)]
    pub win: Option<String>,
    #[serde(default)]
    pub when: Option<String>,
    #[serde(default)]
    pub args: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContributedMenuItem {
    #[serde(default)]
    pub command: Option<String>,
    #[serde(default)]
    pub submenu: Option<String>,
    #[serde(default)]
    pub when: Option<String>,
    #[serde(default)]
    pub group: Option<String>,
    #[serde(default)]
    pub alt: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContributedSubmenu {
    pub id: String,
    pub label: String,
    #[serde(default)]
    pub icon: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContributedView {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub when: Option<String>,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub contextual_title: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContributedViewContainers {
    #[serde(default)]
    pub activitybar: Option<Vec<ContributedViewContainer>>,
    #[serde(default)]
    pub panel: Option<Vec<ContributedViewContainer>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContributedViewContainer {
    pub id: String,
    pub title: String,
    pub icon: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContributedTaskDefinition {
    #[serde(rename = "type")]
    pub task_type: String,
    #[serde(default)]
    pub required: Option<Vec<String>>,
    #[serde(default)]
    pub properties: Option<HashMap<String, serde_json::Value>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContributedDebugger {
    #[serde(rename = "type")]
    pub debug_type: String,
    pub label: String,
    #[serde(default)]
    pub program: Option<String>,
    #[serde(default)]
    pub runtime: Option<String>,
    #[serde(default)]
    pub languages: Option<Vec<String>>,
    #[serde(default)]
    pub configuration_attributes: Option<serde_json::Value>,
    #[serde(default)]
    pub initial_configurations: Option<Vec<serde_json::Value>>,
    #[serde(default)]
    pub configuration_snippets: Option<Vec<serde_json::Value>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContributedBreakpoint {
    pub language: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContributedCustomEditor {
    pub view_type: String,
    pub display_name: String,
    pub selector: Vec<CustomEditorSelector>,
    #[serde(default)]
    pub priority: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomEditorSelector {
    pub filename_pattern: String,
}

// ============================================================================
// Extension Scanning and Discovery
// ============================================================================

/// Represents a scanned extension with its location and manifest
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScannedExtension {
    pub id: String,
    pub path: String,
    pub manifest: ExtensionManifest,
    pub is_builtin: bool,
    pub is_under_development: bool,
}

/// Extension location types (following openvscode-server pattern)
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExtensionLocationType {
    Builtin,
    Installed,
    Development,
}

/// Scan a directory for extensions
fn scan_extension_directory(dir: &PathBuf, location_type: ExtensionLocationType) -> Vec<ScannedExtension> {
    let mut extensions = Vec::new();

    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return extensions,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        // Skip hidden and temp directories
        let dir_name = path.file_name().unwrap_or_default().to_string_lossy();
        if dir_name.starts_with('.') || dir_name.starts_with('_') {
            continue;
        }

        let manifest_path = path.join("package.json");
        if !manifest_path.exists() {
            continue;
        }

        let manifest_content = match fs::read_to_string(&manifest_path) {
            Ok(c) => c,
            Err(_) => continue,
        };

        let manifest: ExtensionManifest = match serde_json::from_str(&manifest_content) {
            Ok(m) => m,
            Err(e) => {
                eprintln!("[Extensions] Failed to parse manifest at {:?}: {}", manifest_path, e);
                continue;
            }
        };

        let extension_id = format!("{}.{}", manifest.publisher, manifest.name);

        extensions.push(ScannedExtension {
            id: extension_id,
            path: path.to_string_lossy().to_string(),
            manifest,
            is_builtin: location_type == ExtensionLocationType::Builtin,
            is_under_development: location_type == ExtensionLocationType::Development,
        });
    }

    extensions
}

/// Scan all extension locations and return all found extensions
#[tauri::command]
pub async fn scan_extensions(app: AppHandle) -> Result<Vec<ScannedExtension>, String> {
    let mut all_extensions = Vec::new();

    // 1. Scan built-in extensions (bundled with app)
    let builtin_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("Failed to get resource dir: {}", e))?
        .join("extensions")
        .join("builtin");

    if builtin_dir.exists() {
        let builtin = scan_extension_directory(&builtin_dir, ExtensionLocationType::Builtin);
        eprintln!("[Extensions] Found {} built-in extensions", builtin.len());
        all_extensions.extend(builtin);
    }

    // 2. Scan installed extensions (user installed)
    let installed_dir = get_extensions_dir(&app)?;
    let installed = scan_extension_directory(&installed_dir, ExtensionLocationType::Installed);
    eprintln!("[Extensions] Found {} installed extensions", installed.len());
    all_extensions.extend(installed);

    // 3. Scan development extensions (workspace .vscode/extensions)
    // This would be set by the workspace configuration

    Ok(all_extensions)
}

/// Get extensions that should activate on a specific event
#[tauri::command]
pub fn get_extensions_for_activation_event(
    extensions: Vec<ScannedExtension>,
    event: String,
) -> Vec<ScannedExtension> {
    extensions
        .into_iter()
        .filter(|ext| {
            if let Some(activation_events) = &ext.manifest.activation_events {
                // Check for wildcard activation
                if activation_events.contains(&"*".to_string()) {
                    return true;
                }
                // Check for specific event
                if activation_events.contains(&event) {
                    return true;
                }
                // Check for onLanguage events with language ID
                if event.starts_with("onLanguage:") {
                    return activation_events.iter().any(|e| e == &event);
                }
            }
            false
        })
        .collect()
}

/// Get all contributed commands from scanned extensions
#[tauri::command]
pub fn get_contributed_commands(extensions: Vec<ScannedExtension>) -> Vec<ContributedCommand> {
    let mut commands = Vec::new();

    for ext in extensions {
        if let Some(contributes) = ext.manifest.contributes {
            if let Some(cmds) = contributes.commands {
                commands.extend(cmds);
            }
        }
    }

    commands
}

/// Get all contributed languages from scanned extensions
#[tauri::command]
pub fn get_contributed_languages(extensions: Vec<ScannedExtension>) -> Vec<ContributedLanguage> {
    let mut languages = Vec::new();

    for ext in extensions {
        if let Some(contributes) = ext.manifest.contributes {
            if let Some(langs) = contributes.languages {
                languages.extend(langs);
            }
        }
    }

    languages
}

/// Get all contributed themes from scanned extensions
#[tauri::command]
pub fn get_contributed_themes(extensions: Vec<ScannedExtension>) -> Vec<ContributedTheme> {
    let mut themes = Vec::new();

    for ext in extensions {
        if let Some(contributes) = ext.manifest.contributes {
            if let Some(t) = contributes.themes {
                themes.extend(t);
            }
        }
    }

    themes
}

/// Result of installing an extension
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallResult {
    pub extension_id: String,
    pub extension_path: String,
    pub manifest: ExtensionManifest,
}

/// Get the extensions directory path
fn get_extensions_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    let extensions_dir = app_data.join("extensions").join("installed");

    // Ensure directory exists
    fs::create_dir_all(&extensions_dir)
        .map_err(|e| format!("Failed to create extensions directory: {}", e))?;

    Ok(extensions_dir)
}

/// Extract a VSIX file and install the extension
fn extract_vsix(vsix_path: &PathBuf, target_dir: &PathBuf) -> Result<ExtensionManifest, String> {
    let file = File::open(vsix_path).map_err(|e| format!("Failed to open VSIX file: {}", e))?;

    let mut archive =
        ZipArchive::new(file).map_err(|e| format!("Failed to read VSIX archive: {}", e))?;

    let mut manifest: Option<ExtensionManifest> = None;

    // First pass: find and parse the manifest
    for i in 0..archive.len() {
        let mut file = archive
            .by_index(i)
            .map_err(|e| format!("Failed to read archive entry: {}", e))?;

        let file_path = file
            .enclosed_name()
            .ok_or("Invalid file path in archive")?
            .to_path_buf();

        // The manifest is at extension/package.json in VSIX files
        if file_path.to_string_lossy() == "extension/package.json" {
            let mut contents = String::new();
            file.read_to_string(&mut contents)
                .map_err(|e| format!("Failed to read package.json: {}", e))?;

            manifest = Some(
                serde_json::from_str(&contents)
                    .map_err(|e| format!("Failed to parse package.json: {}", e))?,
            );
            break;
        }
    }

    let manifest = manifest.ok_or("No package.json found in VSIX")?;

    // Create target directory
    fs::create_dir_all(target_dir)
        .map_err(|e| format!("Failed to create extension directory: {}", e))?;

    // Re-open archive for extraction
    let file = File::open(vsix_path).map_err(|e| format!("Failed to open VSIX file: {}", e))?;
    let mut archive =
        ZipArchive::new(file).map_err(|e| format!("Failed to read VSIX archive: {}", e))?;

    // Second pass: extract files
    for i in 0..archive.len() {
        let mut file = archive
            .by_index(i)
            .map_err(|e| format!("Failed to read archive entry: {}", e))?;

        let file_path = match file.enclosed_name() {
            Some(path) => path.to_path_buf(),
            None => continue,
        };

        // Skip non-extension files
        let file_path_str = file_path.to_string_lossy();
        if !file_path_str.starts_with("extension/") {
            continue;
        }

        // Remove "extension/" prefix for target path
        let relative_path = file_path
            .strip_prefix("extension/")
            .unwrap_or(&file_path);
        let target_path = target_dir.join(relative_path);

        if file.is_dir() {
            fs::create_dir_all(&target_path)
                .map_err(|e| format!("Failed to create directory: {}", e))?;
        } else {
            // Ensure parent directory exists
            if let Some(parent) = target_path.parent() {
                fs::create_dir_all(parent)
                    .map_err(|e| format!("Failed to create parent directory: {}", e))?;
            }

            let mut outfile = File::create(&target_path)
                .map_err(|e| format!("Failed to create file: {}", e))?;

            std::io::copy(&mut file, &mut outfile)
                .map_err(|e| format!("Failed to write file: {}", e))?;
        }
    }

    Ok(manifest)
}

/// Install an extension from a VSIX file path
#[tauri::command]
pub async fn install_extension(app: AppHandle, vsix_path: String) -> Result<InstallResult, String> {
    let vsix_path = PathBuf::from(&vsix_path);

    if !vsix_path.exists() {
        return Err(format!("VSIX file not found: {}", vsix_path.display()));
    }

    let extensions_dir = get_extensions_dir(&app)?;

    // Extract to a temporary location first to get the manifest
    let temp_dir = extensions_dir.join("_temp_install");
    if temp_dir.exists() {
        fs::remove_dir_all(&temp_dir)
            .map_err(|e| format!("Failed to clean temp directory: {}", e))?;
    }

    let manifest = extract_vsix(&vsix_path, &temp_dir)?;

    // Determine final extension ID and path
    let extension_id = format!("{}.{}", manifest.publisher, manifest.name);
    let extension_path = extensions_dir.join(&extension_id);

    // Remove existing installation if present
    if extension_path.exists() {
        fs::remove_dir_all(&extension_path)
            .map_err(|e| format!("Failed to remove existing extension: {}", e))?;
    }

    // Move from temp to final location
    fs::rename(&temp_dir, &extension_path)
        .map_err(|e| format!("Failed to move extension to final location: {}", e))?;

    Ok(InstallResult {
        extension_id,
        extension_path: extension_path.to_string_lossy().to_string(),
        manifest,
    })
}

/// Install an extension from binary data
#[tauri::command]
pub async fn install_extension_from_data(
    app: AppHandle,
    data: Vec<u8>,
    filename: String,
) -> Result<InstallResult, String> {
    let extensions_dir = get_extensions_dir(&app)?;

    // Write data to a temporary VSIX file
    let temp_vsix = extensions_dir.join(format!("_temp_{}", filename));
    let mut file =
        File::create(&temp_vsix).map_err(|e| format!("Failed to create temp file: {}", e))?;

    file.write_all(&data)
        .map_err(|e| format!("Failed to write temp file: {}", e))?;

    // Install from the temp file
    let result = install_extension(app, temp_vsix.to_string_lossy().to_string()).await;

    // Clean up temp file
    let _ = fs::remove_file(&temp_vsix);

    result
}

/// Uninstall an extension by ID
#[tauri::command]
pub async fn uninstall_extension(app: AppHandle, extension_id: String) -> Result<(), String> {
    let extensions_dir = get_extensions_dir(&app)?;
    let extension_path = extensions_dir.join(&extension_id);

    if !extension_path.exists() {
        return Err(format!("Extension not found: {}", extension_id));
    }

    fs::remove_dir_all(&extension_path)
        .map_err(|e| format!("Failed to remove extension: {}", e))?;

    Ok(())
}

/// List all installed extensions
#[tauri::command]
pub async fn list_installed_extensions(app: AppHandle) -> Result<Vec<InstallResult>, String> {
    let extensions_dir = get_extensions_dir(&app)?;

    let mut extensions = Vec::new();

    let entries = fs::read_dir(&extensions_dir)
        .map_err(|e| format!("Failed to read extensions directory: {}", e))?;

    for entry in entries {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };

        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        // Skip temp directories
        let dir_name = path.file_name().unwrap_or_default().to_string_lossy();
        if dir_name.starts_with("_temp") {
            continue;
        }

        // Try to read the manifest
        let manifest_path = path.join("package.json");
        if !manifest_path.exists() {
            continue;
        }

        let manifest_content = match fs::read_to_string(&manifest_path) {
            Ok(c) => c,
            Err(_) => continue,
        };

        let manifest: ExtensionManifest = match serde_json::from_str(&manifest_content) {
            Ok(m) => m,
            Err(_) => continue,
        };

        let extension_id = format!("{}.{}", manifest.publisher, manifest.name);

        extensions.push(InstallResult {
            extension_id,
            extension_path: path.to_string_lossy().to_string(),
            manifest,
        });
    }

    Ok(extensions)
}

/// Read an extension's manifest
#[tauri::command]
pub async fn read_extension_manifest(
    app: AppHandle,
    extension_id: String,
) -> Result<ExtensionManifest, String> {
    let extensions_dir = get_extensions_dir(&app)?;
    let manifest_path = extensions_dir.join(&extension_id).join("package.json");

    if !manifest_path.exists() {
        return Err(format!("Extension not found: {}", extension_id));
    }

    let content = fs::read_to_string(&manifest_path)
        .map_err(|e| format!("Failed to read manifest: {}", e))?;

    serde_json::from_str(&content).map_err(|e| format!("Failed to parse manifest: {}", e))
}
