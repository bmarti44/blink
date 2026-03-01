/**
 * Tauri Terminal Backend
 *
 * Implements the ITerminalBackend interface to bridge VS Code's terminal
 * to Tauri's native PTY backend.
 */

import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { Emitter } from '@codingame/monaco-vscode-api/vscode/vs/base/common/event';
import {
  SimpleTerminalBackend,
  SimpleTerminalProcess,
  type ITerminalBackend,
  type ITerminalChildProcess,
} from '@codingame/monaco-vscode-terminal-service-override';
import type {
  IProcessReadyEvent,
  ITerminalLaunchError,
  ITerminalProfile,
  IShellLaunchConfig,
  ITerminalProcessOptions,
} from '@codingame/monaco-vscode-api/vscode/vs/platform/terminal/common/terminal';
import type { IProcessEnvironment } from '@codingame/monaco-vscode-api/vscode/vs/base/common/platform';

// Types matching Rust terminal commands
interface TerminalInfo {
  id: string;
  shell: string;
  cwd: string;
  cols: number;
  rows: number;
}

interface ShellInfo {
  name: string;
  path: string;
  isDefault: boolean;
}

// Create emitters outside the class for use in constructor
function createTerminalEmitters() {
  return {
    onData: new Emitter<string>(),
    onExit: new Emitter<number>(),
    onReady: new Emitter<IProcessReadyEvent>(),
  };
}

/**
 * Terminal process that bridges to Tauri PTY
 */
class TauriTerminalProcess extends SimpleTerminalProcess {
  private terminalId: string;
  private listeners: UnlistenFn[] = [];
  private _emitters: ReturnType<typeof createTerminalEmitters>;
  private _started: boolean = false; // Guard against multiple start() calls

  constructor(
    id: number,
    terminalId: string,
    pid: number,
    cwd: string,
    emitters: ReturnType<typeof createTerminalEmitters>
  ) {
    // Pass the data event to the parent constructor
    super(id, pid, cwd, emitters.onData.event);
    this.terminalId = terminalId;
    this._emitters = emitters;

    // Override the other events that aren't passed to constructor
    (this as any).onProcessExit = emitters.onExit.event;
    (this as any).onProcessReady = emitters.onReady.event;
  }

  // Factory method to create process with emitters
  static create(id: number, terminalId: string, pid: number, cwd: string): TauriTerminalProcess {
    const emitters = createTerminalEmitters();
    return new TauriTerminalProcess(id, terminalId, pid, cwd, emitters);
  }

  async start(): Promise<ITerminalLaunchError | { injectedArgs: string[] } | undefined> {
    console.log('[TauriTerminalProcess] start() called for terminal:', this.terminalId);

    // Guard against multiple start() calls - this prevents double event listeners
    // which would cause character doubling in the terminal
    if (this._started) {
      console.warn('[TauriTerminalProcess] start() already called, skipping duplicate registration');
      return { injectedArgs: [] };
    }
    this._started = true;

    try {
      // Subscribe to terminal events
      const dataListener = await listen<string>(
        `terminal-data-${this.terminalId}`,
        (event) => {
          this._emitters.onData.fire(event.payload);
        }
      );
      this.listeners.push(dataListener);

      const exitListener = await listen<number>(
        `terminal-exit-${this.terminalId}`,
        (event) => {
          console.log('[TauriTerminalProcess] Terminal exited:', this.terminalId);
          this._emitters.onExit.fire(event.payload ?? 0);
          this.cleanup();
        }
      );
      this.listeners.push(exitListener);

      // Signal ready - IMPORTANT: Fire asynchronously to allow ProcessManager to subscribe first
      // The ProcessManager calls start() and then subscribes to onProcessReady, so we need to
      // defer the ready event to ensure it receives our signal
      console.log('[TauriTerminalProcess] Signaling ready for terminal:', this.terminalId);
      setTimeout(() => {
        console.log('[TauriTerminalProcess] Firing onReady event (deferred) for:', this.terminalId);
        this._emitters.onReady.fire({ pid: this.pid, cwd: this.cwd, windowsPty: undefined });
      }, 0);

      return { injectedArgs: [] };
    } catch (error) {
      console.error('[TauriTerminalProcess] start() failed:', error);
      return { message: String(error) };
    }
  }

  input(data: string): void {
    invoke('write_to_terminal', {
      terminalId: this.terminalId,
      data,
    }).catch((error) => {
      console.error('[TauriTerminalProcess] Failed to write:', error);
    });
  }

  resize(cols: number, rows: number): void {
    invoke('resize_terminal', {
      terminalId: this.terminalId,
      cols,
      rows,
    }).catch((error) => {
      console.error('[TauriTerminalProcess] Failed to resize:', error);
    });
  }

