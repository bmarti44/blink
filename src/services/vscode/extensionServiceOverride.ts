/**
 * Extension Service Override
 *
 * Overrides VS Code's extension management services to:
 * 1. Enable install button for all extensions
 * 2. Route installations through Tauri
 * 3. Show Tauri-installed extensions in the UI
 * 4. Make VS Code believe it's in a native environment (not web)
 *
 * IMPORTANT: This file contains extensive debugging to help diagnose
 * why Node.js extensions show as "not available for web platform"
 */

import {
  IWorkbenchExtensionManagementService,
  IWorkbenchExtensionEnablementService,
} from '@codingame/monaco-vscode-api/vscode/vs/workbench/services/extensionManagement/common/extensionManagement.service';
import { IExtensionManagementService } from '@codingame/monaco-vscode-api/vscode/vs/platform/extensionManagement/common/extensionManagement.service';
import { IExtensionsWorkbenchService } from '@codingame/monaco-vscode-api/vscode/vs/workbench/contrib/extensions/common/extensions.service';
import { Emitter, Event } from '@codingame/monaco-vscode-api/vscode/vs/base/common/event';
import { URI } from '@codingame/monaco-vscode-api/vscode/vs/base/common/uri';
import { readFile, exists } from '@tauri-apps/plugin-fs';
import { getTauriExtensionManager, installExtensionFromGallery, isExtensionInstalled, type GalleryExtension } from './tauriExtensionManagementService';
import { createTauriLocalExtensionManagementServer, getTauriLocalExtensionServer } from './tauriLocalExtensionServer';

/**
 * Cache for extension file contents to avoid repeated reads when switching tabs
 * Key format: `${extensionPath}/${filename}`
 */
const extensionFileCache = new Map<string, string>();

/**
 * Helper to read a file from extension directory, returns empty string if not found
 * Results are cached to prevent CPU-intensive repeated reads when switching tabs
 */
async function readExtensionFile(extensionPath: string, filename: string): Promise<string> {
  const cacheKey = `${extensionPath}/${filename}`;

  // Return cached result if available
  if (extensionFileCache.has(cacheKey)) {
    debugLog('ReadFile', `Cache hit for ${filename} in ${extensionPath}`);
    return extensionFileCache.get(cacheKey)!;
  }

  try {
    // Try common variations of the filename (case-insensitive filesystems may differ)
    const variations = [filename, filename.toUpperCase(), filename.toLowerCase()];
    for (const name of variations) {
      const filePath = `${extensionPath}/${name}`;
      if (await exists(filePath)) {
        const content = await readFile(filePath);
        const decoded = new TextDecoder().decode(content);
        // Cache the result
        extensionFileCache.set(cacheKey, decoded);
        debugLog('ReadFile', `Cached ${filename} from ${extensionPath} (${decoded.length} chars)`);
        return decoded;
      }
    }
    // Cache empty result to avoid repeated failed lookups
    extensionFileCache.set(cacheKey, '');
    return '';
  } catch (err) {
    debugLog('ReadFile', `Failed to read ${filename} from ${extensionPath}:`, err);
    // Cache empty result on error
    extensionFileCache.set(cacheKey, '');
    return '';
  }
}

// Note: TauriExtensionManagementServerService was removed because it broke the install
// functionality. The service needs webExtensionManagementServer to be set by the web
// extension scanner, and our custom service had it as null. The INSTALLED view issue
// needs a different solution - see comments in registerTauriAsLocalServer().

// Debug logging helper
function debugLog(category: string, message: string, data?: unknown): void {
  const timestamp = new Date().toISOString().substring(11, 23);
  console.log(`[${timestamp}][ExtOverride:${category}] ${message}`, data !== undefined ? data : '');
}

/**
 * Patch extension services after initialization
 * This enables installation for all extensions and integrates with Tauri
 */
export async function patchExtensionServices(): Promise<void> {
  debugLog('Init', 'Starting extension services patch...');

  try {
    const { StandaloneServices } = await import('@codingame/monaco-vscode-api/services');
    debugLog('Init', 'StandaloneServices imported successfully');

    // CRITICAL: Patch environment service FIRST to make VS Code think it's native
    // This must happen before any other service checks isWeb
    await patchEnvironmentService(StandaloneServices);

    // Log all available services for debugging
    debugLog('Init', 'Attempting to access services...');

    // Initialize Tauri extension manager
    const tauriManager = getTauriExtensionManager();
    await tauriManager.loadInstalledExtensions();
    debugLog('Init', 'Tauri extension manager initialized');

    // CRITICAL: Register Tauri as the LOCAL extension server
    // This makes VS Code think it has Electron-like capabilities
    await registerTauriAsLocalServer(StandaloneServices);

    // CRITICAL: Patch getExtensionManagementServersToInstall FIRST
    // This is the method that throws "Unsupported" when no servers can install
    await patchWorkbenchExtensionManagementServersMethod(StandaloneServices);

    // Patch the workbench extension management service
    await patchExtensionManagementService(StandaloneServices);

    // CRITICAL: Patch the PLATFORM extension management service
    // This is the actual service that ExtensionsWorkbenchService.uninstall() calls!
    await patchPlatformExtensionManagementService(StandaloneServices);

    // Patch the extensions workbench service (UI)
    await patchExtensionsWorkbenchService(StandaloneServices);

    // Also try to patch individual extension management servers
    await patchExtensionManagementServers(StandaloneServices);

    // Patch at the gallery level
    await patchGalleryCanInstall(StandaloneServices);

    // CRITICAL: Patch the extension enablement service
    // This prevents "not supported in web" disabling
    await patchExtensionEnablementService(StandaloneServices);

    // Patch extension kind checks to allow Node.js extensions
    await patchExtensionKind(StandaloneServices);

    debugLog('Init', '='.repeat(60));
    debugLog('Init', 'ALL EXTENSION SERVICES PATCHED');
    debugLog('Init', 'If ESLint still shows "not available", check:');
    debugLog('Init', '  1. Console for [ExtOverride:*] logs when searching');
    debugLog('Init', '  2. Whether canInstall is actually being called');
    debugLog('Init', '  3. The hasLocal/hasRemote/hasWeb server status');
    debugLog('Init', '='.repeat(60));
  } catch (err) {
    debugLog('Init', 'FAILED to patch extension services:', err);
    console.error('[ExtOverride] Stack trace:', err instanceof Error ? err.stack : err);
  }
}

/**
 * Patch the extension management service to enable all installations
 */
async function patchExtensionManagementService(services: { get: <T>(id: unknown) => T }): Promise<void> {
  debugLog('MgmtService', 'Patching IWorkbenchExtensionManagementService...');

  const extMgmtService = services.get(IWorkbenchExtensionManagementService) as Record<string, unknown> | null;

  if (!extMgmtService) {
    debugLog('MgmtService', 'WARNING: Extension management service not found');
    return;
  }

  // Log available methods
  const methods = Object.keys(extMgmtService).filter(k => typeof extMgmtService[k] === 'function');
  debugLog('MgmtService', 'Available methods:', methods.slice(0, 20).join(', '));

  // Also log prototype methods which might be where the actual implementation is
  const protoMethods = Object.getOwnPropertyNames(Object.getPrototypeOf(extMgmtService))
    .filter(k => typeof (extMgmtService as Record<string, unknown>)[k] === 'function');
  debugLog('MgmtService', 'Prototype methods:', protoMethods.slice(0, 20).join(', '));

  // Store original methods
  const originalCanInstall = (extMgmtService.canInstall as (extension: unknown) => Promise<boolean | unknown>).bind(extMgmtService);
  const originalInstallFromGallery = (extMgmtService.installFromGallery as (gallery: unknown, options?: unknown, servers?: unknown) => Promise<unknown>).bind(extMgmtService);
  const originalGetInstalled = (extMgmtService.getInstalled as (type?: number) => Promise<unknown[]>).bind(extMgmtService);
  const originalGetInstallableServers = (extMgmtService.getInstallableServers as (gallery: unknown) => Promise<unknown[]>).bind(extMgmtService);

  // Override canInstall to always return true
  if (originalCanInstall) {
    extMgmtService.canInstall = async (extension: unknown): Promise<boolean> => {
      const extId = getExtensionId(extension);
      debugLog('MgmtService.canInstall', `>>> CALLED FOR: ${extId}`);

      // First check if already installed via Tauri
      if (extId && isExtensionInstalled(extId)) {
        debugLog('MgmtService.canInstall', `Already installed via Tauri: ${extId}`);
        return true;
      }

      // ALWAYS return true - we handle via Tauri
      debugLog('MgmtService.canInstall', `>>> FORCING TRUE for: ${extId}`);
      return true;
    };
    debugLog('MgmtService', '*** canInstall PATCHED ***');
  }

  // CRITICAL: Override installFromGallery to use Tauri
  // This is the method that actually gets called for installation
  if (originalInstallFromGallery) {
    extMgmtService.installFromGallery = async (
      gallery: unknown,
      options?: unknown,
      servers?: unknown
    ): Promise<unknown> => {
      const g = gallery as GalleryExtension;
      const extId = g.identifier.id || `${g.publisher}.${g.name}`;
      debugLog('MgmtService.installFromGallery', `>>> CALLED FOR: ${extId}`);
      debugLog('MgmtService.installFromGallery', 'Gallery keys:', Object.keys(g).join(', '));
      debugLog('MgmtService.installFromGallery', 'Options:', options);
      debugLog('MgmtService.installFromGallery', 'Servers:', servers);

      try {
        // Try Tauri installation first - this works for ALL extensions
        debugLog('MgmtService.installFromGallery', 'Attempting Tauri installation...');
        const local = await installExtensionFromGallery(g);
        debugLog('MgmtService.installFromGallery', `SUCCESS: Installed via Tauri: ${extId}`);
        return local;
      } catch (err) {
        debugLog('MgmtService.installFromGallery', `Tauri install failed:`, err);
        // Don't fall back to original - it will throw "Unsupported" for Node.js extensions
        // Instead, re-throw with a more helpful message
        throw new Error(`Failed to install ${extId}: ${err instanceof Error ? err.message : err}`);
      }
    };
    debugLog('MgmtService', '*** installFromGallery PATCHED ***');
  } else {
    debugLog('MgmtService', 'WARNING: installFromGallery not found!');
  }

  // Patch getInstallableServers to return a fake server for all extensions
  // This allows the install flow to proceed
  if (originalGetInstallableServers) {
    extMgmtService.getInstallableServers = async (gallery: unknown): Promise<unknown[]> => {
      const g = gallery as GalleryExtension;
      const extId = g.identifier.id || `${g.publisher}.${g.name}`;
      debugLog('MgmtService.getInstallableServers', `>>> CALLED FOR: ${extId}`);

      // Get original result
      const originalServers = await originalGetInstallableServers(gallery);
      debugLog('MgmtService.getInstallableServers', `Original returned ${originalServers.length || 0} servers`);

      // If there are already installable servers, use them
      if (originalServers && originalServers.length > 0) {
        return originalServers;
      }

      // Otherwise, we need to provide a fake server so the install flow can proceed
      // This is a workaround - the actual installation will be handled by our installFromGallery patch
      debugLog('MgmtService.getInstallableServers', 'No servers found, returning placeholder');

      // Return an empty array - our installFromGallery patch will handle it
      // The key is that we patched installFromGallery to not actually use the servers
      return [];
    };
    debugLog('MgmtService', '*** getInstallableServers PATCHED ***');
  }

  // Override getInstalled to include Tauri extensions
  if (originalGetInstalled) {
    extMgmtService.getInstalled = async (type?: number): Promise<unknown[]> => {
      const originalInstalled = await originalGetInstalled(type);
      const tauriInstalled = getTauriExtensionManager().getAllInstalled();

      debugLog('MgmtService.getInstalled', `Original: ${originalInstalled.length}, Tauri: ${tauriInstalled.length}`);

      // Merge, avoiding duplicates
      const installedIds = new Set((originalInstalled as { identifier?: { id: string } }[])
        .map(e => e.identifier?.id.toLowerCase())
        .filter(Boolean));

      const combined = [...originalInstalled];
      for (const ext of tauriInstalled) {
        if (!installedIds.has(ext.identifier.id.toLowerCase())) {
          combined.push(ext);
        }
      }

      return combined;
    };
    debugLog('MgmtService', '*** getInstalled PATCHED ***');
  }

  // CRITICAL: Patch uninstall methods on IWorkbenchExtensionManagementService
  // This is where VS Code's UninstallAction actually calls!
  const originalUninstall = extMgmtService.uninstall as ((extension: unknown) => Promise<void>) | undefined;
  const mgmtProto = Object.getPrototypeOf(extMgmtService) as Record<string, unknown>;
  const protoUninstall = mgmtProto.uninstall as ((extension: unknown) => Promise<void>) | undefined;

  console.log('[ExtOverride] IWorkbenchExtensionManagementService.uninstall - instance:', typeof originalUninstall, ', proto:', typeof protoUninstall);

  const createMgmtUninstallHandler = (origFn: ((extension: unknown) => Promise<void>) | undefined) => {
    return async function(this: unknown, extension: unknown): Promise<void> {
      const ext = extension as { identifier?: { id: string }; local?: { identifier?: { id: string } } };
      const extId = ext.identifier?.id || ext.local?.identifier?.id;
      console.log(`[ExtOverride] >>> IWorkbenchExtensionManagementService.uninstall CALLED for: ${extId}`);

      if (!extId) {
        console.log('[ExtOverride] No extension ID, calling original');
        if (origFn) return origFn.call(this, extension);
        throw new Error('Cannot uninstall extension: no ID found');
      }

      // CRITICAL: Fire onUninstallExtension BEFORE uninstall to signal start
      // VS Code's UninstallAction listens for this
      const onUninstallEmitter = (extMgmtService as Record<string, unknown>)._onUninstallExtension as { fire?: (e: unknown) => void } | undefined;
      if (onUninstallEmitter?.fire) {
        console.log(`[ExtOverride] >>> Firing _onUninstallExtension (start signal)`);
        onUninstallEmitter.fire({ identifier: { id: extId } });
      }

      try {
        // Use Tauri to uninstall
        console.log(`[ExtOverride] >>> Uninstalling via Tauri: ${extId}`);
        const tauriServer = getTauriLocalExtensionServer();
        const localExt = (ext.local || ext) as Parameters<typeof tauriServer.uninstall>[0];
        await tauriServer.uninstall(localExt);
        console.log(`[ExtOverride] >>> Successfully uninstalled from disk: ${extId}`);

        // CRITICAL: Update UI state after successful uninstall
        // Get the extensions workbench service to update UI
        const extWorkbenchSvc = services.get(IExtensionsWorkbenchService) as Record<string, unknown> | null;
        if (extWorkbenchSvc) {
          console.log(`[ExtOverride] >>> Updating UI for uninstalled: ${extId}`);

          // Remove from installed/local arrays
          const removeFromArray = (arr: unknown[] | undefined, id: string) => {
            if (!Array.isArray(arr)) return;
            const idx = arr.findIndex((e: { identifier?: { id: string } }) =>
              e.identifier?.id.toLowerCase() === id.toLowerCase()
            );
            if (idx !== -1) {
              arr.splice(idx, 1);
              console.log(`[ExtOverride] >>> Removed from array at index ${idx}`);
            }
          };

          removeFromArray(extWorkbenchSvc.installed as unknown[], extId);
          removeFromArray(extWorkbenchSvc.local as unknown[], extId);

          // Also remove from extensions array if it exists
          removeFromArray((extWorkbenchSvc as Record<string, unknown>).extensions as unknown[], extId);

          // Update extension state in _extensions map if it exists
          const extensionsMap = extWorkbenchSvc._extensions as Map<string, { state?: number; local?: unknown }> | undefined;
          if (extensionsMap) {
            const mapExt = extensionsMap.get(extId.toLowerCase());
            if (mapExt) {
              mapExt.state = 3; // Uninstalled
              mapExt.local = undefined;
              console.log(`[ExtOverride] >>> Updated state in _extensions map to Uninstalled`);
            }
          }

          // Fire _onDidChangeExtension for this specific extension
          const onDidChangeExtension = extWorkbenchSvc._onDidChangeExtension as { fire?: (e: unknown) => void } | undefined;
          if (onDidChangeExtension?.fire) {
            console.log(`[ExtOverride] >>> Firing _onDidChangeExtension`);
            onDidChangeExtension.fire({ identifier: { id: extId } });
          }

          // Fire UI change events
          const onChange = extWorkbenchSvc._onChange as { fire?: () => void } | undefined;
          if (typeof onChange?.fire === 'function') {
            onChange.fire();
            console.log(`[ExtOverride] >>> Fired _onChange event`);
          }
        }

        // CRITICAL: Fire onDidUninstallExtension on the MANAGEMENT service
        // This is what VS Code's UninstallAction waits for to complete
        const onDidUninstallEmitter = (extMgmtService as Record<string, unknown>)._onDidUninstallExtension as { fire?: (e: unknown) => void } | undefined;
        if (onDidUninstallEmitter?.fire) {
          console.log(`[ExtOverride] >>> Firing _onDidUninstallExtension on MgmtService (completion signal)`);
          onDidUninstallEmitter.fire({ identifier: { id: extId } });
        }

        // Also fire on the workbench service if it has its own emitter
        if (extWorkbenchSvc) {
          const workbenchOnDidUninstall = extWorkbenchSvc._onDidUninstallExtension as { fire?: (e: unknown) => void } | undefined;
          if (workbenchOnDidUninstall?.fire) {
            console.log(`[ExtOverride] >>> Firing _onDidUninstallExtension on WorkbenchService`);
            workbenchOnDidUninstall.fire({ identifier: { id: extId } });
          }
        }

        console.log(`[ExtOverride] >>> Uninstall complete: ${extId}`);
      } catch (err) {
        console.error(`[ExtOverride] >>> Tauri uninstall failed:`, err);

        // Fire error event - serialize error to avoid IPC issues
        const onDidUninstallEmitter = (extMgmtService as Record<string, unknown>)._onDidUninstallExtension as { fire?: (e: unknown) => void } | undefined;
        if (onDidUninstallEmitter?.fire) {
          console.log(`[ExtOverride] >>> Firing _onDidUninstallExtension with error`);
          const errorMsg = err instanceof Error ? err.message : String(err);
          onDidUninstallEmitter.fire({ identifier: { id: extId }, error: errorMsg });
        }

        if (origFn) {
          console.log('[ExtOverride] >>> Trying original uninstall...');
          return origFn.call(this, extension);
        }
        throw err;
      }
    };
  };

  // Patch on instance using Object.defineProperty (required for bound methods)
  if (typeof originalUninstall === 'function' || typeof protoUninstall === 'function') {
    const patchedHandler = createMgmtUninstallHandler(originalUninstall || protoUninstall);
    Object.defineProperty(extMgmtService, 'uninstall', {
      value: patchedHandler,
      writable: true,
      configurable: true
    });
    debugLog('MgmtService', '*** uninstall PATCHED on instance via defineProperty ***');
  }

  // Also patch on prototype
  if (mgmtProto && typeof protoUninstall === 'function') {
    const patchedHandler = createMgmtUninstallHandler(protoUninstall);
    Object.defineProperty(mgmtProto, 'uninstall', {
      value: patchedHandler,
      writable: true,
      configurable: true
    });
    debugLog('MgmtService', '*** uninstall PATCHED on prototype via defineProperty ***');
  }

  // If no uninstall exists, add one
  if (typeof originalUninstall !== 'function' && typeof protoUninstall !== 'function') {
    console.log('[ExtOverride] WARNING: No uninstall on IWorkbenchExtensionManagementService - adding one');
    const patchedHandler = createMgmtUninstallHandler(undefined);
    Object.defineProperty(extMgmtService, 'uninstall', {
      value: patchedHandler,
      writable: true,
      configurable: true
    });
    debugLog('MgmtService', '*** uninstall ADDED via defineProperty ***');
  }

  // CRITICAL: Also patch uninstallExtensions - this is what ExtensionsWorkbenchService.uninstall() actually calls!
  const originalUninstallExtensions = extMgmtService.uninstallExtensions as ((extensions: unknown[]) => Promise<void>) | undefined;
  const protoUninstallExtensions = mgmtProto.uninstallExtensions as ((extensions: unknown[]) => Promise<void>) | undefined;

  console.log('[ExtOverride] IWorkbenchExtensionManagementService.uninstallExtensions - instance:', typeof originalUninstallExtensions, ', proto:', typeof protoUninstallExtensions);

  const createMgmtUninstallExtensionsHandler = (_origFn: ((extensions: unknown[]) => Promise<void>) | undefined) => {
    return async function(this: unknown, extensions: unknown[]): Promise<void> {
      console.log(`[ExtOverride] >>> IWorkbenchExtensionManagementService.uninstallExtensions CALLED for ${extensions.length} extensions`);

      for (const extInfo of extensions) {
        const info = extInfo as { extension?: { identifier?: { id: string }; local?: { identifier?: { id: string } } } };
        const ext = info.extension;
        const extId = ext?.identifier?.id || ext?.local?.identifier?.id;
        console.log(`[ExtOverride] >>> Processing uninstall for: ${extId}`);

        if (!extId) {
          console.log('[ExtOverride] No extension ID found, skipping');
          continue;
        }

        // Fire onUninstallExtension BEFORE uninstall
        const onUninstallEmitter = (extMgmtService as Record<string, unknown>)._onUninstallExtension as { fire?: (e: unknown) => void } | undefined;
        if (onUninstallEmitter?.fire) {
          console.log(`[ExtOverride] >>> Firing _onUninstallExtension for: ${extId}`);
          onUninstallEmitter.fire({ identifier: { id: extId } });
        }

        try {
          // Use Tauri to uninstall
          console.log(`[ExtOverride] >>> Uninstalling via Tauri: ${extId}`);
          const tauriServer = getTauriLocalExtensionServer();
          const localExt = (ext.local || ext) as Parameters<typeof tauriServer.uninstall>[0];
          await tauriServer.uninstall(localExt);
          console.log(`[ExtOverride] >>> Successfully uninstalled from disk: ${extId}`);

          // Fire onDidUninstallExtension AFTER successful uninstall
          const onDidUninstallEmitter = (extMgmtService as Record<string, unknown>)._onDidUninstallExtension as { fire?: (e: unknown) => void } | undefined;
          if (onDidUninstallEmitter?.fire) {
            console.log(`[ExtOverride] >>> Firing _onDidUninstallExtension for: ${extId}`);
            onDidUninstallEmitter.fire({ identifier: { id: extId } });
          }

          // CRITICAL: Directly update ExtensionsWorkbenchService UI state
          // The Extensions class that manages UI listens to server.extensionManagementService events,
          // NOT IWorkbenchExtensionManagementService events. So we must update UI directly.
          const extWorkbenchSvc = services.get(IExtensionsWorkbenchService) as Record<string, unknown> | null;
          if (extWorkbenchSvc) {
            console.log(`[ExtOverride] >>> Updating ExtensionsWorkbenchService UI for: ${extId}`);

            // Get the extensionsServers array which contains Extensions instances
            const extensionsServers = extWorkbenchSvc.extensionsServers as Array<{
              installed?: Array<{ identifier?: { id: string } }>;
              uninstalling?: Array<{ identifier?: { id: string } }>;
              _onChange?: { fire?: (e: unknown) => void };
              onDidUninstallExtension?: (e: { identifier: { id: string }; error?: string }) => void;
            }> | undefined;

            if (extensionsServers) {
              console.log(`[ExtOverride] >>> Found ${extensionsServers.length} extension servers`);
              for (const extServer of extensionsServers) {
                // Try to call onDidUninstallExtension if it exists
                if (typeof extServer.onDidUninstallExtension === 'function') {
                  console.log(`[ExtOverride] >>> Calling onDidUninstallExtension on Extensions instance`);
                  extServer.onDidUninstallExtension({ identifier: { id: extId } });
                } else {
                  // Manually update the arrays
                  if (extServer.installed) {
                    const idx = extServer.installed.findIndex(e =>
                      e.identifier?.id.toLowerCase() === extId.toLowerCase()
                    );
                    if (idx !== -1) {
                      console.log(`[ExtOverride] >>> Removing from installed at index ${idx}`);
                      extServer.installed.splice(idx, 1);
                    }
                  }
                  if (extServer.uninstalling) {
                    extServer.uninstalling = extServer.uninstalling.filter(e =>
                      e.identifier?.id.toLowerCase() !== extId.toLowerCase()
                    );
                  }
                  // Fire change event
                  if (extServer._onChange?.fire) {
                    console.log(`[ExtOverride] >>> Firing _onChange on Extensions instance`);
                    extServer._onChange.fire(undefined);
                  }
                }
              }
            }

            // Also clear the cached _installed and _local arrays
            extWorkbenchSvc._installed = undefined;
            extWorkbenchSvc._local = undefined;

            // Fire the main onChange event
            const mainOnChange = extWorkbenchSvc._onChange as { fire?: (e: unknown) => void } | undefined;
            if (mainOnChange?.fire) {
              console.log(`[ExtOverride] >>> Firing main _onChange event`);
              mainOnChange.fire(undefined);
            }
          }
        } catch (err) {
          console.error(`[ExtOverride] >>> Tauri uninstall failed for ${extId}:`, err);

          // Fire error event
          const onDidUninstallEmitter = (extMgmtService as Record<string, unknown>)._onDidUninstallExtension as { fire?: (e: unknown) => void } | undefined;
          if (onDidUninstallEmitter?.fire) {
            onDidUninstallEmitter.fire({ identifier: { id: extId }, error: String(err) });
          }
        }
      }

      console.log(`[ExtOverride] >>> uninstallExtensions complete`);
    };
  };

  // Patch uninstallExtensions on instance using Object.defineProperty (required for bound methods)
  if (typeof originalUninstallExtensions === 'function' || typeof protoUninstallExtensions === 'function') {
    const patchedHandler = createMgmtUninstallExtensionsHandler(originalUninstallExtensions || protoUninstallExtensions);
    Object.defineProperty(extMgmtService, 'uninstallExtensions', {
      value: patchedHandler,
      writable: true,
      configurable: true
    });
    debugLog('MgmtService', '*** uninstallExtensions PATCHED on instance via defineProperty ***');
  }

  // Also patch on prototype
  if (mgmtProto && typeof protoUninstallExtensions === 'function') {
    const patchedHandler = createMgmtUninstallExtensionsHandler(protoUninstallExtensions);
    Object.defineProperty(mgmtProto, 'uninstallExtensions', {
      value: patchedHandler,
      writable: true,
      configurable: true
    });
    debugLog('MgmtService', '*** uninstallExtensions PATCHED on prototype via defineProperty ***');
  }

  // If no uninstallExtensions exists, add one
  if (typeof originalUninstallExtensions !== 'function' && typeof protoUninstallExtensions !== 'function') {
    console.log('[ExtOverride] WARNING: No uninstallExtensions on IWorkbenchExtensionManagementService - adding one');
    const patchedHandler = createMgmtUninstallExtensionsHandler(undefined);
    Object.defineProperty(extMgmtService, 'uninstallExtensions', {
      value: patchedHandler,
      writable: true,
      configurable: true
    });
    debugLog('MgmtService', '*** uninstallExtensions ADDED via defineProperty ***');
  }

  debugLog('MgmtService', 'IWorkbenchExtensionManagementService fully patched');
}

