//! Terminal/PTY management commands for running shell sessions
//!
//! This module provides commands for spawning and managing terminal sessions
//! using pseudo-terminals (PTY) for full terminal emulation.

use parking_lot::Mutex;
use portable_pty::{native_pty_system, CommandBuilder, PtyPair, PtySize};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Arc;
use std::thread;
use tauri::{AppHandle, Emitter, State};

/// Terminal session information
#[derive(Debug, Clone, Serialize)]
pub struct TerminalInfo {
    pub id: String,
    pub shell: String,
    pub cwd: String,
    pub cols: u16,
    pub rows: u16,
}

/// Terminal session state
struct TerminalSession {
    #[allow(dead_code)]
    pty_pair: PtyPair,
    writer: Box<dyn Write + Send>,
    info: TerminalInfo,
}

/// Global state for managing terminal sessions
pub struct TerminalState {
    sessions: Arc<Mutex<HashMap<String, TerminalSession>>>,
    next_id: Arc<Mutex<u32>>,
}

impl TerminalState {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
            next_id: Arc::new(Mutex::new(1)),
        }
    }

    fn generate_id(&self) -> String {
        let mut id = self.next_id.lock();
        let current = *id;
        *id += 1;
        format!("term-{}", current)
    }
}

impl Default for TerminalState {
    fn default() -> Self {
        Self::new()
    }
}

/// Available shells on the system
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShellInfo {
    pub name: String,
    pub path: String,
    pub is_default: bool,
}

/// Get list of available shells on the system
#[tauri::command]
pub fn get_available_shells() -> Vec<ShellInfo> {
    let mut shells = Vec::new();

    #[cfg(unix)]
    {
        // Common Unix shells
        let unix_shells = [
            ("Zsh", "/bin/zsh"),
            ("Bash", "/bin/bash"),
            ("Fish", "/usr/local/bin/fish"),
            ("Fish (Homebrew)", "/opt/homebrew/bin/fish"),
            ("Sh", "/bin/sh"),
        ];

        for (name, path) in unix_shells {
            if std::path::Path::new(path).exists() {
                shells.push(ShellInfo {
                    name: name.to_string(),
                    path: path.to_string(),
                    is_default: false,
                });
            }
        }

        // Check SHELL env var for default
        if let Ok(default_shell) = std::env::var("SHELL") {
            for shell in &mut shells {
                if shell.path == default_shell {
                    shell.is_default = true;
                    break;
                }
            }
        }

        // If no default found, mark first as default
        if !shells.iter().any(|s| s.is_default) && !shells.is_empty() {
            shells[0].is_default = true;
        }
    }

    #[cfg(windows)]
    {
        // Windows shells
        let windows_shells = [
            ("PowerShell", "powershell.exe"),
            ("Command Prompt", "cmd.exe"),
            ("PowerShell Core", "pwsh.exe"),
        ];

        for (name, cmd) in windows_shells {
            if which::which(cmd).is_ok() {
                shells.push(ShellInfo {
                    name: name.to_string(),
                    path: cmd.to_string(),
                    is_default: name == "PowerShell",
                });
            }
        }
    }

    shells
}

/// Get the default shell for the current platform
#[tauri::command]
pub fn get_default_shell() -> String {
    #[cfg(unix)]
    {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string())
    }

    #[cfg(windows)]
    {
        "powershell.exe".to_string()
    }
}

