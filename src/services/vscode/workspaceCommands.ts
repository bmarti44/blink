/**
 * Workspace Commands
 *
 * Adds custom folder commands using Tauri's native dialogs.
 */

import { registerAction2, Action2, MenuId } from '@codingame/monaco-vscode-api/vscode/vs/platform/actions/common/actions';
import { KeyCode, KeyMod } from '@codingame/monaco-vscode-api/vscode/vs/base/common/keyCodes';
import { KeybindingWeight } from '@codingame/monaco-vscode-api/vscode/vs/platform/keybinding/common/keybindingsRegistry';
import type { ServicesAccessor } from '@codingame/monaco-vscode-api/vscode/vs/platform/instantiation/common/instantiation';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';

// Storage key for workspace folder
const WORKSPACE_FOLDER_KEY = 'blink-workspace-folder';

/**
 * Store the workspace folder path
 */
function setStoredWorkspaceFolder(folderPath: string | null): void {
  if (folderPath) {
    localStorage.setItem(WORKSPACE_FOLDER_KEY, folderPath);
  } else {
    localStorage.removeItem(WORKSPACE_FOLDER_KEY);
  }
}

/**
 * Open a folder picker and switch to the selected folder
 */
async function openFolderAction(): Promise<void> {
  const selected = await openDialog({
    directory: true,
    multiple: false,
    title: 'Open Folder',
  });

  if (selected && typeof selected === 'string') {
    console.log('[WorkspaceCommands] Opening folder:', selected);
    setStoredWorkspaceFolder(selected);
    window.location.reload();
  }
}

/**
 * Open a folder in a new window
 */
async function openFolderInNewWindowAction(): Promise<void> {
  const selected = await openDialog({
    directory: true,
    multiple: false,
    title: 'Open Folder in New Window',
  });

  if (selected && typeof selected === 'string') {
    console.log('[WorkspaceCommands] Opening folder in new window:', selected);

    // Create unique window label based on timestamp
    const windowLabel = `editor-${Date.now()}`;

    // Encode the folder path for URL
    const encodedPath = encodeURIComponent(selected);

    // Get the base URL (works in both dev and production)
    const baseUrl = window.location.origin;

    // Create new window with folder path as URL parameter
    // Use hash routing to match the app's router configuration
    const newWindow = new WebviewWindow(windowLabel, {
      url: `${baseUrl}/#/vscode?folder=${encodedPath}`,
      title: `Blink - ${selected.split('/').pop()}`,
      width: 1200,
      height: 800,
      center: true,
    });

    newWindow.once('tauri://created', () => {
      console.log('[WorkspaceCommands] New window created:', windowLabel);
    });

    newWindow.once('tauri://error', (e) => {
      console.error('[WorkspaceCommands] Error creating window:', e);
    });
  }
}

/**
 * Open Folder Action - custom command with unique ID
 */
class TauriOpenFolderAction extends Action2 {
  constructor() {
    super({
      id: 'tauri.openFolder',
      title: { value: 'Open Folder...', original: 'Open Folder...' },
      category: { value: 'File', original: 'File' },
      f1: true,
      keybinding: {
        weight: KeybindingWeight.WorkbenchContrib,
        primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyO,
      },
      menu: {
        id: MenuId.MenubarFileMenu,
        group: '2_open',
        order: 1,
      },
    });
  }

  async run(_accessor: ServicesAccessor): Promise<void> {
    await openFolderAction();
  }
}

/**
 * Open Folder in New Window Action
 */
class TauriOpenFolderNewWindowAction extends Action2 {
  constructor() {
    super({
      id: 'tauri.openFolderNewWindow',
      title: { value: 'Open Folder in New Window...', original: 'Open Folder in New Window...' },
      category: { value: 'File', original: 'File' },
      f1: true,
      menu: {
        id: MenuId.MenubarFileMenu,
        group: '2_open',
        order: 2,
      },
    });
  }

  async run(_accessor: ServicesAccessor): Promise<void> {
    await openFolderInNewWindowAction();
  }
}

/**
 * Close Folder Action
 */
class TauriCloseFolderAction extends Action2 {
  constructor() {
    super({
      id: 'tauri.closeFolder',
      title: { value: 'Close Folder', original: 'Close Folder' },
      category: { value: 'File', original: 'File' },
      f1: true,
      menu: {
        id: MenuId.MenubarFileMenu,
        group: '2_open',
        order: 3,
      },
    });
  }

  run(_accessor: ServicesAccessor): void {
    console.log('[WorkspaceCommands] Closing workspace');
    setStoredWorkspaceFolder(null);
    window.location.reload();
  }
}

let _registered = false;

/**
 * Register workspace-related commands
 */
export function registerWorkspaceCommands(): void {
  if (_registered) return;
  _registered = true;

  registerAction2(TauriOpenFolderAction);
  registerAction2(TauriOpenFolderNewWindowAction);
  registerAction2(TauriCloseFolderAction);

  console.log('[WorkspaceCommands] Workspace commands registered');
}