/**
 * Patch the PLATFORM extension management service (IExtensionManagementService)
 *
 * CRITICAL: This is NOT the same as IWorkbenchExtensionManagementService!
 * ExtensionsWorkbenchService.extensionManagementService is actually IExtensionManagementService,
 * which is the platform-level service. When ExtensionsWorkbenchService.uninstall() calls
 * this.extensionManagementService.uninstallExtensions(), it's calling IExtensionManagementService,
 * NOT IWorkbenchExtensionManagementService.
 */
async function patchPlatformExtensionManagementService(services: { get: <T>(id: unknown) => T }): Promise<void> {
  debugLog('PlatformMgmt', 'Patching IExtensionManagementService (platform service)...');

  const platformService = services.get(IExtensionManagementService) as Record<string, unknown> | null;

  if (!platformService) {
    debugLog('PlatformMgmt', 'WARNING: Platform extension management service not found');
    return;
  }

  // Log available methods
  const methods = Object.keys(platformService).filter(k => typeof platformService[k] === 'function');
  debugLog('PlatformMgmt', 'Available methods:', methods.slice(0, 20).join(', '));

  const proto = Object.getPrototypeOf(platformService) as Record<string, unknown>;
  const protoMethods = proto ? Object.getOwnPropertyNames(proto).filter(k => typeof proto[k] === 'function') : [];
  debugLog('PlatformMgmt', 'Prototype methods:', protoMethods.slice(0, 20).join(', '));

  // Store original methods
  const originalUninstall = platformService.uninstall as ((extension: unknown) => Promise<void>) | undefined;
  const protoUninstall = proto.uninstall as ((extension: unknown) => Promise<void>) | undefined;

  console.log('[ExtOverride] IExtensionManagementService.uninstall - instance:', typeof originalUninstall, ', proto:', typeof protoUninstall);

  // Create the uninstall handler
  const createPlatformUninstallHandler = (origFn: ((extension: unknown) => Promise<void>) | undefined) => {
    return async function(this: unknown, extension: unknown): Promise<void> {
      const ext = extension as { identifier?: { id: string }; local?: { identifier?: { id: string } } };
      const extId = ext.identifier?.id || ext.local?.identifier?.id;
      console.log(`[ExtOverride] >>> IExtensionManagementService.uninstall CALLED for: ${extId}`);

      if (!extId) {
        console.log('[ExtOverride] No extension ID, calling original');
        if (origFn) return origFn.call(this, extension);
        throw new Error('Cannot uninstall extension: no ID found');
      }

      // Fire onUninstallExtension BEFORE uninstall
      const onUninstallEmitter = (platformService as Record<string, unknown>)._onUninstallExtension as { fire?: (e: unknown) => void } | undefined;
      if (onUninstallEmitter?.fire) {
        console.log(`[ExtOverride] >>> Firing _onUninstallExtension on platform service`);
        onUninstallEmitter.fire({ identifier: { id: extId } });
      }

      try {
        // Use Tauri to uninstall
        console.log(`[ExtOverride] >>> Uninstalling via Tauri: ${extId}`);
        const tauriServer = getTauriLocalExtensionServer();
        const localExt = (ext.local || ext) as Parameters<typeof tauriServer.uninstall>[0];
        await tauriServer.uninstall(localExt);
        console.log(`[ExtOverride] >>> Successfully uninstalled from disk: ${extId}`);

        // Fire onDidUninstallExtension AFTER successful uninstall
        const onDidUninstallEmitter = (platformService as Record<string, unknown>)._onDidUninstallExtension as { fire?: (e: unknown) => void } | undefined;
        if (onDidUninstallEmitter?.fire) {
          console.log(`[ExtOverride] >>> Firing _onDidUninstallExtension on platform service`);
          onDidUninstallEmitter.fire({ identifier: { id: extId } });
        }

        // CRITICAL: Also update ExtensionsWorkbenchService UI directly
        const extWorkbenchSvc = services.get(IExtensionsWorkbenchService) as Record<string, unknown> | null;
        if (extWorkbenchSvc) {
          console.log(`[ExtOverride] >>> Updating UI for uninstalled: ${extId}`);

          // Get the extensionsServers array which contains Extensions instances
          const extensionsServers = extWorkbenchSvc.extensionsServers as Array<{
            installed?: Array<{ identifier?: { id: string } }>;
            uninstalling?: Array<{ identifier?: { id: string } }>;
            _onChange?: { fire?: (e: unknown) => void };
            onDidUninstallExtension?: (e: { identifier: { id: string }; error?: string }) => void;
          }> | undefined;

          if (extensionsServers) {
            console.log(`[ExtOverride] >>> Found ${extensionsServers.length} extension servers`);
            for (const extServer of extensionsServers) {
              if (typeof extServer.onDidUninstallExtension === 'function') {
                console.log(`[ExtOverride] >>> Calling onDidUninstallExtension on Extensions instance`);
                extServer.onDidUninstallExtension({ identifier: { id: extId } });
              } else {
                // Manually update the arrays
                if (extServer.installed) {
                  const idx = extServer.installed.findIndex(e =>
                    e.identifier?.id.toLowerCase() === extId.toLowerCase()
                  );
                  if (idx !== -1) {
                    console.log(`[ExtOverride] >>> Removing from installed at index ${idx}`);
                    extServer.installed.splice(idx, 1);
                  }
                }
                // Fire change event
                if (extServer._onChange?.fire) {
                  console.log(`[ExtOverride] >>> Firing _onChange on Extensions instance`);
                  extServer._onChange.fire(undefined);
                }
              }
            }
          }

          // Clear cached arrays
          extWorkbenchSvc._installed = undefined;
          extWorkbenchSvc._local = undefined;

          // Fire main onChange event
          const mainOnChange = extWorkbenchSvc._onChange as { fire?: (e: unknown) => void } | undefined;
          if (mainOnChange?.fire) {
            console.log(`[ExtOverride] >>> Firing main _onChange event`);
            mainOnChange.fire(undefined);
          }
        }

        console.log(`[ExtOverride] >>> Platform uninstall complete: ${extId}`);
      } catch (err) {
        console.error(`[ExtOverride] >>> Platform uninstall failed:`, err);

        // Fire error event - serialize error to avoid IPC issues
        const onDidUninstallEmitter = (platformService as Record<string, unknown>)._onDidUninstallExtension as { fire?: (e: unknown) => void } | undefined;
        if (onDidUninstallEmitter?.fire) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          onDidUninstallEmitter.fire({ identifier: { id: extId }, error: errorMsg });
        }

        if (origFn) {
          console.log('[ExtOverride] >>> Trying original uninstall...');
          return origFn.call(this, extension);
        }
        throw err;
      }
    };
  };

  // Patch on instance using Object.defineProperty (required for bound methods)
  if (typeof originalUninstall === 'function' || typeof protoUninstall === 'function') {
    const patchedHandler = createPlatformUninstallHandler(originalUninstall || protoUninstall);
    Object.defineProperty(platformService, 'uninstall', {
      value: patchedHandler,
      writable: true,
      configurable: true
    });
    debugLog('PlatformMgmt', '*** uninstall PATCHED on instance via defineProperty ***');
  }

  // Also patch on prototype
  if (proto && typeof protoUninstall === 'function') {
    const patchedHandler = createPlatformUninstallHandler(protoUninstall);
    Object.defineProperty(proto, 'uninstall', {
      value: patchedHandler,
      writable: true,
      configurable: true
    });
    debugLog('PlatformMgmt', '*** uninstall PATCHED on prototype via defineProperty ***');
  }

  debugLog('PlatformMgmt', 'IExtensionManagementService fully patched');
}

/**
 * Patch the extensions workbench service for UI integration
 * This is the KEY patch that enables the install button for all extensions
 */
