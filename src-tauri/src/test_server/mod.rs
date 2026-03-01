//! Debug Test Server Module
//!
//! This module provides an HTTP server for automated testing of the Tauri application.
//! It is only compiled in debug builds (`#[cfg(debug_assertions)]`).
//!
//! # Multi-Window Support
//!
//! All endpoints support a `?window=<label>` query parameter to target specific windows.
//! If not specified, defaults to "main".
//!
//! # Endpoints
//!
//! ## Window Management
//! - `GET /windows` - List all open windows
//! - `POST /windows/open` - Open a new context window (with folder)
//! - `POST /windows/pick` - Open folder picker dialog
//! - `DELETE /windows/:label` - Close a window
//! - `POST /windows/:label/focus` - Focus a window
//! - `POST /windows/:label/inject` - Inject bridge into a window
//!
//! ## JavaScript & DOM
//! - `POST /js?window=main` - Execute JavaScript in the webview
//! - `POST /query?window=main` - Query DOM elements by selector
//! - `GET /dom?window=main` - Get full DOM snapshot
//! - `POST /styles?window=main` - Get computed styles for an element
//! - `POST /invoke?window=main` - Invoke Tauri commands
//!
//! ## Logs & Events
//! - `GET /errors?window=main` - Get captured JavaScript errors
//! - `GET /console?window=main` - Get captured console logs
//! - `GET /network?window=main` - Get captured network requests
//! - `GET /events?window=main` - Get captured custom events
//!
//! ## Extensions
//! - `GET /extensions` - List installed extensions
//! - `POST /extensions/search` - Search Open VSX marketplace
//! - `POST /extensions/install` - Install extension from Open VSX
//! - `DELETE /extensions/:id` - Uninstall extension
//! - `GET /extensions/host/status` - Get extension host status
//! - `POST /extensions/host/restart` - Restart extension host
//!
//! ## Utilities
//! - `GET /health` - Health check endpoint
//!
//! # Configuration
//!
//! Set `TAURI_TEST_PORT` environment variable to change the port (default: 9999)

mod bridge;
pub mod commands;
mod handlers;
mod types;

use std::sync::Arc;

use axum::{
    routing::{delete, get, post},
    Router,
};
use handlers::AppState;
use tauri::{AppHandle, Manager};
use tower_http::cors::{Any, CorsLayer};

pub use bridge::get_bridge_script;

/// Default port for the test server
const DEFAULT_PORT: u16 = 9999;

