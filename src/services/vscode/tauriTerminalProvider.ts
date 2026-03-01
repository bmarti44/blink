import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

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

const terminalListeners = new Map<string, UnlistenFn[]>();

export async function getAvailableShells(): Promise<ShellInfo[]> {
  try {
    return await invoke<ShellInfo[]>('get_available_shells');
  } catch (error) {
    console.error('[TauriTerminal] Failed to get available shells:', error);
    return [];
  }
}

export async function getDefaultShell(): Promise<string> {
  try {
    return await invoke<string>('get_default_shell');
  } catch (error) {
    console.error('[TauriTerminal] Failed to get default shell:', error);
    return '/bin/bash';
  }
}

class TauriPseudoterminal {
  private terminalId: string | null = null;
  private shell: string;
  private cwd: string;
  private dimensions: { cols: number; rows: number } = { cols: 80, rows: 24 };

  constructor(shell?: string, cwd?: string) {
    this.shell = shell || '';
    this.cwd = cwd || '';
  }

  async open(initialDimensions: { columns: number; rows: number } | undefined): Promise<void> {
    if (initialDimensions) {
      this.dimensions = { cols: initialDimensions.columns, rows: initialDimensions.rows };
    }
    try {
      const info = await invoke<TerminalInfo>('spawn_terminal', {
        shell: this.shell || undefined,
        cwd: this.cwd || undefined,
        cols: this.dimensions.cols,
        rows: this.dimensions.rows,
      });
      this.terminalId = info.id;
      console.log('[TauriTerminal] Spawned terminal:', info);
      await this.subscribeToEvents();
    } catch (error) {
      console.error('[TauriTerminal] Failed to spawn terminal:', error);
    }
  }

  private async subscribeToEvents(): Promise<void> {
    if (!this.terminalId) return;

    const listeners: UnlistenFn[] = [];

    const dataListener = await listen<string>(`terminal-data-${this.terminalId}`, (event) => {
      try {
        (this as any)._onDidWrite?.fire?.(event.payload);
      } catch {}
    });
    listeners.push(dataListener);

    const exitListener = await listen<void>(`terminal-exit-${this.terminalId}`, () => {
      console.log('[TauriTerminal] Terminal exited:', this.terminalId);
      try {
        (this as any)._onDidClose?.fire?.(0);
      } catch {}
      this.cleanup();
    });
    listeners.push(exitListener);

    const errorListener = await listen<string>(`terminal-error-${this.terminalId}`, (event) => {
      console.error('[TauriTerminal] Terminal error:', event.payload);
      try {
        (this as any)._onDidWrite?.fire?.(`\r\nTerminal error: ${event.payload}\r\n`);
      } catch {}
    });
    listeners.push(errorListener);

    terminalListeners.set(this.terminalId, listeners);
  }

  async handleInput(data: string): Promise<void> {
    if (!this.terminalId) return;

    try {
      await invoke('write_to_terminal', {
        terminalId: this.terminalId,
        data,
      });
    } catch (error) {
      console.error('[TauriTerminal] Failed to write to terminal:', error);
    }
  }

  async setDimensions(dimensions: { columns: number; rows: number }): Promise<void> {
    if (!this.terminalId) return;
    this.dimensions = { cols: dimensions.columns, rows: dimensions.rows };
    try {
      await invoke('resize_terminal', { terminalId: this.terminalId, cols: dimensions.columns, rows: dimensions.rows });
    } catch (error) {
      console.error('[TauriTerminal] Failed to resize terminal:', error);
    }
  }

  close(): void {
    if (!this.terminalId) return;

    console.log('[TauriTerminal] Closing terminal:', this.terminalId);

    invoke('kill_terminal', { terminalId: this.terminalId }).catch((error) => {
      console.error('[TauriTerminal] Failed to kill terminal:', error);
    });

    this.cleanup();
  }

  private cleanup(): void {
    if (this.terminalId) {
      const listeners = terminalListeners.get(this.terminalId);
      if (listeners) {
        listeners.forEach((unlisten) => unlisten());
        terminalListeners.delete(this.terminalId);
      }
      this.terminalId = null;
    }
  }

  getTerminalId(): string | null {
    return this.terminalId;
  }
}

export function createTauriTerminal(name?: string, shell?: string, cwd?: string): any {
  const pty = new TauriPseudoterminal(shell, cwd);
  const vscodeAny: any = (window as any).monaco?.vscode || (globalThis as any).vscode;
  const terminal = vscodeAny?.window?.createTerminal ? vscodeAny.window.createTerminal({ name: name || 'Terminal', pty }) : null;
  return terminal;
}

export function registerTauriTerminalProfile(): any | null {
  const vscodeAny: any = (window as any).monaco?.vscode || (globalThis as any).vscode;
  if (!vscodeAny?.window?.registerTerminalProfileProvider) {
    console.log('[TauriTerminal] registerTerminalProfileProvider not available, skipping profile registration');
    return null;
  }
  try {
    const profileProvider: any = {
      provideTerminalProfile: async (_token: any): Promise<any> => {
        const defaultShell = await getDefaultShell();
        const pty = new TauriPseudoterminal(defaultShell);
        return new vscodeAny.TerminalProfile({ name: 'Tauri Terminal', pty });
      },
    };
    return vscodeAny.window.registerTerminalProfileProvider('blink.terminal', profileProvider);
  } catch (error) {
    console.warn('[TauriTerminal] Failed to register terminal profile provider:', error);
    return null;
  }
}

export async function listActiveTerminals(): Promise<TerminalInfo[]> {
  try {
    return await invoke<TerminalInfo[]>('list_terminals');
  } catch (error) {
    console.error('[TauriTerminal] Failed to list terminals:', error);
    return [];
  }
}

export function initializeTauriTerminal(): { dispose: () => void } {
  console.log('[TauriTerminal] Initializing Tauri terminal integration');
  const vscodeAny: any = (window as any).monaco?.vscode || (globalThis as any).vscode;
  if (!vscodeAny || !vscodeAny.commands || !vscodeAny.commands.registerCommand) {
    console.warn('[TauriTerminal] VS Code API not available, skipping terminal integration');
    return { dispose: () => {} };
  }
  const vscodeLocal: any = vscodeAny;
  const disposables: any[] = [];

  try {
    const profileDisposable = null;
    if (profileDisposable) {
      disposables.push(profileDisposable);
    }

    disposables.push(
      vscodeLocal.commands.registerCommand('blink.newTerminal', async () => {
        const shells = await getAvailableShells();

        if (shells.length === 0) {
          createTauriTerminal();
          return;
        }

        const items = shells.map((shell) => ({
          label: shell.name,
          description: shell.path,
          shell: shell.path,
          isDefault: shell.isDefault,
        }));

        items.sort((a, b) => (b.isDefault ? 1 : 0) - (a.isDefault ? 1 : 0));

        const selected = await vscodeLocal.window.showQuickPick(items, {
          placeHolder: 'Select a shell',
        });

        if (selected) {
          const terminal = createTauriTerminal(selected.label, selected.shell);
          terminal.show();
        }
      })
    );

    disposables.push(
      vscodeLocal.commands.registerCommand('blink.newTerminalWithShell', async (shellPath?: string) => {
        const shell = shellPath || (await getDefaultShell());
        const terminal = createTauriTerminal(undefined, shell);
        terminal.show();
      })
    );

    console.log('[TauriTerminal] Tauri terminal integration initialized');
  } catch (error) {
    console.warn('[TauriTerminal] Failed to initialize terminal integration:', error);
  }

  return {
    dispose: () => {
      disposables.forEach((d: any) => d.dispose && d.dispose());
    },
  };
}
