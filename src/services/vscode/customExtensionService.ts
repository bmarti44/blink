/**
 * Custom Extension Management Service
 *
 * Overrides the default VS Code extension management to:
 * 1. Enable installation for all extensions (including Node.js ones)
 * 2. Download VSIX files and save to Tauri directory
 * 3. Activate Node.js extensions via our sidecar
 */

import { SyncDescriptor } from '@codingame/monaco-vscode-api/vscode/vs/platform/instantiation/common/descriptors';
import { IWorkbenchExtensionManagementService } from '@codingame/monaco-vscode-api/vscode/vs/workbench/services/extensionManagement/common/extensionManagement.service';
import { IExtensionGalleryService } from '@codingame/monaco-vscode-api/vscode/vs/platform/extensionManagement/common/extensionManagement.service';
import { initializeExtensionManager } from '../extensions/extensionManager';
import { extensionHostService } from './extensionHostService';
import { invoke } from '@tauri-apps/api/core';

// Track installed extensions to activate Node.js ones
const pendingNodeActivations = new Map<string, { path: string; id: string }>();

/**
 * Hook into the workbench to listen for extension events and handle downloads
 * This should be called after workbench initialization
 */
export async function setupExtensionInstallationBridge(): Promise<void> {
  console.log('[CustomExtensionService] Setting up extension installation bridge...');

  try {
    // Initialize our extension manager
    await initializeExtensionManager();

    // Try to access VS Code's extension service via the service accessor
    const { StandaloneServices } = await import('@codingame/monaco-vscode-api/services');

    // Get the extension management service
    const extensionService = StandaloneServices.get(IWorkbenchExtensionManagementService);
    const galleryService = StandaloneServices.get(IExtensionGalleryService);

    if (extensionService && galleryService) {
      console.log('[CustomExtensionService] Found extension services');

      // Listen for extension installation events
      extensionService.onDidInstallExtensions(async (results) => {
        for (const result of results) {
          if (result.error) {
            console.log('[CustomExtensionService] Installation error:', result.error);
            continue;
          }

          const extension = result.local;
          if (!extension) {
            continue;
          }

          console.log('[CustomExtensionService] Extension installed:', extension.identifier.id);

          // Check if this is a Node.js extension
          const manifest = extension.manifest;
          if (manifest.main && !manifest.browser) {
            console.log('[CustomExtensionService] Node.js extension detected:', extension.identifier.id);

            // Get the extension path and install to our Tauri directory
            await handleNodeExtensionInstall(extension, galleryService);
          }
        }
      });

      console.log('[CustomExtensionService] Extension event listeners set up');
    } else {
      console.warn('[CustomExtensionService] Extension services not available');
    }
  } catch (err) {
    console.error('[CustomExtensionService] Failed to setup extension bridge:', err);
  }
}

/**
 * Handle Node.js extension installation
 * Downloads the VSIX and installs to Tauri directory, then activates in sidecar
 */
async function handleNodeExtensionInstall(
  extension: {
    identifier: { id: string };
    location: { fsPath?: string; path?: string; scheme?: string };
    manifest: { main?: string; browser?: string; displayName?: string; name?: string; version?: string; publisher?: string };
  },
  galleryService: unknown
): Promise<void> {
  try {
    const extensionId = extension.identifier.id;
    let extensionPath = extension.location.fsPath || extension.location.path || '';

    console.log('[CustomExtensionService] Processing Node.js extension:', extensionId);
    console.log('[CustomExtensionService] Extension location:', extension.location);

    // If the extension is stored in IndexedDB (vscode-userdata scheme), we need to
    // download the VSIX and extract it to the filesystem for the sidecar
    if (extension.location.scheme === 'vscode-userdata' || !extensionPath.startsWith('/')) {
      console.log('[CustomExtensionService] Extension is in virtual storage, downloading VSIX...');

      // Try to download the VSIX from the gallery
      const downloaded = await downloadExtensionVSIX(extensionId, extension.manifest, galleryService);
      if (downloaded) {
        extensionPath = downloaded;
        console.log('[CustomExtensionService] Extension installed to:', extensionPath);
      } else {
        console.warn('[CustomExtensionService] Could not download extension VSIX');
        return;
      }
    }

    if (!extensionPath) {
      console.warn('[CustomExtensionService] No extension path available for:', extensionId);
      return;
    }

    // Store for sidecar activation
    pendingNodeActivations.set(extensionId, {
      path: extensionPath,
      id: extensionId
    });

    // Try to activate in sidecar immediately
    const ready = await extensionHostService.checkReady();
    if (ready) {
      await activateExtensionInSidecar(extensionId, extensionPath);
    } else {
      console.log('[CustomExtensionService] Sidecar not ready, extension queued:', extensionId);
    }
  } catch (err) {
    console.error('[CustomExtensionService] Failed to handle Node.js extension:', err);
  }
}

