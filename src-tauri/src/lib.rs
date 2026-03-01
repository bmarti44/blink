mod channels;
mod commands;
mod services;

#[cfg(debug_assertions)]
mod test_server;
#[cfg(debug_assertions)]
use test_server::commands::test_server_callback;


use commands::{
    apply_document_edits, create_document, get_document_context_for_ai, get_supported_extensions,
    is_document_supported, read_document, render_document_html, DocumentState,
    // Terminal commands
    get_available_shells, get_default_shell, kill_terminal, list_terminals, resize_terminal,
    spawn_terminal, write_to_terminal, TerminalState,
    // AI Chat commands
    cancel_ai_chat, is_ai_sidecar_ready, send_ai_chat, start_ai_sidecar, stop_ai_sidecar,
    AISidecarState,
    // Extension commands
    install_extension, install_extension_from_data, list_installed_extensions,
                     read_extension_manifest, scan_extensions, uninstall_extension,
    // Extension Host commands
    activate_extension, deactivate_extension, execute_extension_command, get_activated_extensions,
    is_extension_host_ready, set_extension_host_workspace, start_extension_host,
    stop_extension_host, ExtensionHostState,
    // VSCode Server commands
    get_vscode_server_info, is_vscode_server_running, restart_vscode_server, start_vscode_server,
    stop_vscode_server, VscodeServerState,
    // Channel Router commands
    channel_call, init_channel_router, is_extension_host_connection_ready,
    list_extension_host_connections, spawn_extension_host_connection,
    terminate_extension_host_connection, ChannelRouterState,
    // Singleton extension host commands (new)
    start_default_extension_host, stop_default_extension_host, is_default_extension_host_ready,
    set_default_extension_host_workspace, activate_default_extension, deactivate_default_extension,
    execute_default_extension_command, get_default_activated_extensions,
    // Singleton document management commands
    open_default_document, update_default_document, close_default_document, set_default_configuration,
    // Singleton language provider commands
    request_default_completion, request_default_hover, request_default_definition,
    request_default_references, request_default_document_symbols, request_default_code_actions,
    request_default_formatting, request_default_signature_help,
};

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(DocumentState::new())
        .manage(TerminalState::new())
        .manage(AISidecarState::new())
        .manage(ExtensionHostState::new())
         .manage(VscodeServerState::new())
         // Channel router state is initialized with the sidecar path (relative to src-tauri/ in dev)
         .manage(ChannelRouterState::new("binaries/extension-host-sidecar.js".to_string()))
         .invoke_handler({

            #[cfg(debug_assertions)]
            {
                tauri::generate_handler![
                    greet,
                    // Document commands
                    read_document,
                    create_document,
                    apply_document_edits,
                    render_document_html,
                    get_document_context_for_ai,
                    get_supported_extensions,
                    is_document_supported,
                    // Terminal commands
                    get_available_shells,
                    get_default_shell,
                    spawn_terminal,
                    write_to_terminal,
                    resize_terminal,
                    kill_terminal,
                    list_terminals,
                    // AI Chat commands
                    start_ai_sidecar,
                    stop_ai_sidecar,
                    is_ai_sidecar_ready,
                    send_ai_chat,
                    cancel_ai_chat,
                    // Extension commands
                    install_extension,
                    install_extension_from_data,
                    uninstall_extension,
                    list_installed_extensions,
                    read_extension_manifest,
                    scan_extensions,
                    // Extension Host commands
                    start_extension_host,
                    stop_extension_host,
                    is_extension_host_ready,
                    set_extension_host_workspace,
                    activate_extension,
                    deactivate_extension,
                    execute_extension_command,
                    get_activated_extensions,
                    // VSCode Server commands
                    start_vscode_server,
                    stop_vscode_server,
                    get_vscode_server_info,
                    restart_vscode_server,
                    is_vscode_server_running,
                    // Channel Router commands
                    init_channel_router,
                    channel_call,
                    spawn_extension_host_connection,
                    terminate_extension_host_connection,
                    is_extension_host_connection_ready,
                    list_extension_host_connections,
                    // Singleton extension host commands
                    start_default_extension_host,
                    stop_default_extension_host,
                    is_default_extension_host_ready,
                    set_default_extension_host_workspace,
                    activate_default_extension,
                    deactivate_default_extension,
                    execute_default_extension_command,
                    get_default_activated_extensions,
                    // Singleton document management commands
                    open_default_document,
                    update_default_document,
                    close_default_document,
                    set_default_configuration,
                    // Singleton language provider commands
                    request_default_completion,
                    request_default_hover,
                    request_default_definition,
                    request_default_references,
                    request_default_document_symbols,
                    request_default_code_actions,
                    request_default_formatting,
                    request_default_signature_help,
                    // Test server callback (for E2E tests)
                    test_server_callback,
                ]
            }
            #[cfg(not(debug_assertions))]

            {
                tauri::generate_handler![
                    greet,
                    // Document commands
                    read_document,
                    create_document,
                    apply_document_edits,
                    render_document_html,
                    get_document_context_for_ai,
                    get_supported_extensions,
                    is_document_supported,
                    // Terminal commands
                    get_available_shells,
                    get_default_shell,
                    spawn_terminal,
                    write_to_terminal,
                    resize_terminal,
                    kill_terminal,
                    list_terminals,
                    // AI Chat commands
                    start_ai_sidecar,
                    stop_ai_sidecar,
                    is_ai_sidecar_ready,
                    send_ai_chat,
                    cancel_ai_chat,
                    // Extension commands
                    install_extension,
                    install_extension_from_data,
                    uninstall_extension,
                    list_installed_extensions,
                    read_extension_manifest,
                    scan_extensions,
                    // Extension Host commands
                    start_extension_host,
                    stop_extension_host,
                    is_extension_host_ready,
                    set_extension_host_workspace,
                    activate_extension,
                    deactivate_extension,
                    execute_extension_command,
                    get_activated_extensions,
                    // VSCode Server commands
                    start_vscode_server,
                    stop_vscode_server,
                    get_vscode_server_info,
                    restart_vscode_server,
                    is_vscode_server_running,
                    // Channel Router commands
                    init_channel_router,
                    channel_call,
                    spawn_extension_host_connection,
                    terminate_extension_host_connection,
                    is_extension_host_connection_ready,
                    list_extension_host_connections,
                    // Singleton extension host commands
                    start_default_extension_host,
                    stop_default_extension_host,
                    is_default_extension_host_ready,
                    set_default_extension_host_workspace,
                    activate_default_extension,
                    deactivate_default_extension,
                    execute_default_extension_command,
                    get_default_activated_extensions,
                    // Singleton document management commands
                    open_default_document,
                    update_default_document,
                    close_default_document,
                    set_default_configuration,
                    // Singleton language provider commands
                    request_default_completion,
                    request_default_hover,
                    request_default_definition,
                    request_default_references,
                    request_default_document_symbols,
                    request_default_code_actions,
                    request_default_formatting,
                    request_default_signature_help,
                ]
            }
        })
        .setup(|app| {
            // Start the debug test server in debug builds only
            #[cfg(debug_assertions)]
            {
                test_server::start_test_server(app.handle().clone());
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
