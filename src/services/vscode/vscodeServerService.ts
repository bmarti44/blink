/**
 * Code-Server Service
 *
 * Manages Coder's code-server backend.
 * This provides an open-source VS Code server for extension support.
 */

import { invoke } from '@tauri-apps/api/core';

// Server info returned from Rust
export interface CodeServerInfo {
  serverUrl: string;
  port: number;
  auth: string;
}

class CodeServerService {
  private serverInfo: CodeServerInfo | null = null;
  private starting = false;

  /**
   * Start code-server
   * Returns server info including URL for connection
   */
  async start(): Promise<CodeServerInfo> {
    if (this.serverInfo) {
      console.log('[CodeServerService] Server already running');
      return this.serverInfo;
    }

    if (this.starting) {
      // Wait for existing start operation
      while (this.starting) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      if (this.serverInfo) {
        return this.serverInfo;
      }
    }

    this.starting = true;

    try {
      console.log('[CodeServerService] Starting code-server...');
      this.serverInfo = await invoke<CodeServerInfo>('start_vscode_server');
      console.log('[CodeServerService] Server started:', this.serverInfo);
      return this.serverInfo;
    } finally {
      this.starting = false;
    }
  }

  /**
   * Stop code-server
   */
  async stop(): Promise<void> {
    console.log('[CodeServerService] Stopping code-server...');
    await invoke('stop_vscode_server');
    this.serverInfo = null;
    console.log('[CodeServerService] Server stopped');
  }

  /**
   * Restart code-server
   */
  async restart(): Promise<CodeServerInfo> {
    console.log('[CodeServerService] Restarting code-server...');
    this.serverInfo = await invoke<CodeServerInfo>('restart_vscode_server');
    console.log('[CodeServerService] Server restarted:', this.serverInfo);
    return this.serverInfo;
  }

  /**
   * Get server info if running
   */
  async getInfo(): Promise<CodeServerInfo | null> {
    if (this.serverInfo) {
      return this.serverInfo;
    }
    const info = await invoke<CodeServerInfo | null>('get_vscode_server_info');
    if (info) {
      this.serverInfo = info;
    }
    return info;
  }

  /**
   * Check if server is running
   */
  async isRunning(): Promise<boolean> {
    return invoke<boolean>('is_vscode_server_running');
  }

  /**
   * Get the server URL for connecting
   */
  getServerUrl(): string | null {
    return this.serverInfo?.serverUrl ?? null;
  }

  /**
   * Get the port code-server is running on
   */
  getPort(): number | null {
    return this.serverInfo?.port ?? null;
  }
}

// Export as both names for compatibility
export const codeServerService = new CodeServerService();
export const vscodeServerService = codeServerService;