async function patchExtensionsWorkbenchService(services: { get: <T>(id: unknown) => T }): Promise<void> {
  // DEBUGGING: Set global marker
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).__extPatchStarted = Date.now();
  console.log('[ExtOverride] ========== PATCHING EXTENSIONS WORKBENCH SERVICE ==========');

  const extWorkbenchService = services.get(IExtensionsWorkbenchService) as {
    local?: unknown[];
    installed?: unknown[];
    queryLocal?: () => Promise<unknown[]>;
    canInstall?: (extension: unknown) => Promise<boolean | { appendText: (s: string) => unknown }>;
    install?: (extension: unknown, options?: unknown, progressLocation?: unknown) => Promise<unknown>;
    uninstall?: (extension: unknown) => Promise<void>;
    extensionManagementService?: {
      installFromGallery?: (gallery: unknown, options?: unknown, servers?: unknown) => Promise<unknown>;
      uninstall?: (extension: unknown) => Promise<void>;
    };
    extensionsServers?: Array<{
      server?: {
        extensionManagementService?: {
          installFromGallery?: (gallery: unknown, options?: unknown) => Promise<unknown>;
        };
      };
    }>;
  } | null;

  if (!extWorkbenchService) {
    console.warn('[ExtOverride] Extensions workbench service not found');
    return;
  }

  // DEBUGGING: Log all methods on the service
  const serviceKeys = Object.keys(extWorkbenchService);
  const protoKeys = Object.keys(Object.getPrototypeOf(extWorkbenchService) || {});
  console.log('[ExtOverride] Service instance keys:', serviceKeys.slice(0, 30));
  console.log('[ExtOverride] Service prototype keys:', protoKeys.slice(0, 30));
  console.log('[ExtOverride] typeof service.uninstall:', typeof (extWorkbenchService as Record<string, unknown>).uninstall);
  console.log('[ExtOverride] typeof proto.uninstall:', typeof (Object.getPrototypeOf(extWorkbenchService) as Record<string, unknown>).uninstall);

  // Store reference globally for debugging
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).__extWorkbenchService = extWorkbenchService;

  // CRITICAL: Patch ExtensionsWorkbenchService.uninstall directly
  // This is the method that gets called when user clicks the Uninstall button
  const extWorkbenchSvcAny = extWorkbenchService as Record<string, unknown>;
  const origWorkbenchUninstall = extWorkbenchSvcAny.uninstall as ((extension: unknown) => Promise<void>) | undefined;
  if (typeof origWorkbenchUninstall === 'function') {
    const tauriServerForUninstall = getTauriLocalExtensionServer();

    const patchedWorkbenchUninstall = async function(this: unknown, extension: unknown): Promise<void> {
      const ext = extension as { identifier?: { id: string }; local?: { identifier?: { id: string } } };
      const extId = ext.identifier?.id || ext.local?.identifier?.id;
      console.log(`[ExtOverride] >>> ExtensionsWorkbenchService.uninstall CALLED for: ${extId}`);

      if (!extId) {
        console.log('[ExtOverride] No extension ID, calling original');
        return origWorkbenchUninstall.call(this, extension);
      }

      try {
        // CRITICAL: Fire _onUninstallExtension FIRST (start signal)
        // VS Code's progress indicator needs both start and end signals to properly clear
        const onUninstallStartEmitter = extWorkbenchSvcAny._onUninstallExtension as { fire?: (e: unknown) => void } | undefined;
        if (onUninstallStartEmitter?.fire) {
          console.log(`[ExtOverride] >>> Firing _onUninstallExtension (start signal)`);
          onUninstallStartEmitter.fire({ identifier: { id: extId } });
        }

        // Uninstall via Tauri
        console.log(`[ExtOverride] >>> Uninstalling via Tauri: ${extId}`);
        const localExt = (ext.local || ext) as Parameters<typeof tauriServerForUninstall.uninstall>[0];
        await tauriServerForUninstall.uninstall(localExt);
        console.log(`[ExtOverride] >>> Successfully uninstalled from disk: ${extId}`);

        // CRITICAL: Force UI refresh after uninstall
        // Clear cached arrays
        extWorkbenchSvcAny._installed = undefined;
        extWorkbenchSvcAny._local = undefined;

        // Fire onChange events
        const mainOnChange = extWorkbenchSvcAny._onChange as { fire?: (e: unknown) => void } | undefined;
        if (mainOnChange?.fire) {
          console.log(`[ExtOverride] >>> Firing main _onChange event`);
          mainOnChange.fire(undefined);
        }

        // Update extensionsServers
        const extensionsServers = extWorkbenchSvcAny.extensionsServers as Array<{
          installed?: Array<{ identifier?: { id: string } }>;
          _onChange?: { fire?: () => void };
        }> | undefined;

        if (extensionsServers) {
          console.log(`[ExtOverride] >>> Updating ${extensionsServers.length} extension servers`);
          for (const extServer of extensionsServers) {
            if (extServer.installed) {
              const idx = extServer.installed.findIndex(e =>
                e.identifier?.id.toLowerCase() === extId.toLowerCase()
              );
              if (idx !== -1) {
                console.log(`[ExtOverride] >>> Removing from installed at index ${idx}`);
                extServer.installed.splice(idx, 1);
              }
            }
            if (extServer._onChange?.fire) {
              extServer._onChange.fire();
            }
          }
        }

        // CRITICAL: Fire _onDidUninstallExtension on the workbench service
        // VS Code's extension list view listens for this to update the UI
        const onDidUninstallEmitter = extWorkbenchSvcAny._onDidUninstallExtension as { fire?: (e: unknown) => void } | undefined;
        if (onDidUninstallEmitter?.fire) {
          console.log(`[ExtOverride] >>> Firing _onDidUninstallExtension on workbench service`);
          onDidUninstallEmitter.fire({ identifier: { id: extId } });
        }

        // Also fire on the main _onDidChangeExtension emitter
        const onDidChangeExtension = extWorkbenchSvcAny._onDidChangeExtension as { fire?: (e: unknown) => void } | undefined;
        if (onDidChangeExtension?.fire) {
          console.log(`[ExtOverride] >>> Firing _onDidChangeExtension`);
          onDidChangeExtension.fire({ identifier: { id: extId } });
        }

        // CRITICAL: Clear uninstalling arrays and stuck states to stop progress bar
        // VS Code's reportProgressFromOtherSources() shows progress if any extension is in Installing/Uninstalling state
        if (extensionsServers) {
          for (const extServer of extensionsServers) {
            // Clear the uninstalling array for this extension
            const uninstallingArr = (extServer as { uninstalling?: unknown[] }).uninstalling;
            if (Array.isArray(uninstallingArr)) {
              const idx = uninstallingArr.findIndex((e: { identifier?: { id: string } }) =>
                e.identifier?.id.toLowerCase() === extId.toLowerCase()
              );
              if (idx !== -1) {
                console.log(`[ExtOverride] >>> Removing from uninstalling at index ${idx}`);
                uninstallingArr.splice(idx, 1);
              }
            }
            // Clear any stuck Installing/Uninstalling states (0, 2)
            const installedArr = extServer.installed as Array<{ state?: number; identifier?: { id: string } }> | undefined;
            if (installedArr) {
              for (const ext of installedArr) {
                if (ext.state === 0 || ext.state === 2) {
                  console.log(`[ExtOverride] >>> Fixing stuck state: ${ext.identifier?.id} was ${ext.state}, setting to Installed (1)`);
                  ext.state = 1; // Set to Installed
                }
              }
            }
          }
        }

        // Fire onChange one more time to trigger reportProgressFromOtherSources() and clear the progress bar
        if (mainOnChange?.fire) {
          console.log(`[ExtOverride] >>> Firing _onChange again to clear progress bar`);
          mainOnChange.fire(undefined);
        }

        // CRITICAL: Clear tasksInProgress to stop any hanging progress indicators
        // These tasks may have been started by operations that never completed
        const tasksInProgress = extWorkbenchSvcAny.tasksInProgress as Array<{ cancel?: () => void }> | undefined;
        if (tasksInProgress && tasksInProgress.length > 0) {
          console.log(`[ExtOverride] >>> Canceling ${tasksInProgress.length} pending tasks`);
          for (const task of tasksInProgress) {
            if (task.cancel && typeof task.cancel === 'function') {
              try {
                task.cancel();
              } catch (e) {
                console.log('[ExtOverride] >>> Task cancel error:', e);
              }
            }
          }
          tasksInProgress.length = 0;
        }

        // CRITICAL: Call reset() to clear stale UI cache and ensure fresh data
        const resetFn = extWorkbenchSvcAny.reset as (() => void) | undefined;
        if (resetFn && typeof resetFn === 'function') {
          console.log(`[ExtOverride] >>> Calling reset() to clear stale UI cache`);
          try {
            resetFn.call(extWorkbenchSvcAny);
          } catch (e) {
            console.log('[ExtOverride] >>> reset() error:', e);
          }
        }

        console.log(`[ExtOverride] >>> Workbench uninstall complete: ${extId}`);
      } catch (err) {
        console.error(`[ExtOverride] >>> Tauri uninstall failed:`, err);
        // Try original as fallback
        return origWorkbenchUninstall.call(this, extension);
      }
    };

    Object.defineProperty(extWorkbenchService, 'uninstall', {
      value: patchedWorkbenchUninstall,
      writable: true,
      configurable: true
    });
    console.log('[ExtOverride] *** ExtensionsWorkbenchService.uninstall PATCHED via defineProperty ***');
  } else {
    console.log('[ExtOverride] WARNING: ExtensionsWorkbenchService.uninstall not found');
  }

  // CRITICAL: Check if localExtensions is null and inject our fake server
  const workbenchSvc = extWorkbenchService as Record<string, unknown>;
  debugLog('Workbench', 'Current localExtensions:', workbenchSvc.localExtensions);
  debugLog('Workbench', 'Current extensionsServers:', workbenchSvc.extensionsServers);

  // If localExtensions is null, inject a fake one that delegates to our Tauri server
  if (!workbenchSvc.localExtensions) {
    debugLog('Workbench', 'localExtensions is null - injecting Tauri server proxy');

    const tauriServer = getTauriLocalExtensionServer();
    const tauriManager = getTauriExtensionManager();

    // Helper to convert Tauri extension to workbench extension format
    const toWorkbenchExtension = (local: { identifier: { id: string }; location: URI; manifest: { name: string; displayName?: string; description?: string; publisher: string; version: string; icon?: string; categories?: string[]; keywords?: string[]; extensionDependencies?: string[]; extensionPack?: string[] } }) => {
      const extId = local.identifier.id;
      // Extract extension path from location URI for file reading
      const extensionPath = local.location.fsPath;

      // Create the server object that VS Code expects
      // This must match IExtensionManagementServer interface
      const extensionServer = {
        id: 'local',
        label: 'Local',
        extensionManagementService: tauriServer,
        // Additional properties that might be accessed
        get canInstall() { return true; },
      };

      // Create the extension object with all required properties
      // Based on VS Code's IExtension interface for the workbench
      // IMPORTANT: Avoid getters that might throw - use regular properties
      const manifestData = local.manifest;
      const identifierData = local.identifier;

      // Ensure manifest has engines property for compatibility checks
      const safeManifest = {
        ...manifestData,
        engines: (manifestData as { engines?: { vscode?: string } }).engines || { vscode: '*' },
      };

      // Create a proper local extension object with all required properties
      const safeLocal = {
        ...local,
        identifier: { ...local.identifier, uuid: local.identifier.id }, // Add uuid
        manifest: safeManifest,
        // Ensure these properties exist
        type: (local as { type?: number }).type ?? 1,
        isBuiltin: (local as { isBuiltin?: boolean }).isBuiltin ?? false,
        targetPlatform: (local as { targetPlatform?: string }).targetPlatform ?? 'universal',
        isValid: (local as { isValid?: boolean }).isValid ?? true,
        validations: (local as { validations?: unknown[] }).validations ?? [],
        // Additional ILocalExtension properties
        readmeUrl: undefined,
        changelogUrl: undefined,
        publisherDisplayName: local.manifest.publisher,
        publisherId: undefined,
        isApplicationScoped: false,
        isMachineScoped: false,
        isPreReleaseVersion: false,
        hasPreReleaseVersion: false,
        preRelease: false,
        updated: false,
        pinned: false,
        source: 'local',
      };

      // Build the extension object with all properties
      const extensionObj = {
        type: 1, // ExtensionType.User
        identifier: { ...identifierData, uuid: identifierData.id }, // Add uuid for compatibility
        local: safeLocal,
        gallery: undefined, // undefined instead of null - some VS Code checks are strict
        // CRITICAL: server property is needed for renderNavbar
        server: extensionServer,
        state: 1, // ExtensionState.Installed (0=Installing, 1=Installed, 2=Uninstalling, 3=Uninstalled)
        name: manifestData.name,
        displayName: manifestData.displayName || manifestData.name,
        description: manifestData.description || '',
        publisher: manifestData.publisher,
        version: manifestData.version,
        // CRITICAL: installedVersion must match version for installed extensions
        installedVersion: manifestData.version,
        publisherDisplayName: manifestData.publisher,
        enablementState: 12, // EnablementState.EnabledGlobally (0-11 are disabled states, 12=EnabledGlobally, 13=EnabledWorkspace)
        isBuiltin: false,
        // CRITICAL: hasReadme and hasChangelog must be METHODS, not boolean properties
        // VS Code calls them as extension.hasChangelog() in renderNavbar
        // Return true to enable the tabs - the actual content is loaded by getReadme/getChangelog
        hasReadme: () => true,
        hasChangelog: () => true,
        // hasReleaseVersion is a boolean property checked by getGalleryExtension
        hasReleaseVersion: true,
        // Additional required properties
        outdated: false,
        reloadRequired: false,
        // CRITICAL: runtimeState should be undefined for installed/enabled extensions
        runtimeState: undefined,
        telemetryData: undefined,
        preview: false,
        preRelease: false,
        isPreReleaseVersion: false,
        hasPreReleaseVersion: false,
        installCount: 0,
        rating: 0,
        ratingCount: 0,
        categories: manifestData.categories || [],
        tags: manifestData.keywords || [],
        // Pass through actual dependencies from manifest
        dependencies: manifestData.extensionDependencies || [],
        extensionPack: manifestData.extensionPack || [],
        url: undefined,
        iconUrl: manifestData.icon || undefined,
        iconUrlFallback: undefined,
        repository: undefined,
        licenseUrl: undefined,
        publisherUrl: undefined,
        publisherDomain: undefined,
        pinned: false,
        source: 'local',
        // CRITICAL: These properties are needed by the extension detail view
        deprecationInfo: undefined,
        outdatedTargetPlatform: false,
        isMalicious: false,
        isUnsupported: false,
        // CRITICAL: These boolean properties are checked by renderNavbar
        missingFromGallery: false,
        isWorkspaceScoped: false,
        // Extension kind as regular property (not getter)
        extensionKind: [2, 1], // [Workspace, UI] - prefer workspace
        // NOTE: readme/changelog URIs must be undefined to force VS Code to call getReadme()/getChangelog()
        // If we set a file:// URI, the webview can't access it due to security restrictions
        // Setting undefined ensures VS Code calls our async methods which return the content directly
        readme: undefined,
        changelog: undefined,
        manifest: safeManifest,
        license: undefined,
        localizedLanguages: [],
        galleryIdentifier: { ...identifierData, uuid: identifierData.id },
        // CRITICAL: These methods are called by the extension detail view
        hasResource: (_uri: unknown) => false,
        getReadme: async () => {
          debugLog('GetReadme', `Reading README for ${extId} from ${extensionPath}`);
          const content = await readExtensionFile(extensionPath, 'README.md');
          debugLog('GetReadme', `README content length: ${content.length}`);
          return content;
        },
        getChangelog: async () => {
          debugLog('GetChangelog', `Reading CHANGELOG for ${extId} from ${extensionPath}`);
          const content = await readExtensionFile(extensionPath, 'CHANGELOG.md');
          debugLog('GetChangelog', `CHANGELOG content length: ${content.length}`);
          return content;
        },
        getManifest: async () => safeManifest,
        getLicense: async () => {
          debugLog('GetLicense', `Reading LICENSE for ${extId} from ${extensionPath}`);
          const content = await readExtensionFile(extensionPath, 'LICENSE');
          return content || await readExtensionFile(extensionPath, 'LICENSE.md');
        },
        getIcon: async (_webviewView?: unknown) => Promise.resolve(undefined), // Must return Promise
        // Error handling - return empty values instead of throwing
        toString: () => extId,
        // Additional properties that might be accessed
        resourceExtension: undefined,
        deprecation: undefined,
        outdatedVersion: undefined,
        // Properties for extension detail editor
        whenInstalled: Promise.resolve(), // Already installed
        // CRITICAL: contributes property for feature tabs
        get contributes() { return (safeManifest as Record<string, unknown>).contributes || {}; },
      };

      return extensionObj;
    };

    // Get initial installed extensions
    const tauriInstalled = tauriManager.getAllInstalled();
    const initialInstalled = tauriInstalled.map(toWorkbenchExtension);
    debugLog('Workbench', `Loaded ${initialInstalled.length} installed extensions from Tauri`);

    // CRITICAL: Create proper Emitters for change events
    // These MUST be real Emitters so that VS Code can subscribe to them and receive updates
    const fakeLocalOnChangeEmitter = new Emitter<void>();
    const fakeLocalOnResetEmitter = new Emitter<void>();
    debugLog('Workbench', 'Created proper Emitters for fakeLocalExtensions');

    // Create a fake Extensions-like object with all required methods
    const fakeLocalExtensions = {
      server: {
        id: 'local',
        label: 'Local',
        extensionManagementService: tauriServer,
      },
      // Internal state - pre-populated with Tauri extensions
      installed: initialInstalled as unknown[],
      installing: [] as unknown[],
      uninstalling: [] as unknown[],
      _local: initialInstalled as unknown[] | undefined,

      // CRITICAL: 'extensions' getter is used by VS Code to populate the INSTALLED dropdown
      get extensions() { return this.installed; },

      // The canInstall method that ExtensionsWorkbenchService calls
      canInstall: async (galleryExtension: unknown) => {
        debugLog('FakeLocal.canInstall', 'Called for:', getExtensionId(galleryExtension));
        // Always return true - we can install anything via Tauri
        return true;
      },

      // Get extension state - required method
      // ExtensionState: Installing=0, Installed=1, Uninstalling=2, Uninstalled=3
      getExtensionState: (extension: unknown) => {
        const extId = getExtensionId(extension);
        if (extId && isExtensionInstalled(extId)) {
          debugLog('FakeLocal.getExtensionState', `${extId} -> Installed (1)`);
          return 1; // ExtensionState.Installed
        }
        debugLog('FakeLocal.getExtensionState', `${extId} -> Uninstalled (3)`);
        return 3; // ExtensionState.Uninstalled
      },

      // Get runtime state - required method
      getRuntimeState: (extension: unknown) => {
        debugLog('FakeLocal.getRuntimeState', 'Called for:', getExtensionId(extension));
        return undefined; // No special runtime state
      },

      // Other required methods
      get local() { return this.installed; },

      // CRITICAL: Expose the emitters so they can be fired externally
      _onChange: fakeLocalOnChangeEmitter,
      _onReset: fakeLocalOnResetEmitter,

      // CRITICAL: onChange must return the proper Event from the Emitter
      // VS Code's extension list view listens to this event to know when to refresh
      get onChange(): Event<void> {
        return fakeLocalOnChangeEmitter.event;
      },
      get onReset(): Event<void> {
        return fakeLocalOnResetEmitter.event;
      },

      queryInstalled: async () => {
        debugLog('FakeLocal.queryInstalled', 'Called');
        // Return actual installed extensions from Tauri
        await tauriManager.loadInstalledExtensions();
        const extensions = tauriManager.getAllInstalled();
        const workbenchExts = extensions.map(toWorkbenchExtension);
        debugLog('FakeLocal.queryInstalled', `Returning ${workbenchExts.length} extensions`);

        // CRITICAL: Deduplicate extensions to prevent duplicates in UI
        const seen = new Set<string>();
        const uniqueExts = workbenchExts.filter((ext: { identifier?: { id: string } }) => {
          const id = ext.identifier?.id.toLowerCase();
          if (!id || seen.has(id)) {
            if (id) debugLog('FakeLocal.queryInstalled', `Skipping duplicate: ${id}`);
            return false;
          }
          seen.add(id);
          return true;
        });

        debugLog('FakeLocal.queryInstalled', `After dedup: ${uniqueExts.length} unique extensions`);

        // Update our internal state with deduplicated list
        fakeLocalExtensions.installed = uniqueExts;
        fakeLocalExtensions._local = uniqueExts;

        return uniqueExts;
      },

      syncInstalledExtensionsWithGallery: async () => {},

      // Reset method
      reset: async () => {
        debugLog('FakeLocal.reset', 'Called');
        // Reload extensions on reset
        await tauriManager.loadInstalledExtensions();
        const extensions = tauriManager.getAllInstalled();
        const workbenchExts = extensions.map(toWorkbenchExtension);

        // CRITICAL: Deduplicate extensions to prevent duplicates in UI
        const seen = new Set<string>();
        const uniqueExts = workbenchExts.filter((ext: { identifier?: { id: string } }) => {
          const id = ext.identifier?.id.toLowerCase();
          if (!id || seen.has(id)) {
            return false;
          }
          seen.add(id);
          return true;
        });

        fakeLocalExtensions.installed = uniqueExts;
        fakeLocalExtensions._local = uniqueExts;
        // Fire change event to update UI
        fakeLocalOnChangeEmitter.fire();
        fakeLocalOnResetEmitter.fire();
        debugLog('FakeLocal.reset', 'Fired _onChange and _onReset events');
      },

      // CRITICAL: Method to get extension by identifier - needed for detail view
      getExtension: (identifier: { id: string }) => {
        const extId = identifier.id.toLowerCase();
        return fakeLocalExtensions.installed.find(
          (ext: { identifier?: { id: string } }) => ext.identifier?.id.toLowerCase() === extId
        );
      },

      // CRITICAL: Uninstall method - VS Code UI calls this when user clicks Uninstall
      uninstall: async (extension: unknown) => {
        const extId = getExtensionId(extension);
        debugLog('FakeLocal.uninstall', `>>> UNINSTALL CALLED for: ${extId}`);

        if (!extId) {
          console.error('[FakeLocal] Cannot uninstall - no extension ID found');
          throw new Error('Cannot uninstall extension: no ID found');
        }

        // Add to uninstalling array to show progress
        fakeLocalExtensions.uninstalling.push(extension);
        debugLog('FakeLocal.uninstall', `>>> Added to uninstalling array`);

        try {
          // Call the Tauri server's uninstall method
          const localExt = extension as Parameters<typeof tauriServer.uninstall>[0];
          await tauriServer.uninstall(localExt);
          debugLog('FakeLocal.uninstall', `>>> Successfully uninstalled: ${extId}`);

          // Remove from our local arrays
          const removeFromArray = (arr: unknown[] | undefined, id?: string) => {
            if (!Array.isArray(arr)) return;
            const targetId = id || extId;
            const idx = arr.findIndex((e: { identifier?: { id: string } }) =>
              e.identifier?.id.toLowerCase() === targetId.toLowerCase()
            );
            if (idx !== -1) {
              arr.splice(idx, 1);
              debugLog('FakeLocal.uninstall', `>>> Removed from array at index ${idx}`);
            }
          };

          removeFromArray(fakeLocalExtensions.installed);
          removeFromArray(fakeLocalExtensions._local as unknown[]);

          // Remove from uninstalling array
          const uninstallIdx = fakeLocalExtensions.uninstalling.indexOf(extension);
          if (uninstallIdx !== -1) {
            fakeLocalExtensions.uninstalling.splice(uninstallIdx, 1);
            debugLog('FakeLocal.uninstall', `>>> Removed from uninstalling array`);
          }

          // Reload from Tauri to ensure consistency
          await fakeLocalExtensions.queryInstalled();

          // CRITICAL: Fire the onChange event to notify VS Code's UI to refresh
          debugLog('FakeLocal.uninstall', `>>> Firing _onChange event to trigger UI refresh`);
          fakeLocalOnChangeEmitter.fire();

        } catch (err) {
          console.error('[FakeLocal] Uninstall failed:', err);
          // Remove from uninstalling array even on error
          const uninstallIdx = fakeLocalExtensions.uninstalling.indexOf(extension);
          if (uninstallIdx !== -1) {
            fakeLocalExtensions.uninstalling.splice(uninstallIdx, 1);
          }
          throw err;
        }
      },

      // Uninstall multiple extensions
      uninstallExtensions: async (extensions: unknown[]) => {
        debugLog('FakeLocal.uninstallExtensions', `>>> Called for ${extensions.length} extensions`);
        for (const ext of extensions) {
          await fakeLocalExtensions.uninstall(ext);
        }
      },
    };

    // CRITICAL: Subscribe to tauriServer events to keep fakeLocalExtensions.installed in sync
    // This mimics what VS Code's Extensions class does in its constructor
    tauriServer.onDidInstallExtensions((results) => {
      debugLog('FakeLocal', '>>> Received onDidInstallExtensions from tauriServer');
      for (const result of results) {
        if (result.local && !result.error) {
          const extId = result.identifier.id.toLowerCase();
          const existing = fakeLocalExtensions.installed.find(
            (e: { identifier?: { id: string } }) => e.identifier?.id.toLowerCase() === extId
          );
          if (!existing) {
            const workbenchExt = toWorkbenchExtension(result.local);
            fakeLocalExtensions.installed.push(workbenchExt);
            debugLog('FakeLocal', `>>> Added ${extId} to installed array (now ${fakeLocalExtensions.installed.length} items)`);
          }
        }
      }
      fakeLocalOnChangeEmitter.fire();
    });

    tauriServer.onDidUninstallExtension((event) => {
      debugLog('FakeLocal', '>>> Received onDidUninstallExtension from tauriServer');
      const extId = event.identifier.id.toLowerCase();
      if (extId) {
        const idx = fakeLocalExtensions.installed.findIndex(
          (e: { identifier?: { id: string } }) => e.identifier?.id.toLowerCase() === extId
        );
        if (idx !== -1) {
          fakeLocalExtensions.installed.splice(idx, 1);
          debugLog('FakeLocal', `>>> Removed ${extId} from installed array (now ${fakeLocalExtensions.installed.length} items)`);
        }
      }
      fakeLocalOnChangeEmitter.fire();
    });

    workbenchSvc.localExtensions = fakeLocalExtensions;

    // CRITICAL: When localExtensions changes, clear ALL caches and force UI refresh
    // This ensures the main service recalculates installed/local from extensionsServers
    fakeLocalOnChangeEmitter.event(() => {
      debugLog('Workbench', '>>> localExtensions changed, clearing ALL caches');

      // Clear main service caches
      workbenchSvc._installed = undefined;
      workbenchSvc._local = undefined;

      // Also clear extensions cache if it exists
      const _extensions = workbenchSvc._extensions as unknown;
      if (_extensions && typeof (_extensions as { clear?: () => void }).clear === 'function') {
        (_extensions as { clear: () => void }).clear();
      }

      // Force synchronous refresh of localExtensions data
      // This ensures extensionsServers[0].local is up to date
      debugLog('Workbench', `>>> localExtensions.installed now has ${fakeLocalExtensions.installed.length} items`);

      // Fire the main onChange to trigger UI refresh AFTER a small delay
      // This allows the data to settle before recalculation
      setTimeout(() => {
        debugLog('Workbench', '>>> Firing main _onChange after local change');
        const mainOnChange = workbenchSvc._onChange as { fire?: () => void } | undefined;
        if (mainOnChange?.fire) {
          workbenchSvc._installed = undefined; // Clear again just before firing
          workbenchSvc._local = undefined;
          mainOnChange.fire();
        }
      }, 50);
    });

    // Add to extensionsServers array - but REPLACE any existing local server to avoid duplicates
    const servers = workbenchSvc.extensionsServers as Array<{ server?: { id?: string }; installed?: unknown[] }>;
    if (Array.isArray(servers)) {
      // Find and remove any existing local server to prevent duplicates
      let foundLocalIdx = -1;
      for (let i = 0; i < servers.length; i++) {
        if (servers[i]?.server?.id === 'local') {
          foundLocalIdx = i;
          debugLog('Workbench', `Found existing local server at index ${i}, will replace it`);
          // Clear any existing extensions from the old server
          const serverToReplace = servers[i];
          if (serverToReplace.installed) {
            serverToReplace.installed.length = 0;
          }
          break;
        }
      }

      if (foundLocalIdx >= 0) {
        // Replace the existing local server
        servers[foundLocalIdx] = fakeLocalExtensions as typeof servers[number];
        debugLog('Workbench', `Replaced existing local server at index ${foundLocalIdx}`);
      } else {
        // No existing local server, add ours at the beginning
        servers.unshift(fakeLocalExtensions as typeof servers[number]);
        debugLog('Workbench', 'Added fakeLocalExtensions to extensionsServers');
      }

      debugLog('Workbench', `extensionsServers now has ${servers.length} servers`);
    }

    debugLog('Workbench', 'Injected fake localExtensions:', !!workbenchSvc.localExtensions);

    // NOTE: We do NOT populate workbenchSvc.installed/local directly anymore
    // because that causes duplicates. Extensions are managed through fakeLocalExtensions
    // which is in extensionsServers[0]. VS Code will query that for the installed list.
  }

  // CRITICAL: Clear the installing array to prevent stale "Installing" states
  if (Array.isArray(workbenchSvc.installing)) {
    debugLog('Workbench', `Clearing installing array, had: ${(workbenchSvc.installing as unknown[]).length} items`);
    (workbenchSvc.installing as unknown[]).length = 0;
  }

  // CRITICAL: Fix any extension objects stuck in "Installing" state
  // ExtensionState: Installing=0, Installed=1, Uninstalling=2, Uninstalled=3
  const fixInstallingState = (extensions: unknown[] | undefined) => {
    if (!Array.isArray(extensions)) return;
    let fixed = 0;
    for (const ext of extensions) {
      const e = ext as { state?: number; identifier?: { id: string } };
      if (e.state === 0) { // Installing (0)
        const extId = e.identifier?.id;
        // If it's a Tauri-installed extension, set to Installed (1)
        if (extId && isExtensionInstalled(extId)) {
          e.state = 1; // Installed
          fixed++;
        } else {
          // Otherwise set to Uninstalled (3) so user can try installing again
          e.state = 3; // Uninstalled
          fixed++;
        }
      }
    }
    if (fixed > 0) {
      debugLog('Workbench', `Fixed ${fixed} extensions stuck in Installing state`);
    }
  };

  // Fix extensions in various arrays/maps where they might be stored
  fixInstallingState(workbenchSvc.installed as unknown[]);
  fixInstallingState(workbenchSvc.local as unknown[]);

  // Also check _extensions Map if it exists
  const extensionsMap = workbenchSvc._extensions as Map<string, { state?: number; identifier?: { id: string } }> | undefined;
  if (extensionsMap && typeof extensionsMap.forEach === 'function') {
    let fixed = 0;
    extensionsMap.forEach((ext) => {
      if (ext.state === 0) { // Installing
        const extId = ext.identifier?.id;
        if (extId && isExtensionInstalled(extId)) {
          ext.state = 1; // Installed
        } else {
          ext.state = 3; // Uninstalled
        }
        fixed++;
      }
    });
    if (fixed > 0) {
      debugLog('Workbench', `Fixed ${fixed} extensions in _extensions Map`);
    }
  }

  // CRITICAL: Cancel and clear any pending tasks to stop the progress bar
  // VS Code may have started some tasks during initialization that never complete in our environment
  const cancelPendingTasks = () => {
    const tasksInProgress = workbenchSvc.tasksInProgress as Array<{ cancel?: () => void }> | undefined;
    if (tasksInProgress && tasksInProgress.length > 0) {
      debugLog('Workbench', `>>> Canceling ${tasksInProgress.length} pending tasks during init`);
      for (const task of tasksInProgress) {
        if (task.cancel && typeof task.cancel === 'function') {
          try {
            task.cancel();
          } catch (e) {
            debugLog('Workbench', '>>> Task cancel error:', e);
          }
        }
      }
      tasksInProgress.length = 0;
    }
  };

  // Cancel any pending tasks immediately
  cancelPendingTasks();

  // Also set up a delayed check to catch tasks that start during initialization
  setTimeout(() => {
    cancelPendingTasks();
    // Fire onChange to trigger progress bar cleanup
    const onChange = workbenchSvc._onChange as { fire?: () => void } | undefined;
    if (onChange?.fire) {
      debugLog('Workbench', '>>> Firing _onChange after delayed task cleanup');
      onChange.fire();
    }
  }, 3000); // Wait 3 seconds for initialization to settle

  // Check extensions getter
  const allExtensions = workbenchSvc.extensions as unknown[] | undefined;
  fixInstallingState(allExtensions);

  // CRITICAL: Patch getExtensionState on the workbench service
  // The original checks this.installing array first, which may have stale data
  // ExtensionState: Installing=0, Installed=1, Uninstalling=2, Uninstalled=3
  const originalGetExtensionState = (extWorkbenchService as { getExtensionState?: (ext: unknown) => number }).getExtensionState?.bind(extWorkbenchService);
  if (originalGetExtensionState) {
    (extWorkbenchService as Record<string, unknown>).getExtensionState = (extension: unknown): number => {
      const extId = getExtensionId(extension);

      // Check if installed via Tauri first
      if (extId && isExtensionInstalled(extId)) {
        debugLog('Workbench.getExtensionState', `${extId} -> Installed (1)`);
        return 1; // ExtensionState.Installed
      }

      // For non-Tauri extensions, use original but filter out stale "Installing" states
      const result = originalGetExtensionState(extension);

      // If original says "Installing" (0), double-check it's really installing
      if (result === 0) {
        debugLog('Workbench.getExtensionState', `${extId} -> Original said Installing, returning Uninstalled (3)`);
        return 3; // ExtensionState.Uninstalled - let them install
      }

      debugLog('Workbench.getExtensionState', `${extId} -> ${result}`);
      return result;
    };
    debugLog('Workbench', '*** getExtensionState PATCHED ***');
  }

  // CRITICAL: Patch getExtension to return our full extension objects
  // This is called when clicking on an extension to open the detail view
  const originalGetExtension = (extWorkbenchService as { getExtension?: (id: unknown) => unknown }).getExtension?.bind(extWorkbenchService);
  if (originalGetExtension) {
    (extWorkbenchService as Record<string, unknown>).getExtension = (identifier: unknown): unknown => {
      const id = identifier as { id?: string } | string;
      const extId = typeof id === 'string' ? id : id.id;
      debugLog('Workbench.getExtension', `>>> CALLED for: ${extId}`);

      // Check if it's in our fakeLocalExtensions first
      const fakeLocal = workbenchSvc.localExtensions as { getExtension?: (id: { id: string }) => unknown } | undefined;
      if (fakeLocal?.getExtension && extId) {
        const ourExt = fakeLocal.getExtension({ id: extId });
        if (ourExt) {
          debugLog('Workbench.getExtension', `>>> Found in fakeLocalExtensions: ${extId}`);
          return ourExt;
        }
      }

      // Fall back to original
      const result = originalGetExtension(identifier);
      debugLog('Workbench.getExtension', `>>> Original returned for: ${extId}`, result ? 'found' : 'not found');
      return result;
    };
    debugLog('Workbench', '*** getExtension PATCHED ***');
  } else {
    debugLog('Workbench', 'WARNING: getExtension not found on workbench service');
  }

  // CRITICAL: Patch canInstall to always return true for gallery extensions
  // This enables the install button for all extensions, including Node.js extensions
  const originalCanInstall = extWorkbenchService.canInstall?.bind(extWorkbenchService);

  debugLog('Workbench', 'Original canInstall exists:', !!originalCanInstall);

  // Also log other available methods for debugging
  const serviceMethods = Object.keys(extWorkbenchService).filter(
    k => typeof (extWorkbenchService as Record<string, unknown>)[k] === 'function'
  );
  debugLog('Workbench', 'Available methods on service:', serviceMethods.join(', '));

  if (originalCanInstall) {
    (extWorkbenchService as Record<string, unknown>).canInstall = async (extension: unknown): Promise<boolean> => {
      const extId = getExtensionId(extension);
      debugLog('canInstall', `Called for: ${extId}`);

      // Inspect the extension object for debugging
      inspectExtension(extension);

      // Check if already installed via Tauri
      if (extId && isExtensionInstalled(extId)) {
        debugLog('canInstall', `Already installed via Tauri: ${extId}`);
        return true;
      }

      // Try original first to see what it returns
      try {
        const result = await originalCanInstall(extension);
        debugLog('canInstall', `Original result for ${extId}:`, result);
        debugLog('canInstall', `Result type: ${typeof result}`);

        if (result === true) {
          return true;
        }

        // Log the error message if it's an object
        if (result && typeof result === 'object') {
          const resultObj = result as { value?: string };
          debugLog('canInstall', `Error message object:`, resultObj);

          // Try to get the actual error text
          if ('appendText' in result || 'value' in result) {
            debugLog('canInstall', `This is a MarkdownString error - overriding`);
          }
        }

        debugLog('canInstall', `Overriding to allow install for: ${extId}`);
      } catch (err) {
        debugLog('canInstall', `Original threw for ${extId}:`, err);
      }

      // Always allow installation - we'll handle it via Tauri sidecar
      return true;
    };
    debugLog('Workbench', 'canInstall method patched successfully');
  } else {
    debugLog('Workbench', 'WARNING: canInstall method not found on service');
  }

  // Patch install to route through Tauri for Node.js extensions
  const originalInstall = extWorkbenchService.install?.bind(extWorkbenchService);

  if (originalInstall) {
    (extWorkbenchService as Record<string, unknown>).install = async (
      extension: unknown,
      options?: unknown,
      progressLocation?: unknown
    ): Promise<unknown> => {
      const extId = getExtensionId(extension);
      debugLog('Workbench.install', `>>> INSTALL CALLED for: ${extId}`);
      debugLog('Workbench.install', `Options:`, options);

      // Try to extract gallery info for Tauri installation
      const ext = extension as { gallery?: GalleryExtension; identifier?: { id: string } };

      if (ext.gallery) {
        debugLog('Workbench.install', `Has gallery info, attempting Tauri installation...`);
        try {
          const local = await installExtensionFromGallery(ext.gallery);
          debugLog('Workbench.install', `Tauri installation SUCCESS for: ${extId}`);

          // Create a mock extension object that the UI expects
          // This is necessary because the original install returns an Extension object
          const mockExtension = {
            ...ext,
            local,
            state: 1, // ExtensionState.Installed
            enablementState: 12, // EnablementState.EnabledGlobally (0-11 are disabled states, 12=EnabledGlobally, 13=EnabledWorkspace)
          };

          return mockExtension;
        } catch (tauriErr) {
          debugLog('Workbench.install', `Tauri installation failed:`, tauriErr);
          // Don't fall back to original - it will fail anyway
          // Instead, throw a more helpful error
          throw new Error(`Failed to install ${extId} via Tauri: ${tauriErr}`);
        }
      }

      // If no gallery info, try original (for local extensions, etc.)
      debugLog('Workbench.install', `No gallery info, trying original install...`);
      try {
        return await originalInstall(extension, options, progressLocation);
      } catch (originalErr) {
        debugLog('Workbench.install', `Original install failed:`, originalErr);
        throw originalErr;
      }
    };
    debugLog('Workbench', '*** install method PATCHED ***');
  }

  // CRITICAL: Patch uninstall to route through Tauri
  // This is called when user clicks "Uninstall" from the context menu
  // We need to patch BOTH the instance AND the prototype to catch all code paths
  const originalUninstall = (extWorkbenchService as Record<string, unknown>).uninstall as
    ((extension: unknown) => Promise<void>) | undefined;
  const proto = Object.getPrototypeOf(extWorkbenchService) as Record<string, unknown>;
  const protoUninstall = proto.uninstall as ((extension: unknown) => Promise<void>) | undefined;

  debugLog('Workbench', `uninstall on instance: ${typeof originalUninstall}, on proto: ${typeof protoUninstall}`);

  // Create the uninstall handler - use regular function to preserve 'this'
  const createUninstallHandler = (origFn: ((extension: unknown) => Promise<void>) | undefined) => {
    return async function(this: unknown, extension: unknown): Promise<void> {
      const ext = extension as { identifier?: { id: string }; local?: unknown };
      const extId = ext.identifier?.id;
      debugLog('Workbench.uninstall', `>>> CALLED for: ${extId}`);

      if (!extId) {
        debugLog('Workbench.uninstall', 'No extension ID, calling original');
        if (origFn) return origFn.call(this, extension);
        throw new Error('Cannot uninstall extension: no ID found');
      }

      try {
        // Use Tauri to uninstall
        debugLog('Workbench.uninstall', `>>> Uninstalling via Tauri: ${extId}`);
        const tauriServer = getTauriLocalExtensionServer();
        // Cast to expected type - the uninstall method only needs identifier.id
        const localExt = (ext.local || ext) as Parameters<typeof tauriServer.uninstall>[0];
        await tauriServer.uninstall(localExt);

        // Update the local state
        debugLog('Workbench.uninstall', `>>> Updating local state for: ${extId}`);

        // Remove from the installed arrays
        const removeFromArray = (arr: unknown[] | undefined, id: string) => {
          if (!Array.isArray(arr)) return;
          const idx = arr.findIndex((e: { identifier?: { id: string } }) =>
            e.identifier?.id.toLowerCase() === id.toLowerCase()
          );
          if (idx !== -1) {
            arr.splice(idx, 1);
            debugLog('Workbench.uninstall', `>>> Removed from array at index ${idx}`);
          }
        };

        removeFromArray(workbenchSvc.installed as unknown[], extId);
        removeFromArray(workbenchSvc.local as unknown[], extId);

        // Also remove from the fakeLocalExtensions if it exists
        const fakeLocal = workbenchSvc.localExtensions as { installed?: unknown[]; _local?: unknown[] } | undefined;
        if (fakeLocal) {
          removeFromArray(fakeLocal.installed, extId);
          removeFromArray(fakeLocal._local, extId);
        }

        // Update the extension state in _extensions map
        const extensionsMap = workbenchSvc._extensions as Map<string, { state?: number }> | undefined;
        if (extensionsMap) {
          const mapExt = extensionsMap.get(extId.toLowerCase());
          if (mapExt) {
            mapExt.state = 3; // Uninstalled
            debugLog('Workbench.uninstall', `>>> Updated state in _extensions map`);
          }
        }

        // Fire change events to update UI
        const onChange = workbenchSvc._onChange as { fire?: () => void } | undefined;
        if (typeof onChange?.fire === 'function') {
          onChange.fire();
          debugLog('Workbench.uninstall', `>>> Fired _onChange`);
        }

        // Call resetExtensionsState if available
        if (typeof workbenchSvc.resetExtensionsState === 'function') {
          await (workbenchSvc.resetExtensionsState as () => Promise<void>)();
          debugLog('Workbench.uninstall', `>>> Called resetExtensionsState`);
        }

        debugLog('Workbench.uninstall', `>>> Successfully uninstalled: ${extId}`);
      } catch (err) {
        debugLog('Workbench.uninstall', `>>> Tauri uninstall failed:`, err);
        // Try the original as fallback
        if (origFn) {
          debugLog('Workbench.uninstall', `>>> Trying original uninstall...`);
          return origFn.call(this, extension);
        }
        throw err;
      }
    };
  };

  // Patch on instance
  if (typeof originalUninstall === 'function' || typeof protoUninstall === 'function') {
    (extWorkbenchService as Record<string, unknown>).uninstall = createUninstallHandler(originalUninstall || protoUninstall);
    debugLog('Workbench', '*** uninstall method PATCHED on instance ***');
  }

  // Also patch on prototype if it exists there
  if (proto && typeof protoUninstall === 'function') {
    proto.uninstall = createUninstallHandler(protoUninstall);
    debugLog('Workbench', '*** uninstall method PATCHED on prototype ***');
  }

  // If neither exists, add one
  if (typeof originalUninstall !== 'function' && typeof protoUninstall !== 'function') {
    debugLog('Workbench', 'WARNING: uninstall method not found on service - attempting to add it');
    // If there's no uninstall method, add one
    (extWorkbenchService as Record<string, unknown>).uninstall = async (
      extension: unknown
    ): Promise<void> => {
      const ext = extension as { identifier?: { id: string }; local?: unknown };
      const extId = ext.identifier?.id;
      debugLog('Workbench.uninstall', `>>> ADDED METHOD CALLED for: ${extId}`);

      if (!extId) {
        throw new Error('Cannot uninstall extension: no ID found');
      }

      // Use Tauri to uninstall
      const tauriServer = getTauriLocalExtensionServer();
      const localExt = (ext.local || ext) as Parameters<typeof tauriServer.uninstall>[0];
      await tauriServer.uninstall(localExt);

      // Update local state (same as above)
      const removeFromArray = (arr: unknown[] | undefined, id: string) => {
        if (!Array.isArray(arr)) return;
        const idx = arr.findIndex((e: { identifier?: { id: string } }) =>
          e.identifier?.id.toLowerCase() === id.toLowerCase()
        );
        if (idx !== -1) arr.splice(idx, 1);
      };

      removeFromArray(workbenchSvc.installed as unknown[], extId);
      removeFromArray(workbenchSvc.local as unknown[], extId);

      const onChange = workbenchSvc._onChange as { fire?: () => void } | undefined;
      if (typeof onChange?.fire === 'function') onChange.fire();
    };
    debugLog('Workbench', '*** uninstall method ADDED ***');
  }

  // DEBUGGING: Verify patching succeeded
  console.log('[ExtOverride] ========== UNINSTALL PATCHING COMPLETE ==========');
  console.log('[ExtOverride] typeof service.uninstall after patch:', typeof (extWorkbenchService as Record<string, unknown>).uninstall);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).__extPatchCompleted = Date.now();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).__uninstallPatched = true;

  // CRITICAL: Also patch the extensionManagementService.installFromGallery
  // This is called by the "Install Anyway" button
  const extMgmtSvc = (extWorkbenchService as Record<string, unknown>).extensionManagementService as {
    installFromGallery?: (gallery: unknown, options?: unknown, servers?: unknown) => Promise<unknown>;
  } | undefined;

  if (extMgmtSvc?.installFromGallery) {
    const originalInstallFromGallery = extMgmtSvc.installFromGallery.bind(extMgmtSvc);

    extMgmtSvc.installFromGallery = async (
      gallery: unknown,
      options?: unknown,
      servers?: unknown
    ): Promise<unknown> => {
      const g = gallery as GalleryExtension;
      const extId = g.identifier.id || `${g.publisher}.${g.name}`;
      debugLog('ExtMgmtSvc.installFromGallery', `>>> CALLED for: ${extId}`);

      try {
        // Try Tauri first
        debugLog('ExtMgmtSvc.installFromGallery', `Attempting Tauri installation...`);
        const result = await installExtensionFromGallery(g);
        debugLog('ExtMgmtSvc.installFromGallery', `Tauri installation SUCCESS`);
        return result;
      } catch (tauriErr) {
        debugLog('ExtMgmtSvc.installFromGallery', `Tauri failed:`, tauriErr);
        // Try original as fallback
        debugLog('ExtMgmtSvc.installFromGallery', `Trying original...`);
        return originalInstallFromGallery(gallery, options, servers);
      }
    };
    debugLog('Workbench', '*** extensionManagementService.installFromGallery PATCHED ***');
  }

  // Patch queryLocal to include Tauri extensions
  const originalQueryLocal = (extWorkbenchService as { queryLocal?: () => Promise<unknown[]> }).queryLocal?.bind(extWorkbenchService);

  if (originalQueryLocal) {
    (extWorkbenchService as Record<string, unknown>).queryLocal = async (): Promise<unknown[]> => {
      debugLog('queryLocal', '>>> Called');
      let original: unknown[] = [];
      try {
        // Add timeout to prevent hanging
        const timeoutPromise = new Promise<unknown[]>((_, reject) =>
          setTimeout(() => reject(new Error('queryLocal timeout')), 5000)
        );
        original = await Promise.race([originalQueryLocal(), timeoutPromise]);
        debugLog('queryLocal', `>>> Original returned ${original.length} extensions`);
      } catch (err) {
        debugLog('queryLocal', '>>> Original queryLocal failed or timed out, using empty array:', err);
        // Continue with empty original array - just return Tauri extensions
      }
      const tauriInstalled = getTauriExtensionManager().getAllInstalled();

      // Convert to workbench extension format
      const tauriWorkbenchExts = tauriInstalled.map(ext => ({
        type: 1, // ExtensionType.User
        identifier: ext.identifier,
        local: ext,
        gallery: undefined,
        state: 1, // ExtensionState.Installed
        name: ext.manifest.name,
        displayName: ext.manifest.displayName || ext.manifest.name,
        description: ext.manifest.description,
        publisher: ext.manifest.publisher,
        version: ext.manifest.version,
        publisherDisplayName: ext.manifest.publisher,
        enablementState: 12, // EnablementState.EnabledGlobally (0-11 are disabled states, 12=EnabledGlobally, 13=EnabledWorkspace)
        isBuiltin: false,
        hasReadme: false,
        hasChangelog: false,
      }));

      // Merge, avoiding duplicates
      const installedIds = new Set((original as { identifier?: { id: string } }[])
        .map(e => e.identifier?.id.toLowerCase())
        .filter(Boolean));

      const combined = [...original];
      for (const ext of tauriWorkbenchExts) {
        if (!installedIds.has(ext.identifier.id.toLowerCase())) {
          combined.push(ext);
        }
      }

      debugLog('queryLocal', `>>> Returning ${combined.length} total extensions`);
      return combined;
    };
  }

  // Listen for Tauri extension changes and refresh UI
  getTauriExtensionManager().onDidChange(() => {
    console.log('[ExtOverride] Tauri extensions changed, UI should refresh');
    // The UI should auto-refresh from the patched queryLocal
  });

  console.log('[ExtOverride] Extensions workbench service patched');
}