/**
 * Download extension VSIX from Open VSX and install to Tauri directory
 */
async function downloadExtensionVSIX(
  extensionId: string,
  manifest: { name?: string; version?: string; publisher?: string },
  _galleryService: unknown
): Promise<string | null> {
  try {
    const [publisher, name] = extensionId.split('.');
    const version = manifest.version || 'latest';

    // Construct Open VSX download URL
    const downloadUrl = `https://open-vsx.org/api/${publisher}/${name}/${version}/file/${publisher}.${name}-${version}.vsix`;

    console.log('[CustomExtensionService] Downloading from:', downloadUrl);

    // Fetch the VSIX
    const response = await fetch(downloadUrl);
    if (!response.ok) {
      // Try alternative URL format
      const altUrl = `https://open-vsx.org/api/${publisher}/${name}/file/${publisher}.${name}-${version}.vsix`;
      const altResponse = await fetch(altUrl);
      if (!altResponse.ok) {
        console.error('[CustomExtensionService] Download failed:', response.status);
        return null;
      }
    }

    const vsixData = new Uint8Array(await response.arrayBuffer());
    console.log('[CustomExtensionService] Downloaded VSIX:', vsixData.length, 'bytes');

    // Install via Tauri
    const result = await invoke<{
      extensionId: string;
      extensionPath: string;
    }>('install_extension_from_data', {
      data: Array.from(vsixData),
      filename: `${extensionId}.vsix`
    });

    console.log('[CustomExtensionService] Installed to Tauri directory:', result.extensionPath);
    return result.extensionPath;
  } catch (err) {
    console.error('[CustomExtensionService] Failed to download VSIX:', err);
    return null;
  }
}

/**
 * Activate an extension in the sidecar
 */
async function activateExtensionInSidecar(extensionId: string, extensionPath: string): Promise<void> {
  try {
    console.log('[CustomExtensionService] Activating in sidecar:', extensionId);
    await extensionHostService.activateExtension(extensionPath, extensionId);
    console.log('[CustomExtensionService] Successfully activated:', extensionId);
    pendingNodeActivations.delete(extensionId);
  } catch (err) {
    console.error('[CustomExtensionService] Failed to activate:', extensionId, err);
  }
}

/**
 * Activate any pending Node.js extensions
 * Call this when the sidecar becomes ready
 */
export async function activatePendingExtensions(): Promise<void> {
  if (pendingNodeActivations.size === 0) {
    return;
  }

  console.log('[CustomExtensionService] Activating pending extensions:', pendingNodeActivations.size);

  for (const [extensionId, activation] of pendingNodeActivations) {
    await activateExtensionInSidecar(extensionId, activation.path);
  }
}

/**
 * Get custom service overrides that modify extension installation behavior
 *
 * This creates services that:
 * 1. Override canInstall to always return true
 * 2. Allow all extensions to be installed regardless of platform
 */
export function getCustomExtensionServiceOverrides(): Record<string, SyncDescriptor<unknown>> {
  // We'll use runtime patching instead of service overrides
  // because the extension service hierarchy is complex
  return {};
}

/**
 * Patch the extension management to allow all installations
 * Call this after services are initialized
 */
export async function patchExtensionInstallation(): Promise<void> {
  try {
    const { StandaloneServices } = await import('@codingame/monaco-vscode-api/services');
    const extensionService = StandaloneServices.get(IWorkbenchExtensionManagementService) as {
      canInstall?: (extension: unknown) => Promise<boolean | { value: string }>;
    };

    if (extensionService && typeof extensionService.canInstall === 'function') {
      const originalCanInstall = extensionService.canInstall.bind(extensionService);

      // Override canInstall to always return true
      (extensionService as Record<string, unknown>).canInstall = async (extension: unknown) => {
        console.log('[CustomExtensionService] canInstall called for:', extension);

        // First try the original - if it works, use it
        try {
          const result = await originalCanInstall(extension);
          if (result === true) {
            return true;
          }
          // If it returns an error message, we'll override to true
          // This allows Node.js extensions to be installed
          console.log('[CustomExtensionService] Overriding canInstall to allow installation');
          return true;
        } catch {
          return true;
        }
      };

      console.log('[CustomExtensionService] Patched canInstall to allow all extensions');
    }
  } catch (err) {
    console.error('[CustomExtensionService] Failed to patch extension installation:', err);
  }
}