/// Spawn a new terminal session
#[tauri::command]
pub async fn spawn_terminal(
    app: AppHandle,
    state: State<'_, TerminalState>,
    shell: Option<String>,
    cwd: Option<String>,
    cols: Option<u16>,
    rows: Option<u16>,
) -> Result<TerminalInfo, String> {
    let shell_path = shell.unwrap_or_else(get_default_shell);
    let working_dir = cwd.unwrap_or_else(|| {
        std::env::var("HOME")
            .or_else(|_| std::env::var("USERPROFILE"))
            .unwrap_or_else(|_| "/".to_string())
    });

    let term_cols = cols.unwrap_or(80);
    let term_rows = rows.unwrap_or(24);

    // Create PTY system
    let pty_system = native_pty_system();

    // Create PTY pair with specified size
    let pty_pair = pty_system
        .openpty(PtySize {
            rows: term_rows,
            cols: term_cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Failed to open PTY: {}", e))?;

    // Build the shell command
    let mut cmd = CommandBuilder::new(&shell_path);
    cmd.cwd(&working_dir);

    // Set up environment
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");

    // Spawn the shell process
    let mut child = pty_pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("Failed to spawn shell: {}", e))?;

    // Get the terminal ID
    let terminal_id = state.generate_id();

    // Create terminal info
    let info = TerminalInfo {
        id: terminal_id.clone(),
        shell: shell_path.clone(),
        cwd: working_dir,
        cols: term_cols,
        rows: term_rows,
    };

    // Get reader and writer
    let reader = pty_pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("Failed to clone reader: {}", e))?;
    let writer = pty_pair
        .master
        .take_writer()
        .map_err(|e| format!("Failed to take writer: {}", e))?;

    // Store session
    {
        let mut sessions = state.sessions.lock();
        sessions.insert(
            terminal_id.clone(),
            TerminalSession {
                pty_pair,
                writer,
                info: info.clone(),
            },
        );
    }

    // Spawn thread to read output and emit events
    let app_clone = app.clone();
    let term_id_clone = terminal_id.clone();
    let sessions_clone = state.sessions.clone();

    thread::spawn(move || {
        let mut reader = reader;
        let mut buffer = [0u8; 4096];

        loop {
            match reader.read(&mut buffer) {
                Ok(0) => {
                    // EOF - terminal closed
                    let _ = app_clone.emit(&format!("terminal-exit-{}", term_id_clone), ());
                    break;
                }
                Ok(n) => {
                    // Send data to frontend
                    let data = String::from_utf8_lossy(&buffer[..n]).to_string();
                    let _ = app_clone.emit(&format!("terminal-data-{}", term_id_clone), data);
                }
                Err(e) => {
                    eprintln!("Error reading from terminal: {}", e);
                    let _ = app_clone.emit(&format!("terminal-error-{}", term_id_clone), e.to_string());
                    break;
                }
            }
        }

        // Clean up session
        let mut sessions = sessions_clone.lock();
        sessions.remove(&term_id_clone);
    });

    // Spawn thread to wait for child process
    let app_clone2 = app.clone();
    let term_id_clone2 = terminal_id.clone();

    thread::spawn(move || {
        let _ = child.wait();
        let _ = app_clone2.emit(&format!("terminal-exit-{}", term_id_clone2), ());
    });

    Ok(info)
}

/// Write data to a terminal session
#[tauri::command]
pub fn write_to_terminal(
    state: State<'_, TerminalState>,
    terminal_id: String,
    data: String,
) -> Result<(), String> {
    let mut sessions = state.sessions.lock();

    let session = sessions
        .get_mut(&terminal_id)
        .ok_or_else(|| format!("Terminal {} not found", terminal_id))?;

    session
        .writer
        .write_all(data.as_bytes())
        .map_err(|e| format!("Failed to write to terminal: {}", e))?;

    session
        .writer
        .flush()
        .map_err(|e| format!("Failed to flush terminal: {}", e))?;

    Ok(())
}

/// Resize a terminal session
#[tauri::command]
pub fn resize_terminal(
    state: State<'_, TerminalState>,
    terminal_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let sessions = state.sessions.lock();

    let session = sessions
        .get(&terminal_id)
        .ok_or_else(|| format!("Terminal {} not found", terminal_id))?;

    session
        .pty_pair
        .master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Failed to resize terminal: {}", e))?;

    Ok(())
}

/// Kill a terminal session
#[tauri::command]
pub fn kill_terminal(state: State<'_, TerminalState>, terminal_id: String) -> Result<(), String> {
    let mut sessions = state.sessions.lock();

    if sessions.remove(&terminal_id).is_some() {
        Ok(())
    } else {
        Err(format!("Terminal {} not found", terminal_id))
    }
}

/// List all active terminal sessions
#[tauri::command]
pub fn list_terminals(state: State<'_, TerminalState>) -> Vec<TerminalInfo> {
    let sessions = state.sessions.lock();
    sessions.values().map(|s| s.info.clone()).collect()
}
