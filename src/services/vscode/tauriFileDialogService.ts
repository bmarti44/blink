/**
 * Tauri File Dialog Service
 *
 * Overrides VS Code's file dialog service to use Tauri's native dialogs
 */

import * as monaco from 'monaco-editor';
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';
import { homeDir } from '@tauri-apps/api/path';

// Storage key for workspace folder
const WORKSPACE_FOLDER_KEY = 'blink-workspace-folder';

/**
 * Store the workspace folder path
 */
function setStoredWorkspaceFolder(folderPath: string): void {
  localStorage.setItem(WORKSPACE_FOLDER_KEY, folderPath);
}

/**
 * Custom File Dialog Service using Tauri's native dialogs
 */
export class TauriFileDialogService {
  readonly _serviceBrand: undefined;

  async defaultFilePath(_schemeFilter?: string): Promise<monaco.Uri> {
    try {
      const home = await homeDir();
      return monaco.Uri.file(home);
    } catch {
      return monaco.Uri.file('/');
    }
  }

  async defaultFolderPath(_schemeFilter?: string): Promise<monaco.Uri> {
    try {
      const home = await homeDir();
      return monaco.Uri.file(home);
    } catch {
      return monaco.Uri.file('/');
    }
  }

  async defaultWorkspacePath(_schemeFilter?: string): Promise<monaco.Uri> {
    try {
      const home = await homeDir();
      return monaco.Uri.file(home);
    } catch {
      return monaco.Uri.file('/');
    }
  }

  async preferredHome(_schemeFilter?: string): Promise<monaco.Uri> {
    try {
      const home = await homeDir();
      return monaco.Uri.file(home);
    } catch {
      return monaco.Uri.file('/');
    }
  }

  async pickFileFolderAndOpen(_options: unknown): Promise<void> {
    const selected = await openDialog({
      directory: true,
      multiple: false,
      title: 'Open Folder',
    });

    if (selected && typeof selected === 'string') {
      console.log('[TauriFileDialog] Selected folder:', selected);
      setStoredWorkspaceFolder(selected);
      window.location.reload();
    }
  }

  async pickFileAndOpen(_options: unknown): Promise<void> {
    const selected = await openDialog({
      directory: false,
      multiple: false,
      title: 'Open File',
    });

    if (selected && typeof selected === 'string') {
      console.log('[TauriFileDialog] Selected file:', selected);
      // TODO: Open the file in the editor
    }
  }

  async pickFolderAndOpen(_options: unknown): Promise<void> {
    console.log('[TauriFileDialog] pickFolderAndOpen called');

    const selected = await openDialog({
      directory: true,
      multiple: false,
      title: 'Open Folder',
    });

    if (selected && typeof selected === 'string') {
      console.log('[TauriFileDialog] Selected folder:', selected);
      setStoredWorkspaceFolder(selected);
      // Reload the page to apply the new workspace
      window.location.reload();
    }
  }

  async pickWorkspaceAndOpen(_options: unknown): Promise<void> {
    // For now, treat workspace same as folder
    await this.pickFolderAndOpen(_options);
  }

  async pickFileToSave(defaultUri: monaco.Uri, _availableFileSystems?: string[]): Promise<monaco.Uri | undefined> {
    const result = await saveDialog({
      defaultPath: defaultUri.fsPath,
      title: 'Save File',
    });

    if (result) {
      return monaco.Uri.file(result);
    }
    return undefined;
  }

  async showSaveDialog(options: { defaultUri?: monaco.Uri; title?: string }): Promise<monaco.Uri | undefined> {
    const result = await saveDialog({
      defaultPath: options.defaultUri?.fsPath,
      title: options.title || 'Save',
    });

    if (result) {
      return monaco.Uri.file(result);
    }
    return undefined;
  }

  async showSaveConfirm(_fileNamesOrResources: (string | monaco.Uri)[]): Promise<number> {
    // Return 0 for Save, 1 for Don't Save, 2 for Cancel
    // For now, always return Save
    return 0;
  }

  async showOpenDialog(options: {
    canSelectFiles?: boolean;
    canSelectFolders?: boolean;
    canSelectMany?: boolean;
    title?: string;
  }): Promise<monaco.Uri[] | undefined> {
    const selected = await openDialog({
      directory: options.canSelectFolders ?? false,
      multiple: options.canSelectMany ?? false,
      title: options.title || 'Open',
    });

    if (selected) {
      if (Array.isArray(selected)) {
        return selected.map(path => monaco.Uri.file(path));
      } 
        return [monaco.Uri.file(selected)];
      
    }
    return undefined;
  }
}

/**
 * Get the Tauri file dialog service override
 */
export function getTauriFileDialogServiceOverride(): Record<string, unknown> {
  return {
    fileDialogService: new TauriFileDialogService(),
  };
}