/// Start the debug test server
///
/// This function spawns an Axum HTTP server in a background task.
/// The server provides endpoints for test automation.
pub fn start_test_server(app_handle: AppHandle) {
    let port = std::env::var("TAURI_TEST_PORT")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(DEFAULT_PORT);

    println!("[TestServer] Starting debug test server on port {}", port);

    // Create shared state
    let state = Arc::new(AppState::new(app_handle.clone()));

    // Configure CORS to allow all origins (for test tools)
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    // Build the router with all endpoints
    let app = Router::new()
        // Window management
        .route("/windows", get(handlers::list_windows))
        .route("/windows/open", post(handlers::open_window))
        .route("/windows/pick", post(handlers::pick_folder))
        .route("/windows/:label", delete(handlers::close_window))
        .route("/windows/:label/focus", post(handlers::focus_window))
        .route("/windows/:label/inject", post(handlers::inject_bridge_handler))
        // JavaScript execution
        .route("/js", post(handlers::execute_js))
        // DOM querying
        .route("/query", post(handlers::query_dom))
        .route("/dom", get(handlers::get_dom))
        .route("/styles", post(handlers::get_styles))
        // Tauri command invocation
        .route("/invoke", post(handlers::invoke_command))
        // Log retrieval
        .route("/errors", get(handlers::get_errors))
        .route("/errors", delete(handlers::clear_errors))
        .route("/console", get(handlers::get_console))
        .route("/console", delete(handlers::clear_console))
        .route("/network", get(handlers::get_network))
        .route("/network", delete(handlers::clear_network))
        .route("/events", get(handlers::get_events))
        .route("/events", delete(handlers::clear_events))
        // Health check
        .route("/health", get(handlers::health_check))
        // Extension management
        .route("/extensions", get(handlers::list_extensions))
        .route("/extensions/search", post(handlers::search_extensions))
        .route("/extensions/install", post(handlers::install_extension_handler))
        .route("/extensions/:id", delete(handlers::uninstall_extension_handler))
        .route("/extensions/host/status", get(handlers::extension_host_status))
        .route("/extensions/host/restart", post(handlers::restart_extension_host))
        // Terminal management
        .route("/terminals", get(handlers::list_terminals_handler))
        .route("/terminals", post(handlers::create_terminal_handler))
        .route("/terminals/shells", get(handlers::get_shells_handler))
        .route("/terminals/write", post(handlers::write_terminal_handler))
        .route("/terminals/resize", post(handlers::resize_terminal_handler))
        .route("/terminals/:id", delete(handlers::kill_terminal_handler))
        // File system operations
        .route("/fs/read", post(handlers::read_file_handler))
        .route("/fs/write", post(handlers::write_file_handler))
        .route("/fs/list", post(handlers::list_dir_handler))
        .route("/fs/stat", get(handlers::stat_file_handler))
        .route("/fs", delete(handlers::delete_file_handler))
        // Add state and CORS
        .with_state(state.clone())
        .layer(cors);

    // Spawn the server in a background task using Tauri's async runtime
    tauri::async_runtime::spawn(async move {
        let addr = std::net::SocketAddr::from(([127, 0, 0, 1], port));
        let listener = match tokio::net::TcpListener::bind(addr).await {
            Ok(l) => l,
            Err(e) => {
                eprintln!("[TestServer] Failed to bind to port {}: {}", port, e);
                return;
            }
        };

        println!("[TestServer] Listening on http://127.0.0.1:{}", port);
        println!("[TestServer] Endpoints available:");
        println!("[TestServer]   Window Management:");
        println!("[TestServer]     GET  /windows - List all windows");
        println!("[TestServer]     POST /windows/open - Open new context window");
        println!("[TestServer]     POST /windows/pick - Open folder picker");
        println!("[TestServer]     DELETE /windows/:label - Close window");
        println!("[TestServer]     POST /windows/:label/focus - Focus window");
        println!("[TestServer]     POST /windows/:label/inject - Inject bridge");
        println!("[TestServer]   JavaScript & DOM (add ?window=<label>):");
        println!("[TestServer]     POST /js - Execute JavaScript");
        println!("[TestServer]     POST /query - Query DOM elements");
        println!("[TestServer]     GET  /dom - Get DOM snapshot");
        println!("[TestServer]     POST /styles - Get computed styles");
        println!("[TestServer]     POST /invoke - Invoke Tauri commands");
        println!("[TestServer]   Logs (add ?window=<label>):");
        println!("[TestServer]     GET  /errors - Get captured errors");
        println!("[TestServer]     GET  /console - Get console logs");
        println!("[TestServer]     GET  /network - Get network requests");
        println!("[TestServer]     GET  /events - Get custom events");
        println!("[TestServer]   Extensions:");
        println!("[TestServer]     GET  /extensions - List installed extensions");
        println!("[TestServer]     POST /extensions/search - Search Open VSX");
        println!("[TestServer]     POST /extensions/install - Install from Open VSX");
        println!("[TestServer]     DELETE /extensions/:id - Uninstall extension");
        println!("[TestServer]     GET  /extensions/host/status - Extension host status");
        println!("[TestServer]     POST /extensions/host/restart - Restart extension host");
        println!("[TestServer]   Terminals:");
        println!("[TestServer]     GET  /terminals - List active terminals");
        println!("[TestServer]     POST /terminals - Create new terminal");
        println!("[TestServer]     GET  /terminals/shells - Get available shells");
        println!("[TestServer]     POST /terminals/write - Write to terminal");
        println!("[TestServer]     POST /terminals/resize - Resize terminal");
        println!("[TestServer]     DELETE /terminals/:id - Kill terminal");
        println!("[TestServer]   File System:");
        println!("[TestServer]     POST /fs/read - Read file");
        println!("[TestServer]     POST /fs/write - Write file");
        println!("[TestServer]     POST /fs/list - List directory");
        println!("[TestServer]     GET  /fs/stat - Get file stats");
        println!("[TestServer]     DELETE /fs - Delete file/directory");
        println!("[TestServer]   Utilities:");
        println!("[TestServer]     GET  /health - Health check");

        if let Err(e) = axum::serve(listener, app).await {
            eprintln!("[TestServer] Server error: {}", e);
        }
    });

    // Inject the test bridge script into the main webview
    inject_bridge_script(app_handle, state);
}

/// Inject the test bridge JavaScript into the webview
fn inject_bridge_script(app_handle: AppHandle, state: Arc<AppState>) {
    // Wait a moment for the window to be ready, then inject the script
    tauri::async_runtime::spawn(async move {
        // Give the window time to initialize
        tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;

        if let Some(window) = app_handle.get_webview_window("main") {
            let script = get_bridge_script();
            match window.eval(script) {
                Ok(_) => {
                    state.mark_bridge_injected("main");
                    println!("[TestServer] Bridge script injected successfully");
                }
                Err(e) => eprintln!("[TestServer] Failed to inject bridge script: {}", e),
            }
        } else {
            eprintln!("[TestServer] No main window found for bridge injection");
        }
    });
}