/**
 * Try to patch individual extension management servers
 * This is a deeper attempt to enable installation for all extensions
 */
async function patchExtensionManagementServers(services: { get: <T>(id: unknown) => T }): Promise<void> {
  debugLog('Servers', 'Attempting to patch extension management servers...');

  try {
    // Try to import the extension management server service
    const { IExtensionManagementServerService } = await import(
      '@codingame/monaco-vscode-api/vscode/vs/workbench/services/extensionManagement/common/extensionManagement.service'
    );

    const serverService = services.get(IExtensionManagementServerService) as {
      localExtensionManagementServer?: {
        extensionManagementService?: {
          canInstall?: (extension: unknown) => Promise<boolean | string>;
          isExtensionPlatformCompatible?: (extension: unknown) => Promise<boolean>;
        };
      };
      remoteExtensionManagementServer?: {
        extensionManagementService?: {
          canInstall?: (extension: unknown) => Promise<boolean | string>;
          isExtensionPlatformCompatible?: (extension: unknown) => Promise<boolean>;
        };
      };
      webExtensionManagementServer?: {
        extensionManagementService?: {
          canInstall?: (extension: unknown) => Promise<boolean | string>;
          isExtensionPlatformCompatible?: (extension: unknown) => Promise<boolean>;
        };
      };
    } | null;

    if (!serverService) {
      debugLog('Servers', 'ExtensionManagementServerService not found');
      return;
    }

    // Log what servers are available
    debugLog('Servers', 'Available servers:', {
      hasLocal: !!serverService.localExtensionManagementServer,
      hasRemote: !!serverService.remoteExtensionManagementServer,
      hasWeb: !!serverService.webExtensionManagementServer,
    });

    // Patch web extension management server - THIS IS CRITICAL FOR INSTALLATION
    const webServer = serverService.webExtensionManagementServer;
    if (webServer?.extensionManagementService) {
      const svc = webServer.extensionManagementService as Record<string, unknown>;

      // Log available methods on the service
      const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(svc))
        .filter(k => typeof svc[k] === 'function');
      debugLog('WebServer', 'Service prototype methods:', methods.slice(0, 20).join(', '));

      // Also check instance methods
      const instanceMethods = Object.keys(svc).filter(k => typeof svc[k] === 'function');
      debugLog('WebServer', 'Service instance methods:', instanceMethods.join(', '));

      // CRITICAL: Patch canInstall - this is called during actual installation!
      const originalWebCanInstall = (svc.canInstall as (extension: unknown) => Promise<boolean | unknown>).bind(svc);

      if (originalWebCanInstall) {
        svc.canInstall = async (extension: unknown): Promise<boolean> => {
          const extId = getExtensionId(extension);
          debugLog('WebServer.canInstall', `>>> CALLED FOR: ${extId}`);

          // Log extension details
          const ext = extension as {
            allTargetPlatforms?: string[];
            displayName?: string;
            identifier?: { id: string };
          };
          debugLog('WebServer.canInstall', `Target platforms:`, ext.allTargetPlatforms);

          // ALWAYS return true - we handle installation via Tauri
          debugLog('WebServer.canInstall', `>>> FORCING TRUE for ${extId}`);
          return true;
        };

        debugLog('Servers', '*** Web extension server canInstall PATCHED ***');
      } else {
        debugLog('Servers', 'WARNING: canInstall not found on web server service');
      }

      // Patch isExtensionPlatformCompatible - backup for platform check
      const originalPlatformCheck = (svc.isExtensionPlatformCompatible as (extension: unknown) => Promise<boolean>).bind(svc);

      if (originalPlatformCheck) {
        svc.isExtensionPlatformCompatible = async (extension: unknown): Promise<boolean> => {
          const extId = getExtensionId(extension);
          debugLog('WebServer.platformCheck', `>>> CALLED FOR: ${extId}`);
          debugLog('WebServer.platformCheck', `>>> FORCING TRUE`);
          return true;
        };

        debugLog('Servers', '*** Web extension server isExtensionPlatformCompatible PATCHED ***');
      }

      // ALSO patch installFromGallery to intercept and use Tauri
      const originalInstallFromGallery = (svc.installFromGallery as (extension: unknown, options?: unknown) => Promise<unknown>).bind(svc);

      // Get the onDidInstallExtensions event emitter to fire after installation
      // Log all properties that might be emitters
      const allKeys = Object.keys(svc);
      const emitterKeys = allKeys.filter(k => k.includes('Install') || k.includes('install') || k.startsWith('_on'));
      debugLog('WebServer', 'Potential emitter keys:', emitterKeys.join(', '));

      const onDidInstallExtensions = svc.onDidInstallExtensions as { fire?: (event: unknown) => void } | undefined;
      const _onDidInstallExtensions = (svc as Record<string, unknown>)._onDidInstallExtensions as { fire?: (event: unknown) => void } | undefined;
      const eventEmitter = onDidInstallExtensions?.fire ? onDidInstallExtensions : _onDidInstallExtensions;

      debugLog('WebServer', 'onDidInstallExtensions type:', typeof svc.onDidInstallExtensions);
      debugLog('WebServer', '_onDidInstallExtensions type:', typeof (svc as Record<string, unknown>)._onDidInstallExtensions);
      debugLog('WebServer', 'Has onDidInstallExtensions.fire:', !!onDidInstallExtensions?.fire);
      debugLog('WebServer', 'Has _onDidInstallExtensions.fire:', !!_onDidInstallExtensions?.fire);

      // Capture the workbench service for use in the closure
      const workbenchExtMgmt = services.get(IWorkbenchExtensionManagementService) as Record<string, unknown> | null;
      debugLog('WebServer', 'Workbench ext mgmt service available:', !!workbenchExtMgmt);

      if (originalInstallFromGallery) {
        svc.installFromGallery = async (extension: unknown, options?: unknown): Promise<unknown> => {
          const ext = extension as GalleryExtension;
          const extId = ext.identifier.id || `${ext.publisher}.${ext.name}`;
          debugLog('WebServer.install', `>>> INTERCEPTED installFromGallery for: ${extId}`);

          try {
            // Try Tauri installation
            debugLog('WebServer.install', `Attempting Tauri installation...`);
            const localExtension = await installExtensionFromGallery(ext);
            debugLog('WebServer.install', `Tauri installation SUCCESSFUL for: ${extId}`);

            // Build the install result that VS Code expects
            const installResult = [{
              identifier: { id: extId },
              local: localExtension,
              operation: 1, // InstallOperation.Install
              source: ext, // gallery extension
              profileLocation: undefined,
              applicationScoped: false,
            }];

            // Try multiple ways to fire the event so the UI updates
            let eventFired = false;

            // Method 1: Direct emitter on the web server service
            if (eventEmitter?.fire) {
              debugLog('WebServer.install', 'Firing onDidInstallExtensions on web server...');
              eventEmitter.fire(installResult);
              debugLog('WebServer.install', 'Web server event fired!');
              eventFired = true;
            }

            // Method 2: Try the workbench extension management service
            if (workbenchExtMgmt) {
              // Try _onDidInstallExtensions
              const wbEmitter = workbenchExtMgmt._onDidInstallExtensions as { fire?: (event: unknown) => void } | undefined;
              if (wbEmitter?.fire) {
                debugLog('WebServer.install', 'Firing on IWorkbenchExtensionManagementService...');
                wbEmitter.fire(installResult);
                debugLog('WebServer.install', 'Workbench service event fired!');
                eventFired = true;
              } else {
                debugLog('WebServer.install', 'No _onDidInstallExtensions on workbench service');
              }
            }

            if (!eventFired) {
              debugLog('WebServer.install', 'WARNING: No event emitter found, UI may not update');
              debugLog('WebServer.install', 'Try reloading the Extensions view or the whole window');
            }

            return localExtension;
          } catch (err) {
            debugLog('WebServer.install', `Tauri installation failed:`, err);
            // Fall back to original (which will likely fail, but let's try)
            debugLog('WebServer.install', `Falling back to original installFromGallery...`);
            return originalInstallFromGallery(extension, options);
          }
        };

        debugLog('Servers', '*** Web extension server installFromGallery PATCHED ***');
      }
    } else {
      debugLog('Servers', 'WARNING: webExtensionManagementServer or its service not found');
    }

    // If no local server exists, we might need to create one or use a different approach
    if (!serverService.localExtensionManagementServer) {
      debugLog('Servers', 'WARNING: No local extension management server - Node.js extensions may not work');
      debugLog('Servers', 'SOLUTION: You need to either:');
      debugLog('Servers', '  1. Set up a VSCode Server and configure remoteAuthority');
      debugLog('Servers', '  2. Use @codingame/monaco-vscode-server package');
      debugLog('Servers', '  3. Implement a custom local extension management server');
    }

  } catch (err) {
    debugLog('Servers', 'Failed to patch servers:', err);
  }
}

