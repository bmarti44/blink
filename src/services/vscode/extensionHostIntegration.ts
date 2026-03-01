/**
 * Extension Host Integration
 *
 * Integrates the Node.js extension host sidecar with the VS Code workbench.
 * This enables running Node.js extensions like ESLint, Prettier, etc.
 */

import { extensionHostService } from './extensionHostService';
import { invoke } from '@tauri-apps/api/core';
import { getService } from '@codingame/monaco-vscode-api/services';
import { INotificationService } from '@codingame/monaco-vscode-api/vscode/vs/platform/notification/common/notification.service';
import { ILogService } from '@codingame/monaco-vscode-api/vscode/vs/platform/log/common/log.service';

const vscode: any = (window as any).monaco?.vscode || (globalThis as any).vscode || {};

// Extension manifest from installed extensions (matches Rust ExtensionManifest)
interface ExtensionManifest {
  name: string;
  version: string;
  publisher: string;
  displayName?: string;
  description?: string;
  categories?: string[];
  main?: string;
  browser?: string;
}

// Matches Rust InstallResult
interface InstalledExtension {
  extensionId: string;
  extensionPath: string;
  manifest: ExtensionManifest;
}

/**
 * Initialize the extension host integration
 * Call this after workbench initialization
 */
export async function initializeExtensionHost(workspaceFolder?: string): Promise<void> {
  console.log('[ExtensionHostIntegration] Initializing...');

  try {
    // Start the extension host sidecar
    console.log('[ExtensionHostIntegration] Starting extension host sidecar...');
    await extensionHostService.start();
    console.log('[ExtensionHostIntegration] Extension host sidecar started');

    // Wait for it to be ready
    console.log('[ExtensionHostIntegration] Waiting for extension host to be ready...');
    await waitForReady();
    console.log('[ExtensionHostIntegration] Extension host is ready');

    // Set workspace folder if provided
    if (workspaceFolder) {
      console.log('[ExtensionHostIntegration] Setting workspace folder:', workspaceFolder);
      await extensionHostService.setWorkspaceFolder(workspaceFolder);
    }

    // Set up event handlers
    setupEventHandlers();

    // Scan and activate installed Node.js extensions
    console.log('[ExtensionHostIntegration] Scanning for installed Node.js extensions...');
    await activateInstalledExtensions();

    console.log('[ExtensionHostIntegration] Initialized successfully');
  } catch (error) {
    console.error('[ExtensionHostIntegration] Failed to initialize:', error);
  }
}

/**
 * Wait for the extension host to be ready
 */
async function waitForReady(): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Extension host failed to become ready'));
    }, 10000);

    const checkReady = async () => {
      const ready = await extensionHostService.checkReady();
      if (ready) {
        clearTimeout(timeout);
        resolve();
      } else {
        setTimeout(checkReady, 100);
      }
    };

    checkReady();
  });
}

// Map of output channels created for extensions
const extensionOutputChannels = new Map<string, { appendLine: (s: string) => void; show: () => void }>();

// Diagnostic collection for extension diagnostics
let extensionDiagnostics: any | null = null;

// Registered extension commands
const registeredCommands = new Set<string>();

/**
 * Get or create an output channel for an extension
 */
async function getOutputChannel(channelName: string) {
  let channel = extensionOutputChannels.get(channelName);
  if (!channel) {
    const log: any = await getService(ILogService as any);
    channel = {
      appendLine: (s: string) => (log?.info ? log.info(`[Ext:${channelName}] ${s}`) : console.log(`[Ext:${channelName}] ${s}`)),
      show: () => {},
    };
    extensionOutputChannels.set(channelName, channel);
  }
  return channel;
}

/**
 * Show notification using vscode API
 */