  shutdown(_immediate: boolean): void {
    invoke('kill_terminal', { terminalId: this.terminalId }).catch((error) => {
      console.error('[TauriTerminalProcess] Failed to kill:', error);
    });
    this.cleanup();
  }

  sendSignal(_signal: string): void {
    // Signals are handled by the PTY backend
    console.log('[TauriTerminalProcess] Signal:', _signal);
  }

  clearBuffer(): void | Promise<void> {
    // Clear handled by xterm.js frontend
  }

  private cleanup(): void {
    for (const unlisten of this.listeners) {
      unlisten();
    }
    this.listeners = [];
  }
}

/**
 * Terminal backend that creates Tauri PTY terminals
 */
export class TauriTerminalBackend extends SimpleTerminalBackend {
  private processId = 0;
  private _defaultShell: string = '/bin/bash';
  private availableShells: ITerminalProfile[] = [];
  private initialized = false;

  // Implement abstract property getDefaultSystemShell
  getDefaultSystemShell = async (): Promise<string> => {
    await this.whenReady;
    return this._defaultShell;
  };

  // Implement abstract property createProcess
  createProcess = async (
    shellLaunchConfig: IShellLaunchConfig,
    cwd: string,
    cols: number,
    rows: number,
    _unicodeVersion: '6' | '11',
    _env: IProcessEnvironment,
    _options: ITerminalProcessOptions,
    _shouldPersist: boolean
  ): Promise<ITerminalChildProcess> => {
    const id = ++this.processId;

    console.log('[TauriTerminalBackend] createProcess called:', {
      id,
      shellLaunchConfig,
      cwd,
      cols,
      rows,
    });

    try {
      // Determine shell to use
      let shell = shellLaunchConfig.executable;
      if (!shell) {
        shell = this._defaultShell;
      }

      console.log('[TauriTerminalBackend] Spawning terminal with shell:', shell);

      // Spawn terminal in Tauri backend
      const info = await invoke<TerminalInfo>('spawn_terminal', {
        shell,
        cwd: cwd || undefined,
        cols,
        rows,
      });

      console.log('[TauriTerminalBackend] Terminal spawned:', info);

      // Create process wrapper using factory method
      const process = TauriTerminalProcess.create(
        id,
        info.id,
        parseInt(info.id.replace('term-', ''), 10) || id,
        info.cwd
      );

      console.log('[TauriTerminalBackend] TauriTerminalProcess created, calling start()');

      // Start the process to set up event listeners
      const startResult = await process.start();
      console.log('[TauriTerminalBackend] Process start() result:', startResult);

      return process;
    } catch (error) {
      console.error('[TauriTerminalBackend] Failed to create terminal:', error);
      throw error;
    }
  };

  constructor() {
    super();
    this.doInitialize();
  }

  override getProfiles = async (): Promise<ITerminalProfile[]> => {
    await this.whenReady;
    return this.availableShells;
  };

  // Override getShellEnvironment to return a valid environment object
  // This is required because terminalProcessManager checks for undefined and throws an error
  override getShellEnvironment = async (): Promise<IProcessEnvironment> => {
    // Return a minimal environment - the actual terminal will inherit
    // the full environment from the Tauri process when it spawns
    return {
      PATH: '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin',
      HOME: '/Users/briamart',
      SHELL: this._defaultShell,
      TERM: 'xterm-256color',
      LANG: 'en_US.UTF-8',
    };
  };

  private async doInitialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Get default shell
      this._defaultShell = await invoke<string>('get_default_shell');

      // Get available shells
      const shells = await invoke<ShellInfo[]>('get_available_shells');
      this.availableShells = shells.map((shell) => ({
        profileName: shell.name,
        path: shell.path,
        isDefault: shell.isDefault,
      }));

      this.initialized = true;
      this.setReady();
      console.log('[TauriTerminalBackend] Initialized with shell:', this._defaultShell);
    } catch (error) {
      console.error('[TauriTerminalBackend] Failed to initialize:', error);
      this.setReady(); // Still mark as ready to allow fallback
    }
  }
}

// Create singleton instance
let backendInstance: TauriTerminalBackend | null = null;

export function getTauriTerminalBackend(): ITerminalBackend {
  if (!backendInstance) {
    console.log('[TauriTerminalBackend] Creating singleton instance');
    try {
      backendInstance = new TauriTerminalBackend();
      console.log('[TauriTerminalBackend] Singleton created successfully');
      // Expose for debugging
      (window as any).__TAURI_TERMINAL_BACKEND__ = backendInstance;
    } catch (error) {
      console.error('[TauriTerminalBackend] Failed to create singleton:', error);
      throw error;
    }
  }
  return backendInstance;
}