/**
 * Additional patching at the gallery service level
 * This patches the actual canInstall that checks platform compatibility
 */
async function patchGalleryCanInstall(services: { get: <T>(id: unknown) => T }): Promise<void> {
  debugLog('Gallery', 'Attempting to patch gallery canInstall...');

  try {
    // Try to get the extension gallery service
    const { IExtensionGalleryService } = await import(
      '@codingame/monaco-vscode-api/vscode/vs/platform/extensionManagement/common/extensionManagement.service'
    );

    const galleryService = services.get(IExtensionGalleryService) as {
      isEnabled?: () => boolean;
      query?: (...args: unknown[]) => Promise<unknown>;
    } | null;

    if (galleryService) {
      debugLog('Gallery', 'Gallery service found, isEnabled:', galleryService.isEnabled?.());
    } else {
      debugLog('Gallery', 'Gallery service not found');
    }
  } catch (err) {
    debugLog('Gallery', 'Failed to access gallery service:', err);
  }
}

/**
 * Extract extension ID from various extension object formats
 */
function getExtensionId(extension: unknown): string | undefined {
  if (!extension || typeof extension !== 'object') {
    return undefined;
  }

  const ext = extension as Record<string, unknown>;

  // Gallery extension format
  if (ext.publisher && ext.name) {
    return `${ext.publisher}.${ext.name}`;
  }

  // Identifier format
  if (ext.identifier && typeof ext.identifier === 'object') {
    const identifier = ext.identifier as { id?: string };
    return identifier.id;
  }

  // Try displayName for debugging
  if (ext.displayName) {
    debugLog('ExtId', `Could not get ID, displayName is: ${ext.displayName}`);
  }

  return undefined;
}

/**
 * Debug helper to inspect extension object structure
 */
function inspectExtension(extension: unknown): void {
  if (!extension || typeof extension !== 'object') {
    debugLog('Inspect', 'Extension is null or not an object');
    return;
  }

  const ext = extension as Record<string, unknown>;
  const keys = Object.keys(ext);
  debugLog('Inspect', `Extension keys: ${keys.join(', ')}`);

  // Log important properties
  if (ext.gallery) {
    const gallery = ext.gallery as Record<string, unknown>;
    debugLog('Inspect', 'Gallery info:', {
      name: gallery.name,
      publisher: gallery.publisher,
      version: gallery.version,
      properties: gallery.properties,
    });
  }

  if (ext.local) {
    debugLog('Inspect', 'Has local extension data');
  }
}

/**
 * CRITICAL: Patch the methods that determine which servers can install extensions
 * This is the ROOT CAUSE of the "Unsupported" error
 *
 * The error is thrown in getExtensionManagementServersToInstall() when no servers
 * can install the extension (because ESLint is a 'workspace' kind extension and
 * we don't have a remote server)
 */
