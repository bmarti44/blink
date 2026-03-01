/**
 * Extension Commands
 *
 * VS Code commands for managing extensions including:
 * - Installing VSIX files from disk
 * - Managing extension lifecycle
 */

import { registerAction2, Action2, MenuId } from '@codingame/monaco-vscode-api/vscode/vs/platform/actions/common/actions';
import { KeybindingWeight } from '@codingame/monaco-vscode-api/vscode/vs/platform/keybinding/common/keybindingsRegistry';
import type { ServicesAccessor } from '@codingame/monaco-vscode-api/vscode/vs/platform/instantiation/common/instantiation';
import { INotificationService } from '@codingame/monaco-vscode-api/vscode/vs/platform/notification/common/notification.service';
import Severity from '@codingame/monaco-vscode-api/vscode/vs/base/common/severity';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { getExtensionManager } from '../extensions/extensionManager';
import { extensionHostService } from './extensionHostService';

/**
 * Install a VSIX file from disk
 */
async function installVsixFromDisk(notificationService: INotificationService): Promise<void> {
  try {
    // Open file picker for VSIX files
    const selected = await openDialog({
      multiple: false,
      title: 'Install Extension from VSIX',
      filters: [{
        name: 'VS Code Extension',
        extensions: ['vsix']
      }]
    });

    if (!selected || typeof selected !== 'string') {
      return; // User cancelled
    }

    console.log('[ExtensionCommands] Installing VSIX:', selected);

    // Show progress notification
    notificationService.info(`Installing extension from ${selected.split('/').pop()}...`);

    // Install via extension manager
    const manager = getExtensionManager();
    await manager.initialize();
    const info = await manager.installFromPath(selected);

    console.log('[ExtensionCommands] Extension installed:', info.id);

    // If it's a Node.js extension, activate it in the sidecar
    if (info.manifest.main && !info.manifest.browser) {
      console.log('[ExtensionCommands] Activating Node.js extension in sidecar:', info.id);
      try {
        const ready = await extensionHostService.checkReady();
        if (ready) {
          await extensionHostService.activateExtension(info.extensionPath, info.id);
          notificationService.notify({
            severity: Severity.Info,
            message: `Extension "${info.displayName}" installed and activated successfully.`
          });
        } else {
          notificationService.notify({
            severity: Severity.Warning,
            message: `Extension "${info.displayName}" installed. Restart to activate Node.js extensions.`
          });
        }
      } catch (err) {
        console.error('[ExtensionCommands] Failed to activate in sidecar:', err);
        notificationService.notify({
          severity: Severity.Warning,
          message: `Extension "${info.displayName}" installed but activation failed. Try restarting.`
        });
      }
    } else {
      // Browser extension - may need reload
      notificationService.info(`Extension "${info.displayName}" installed. Reload window to activate.`);
    }
  } catch (err) {
    console.error('[ExtensionCommands] Failed to install VSIX:', err);
    notificationService.error(`Failed to install extension: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Install Extension from VSIX Action
 */
class InstallVsixAction extends Action2 {
  constructor() {
    super({
      id: 'extensions.installFromVSIX',
      title: { value: 'Install from VSIX...', original: 'Install from VSIX...' },
      category: { value: 'Extensions', original: 'Extensions' },
      f1: true,
      keybinding: {
        weight: KeybindingWeight.WorkbenchContrib,
        primary: 0, // No default keybinding
      },
      menu: {
        id: MenuId.MenubarPreferencesMenu,
        group: '2_extensions',
        order: 1,
      },
    });
  }

  async run(accessor: ServicesAccessor): Promise<void> {
    const notificationService = accessor.get(INotificationService);
    await installVsixFromDisk(notificationService);
  }
}

/**
 * Register extension-related commands
 */
let _registered = false;

export function registerExtensionCommands(): void {
  if (_registered) return;
  _registered = true;

  registerAction2(InstallVsixAction);

  console.log('[ExtensionCommands] Extension commands registered');
}