async function showNotification(level: string, message: string): Promise<void> {
  const notifier: any = await getService(INotificationService as any);
  const log: any = await getService(ILogService as any);
  const sev = (level || 'info').toLowerCase();
  if (sev === 'error') {
    log?.error ? log.error(message) : console.error(message);
    notifier?.error ? notifier.error(message) : console.error(message);
  } else if (sev === 'warning' || sev === 'warn') {
    log?.warn ? log.warn(message) : console.warn(message);
    notifier?.warn ? notifier.warn(message) : console.warn(message);
  } else {
    log?.info ? log.info(message) : console.log(message);
    notifier?.info ? notifier.info(message) : console.log(message);
  }
}

/**
 * Convert extension diagnostic severity to VS Code DiagnosticSeverity
 */
function toDiagnosticSeverity(severity: number): any {
  const VS = vscode && vscode.DiagnosticSeverity ? vscode.DiagnosticSeverity : { Error: 0, Warning: 1, Information: 2, Hint: 3 };
  switch (severity) {
    case 1:
      return VS.Error;
    case 2:
      return VS.Warning;
    case 3:
      return VS.Information;
    case 4:
      return VS.Hint;
    default:
      return VS.Error;
  }
}

/**
 * Set up event handlers for extension host events
 */
function setupEventHandlers(): void {
  extensionDiagnostics =
    vscode && vscode.languages && vscode.languages.createDiagnosticCollection ? vscode.languages.createDiagnosticCollection('extension-host') : null;

  // Handle notifications from extensions
  extensionHostService.onNotification((notification) => {
    console.log(`[Extension ${notification.level}] ${notification.message}`);
    showNotification(notification.level, notification.message);
  });

  // Handle output channel messages
  extensionHostService.onOutput((output) => {
    console.log(`[Extension Output: ${output.channel}] ${output.text}`);
    (async () => {
      const channel = await getOutputChannel(output.channel);
      channel.appendLine(output.text);
    })();
  });

  // Handle diagnostics from extensions
  extensionHostService.onDiagnostics((diagnosticsData) => {
    console.log(`[Extension Diagnostics] ${diagnosticsData.uri}:`, diagnosticsData.diagnostics);

    // Push diagnostics to VS Code diagnostics service
    if (extensionDiagnostics) {
      if (vscode && vscode.Uri && vscode.Range && vscode.Diagnostic) {
        const uri = vscode.Uri.parse(diagnosticsData.uri);
        const diagnostics = diagnosticsData.diagnostics.map(
          (d: {
            range: { start: { line: number; character: number }; end: { line: number; character: number } };
            message: string;
            severity: number;
            source?: string;
            code?: string;
          }) => {
            const range = new vscode.Range(d.range.start.line, d.range.start.character, d.range.end.line, d.range.end.character);
            const diagnostic = new vscode.Diagnostic(range, d.message, toDiagnosticSeverity(d.severity));
            if (d.source) {
              diagnostic.source = d.source;
            }
            if (d.code) {
              diagnostic.code = d.code as any;
            }
            return diagnostic;
          }
        );
        extensionDiagnostics.set(uri, diagnostics);
      }
    }
  });

  // Handle provider registrations
  extensionHostService.onProviderRegistered((provider) => {
    console.log(`[Extension Provider] Registered ${provider.kind} provider:`, provider.id);
    // Provider registration is handled by the extension host sidecar
    // The sidecar bridges the providers to our language features
  });

  // Handle command registrations
  extensionHostService.onCommandRegistered((command) => {
    console.log(`[Extension Command] Registered: ${command.command}`);

    // Register command in VS Code if not already registered
    if (!registeredCommands.has(command.command)) {
      registeredCommands.add(command.command);

      // Register command that proxies to extension host
      if (vscode && vscode.commands && vscode.window) {
        vscode.commands.registerCommand(command.command, async (...args: unknown[]) => {
          try {
            const result = await extensionHostService.executeCommand(command.command, args);
            return result;
          } catch (error) {
            console.error(`[Extension Command] Error executing ${command.command}:`, error);
            vscode.window.showErrorMessage(`Command failed: ${command.command}`);
          }
        });
      }
    }
  });

  // Handle extension host exit
  extensionHostService.onExit(() => {
    console.warn('[ExtensionHostIntegration] Extension host exited unexpectedly');

    // Show notification with restart option
    if (vscode && vscode.window && vscode.window.showErrorMessage) {
      vscode.window
        .showErrorMessage('Extension host exited unexpectedly. Some extensions may not work.', 'Restart Extension Host')
        .then((selection: any) => {
          if (selection === 'Restart Extension Host') {
            restartExtensionHost();
          }
        });
    } else {
      showNotification('error', 'Extension host exited unexpectedly. Some extensions may not work.');
    }
  });
}