async function patchWorkbenchExtensionManagementServersMethod(
  services: { get: <T>(id: unknown) => T }
): Promise<void> {
  debugLog('ServersPatch', 'CRITICAL: Patching getExtensionManagementServersToInstall...');

  // Get the IExtensionManagementServerService to access the web server
  let webServer: unknown = null;
  try {
    const { IExtensionManagementServerService } = await import(
      '@codingame/monaco-vscode-api/vscode/vs/workbench/services/extensionManagement/common/extensionManagement.service'
    );
    const serverService = services.get(IExtensionManagementServerService) as {
      webExtensionManagementServer: unknown | null;
    } | null;
    webServer = serverService?.webExtensionManagementServer;
    debugLog('ServersPatch', 'Web server available:', !!webServer);
  } catch (err) {
    debugLog('ServersPatch', 'Failed to get server service:', err);
  }

  // Get the workbench extension management service
  const extMgmtService = services.get(IWorkbenchExtensionManagementService) as Record<string, unknown> | null;

  if (!extMgmtService) {
    debugLog('ServersPatch', 'WARNING: Service not found');
    return;
  }

  // Check both instance and prototype for the methods
  const proto = Object.getPrototypeOf(extMgmtService);

  // Log all methods on the prototype for debugging
  const protoMethods = Object.getOwnPropertyNames(proto).filter(k => {
    try { return typeof proto[k] === 'function'; }
    catch { return false; }
  });
  debugLog('ServersPatch', 'Prototype methods found:', protoMethods.slice(0, 30).join(', '));

  // PATCH 1: getExtensionManagementServersToInstall
  // This is the method that throws "Unsupported" error
  if (typeof proto.getExtensionManagementServersToInstall === 'function') {
    const originalMethod = proto.getExtensionManagementServersToInstall;

    proto.getExtensionManagementServersToInstall = async function(
      this: unknown,
      gallery: unknown,
      manifest: unknown
    ): Promise<unknown[]> {
      const g = gallery as GalleryExtension;
      const extId = g.identifier.id || `${g.publisher}.${g.name}`;
      debugLog('ServersPatch.getServersToInstall', `>>> INTERCEPTED for: ${extId}`);

      try {
        // Try the original method first
        const servers = await originalMethod.call(this, gallery, manifest);
        debugLog('ServersPatch.getServersToInstall', `Original returned ${(servers as unknown[]).length} servers`);

        if (servers && (servers as unknown[]).length > 0) {
          return servers;
        }
      } catch (err) {
        debugLog('ServersPatch.getServersToInstall', `Original threw (expected for Node.js extensions):`, (err as Error).message);
        // This is expected for Node.js extensions - we'll handle it below
      }

      // If no servers or error, return web server as fallback
      // Our installFromGallery patch on the web server will handle the actual Tauri installation
      if (webServer) {
        debugLog('ServersPatch.getServersToInstall', `>>> RETURNING WEB SERVER as fallback for ${extId}`);
        return [webServer];
      }

      debugLog('ServersPatch.getServersToInstall', 'WARNING: No web server available, returning empty array');
      return [];
    };

    debugLog('ServersPatch', '*** getExtensionManagementServersToInstall PATCHED on prototype ***');
  } else {
    debugLog('ServersPatch', 'WARNING: getExtensionManagementServersToInstall not found on prototype');
  }

  // PATCH 2: getInstallableExtensionManagementServers
  // This determines which servers can theoretically install an extension
  if (typeof proto.getInstallableExtensionManagementServers === 'function') {
    const originalMethod = proto.getInstallableExtensionManagementServers;

    proto.getInstallableExtensionManagementServers = function(
      this: unknown,
      manifest: unknown
    ): unknown[] {
      debugLog('ServersPatch.getInstallableServers', '>>> INTERCEPTED');

      const servers = originalMethod.call(this, manifest) as unknown[];
      debugLog('ServersPatch.getInstallableServers', `Original returned ${servers.length} servers`);

      if (servers.length > 0) {
        return servers;
      }

      // If no servers can install, add web server as fallback
      if (webServer) {
        debugLog('ServersPatch.getInstallableServers', '>>> ADDING WEB SERVER as fallback');
        return [webServer];
      }

      return servers;
    };

    debugLog('ServersPatch', '*** getInstallableExtensionManagementServers PATCHED on prototype ***');
  } else {
    debugLog('ServersPatch', 'WARNING: getInstallableExtensionManagementServers not found on prototype');
  }

  // PATCH 3: validServers - this also throws Unsupported for invalid servers
  if (typeof proto.validServers === 'function') {
    const originalMethod = proto.validServers;

    proto.validServers = function(
      this: unknown,
      gallery: unknown,
      manifest: unknown,
      servers: unknown[]
    ): unknown[] {
      const g = gallery as GalleryExtension;
      const extId = g.identifier.id || `${g.publisher}.${g.name}`;
      debugLog('ServersPatch.validServers', `>>> INTERCEPTED for: ${extId}`);

      try {
        return originalMethod.call(this, gallery, manifest, servers);
      } catch (err) {
        debugLog('ServersPatch.validServers', `Original threw:`, (err as Error).message);
        // If it throws, just return the servers - we'll handle installation via Tauri
        debugLog('ServersPatch.validServers', '>>> Bypassing validation, returning servers as-is');
        return servers;
      }
    };

    debugLog('ServersPatch', '*** validServers PATCHED on prototype ***');
  }

  debugLog('ServersPatch', 'Server methods patching complete');
}

/**
 * CRITICAL: Register Tauri as the LOCAL extension management server
 *
 * This makes VS Code think it's running in an Electron-like environment with
 * a local extension server. This removes the "not supported in web" warnings
 * and allows proper extension installation.
 */
async function registerTauriAsLocalServer(services: { get: <T>(id: unknown) => T }): Promise<void> {
  debugLog('TauriLocal', 'Registering Tauri as local extension server...');

  try {
    const { IExtensionManagementServerService } = await import(
      '@codingame/monaco-vscode-api/vscode/vs/workbench/services/extensionManagement/common/extensionManagement.service'
    );

    const serverService = services.get(IExtensionManagementServerService) as {
      localExtensionManagementServer: unknown | null;
      remoteExtensionManagementServer: unknown | null;
      webExtensionManagementServer: unknown | null;
      _servers?: unknown[];
      servers?: unknown[];
    } | null;

    if (!serverService) {
      debugLog('TauriLocal', 'WARNING: Server service not found');
      return;
    }

    debugLog('TauriLocal', 'Current servers:', {
      hasLocal: !!serverService.localExtensionManagementServer,
      hasRemote: !!serverService.remoteExtensionManagementServer,
      hasWeb: !!serverService.webExtensionManagementServer,
    });

    // Use pre-created server from early patch if available, otherwise create new
    let tauriLocalServer = (window as unknown as Record<string, unknown>).__TAURI_LOCAL_EXT_SERVER__ as {
      id: string;
      label: string;
      extensionManagementService: unknown;
    } | undefined;

    if (!tauriLocalServer) {
      tauriLocalServer = createTauriLocalExtensionManagementServer();
      debugLog('TauriLocal', 'Created new Tauri local server:', tauriLocalServer.id);
    } else {
      debugLog('TauriLocal', 'Using pre-created Tauri local server:', tauriLocalServer.id);
    }

    // Register it as the local server
    // This is the key - VS Code will now think it has a local server
    (serverService as Record<string, unknown>).localExtensionManagementServer = tauriLocalServer;

    // Also add it to the servers array if it exists
    if (Array.isArray(serverService._servers)) {
      serverService._servers.unshift(tauriLocalServer);
      debugLog('TauriLocal', 'Added to _servers array');
    }
    if (Array.isArray(serverService.servers)) {
      serverService.servers.unshift(tauriLocalServer);
      debugLog('TauriLocal', 'Added to servers array');
    }

    debugLog('TauriLocal', 'After registration:', {
      hasLocal: !!serverService.localExtensionManagementServer,
      localId: (serverService.localExtensionManagementServer as { id?: string }).id,
    });

    // CRITICAL: Patch getExtensionManagementServer to return our Tauri server for Tauri-installed extensions
    // This is called when VS Code validates extensions after installation
    // The method takes an IExtension object with a 'location' property (URI)
    const serverServiceAny = serverService as Record<string, unknown>;

    // The default implementation is 'unsupported', so we need to replace it completely
    serverServiceAny.getExtensionManagementServer = function(extension: {
      location?: { scheme?: string; path?: string; fsPath?: string };
      extensionLocation?: { scheme?: string; path?: string; fsPath?: string };
      identifier?: { id?: string };
    }): unknown {
      // Extension can have location or extensionLocation
      const location = extension.location || extension.extensionLocation;
      const path = location?.fsPath || location?.path || '';
      const extId = extension.identifier?.id || 'unknown';

      debugLog('TauriLocal.getServer', `>>> CALLED for: ${extId}, path: ${path}`);

      // Check if this is a Tauri-installed extension (located in our extensions folder)
      if (path.includes('/extensions/installed/') || path.includes('\\extensions\\installed\\') ||
          path.includes('/com.blink.app/') || path.includes('\\com.blink.app\\')) {
        debugLog('TauriLocal.getServer', '>>> Returning Tauri local server');
        return tauriLocalServer;
      }

      // For web extensions, return the web server if available
      if (serverService.webExtensionManagementServer && location?.scheme === 'web-extension') {
        debugLog('TauriLocal.getServer', '>>> Returning web server');
        return serverService.webExtensionManagementServer;
      }

      // For file:// URIs that are Tauri extensions, also return our server
      if (location?.scheme === 'file' && (path.includes('Application Support') || path.includes('AppData'))) {
        debugLog('TauriLocal.getServer', '>>> Returning Tauri local server (file scheme)');
        return tauriLocalServer;
      }

      debugLog('TauriLocal.getServer', '>>> No matching server, returning local server as default');
      return tauriLocalServer; // Default to our Tauri server
    };
    debugLog('TauriLocal', '*** getExtensionManagementServer PATCHED (replaced unsupported) ***');

    // Also patch getExtensionInstallLocation which is marked as unsupported
    // This returns ExtensionInstallLocation enum: 0=Local, 1=Remote, 2=Web
    serverServiceAny.getExtensionInstallLocation = function(extension: {
      location?: { scheme?: string; path?: string; fsPath?: string };
      extensionLocation?: { scheme?: string; path?: string; fsPath?: string };
    }): number | null {
      const location = extension.location || extension.extensionLocation;
      const path = location?.fsPath || location?.path || '';

      debugLog('TauriLocal.getInstallLocation', `>>> CALLED for path: ${path}`);

      // For Tauri extensions, return Local (0)
      if (path.includes('/extensions/installed/') || path.includes('/com.blink.app/') ||
          path.includes('\\extensions\\installed\\') || path.includes('\\com.blink.app\\')) {
        debugLog('TauriLocal.getInstallLocation', '>>> Returning Local (0)');
        return 0; // ExtensionInstallLocation.Local
      }

      // Default to Local
      debugLog('TauriLocal.getInstallLocation', '>>> Returning Local (0) as default');
      return 0;
    };
    debugLog('TauriLocal', '*** getExtensionInstallLocation PATCHED ***');

    // Get the workbench extension management service
    const extMgmtService = services.get(IWorkbenchExtensionManagementService) as Record<string, unknown> | null;

    if (extMgmtService) {
      const proto = Object.getPrototypeOf(extMgmtService);

      // Patch getInstallableExtensionManagementServers to include our server
      if (typeof proto.getInstallableExtensionManagementServers === 'function') {
        const originalMethod = proto.getInstallableExtensionManagementServers;

        proto.getInstallableExtensionManagementServers = function(
          this: unknown,
          manifest: unknown
        ): unknown[] {
          debugLog('TauriLocal.getInstallableServers', '>>> INTERCEPTED');

          // Get original result
          const servers = originalMethod.call(this, manifest) as unknown[];

          // If Tauri server isn't in the list, add it
          if (!servers.includes(tauriLocalServer)) {
            debugLog('TauriLocal.getInstallableServers', 'Adding Tauri local server');
            return [tauriLocalServer, ...servers];
          }

          return servers;
        };

        debugLog('TauriLocal', 'Patched getInstallableExtensionManagementServers to include Tauri server');
      }

      // CRITICAL: Forward events from Tauri local server to workbench extension management service
      // This ensures the UI updates when extensions are installed
      const tauriService = tauriLocalServer.extensionManagementService as {
        onDidInstallExtensions?: { (listener: (e: unknown) => void): { dispose: () => void } };
        onInstallExtension?: { (listener: (e: unknown) => void): { dispose: () => void } };
        onUninstallExtension?: { (listener: (e: unknown) => void): { dispose: () => void } };
        onDidUninstallExtension?: { (listener: (e: unknown) => void): { dispose: () => void } };
      };

      // Find the workbench service's event emitters
      const workbenchEmitters = {
        onDidInstallExtensions: extMgmtService._onDidInstallExtensions as { fire?: (e: unknown) => void } | undefined,
        onInstallExtension: extMgmtService._onInstallExtension as { fire?: (e: unknown) => void } | undefined,
        onUninstallExtension: extMgmtService._onUninstallExtension as { fire?: (e: unknown) => void } | undefined,
        onDidUninstallExtension: extMgmtService._onDidUninstallExtension as { fire?: (e: unknown) => void } | undefined,
      };

      debugLog('TauriLocal', 'Workbench emitters found:', {
        hasOnDidInstallExtensions: !!workbenchEmitters.onDidInstallExtensions?.fire,
        hasOnInstallExtension: !!workbenchEmitters.onInstallExtension?.fire,
        hasOnUninstallExtension: !!workbenchEmitters.onUninstallExtension?.fire,
        hasOnDidUninstallExtension: !!workbenchEmitters.onDidUninstallExtension?.fire,
      });

      // Also get the IExtensionsWorkbenchService for UI updates
      const extWorkbenchService = services.get(IExtensionsWorkbenchService) as Record<string, unknown> | null;
      debugLog('TauriLocal', 'Extensions workbench service found:', !!extWorkbenchService);

      if (extWorkbenchService) {
        // Log available methods and properties for debugging
        const keys = Object.keys(extWorkbenchService);
        const changeRelated = keys.filter(k => k.includes('change') || k.includes('Change') || k.includes('refresh') || k.includes('Refresh') || k.includes('_on'));
        debugLog('TauriLocal', 'UI service change-related keys:', changeRelated.join(', '));
      }

      // Forward onDidInstallExtensions
      const didInstallEmitter = workbenchEmitters.onDidInstallExtensions;
      if (tauriService.onDidInstallExtensions && didInstallEmitter?.fire) {
        const fireDidInstall = didInstallEmitter.fire.bind(didInstallEmitter);
        tauriService.onDidInstallExtensions(async (event) => {
          debugLog('TauriLocal', '>>> FORWARDING onDidInstallExtensions to workbench', event);

          // CRITICAL: Reload TauriExtensionManager FIRST so isExtensionInstalled returns correct value
          debugLog('TauriLocal', '>>> Reloading TauriExtensionManager after install...');
          try {
            await getTauriExtensionManager().loadInstalledExtensions();
            debugLog('TauriLocal', '>>> TauriExtensionManager reloaded after install');
          } catch (err) {
            debugLog('TauriLocal', '>>> Failed to reload TauriExtensionManager:', err);
          }

          fireDidInstall(event);

          // Also try to notify the UI layer directly
          if (extWorkbenchService) {
            const eventArray = event as Array<{ identifier?: { id: string }; local?: unknown }>;
            if (eventArray && eventArray.length > 0) {
              const installed = eventArray[0];
              const extId = installed.identifier?.id;

              if (extId) {
                debugLog('TauriLocal', `>>> Looking for extension object to update: ${extId}`);

                // Log all keys on the workbench service to find where extensions are stored
                const allKeys = Object.keys(extWorkbenchService);
                const extensionRelatedKeys = allKeys.filter(k =>
                  k.includes('extension') || k.includes('Extension') ||
                  k.includes('install') || k.includes('Install') ||
                  k.includes('_') || k.includes('gallery') || k.includes('Gallery')
                );
                debugLog('TauriLocal', `>>> Extension-related keys: ${extensionRelatedKeys.slice(0, 30).join(', ')}`);

                // Try to find the extension in the 'installed' or 'local' arrays
                const installed_exts = extWorkbenchService.installed as Array<{
                  identifier?: { id: string };
                  state?: number;
                  local?: unknown;
                  enablementState?: number;
                }> | undefined;

                const local_exts = extWorkbenchService.local as Array<{
                  identifier?: { id: string };
                  state?: number;
                  local?: unknown;
                  enablementState?: number;
                }> | undefined;

                debugLog('TauriLocal', `>>> installed array length: ${installed_exts?.length || 0}`);
                debugLog('TauriLocal', `>>> local array length: ${local_exts?.length || 0}`);

                // Check for installing extensions - these are the ones with "Installing" state
                const installing = extWorkbenchService.installing as Array<{
                  identifier?: { id: string };
                  state?: number;
                  local?: unknown;
                  enablementState?: number;
                }> | undefined;
                debugLog('TauriLocal', `>>> installing array length: ${installing?.length || 0}`);

                // CRITICAL: Find the extension in the 'installing' array, update it, and move to installed
                if (installing && installing.length > 0) {
                  let foundExtIndex = -1;
                  let foundExt: typeof installing[0] | null = null;

                  for (let i = 0; i < installing.length; i++) {
                    const ext = installing[i];
                    debugLog('TauriLocal', `>>> Checking installing ext: ${ext.identifier?.id}, state: ${ext.state}`);
                    if (ext.identifier?.id.toLowerCase() === extId.toLowerCase()) {
                      debugLog('TauriLocal', `>>> FOUND in installing array at index ${i}!`);
                      foundExtIndex = i;
                      foundExt = ext;

                      // Log all properties and methods on the extension object
                      const extObj = ext as Record<string, unknown>;
                      const allKeys = Object.keys(extObj);
                      debugLog('TauriLocal', `>>> Extension object keys: ${allKeys.join(', ')}`);

                      // Check for setter methods
                      const protoKeys = Object.getOwnPropertyNames(Object.getPrototypeOf(ext) || {});
                      debugLog('TauriLocal', `>>> Extension prototype keys: ${protoKeys.join(', ')}`);

                      // Check property descriptors to see if properties are writable
                      const stateDesc = Object.getOwnPropertyDescriptor(ext, 'state') ||
                                       Object.getOwnPropertyDescriptor(Object.getPrototypeOf(ext) || {}, 'state');
                      debugLog('TauriLocal', `>>> state property descriptor:`, stateDesc);

                      // Try updating the extension properties
                      debugLog('TauriLocal', `>>> Before: state=${ext.state}, enablementState=${ext.enablementState}`);

                      try {
                        // Method 1: Try direct assignment
                        ext.state = 1; // ExtensionState.Installed
                        debugLog('TauriLocal', `>>> After direct state assignment: state=${ext.state}`);
                      } catch (err) {
                        debugLog('TauriLocal', `>>> Direct state assignment failed:`, err);
                      }

                      try {
                        ext.local = installed.local;
                        debugLog('TauriLocal', `>>> After local assignment: local=${!!ext.local}`);
                      } catch (err) {
                        debugLog('TauriLocal', `>>> Direct local assignment failed:`, err);
                      }

                      try {
                        ext.enablementState = 12; // EnablementState.EnabledGlobally (12, not 8)
                        debugLog('TauriLocal', `>>> After enablementState assignment: enablementState=${ext.enablementState}`);
                      } catch (err) {
                        debugLog('TauriLocal', `>>> Direct enablementState assignment failed:`, err);
                      }

                      // Method 2: Try Object.assign
                      try {
                        Object.assign(ext, { state: 1, local: installed.local, enablementState: 8 });
                        debugLog('TauriLocal', `>>> After Object.assign: state=${ext.state}`);
                      } catch (err) {
                        debugLog('TauriLocal', `>>> Object.assign failed:`, err);
                      }

                      // Method 3: Try calling a setState method if it exists
                      const setState = (ext as { setState?: (state: number) => void }).setState;
                      if (typeof setState === 'function') {
                        debugLog('TauriLocal', `>>> Found setState method, calling...`);
                        try {
                          setState.call(ext, 1);
                          debugLog('TauriLocal', `>>> After setState: state=${ext.state}`);
                        } catch (err) {
                          debugLog('TauriLocal', `>>> setState failed:`, err);
                        }
                      }

                      // Method 4: Try using _state or internal property
                      const extAny = ext as Record<string, unknown>;
                      if ('_state' in extAny) {
                        debugLog('TauriLocal', `>>> Found _state property, setting...`);
                        try {
                          extAny._state = 1;
                          debugLog('TauriLocal', `>>> After _state assignment: _state=${extAny._state}`);
                        } catch (err) {
                          debugLog('TauriLocal', `>>> _state assignment failed:`, err);
                        }
                      }

                      debugLog('TauriLocal', `>>> Final state check: state=${ext.state}, enablementState=${ext.enablementState}`);
                    }
                  }

                  // Remove from installing array and add to installed array
                  if (foundExtIndex >= 0 && foundExt) {
                    debugLog('TauriLocal', `>>> Removing from installing array...`);
                    try {
                      installing.splice(foundExtIndex, 1);
                      debugLog('TauriLocal', `>>> installing array length after removal: ${installing.length}`);
                    } catch (err) {
                      debugLog('TauriLocal', `>>> splice failed:`, err);
                    }

                    // Add to installed array if it exists
                    if (installed_exts && Array.isArray(installed_exts)) {
                      debugLog('TauriLocal', `>>> Adding to installed array...`);
                      try {
                        installed_exts.push(foundExt);
                        debugLog('TauriLocal', `>>> installed array length after addition: ${installed_exts.length}`);
                      } catch (err) {
                        debugLog('TauriLocal', `>>> push to installed failed:`, err);
                      }
                    }

                    // Also add to local array if it exists
                    if (local_exts && Array.isArray(local_exts)) {
                      debugLog('TauriLocal', `>>> Adding to local array...`);
                      try {
                        local_exts.push(foundExt);
                      } catch (err) {
                        debugLog('TauriLocal', `>>> push to local failed:`, err);
                      }
                    }
                  }
                }

                // Also check _extensions Map if it exists
                const _extensions = extWorkbenchService._extensions as Map<string, unknown> | undefined;
                if (_extensions && typeof _extensions.get === 'function') {
                  debugLog('TauriLocal', `>>> _extensions Map size: ${_extensions.size}`);
                  const ext = _extensions.get(extId.toLowerCase());
                  if (ext) {
                    debugLog('TauriLocal', `>>> FOUND in _extensions Map!`);
                    const extObj = ext as { state?: number; local?: unknown; enablementState?: number };
                    debugLog('TauriLocal', `>>> Before update: state=${extObj.state}`);
                    extObj.state = 1; // ExtensionState.Installed
                    extObj.local = installed.local;
                    extObj.enablementState = 12; // EnablementState.EnabledGlobally (12, not 8)
                    debugLog('TauriLocal', `>>> After update: state=${extObj.state}`);
                  }
                }

                // Find the extension object by ID and update its state
                // Note: Extension objects may be frozen/readonly, so wrap in try-catch
                const findAndUpdate = (arr: Array<{ identifier?: { id: string }; state?: number; local?: unknown; enablementState?: number }> | undefined) => {
                  if (!arr) return false;
                  for (const ext of arr) {
                    if (ext.identifier?.id.toLowerCase() === extId.toLowerCase()) {
                      debugLog('TauriLocal', `>>> FOUND extension object, updating state...`);
                      debugLog('TauriLocal', `>>> Before: state=${ext.state}, enablementState=${ext.enablementState}`);
                      try {
                        ext.state = 1; // ExtensionState.Installed
                      } catch (e) {
                        debugLog('TauriLocal', `>>> Could not update state (readonly): ${e}`);
                      }
                      try {
                        ext.local = installed.local;
                      } catch (e) {
                        debugLog('TauriLocal', `>>> Could not update local (readonly): ${e}`);
                      }
                      try {
                        ext.enablementState = 12; // EnablementState.EnabledGlobally (12, not 8)
                      } catch (e) {
                        debugLog('TauriLocal', `>>> Could not update enablementState (readonly): ${e}`);
                      }
                      debugLog('TauriLocal', `>>> After: state=${ext.state}, enablementState=${ext.enablementState}`);
                      return true;
                    }
                  }
                  return false;
                };

                const foundInInstalled = findAndUpdate(installed_exts);
                const foundInLocal = findAndUpdate(local_exts);
                debugLog('TauriLocal', `>>> Updated in installed: ${foundInInstalled}, in local: ${foundInLocal}`);

                // Also try the 'extensions' getter if it exists
                const extensions = extWorkbenchService.extensions as Array<{
                  identifier?: { id: string };
                  state?: number;
                  local?: unknown;
                  enablementState?: number;
                }> | undefined;
                if (extensions) {
                  const foundInExtensions = findAndUpdate(extensions);
                  debugLog('TauriLocal', `>>> Updated in extensions: ${foundInExtensions}`);
                }
              }
            }

            // Try various methods to refresh the UI
            const onChange = extWorkbenchService._onChange as { fire?: () => void } | undefined;
            if (onChange?.fire) {
              debugLog('TauriLocal', '>>> Firing _onChange on ExtensionsWorkbenchService');
              onChange.fire();
            }

            // Try to find and fire the onDidInstallExtension emitter on the ExtensionsWorkbenchService
            const extWorkbenchOnDidInstall = extWorkbenchService._onDidInstallExtension as { fire?: (e: unknown) => void } | undefined;
            if (extWorkbenchOnDidInstall?.fire) {
              debugLog('TauriLocal', '>>> Firing _onDidInstallExtension on ExtensionsWorkbenchService');
              if (eventArray && eventArray.length > 0) {
                extWorkbenchOnDidInstall.fire(eventArray[0]);
              }
            }

            // Also try onDidChangeExtension
            const onDidChangeExt = extWorkbenchService._onDidChangeExtension as { fire?: (e: unknown) => void } | undefined;
            if (onDidChangeExt?.fire && eventArray && eventArray.length > 0) {
              debugLog('TauriLocal', '>>> Firing _onDidChangeExtension on ExtensionsWorkbenchService');
              // Fire for the installed extension
              for (const ext of eventArray) {
                if (ext.local) {
                  onDidChangeExt.fire(ext.local);
                }
              }
            }

            // Try to call postInstallExtension or similar method
            const postInstall = extWorkbenchService.postInstallExtension as ((ext: unknown) => void) | undefined;
            if (postInstall && eventArray && eventArray.length > 0) {
              debugLog('TauriLocal', '>>> Calling postInstallExtension');
              for (const ext of eventArray) {
                try {
                  postInstall.call(extWorkbenchService, ext);
                } catch (err) {
                  debugLog('TauriLocal', 'postInstallExtension failed:', err);
                }
              }
            }

            // Try queryLocal to refresh the installed list
            const queryLocal = extWorkbenchService.queryLocal as (() => Promise<unknown>) | undefined;
            if (queryLocal) {
              debugLog('TauriLocal', '>>> Calling queryLocal to refresh installed extensions');
              queryLocal.call(extWorkbenchService).catch((err: unknown) => {
                debugLog('TauriLocal', 'queryLocal failed:', err);
              });
            }

            // Also try resetExtensionsState if available
            const resetState = extWorkbenchService.resetExtensionsState as (() => void) | undefined;
            if (resetState) {
              debugLog('TauriLocal', '>>> Calling resetExtensionsState');
              try {
                resetState.call(extWorkbenchService);
              } catch (err) {
                debugLog('TauriLocal', 'resetExtensionsState failed:', err);
              }
            }

            // CRITICAL: Clear installing arrays and stuck states to stop progress bar
            // VS Code's reportProgressFromOtherSources() shows progress if any extension is in Installing/Uninstalling state
            const extensionsServers = extWorkbenchService.extensionsServers as Array<{
              installed?: Array<{ state?: number; identifier?: { id: string } }>;
              installing?: unknown[];
              _onChange?: { fire?: (e: unknown) => void };
            }> | undefined;

            if (extensionsServers) {
              for (const extServer of extensionsServers) {
                // Clear the installing array after install completes
                const installingArr = extServer.installing;
                if (Array.isArray(installingArr) && installingArr.length > 0) {
                  debugLog('TauriLocal', `>>> Clearing installing array (had ${installingArr.length} items)`);
                  installingArr.length = 0;
                }
                // Clear any stuck Installing/Uninstalling states (0, 2)
                const installedArr = extServer.installed;
                if (installedArr) {
                  for (const ext of installedArr) {
                    if (ext.state === 0 || ext.state === 2) {
                      debugLog('TauriLocal', `>>> Fixing stuck state after install: ${ext.identifier?.id} was ${ext.state}, setting to Installed (1)`);
                      ext.state = 1; // Set to Installed
                    }
                  }
                }
              }
            }

            // Clear the main ExtensionsWorkbenchService.installing array too
            const mainInstallingArr = extWorkbenchService.installing as unknown[] | undefined;
            if (Array.isArray(mainInstallingArr) && mainInstallingArr.length > 0) {
              debugLog('TauriLocal', `>>> Clearing main installing array (had ${mainInstallingArr.length} items)`);
              mainInstallingArr.length = 0;
            }

            // Clear cached _installed/_local to force recalculation
            extWorkbenchService._installed = undefined;
            extWorkbenchService._local = undefined;

            // Fire onChange one more time to trigger reportProgressFromOtherSources() and clear the progress bar
            if (onChange?.fire) {
              debugLog('TauriLocal', '>>> Firing _onChange again to clear progress bar after install');
              onChange.fire();
            }

            // CRITICAL: Clear tasksInProgress to stop any hanging progress indicators
            const tasksInProgress = extWorkbenchService.tasksInProgress as Array<{ cancel?: () => void }> | undefined;
            if (tasksInProgress && tasksInProgress.length > 0) {
              debugLog('TauriLocal', `>>> Canceling ${tasksInProgress.length} pending tasks after install`);
              for (const task of tasksInProgress) {
                if (task.cancel && typeof task.cancel === 'function') {
                  try {
                    task.cancel();
                  } catch (e) {
                    debugLog('TauriLocal', '>>> Task cancel error:', e);
                  }
                }
              }
              tasksInProgress.length = 0;
            }

            // CRITICAL: Call reset() to clear stale UI cache and ensure fresh data
            const resetFn = extWorkbenchService.reset as (() => void) | undefined;
            if (resetFn && typeof resetFn === 'function') {
              debugLog('TauriLocal', '>>> Calling reset() to clear stale UI cache after install');
              try {
                resetFn.call(extWorkbenchService);
              } catch (e) {
                debugLog('TauriLocal', '>>> reset() error:', e);
              }
            }
          }
        });
        debugLog('TauriLocal', 'Event forwarding set up for onDidInstallExtensions');
      } else {
        debugLog('TauriLocal', 'WARNING: Could not set up onDidInstallExtensions forwarding');
      }

      // Forward onInstallExtension
      const installEmitter = workbenchEmitters.onInstallExtension;
      if (tauriService.onInstallExtension && installEmitter?.fire) {
        const fireInstall = installEmitter.fire.bind(installEmitter);
        tauriService.onInstallExtension((event) => {
          debugLog('TauriLocal', '>>> FORWARDING onInstallExtension to workbench', event);
          fireInstall(event);
        });
        debugLog('TauriLocal', 'Event forwarding set up for onInstallExtension');
      }

      // Forward onUninstallExtension
      const uninstallEmitter = workbenchEmitters.onUninstallExtension;
      if (tauriService.onUninstallExtension && uninstallEmitter?.fire) {
        const fireUninstall = uninstallEmitter.fire.bind(uninstallEmitter);
        tauriService.onUninstallExtension((event) => {
          debugLog('TauriLocal', '>>> FORWARDING onUninstallExtension to workbench', event);
          fireUninstall(event);
        });
      }

      // Forward onDidUninstallExtension
      const didUninstallEmitter = workbenchEmitters.onDidUninstallExtension;
      if (tauriService.onDidUninstallExtension && didUninstallEmitter?.fire) {
        const fireDidUninstall = didUninstallEmitter.fire.bind(didUninstallEmitter);
        tauriService.onDidUninstallExtension(async (event) => {
          debugLog('TauriLocal', '>>> FORWARDING onDidUninstallExtension to workbench', event);

          // CRITICAL: Reload TauriExtensionManager FIRST so isExtensionInstalled returns correct value
          debugLog('TauriLocal', '>>> Reloading TauriExtensionManager before state updates...');
          try {
            await getTauriExtensionManager().loadInstalledExtensions();
            debugLog('TauriLocal', '>>> TauriExtensionManager reloaded');
          } catch (err) {
            debugLog('TauriLocal', '>>> Failed to reload TauriExtensionManager:', err);
          }

          // Update extension state to Uninstalled (3)
          const uninstallEvent = event as { identifier?: { id?: string } };
          const extId = uninstallEvent.identifier?.id;

          if (extId && extWorkbenchService) {
            debugLog('TauriLocal', `>>> Updating state for uninstalled: ${extId}`);

            // Update in _extensions Map if it exists
            const _extensions = extWorkbenchService._extensions as Map<string, unknown> | undefined;
            if (_extensions && typeof _extensions.get === 'function') {
              const ext = _extensions.get(extId.toLowerCase());
              if (ext) {
                const extObj = ext as { state?: number; local?: unknown };
                debugLog('TauriLocal', `>>> Updating state in _extensions Map: ${extObj.state} -> 3`);
                try {
                  extObj.state = 3; // ExtensionState.Uninstalled
                  extObj.local = undefined;
                } catch (e) {
                  debugLog('TauriLocal', `>>> Could not update _extensions Map (readonly): ${e}`);
                }
              }
            }

            // REMOVE extension from arrays (not just update state)
            // VS Code UI filters by presence in array, not just state property
            const removeFromArray = (arr: Array<{ identifier?: { id: string } }> | undefined) => {
              if (!arr) return false;
              const idx = arr.findIndex(ext => ext.identifier?.id.toLowerCase() === extId.toLowerCase());
              if (idx !== -1) {
                debugLog('TauriLocal', `>>> REMOVING ${extId} from array at index ${idx}`);
                try {
                  arr.splice(idx, 1);
                  return true;
                } catch (e) {
                  debugLog('TauriLocal', `>>> Could not remove from array (readonly): ${e}`);
                  // Fall back to setting state
                  try {
                    const ext = arr[idx] as { state?: number; local?: unknown };
                    ext.state = 3;
                    ext.local = undefined;
                  } catch (e2) {
                    debugLog('TauriLocal', `>>> Could not update state either: ${e2}`);
                  }
                }
              }
              return false;
            };

            const installed_exts = extWorkbenchService.installed as Array<{ identifier?: { id: string }; state?: number; local?: unknown }> | undefined;
            const local_exts = extWorkbenchService.local as Array<{ identifier?: { id: string }; state?: number; local?: unknown }> | undefined;
            const extensions = extWorkbenchService.extensions as Array<{ identifier?: { id: string }; state?: number; local?: unknown }> | undefined;

            const removedFromInstalled = removeFromArray(installed_exts);
            const removedFromLocal = removeFromArray(local_exts);
            const removedFromExtensions = removeFromArray(extensions);
            debugLog('TauriLocal', `>>> Removed from: installed=${removedFromInstalled}, local=${removedFromLocal}, extensions=${removedFromExtensions}`);

            // CRITICAL: Call queryLocal FIRST and AWAIT it to refresh data before firing events
            // This ensures the UI gets fresh data when it refreshes
            const queryLocal = extWorkbenchService.queryLocal as (() => Promise<unknown>) | undefined;
            if (queryLocal) {
              debugLog('TauriLocal', '>>> Calling queryLocal FIRST to refresh before UI update');
              try {
                await queryLocal.call(extWorkbenchService);
                debugLog('TauriLocal', '>>> queryLocal completed');
              } catch (err) {
                debugLog('TauriLocal', 'queryLocal failed:', err);
              }
            }

            // Also try resetExtensionsState if available - do this before firing events
            const resetState = extWorkbenchService.resetExtensionsState as (() => void) | undefined;
            if (resetState) {
              debugLog('TauriLocal', '>>> Calling resetExtensionsState after uninstall');
              try {
                resetState.call(extWorkbenchService);
              } catch (err) {
                debugLog('TauriLocal', 'resetExtensionsState failed:', err);
              }
            }

            // NOW fire events to trigger UI refresh with fresh data
            const onChange = extWorkbenchService._onChange as { fire?: () => void } | undefined;
            if (onChange?.fire) {
              debugLog('TauriLocal', '>>> Firing _onChange on ExtensionsWorkbenchService (uninstall)');
              onChange.fire();
            }

            // Fire _onDidUninstallExtension on the workbench service
            const extWorkbenchOnDidUninstall = extWorkbenchService._onDidUninstallExtension as { fire?: (e: unknown) => void } | undefined;
            if (extWorkbenchOnDidUninstall?.fire) {
              debugLog('TauriLocal', '>>> Firing _onDidUninstallExtension on ExtensionsWorkbenchService');
              extWorkbenchOnDidUninstall.fire(event);
            }

            // Also try onDidChangeExtension
            const onDidChangeExt = extWorkbenchService._onDidChangeExtension as { fire?: (e: unknown) => void } | undefined;
            if (onDidChangeExt?.fire) {
              debugLog('TauriLocal', '>>> Firing _onDidChangeExtension on ExtensionsWorkbenchService (uninstall)');
              onDidChangeExt.fire({ identifier: { id: extId } });
            }

            // Fire _onChange one more time after all events to ensure UI is updated
            if (onChange?.fire) {
              debugLog('TauriLocal', '>>> Firing _onChange AGAIN after all events');
              onChange.fire();
            }
          }

          fireDidUninstall(event);
        });
      }
    }

    debugLog('TauriLocal', 'Tauri local server registered successfully');

    // CRITICAL: Update the CONTEXT_HAS_LOCAL_SERVER context key to enable the INSTALLED view
    // This context key is used by VS Code to decide whether to show the local/installed extensions view
    // By default it's set during ExtensionsViewletViewsContribution initialization, but since we
    // register the local server AFTER initialization, we need to manually update the context key
    try {
      const { IContextKeyService } = await import(
        '@codingame/monaco-vscode-api/vscode/vs/platform/contextkey/common/contextkey.service'
      );
      const contextKeyService = services.get(IContextKeyService) as {
        createKey?: <T>(key: string, defaultValue: T) => { set: (value: T) => void; get: () => T };
        getContextKeyValue?: <T>(key: string) => T | undefined;
      } | null;

      if (contextKeyService) {
        debugLog('TauriLocal', 'Setting hasLocalServer context key to true...');
        // Create or get the context key and set it to true
        const hasLocalServerKey = contextKeyService.createKey?.('hasLocalServer', false);
        if (hasLocalServerKey) {
          hasLocalServerKey.set(true);
          debugLog('TauriLocal', '*** CONTEXT_HAS_LOCAL_SERVER set to TRUE ***');
        } else {
          debugLog('TauriLocal', 'WARNING: Could not create hasLocalServer context key');
        }
      } else {
        debugLog('TauriLocal', 'WARNING: Context key service not available');
      }
    } catch (contextErr) {
      debugLog('TauriLocal', 'Failed to update context key:', contextErr);
    }

    // CRITICAL: Manually register the INSTALLED view since ExtensionsViewletViewsContribution
    // already ran before we set up the local server
    try {
      const { IViewDescriptorService } = await import(
        '@codingame/monaco-vscode-api/vscode/vs/workbench/common/views.service'
      );
      const { Registry } = await import(
        '@codingame/monaco-vscode-api/vscode/vs/platform/registry/common/platform'
      );
      const { Extensions } = await import(
        '@codingame/monaco-vscode-api/vscode/vs/workbench/common/views'
      );
      const { SyncDescriptor } = await import(
        '@codingame/monaco-vscode-api/vscode/vs/platform/instantiation/common/descriptors'
      );
      const { ContextKeyExpr } = await import(
        '@codingame/monaco-vscode-api/vscode/vs/platform/contextkey/common/contextkey'
      );

      // Import DefaultViewsContext from extensions common module
      let DefaultViewsContext: unknown;
      try {
        const extensionsCommon = await import(
          '@codingame/monaco-vscode-api/vscode/vs/workbench/contrib/extensions/common/extensions'
        );
        DefaultViewsContext = (extensionsCommon as Record<string, unknown>).DefaultViewsContext;
        debugLog('TauriLocal', 'DefaultViewsContext imported:', !!DefaultViewsContext);
      } catch (importErr) {
        debugLog('TauriLocal', 'Could not import DefaultViewsContext, using fallback:', importErr);
      }

      // Try to import ServerInstalledExtensionsView - this is the view class for installed extensions
      let ServerInstalledExtensionsView: unknown;
      try {
        const extensionsViews = await import(
          '@codingame/monaco-vscode-api/vscode/vs/workbench/contrib/extensions/browser/extensionsViews'
        );
        ServerInstalledExtensionsView = (extensionsViews as Record<string, unknown>).ServerInstalledExtensionsView;
        debugLog('TauriLocal', 'ServerInstalledExtensionsView imported:', !!ServerInstalledExtensionsView);
      } catch (importErr) {
        debugLog('TauriLocal', 'Could not import ServerInstalledExtensionsView:', importErr);
      }

      const viewDescriptorService = services.get(IViewDescriptorService) as {
        getViewContainerById?: (id: string) => unknown;
      } | null;

      if (viewDescriptorService && ServerInstalledExtensionsView) {
        const VIEWLET_ID = 'workbench.view.extensions';
        const container = viewDescriptorService.getViewContainerById?.(VIEWLET_ID);

        if (container) {
          const viewRegistry = Registry.as(Extensions.ViewsRegistry) as {
            registerViews?: (views: unknown[], container: unknown) => void;
            getViews?: (container: unknown) => unknown[];
          };

          // Check if INSTALLED view already exists
          const existingViews = viewRegistry.getViews?.(container) || [];
          const installedViewExists = (existingViews as Array<{ id?: string }>).some(
            v => v.id === 'workbench.views.extensions.installed'
          );

          debugLog('TauriLocal', `Existing views: ${(existingViews as Array<{ id?: string }>).map(v => v.id).join(', ')}`);

          if (!installedViewExists) {
            debugLog('TauriLocal', 'Registering INSTALLED view manually...');

            // Use DefaultViewsContext if available, otherwise use the context key name directly
            // The context key is 'defaultExtensionViews' (not 'defaultExtensionsViewsContext')
            const whenCondition = DefaultViewsContext
              ? ContextKeyExpr.and(DefaultViewsContext as ReturnType<typeof ContextKeyExpr.has>)
              : ContextKeyExpr.has('defaultExtensionViews');

            // Create the view descriptor matching VS Code's exact structure
            const viewDescriptor = {
              id: 'workbench.views.extensions.installed',
              get name() {
                return { value: 'Installed', original: 'Installed' };
              },
              weight: 100,
              order: 1,
              when: whenCondition,
              ctorDescriptor: new (SyncDescriptor as new (ctor: unknown, args: unknown[]) => unknown)(
                ServerInstalledExtensionsView,
                [{ server: tauriLocalServer, flexibleHeight: true }]
              ),
              canToggleVisibility: true
            };

            viewRegistry.registerViews?.([viewDescriptor], container);
            debugLog('TauriLocal', '*** INSTALLED view registered manually ***');

            // Verify registration
            const updatedViews = viewRegistry.getViews?.(container) || [];
            const nowExists = (updatedViews as Array<{ id?: string }>).some(
              v => v.id === 'workbench.views.extensions.installed'
            );
            debugLog('TauriLocal', `After registration, view exists: ${nowExists}`);
          } else {
            debugLog('TauriLocal', 'INSTALLED view already exists');
          }
        } else {
          debugLog('TauriLocal', 'Could not get extensions view container');
        }
      } else {
        debugLog('TauriLocal', 'ViewDescriptorService or ServerInstalledExtensionsView not available');
      }
    } catch (viewsErr) {
      debugLog('TauriLocal', 'Failed to register INSTALLED view:', viewsErr);
    }


  } catch (err) {
    debugLog('TauriLocal', 'Failed to register:', err);
  }
}