/**
 * Restart the extension host after unexpected exit
 */
async function restartExtensionHost(): Promise<void> {
  try {
    console.log('[ExtensionHostIntegration] Restarting extension host...');
    await extensionHostService.stop();
    await extensionHostService.start();
    await waitForReady();
    await activateInstalledExtensions();
    if (vscode && vscode.window) vscode.window.showInformationMessage('Extension host restarted successfully');
  } catch (error) {
    console.error('[ExtensionHostIntegration] Failed to restart extension host:', error);
    if (vscode && vscode.window) vscode.window.showErrorMessage('Failed to restart extension host');
  }
}

/**
 * Activate installed extensions that require Node.js
 */
async function activateInstalledExtensions(): Promise<void> {
  try {
    // Get list of installed extensions
    const extensions = await invoke<InstalledExtension[]>('list_installed_extensions');
    console.log(`[ExtensionHostIntegration] Found ${extensions.length} installed extensions`);

    for (const ext of extensions) {
      console.log(`[ExtensionHostIntegration] Extension: ${ext.extensionId}`, {
        main: ext.manifest.main,
        browser: ext.manifest.browser,
        path: ext.extensionPath,
      });

      // Check if this is a Node.js extension (has 'main' but not 'browser')
      if (ext.manifest.main && !ext.manifest.browser) {
        console.log(`[ExtensionHostIntegration] Activating Node.js extension: ${ext.extensionId}`);
        await activateExtension(ext);
      } else if (ext.manifest.browser) {
        console.log(`[ExtensionHostIntegration] Skipping browser extension: ${ext.extensionId}`);
      } else {
        console.log(`[ExtensionHostIntegration] Skipping extension without entry point: ${ext.extensionId}`);
      }
    }
  } catch (error) {
    console.error('[ExtensionHostIntegration] Failed to activate installed extensions:', error);
  }
}

/**
 * Activate a single extension in the extension host
 */
async function activateExtension(extension: InstalledExtension): Promise<void> {
  try {
    const result = await extensionHostService.activateExtension(extension.extensionPath, extension.extensionId);

    if (result.success) {
      console.log(`[ExtensionHostIntegration] Activated: ${extension.extensionId}`);
    } else {
      console.error(`[ExtensionHostIntegration] Failed to activate ${extension.extensionId}:`, result.error);
    }
  } catch (error) {
    console.error(`[ExtensionHostIntegration] Error activating ${extension.extensionId}:`, error);
  }
}

/**
 * Install and activate a Node.js extension
 * Call this when user installs an extension that requires Node.js
 */
export async function installNodeExtension(extensionPath: string, extensionId: string): Promise<boolean> {
  try {
    const result = await extensionHostService.activateExtension(extensionPath, extensionId);
    return result.success ?? false;
  } catch (error) {
    console.error(`[ExtensionHostIntegration] Failed to install ${extensionId}:`, error);
    return false;
  }
}

/**
 * Uninstall a Node.js extension
 */
export async function uninstallNodeExtension(extensionId: string): Promise<boolean> {
  try {
    const result = await extensionHostService.deactivateExtension(extensionId);
    return result.success ?? false;
  } catch (error) {
    console.error(`[ExtensionHostIntegration] Failed to uninstall ${extensionId}:`, error);
    return false;
  }
}

/**
 * Stop the extension host
 */
export async function stopExtensionHost(): Promise<void> {
  await extensionHostService.stop();
}

/**
 * Get list of currently activated Node.js extensions
 */
export async function getActivatedNodeExtensions(): Promise<string[]> {
  return extensionHostService.getActivatedExtensions();
}