/**
 * CRITICAL: Patch the Extension Enablement Service
 * This prevents extensions from being disabled with "not supported in web" error
 */
async function patchExtensionEnablementService(services: { get: <T>(id: unknown) => T }): Promise<void> {
  debugLog('Enablement', 'Patching IWorkbenchExtensionEnablementService...');

  try {
    const enablementService = services.get(IWorkbenchExtensionEnablementService) as Record<string, unknown> | null;

    if (!enablementService) {
      debugLog('Enablement', 'WARNING: Enablement service not found');
      return;
    }

    // Log available methods
    const methods = Object.keys(enablementService).filter(k => typeof enablementService[k] === 'function');
    debugLog('Enablement', 'Available methods:', methods.slice(0, 30).join(', '));

    // Also log prototype methods
    const proto = Object.getPrototypeOf(enablementService);
    const protoMethods = Object.getOwnPropertyNames(proto).filter(k => {
      try { return typeof proto[k] === 'function'; }
      catch { return false; }
    });
    debugLog('Enablement', 'Prototype methods:', protoMethods.slice(0, 30).join(', '));

    // Patch canChangeEnablement - should always return true
    const originalCanChangeEnablement = (enablementService.canChangeEnablement as (ext: unknown) => boolean).bind(enablementService);
    if (originalCanChangeEnablement) {
      enablementService.canChangeEnablement = (extension: unknown): boolean => {
        const extId = getExtensionId(extension);
        debugLog('Enablement.canChangeEnablement', `>>> CALLED for: ${extId}`);
        debugLog('Enablement.canChangeEnablement', `>>> FORCING TRUE`);
        return true;
      };
      debugLog('Enablement', '*** canChangeEnablement PATCHED ***');
    }

    // Patch canChangeWorkspaceEnablement - should always return true
    const originalCanChangeWorkspace = (enablementService.canChangeWorkspaceEnablement as (ext: unknown) => boolean).bind(enablementService);
    if (originalCanChangeWorkspace) {
      enablementService.canChangeWorkspaceEnablement = (extension: unknown): boolean => {
        const extId = getExtensionId(extension);
        debugLog('Enablement.canChangeWorkspace', `>>> CALLED for: ${extId}`);
        return true;
      };
      debugLog('Enablement', '*** canChangeWorkspaceEnablement PATCHED ***');
    }

    // Patch isEnabled - check if Tauri has the extension installed
    const originalIsEnabled = (enablementService.isEnabled as (ext: unknown) => boolean).bind(enablementService);
    if (originalIsEnabled) {
      enablementService.isEnabled = (extension: unknown): boolean => {
        const extId = getExtensionId(extension);

        // Check if it's a Tauri-installed extension - always enabled
        if (extId && isExtensionInstalled(extId)) {
          debugLog('Enablement.isEnabled', `>>> ${extId} is Tauri-installed, returning TRUE`);
          return true;
        }

        // Fall back to original for other extensions
        const result = originalIsEnabled(extension);
        debugLog('Enablement.isEnabled', `>>> ${extId}: ${result}`);
        return result;
      };
      debugLog('Enablement', '*** isEnabled PATCHED ***');
    }

    // Patch isDisabledByExtensionKind - this is likely what's causing "not supported in web"
    const originalIsDisabledByKind = (proto.isDisabledByExtensionKind as (ext: unknown) => boolean).bind(enablementService);
    if (originalIsDisabledByKind) {
      proto.isDisabledByExtensionKind = function(this: unknown, extension: unknown): boolean {
        const extId = getExtensionId(extension);
        debugLog('Enablement.isDisabledByKind', `>>> CALLED for: ${extId}`);

        // If it's a Tauri-installed extension, it's NOT disabled by kind
        if (extId && isExtensionInstalled(extId)) {
          debugLog('Enablement.isDisabledByKind', `>>> ${extId} is Tauri-installed, returning FALSE`);
          return false;
        }

        // For other extensions, force false as well - we handle all extensions via Tauri
        debugLog('Enablement.isDisabledByKind', `>>> FORCING FALSE for ${extId}`);
        return false;
      };
      debugLog('Enablement', '*** isDisabledByExtensionKind PATCHED on prototype ***');
    } else {
      debugLog('Enablement', 'WARNING: isDisabledByExtensionKind not found on prototype');
    }

    // Patch isDisabledByVirtualWorkspace
    const originalIsDisabledByVirtual = (proto.isDisabledByVirtualWorkspace as (ext: unknown) => boolean).bind(enablementService);
    if (originalIsDisabledByVirtual) {
      proto.isDisabledByVirtualWorkspace = function(this: unknown, extension: unknown): boolean {
        const extId = getExtensionId(extension);
        debugLog('Enablement.isDisabledByVirtual', `>>> CALLED for: ${extId}`);
        return false; // Never disabled by virtual workspace
      };
      debugLog('Enablement', '*** isDisabledByVirtualWorkspace PATCHED ***');
    }

    // Patch isDisabledByTrustRequirement
    const originalIsDisabledByTrust = (proto.isDisabledByTrustRequirement as (ext: unknown) => boolean).bind(enablementService);
    if (originalIsDisabledByTrust) {
      proto.isDisabledByTrustRequirement = function(this: unknown, extension: unknown): boolean {
        const extId = getExtensionId(extension);
        debugLog('Enablement.isDisabledByTrust', `>>> CALLED for: ${extId}`);
        return false; // Never disabled by trust
      };
      debugLog('Enablement', '*** isDisabledByTrustRequirement PATCHED ***');
    }

    // Patch getEnablementState to return EnabledGlobally for Tauri extensions
    const originalGetEnablementState = (enablementService.getEnablementState as (ext: unknown) => number).bind(enablementService);
    if (originalGetEnablementState) {
      enablementService.getEnablementState = (extension: unknown): number => {
        const extId = getExtensionId(extension);

        // For Tauri-installed extensions, always return EnabledGlobally (12)
        // NOTE: EnablementState values: 0-11 are disabled states, 12=EnabledGlobally, 13=EnabledWorkspace
        if (extId && isExtensionInstalled(extId)) {
          debugLog('Enablement.getEnablementState', `>>> ${extId} is Tauri-installed, returning EnabledGlobally (12)`);
          return 12; // EnablementState.EnabledGlobally (NOT 8 which is DisabledByExtensionDependency!)
        }

        // For extensions NOT in Tauri (not installed), we should NOT return EnabledGlobally
        // This is the key fix: if an extension was uninstalled, isExtensionInstalled returns false
        // In that case, we should NOT return a enabled state from the original function
        // because VS Code's original might still cache an enabled state
        if (extId) {
          // The extension is NOT installed (checked above), so it should show as disabled/uninstalled
          // Check if VS Code has this extension with a local property - if so, it thinks it's installed
          // but we know it's not (Tauri is the source of truth)
          const extObj = extension as { local?: unknown; state?: number };

          // If the extension has local info but is NOT in Tauri, it's stale - treat as uninstalled
          if (extObj.local !== undefined) {
            debugLog('Enablement.getEnablementState', `>>> ${extId} has local info but NOT in Tauri, returning DisabledByExtensionKind (1)`);
            return 1; // DisabledByExtensionKind - effectively makes it show as not installed
          }

          // Also check if the state property says Uninstalled
          if (extObj.state === 3) { // ExtensionState.Uninstalled
            debugLog('Enablement.getEnablementState', `>>> ${extId} is Uninstalled (state=3), returning DisabledByExtensionKind (1)`);
            return 1;
          }
        }

        const result = originalGetEnablementState(extension);
        debugLog('Enablement.getEnablementState', `>>> ${extId}: ${result}`);
        return result;
      };
      debugLog('Enablement', '*** getEnablementState PATCHED ***');
    }

    // Try to patch setEnablement to always succeed for Tauri extensions
    const originalSetEnablement = (enablementService.setEnablement as (exts: unknown[], state: number) => Promise<boolean[]>).bind(enablementService);
    if (originalSetEnablement) {
      enablementService.setEnablement = async (extensions: unknown[], state: number): Promise<boolean[]> => {
        debugLog('Enablement.setEnablement', `>>> CALLED with state: ${state}`);
        const results: boolean[] = [];

        for (const ext of extensions) {
          const extId = getExtensionId(ext);
          if (extId && isExtensionInstalled(extId)) {
            debugLog('Enablement.setEnablement', `>>> ${extId} is Tauri-installed, returning true`);
            results.push(true);
          } else {
            // Try original
            try {
              const [result] = await originalSetEnablement([ext], state);
              results.push(result);
            } catch {
              results.push(true); // Assume success
            }
          }
        }

        return results;
      };
      debugLog('Enablement', '*** setEnablement PATCHED ***');
    }

    debugLog('Enablement', 'Extension Enablement Service patched successfully');

  } catch (err) {
    debugLog('Enablement', 'Failed to patch:', err);
  }
}

/**
 * CRITICAL: Patch the Environment Service to make VS Code believe it's native
 *
 * VS Code uses IWorkbenchEnvironmentService to check isWeb, isNative, etc.
 * By overriding these properties, we can make extensions think they're running
 * in a native (Electron-like) environment instead of a web browser.
 *
 * NOTE: The main platform detection happens in platform.js at module load time,
 * so the fake process injection in workerSetupEntry.ts is the primary method.
 * This function provides additional runtime patching as a backup.
 */
async function patchEnvironmentService(_services: { get: <T>(id: unknown) => T }): Promise<void> {
  debugLog('Environment', 'Patching environment/platform to report native environment...');

  // The primary approach is the fake process injection in workerSetupEntry.ts
  // which runs BEFORE platform.js loads and sets isNative=true.
  // This function provides additional logging and attempts to patch at runtime.

  try {
    // Try to access the platform module to see current values
    const platform = await import(
      '@codingame/monaco-vscode-api/vscode/vs/base/common/platform'
    );

    debugLog('Environment', 'Platform module current values:', {
      isWeb: platform.isWeb,
      isNative: platform.isNative,
      isElectron: platform.isElectron,
      platform: platform.platform,
    });

    // Check if our fake process injection worked
    const globalThisTyped = globalThis as { vscode?: { process?: unknown }; process?: unknown };
    debugLog('Environment', 'Fake process check:', {
      hasVscodeProcess: !!globalThisTyped.vscode?.process,
      hasGlobalProcess: !!globalThisTyped.process,
    });

    // If isWeb is still true, our injection may have happened too late
    if (platform.isWeb) {
      debugLog('Environment', 'WARNING: isWeb is still true - fake process injection may have been too late');
      debugLog('Environment', 'Extensions requiring native environment may not work');

      // Try to override the module exports (usually won't work but worth trying)
      const platformModule = platform as Record<string, unknown>;
      try {
        Object.defineProperty(platformModule, 'isWeb', { value: false, writable: true, configurable: true });
        Object.defineProperty(platformModule, 'isNative', { value: true, writable: true, configurable: true });
        debugLog('Environment', 'Attempted to override platform module exports');
        debugLog('Environment', 'After override:', { isWeb: platform.isWeb, isNative: platform.isNative });
      } catch (err) {
        debugLog('Environment', 'Could not override platform exports (expected for ES modules):', err);
      }
    } else {
      debugLog('Environment', 'SUCCESS: isWeb is false - fake process injection worked!');
    }

  } catch (err) {
    debugLog('Environment', 'Failed to check platform:', err);
  }
}

/**
 * Additional patch: Try to patch the ExtensionKind checker
 * This is used to determine if an extension can run in web/native environments
 */
async function patchExtensionKind(services: { get: <T>(id: unknown) => T }): Promise<void> {
  debugLog('ExtKind', 'Attempting to patch extension kind checks...');

  try {
    // The ExtensionKind determines where an extension can run:
    // - UI: runs in the UI host (browser/Electron main)
    // - Workspace: runs in the workspace host (remote server/Node.js sidecar)
    // - Web: runs in web worker

    // Try to find and patch the service that checks extension kinds
    const { IExtensionManagementServerService } = await import(
      '@codingame/monaco-vscode-api/vscode/vs/workbench/services/extensionManagement/common/extensionManagement.service'
    );

    const serverService = services.get(IExtensionManagementServerService) as Record<string, unknown> | null;

    if (!serverService) {
      debugLog('ExtKind', 'Server service not found');
      return;
    }

    // Look for methods related to extension kind checking
    const allKeys = Object.keys(serverService);
    const kindRelated = allKeys.filter(k =>
      k.toLowerCase().includes('kind') ||
      k.toLowerCase().includes('support') ||
      k.toLowerCase().includes('capable')
    );
    debugLog('ExtKind', 'Kind-related properties:', kindRelated.join(', '));

    // Also check prototype
    const proto = Object.getPrototypeOf(serverService);
    if (proto) {
      const protoMethods = Object.getOwnPropertyNames(proto).filter(k => {
        try { return typeof proto[k] === 'function'; }
        catch { return false; }
      });
      const kindMethods = protoMethods.filter(k =>
        k.toLowerCase().includes('kind') ||
        k.toLowerCase().includes('support') ||
        k.toLowerCase().includes('capable') ||
        k.toLowerCase().includes('preference')
      );
      debugLog('ExtKind', 'Kind-related prototype methods:', kindMethods.join(', '));

      // Try to patch getExtensionKind if it exists
      if (typeof proto.getExtensionKind === 'function') {
        const original = proto.getExtensionKind;
        proto.getExtensionKind = function(this: unknown, extension: unknown): unknown {
          const extId = getExtensionId(extension);
          debugLog('ExtKind.getExtensionKind', `>>> CALLED for: ${extId}`);

          // Get original result
          const kinds = original.call(this, extension);
          debugLog('ExtKind.getExtensionKind', `>>> Original result:`, kinds);

          // If extension is Tauri-installed, ensure it has Workspace kind
          // This allows Node.js extensions to run
          if (extId && isExtensionInstalled(extId)) {
            debugLog('ExtKind.getExtensionKind', `>>> Tauri extension, ensuring Workspace kind`);
            // ExtensionKind values: UI=1, Workspace=2, Web=3
            return [2, 1]; // Prefer Workspace, fallback to UI
          }

          return kinds;
        };
        debugLog('ExtKind', '*** getExtensionKind PATCHED ***');
      }

      // Patch getPreferredExtensionKindServer if it exists
      if (typeof proto.getPreferredExtensionKindServer === 'function') {
        const original = proto.getPreferredExtensionKindServer;
        proto.getPreferredExtensionKindServer = function(this: unknown, manifest: unknown): unknown {
          debugLog('ExtKind.getPreferredServer', '>>> CALLED');

          // Return local server for Tauri-installed extensions
          const localServer = serverService.localExtensionManagementServer;
          if (localServer) {
            debugLog('ExtKind.getPreferredServer', '>>> Returning local (Tauri) server');
            return localServer;
          }

          return original.call(this, manifest);
        };
        debugLog('ExtKind', '*** getPreferredExtensionKindServer PATCHED ***');
      }
    }

    debugLog('ExtKind', 'Extension kind patching complete');

  } catch (err) {
    debugLog('ExtKind', 'Failed to patch:', err);
  }
}

// Note: The INSTALLED view is enabled by:
// 1. registerTauriAsLocalServer() - Sets localExtensionManagementServer on the server service
// 2. Setting CONTEXT_HAS_LOCAL_SERVER context key to true after registration
// 3. The context key triggers VS Code's conditional views to show the INSTALLED section
// This approach works even though the local server is registered AFTER initialization,
// because we manually update the context key that controls view visibility.

