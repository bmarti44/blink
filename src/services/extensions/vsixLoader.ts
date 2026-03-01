/**
 * VSIX Loader
 *
 * Handles loading and parsing of .vsix extension packages.
 * VSIX files are ZIP archives containing:
 * - extension/package.json (manifest)
 * - extension/* (extension files)
 * - [Content_Types].xml
 * - extension.vsixmanifest
 */

import { invoke } from '@tauri-apps/api/core';
import type { ExtensionManifest, ExtensionInfo, ExtensionType } from './types';

/**
 * Result from installing a VSIX file
 */
export interface VsixInstallResult {
  success: boolean;
  extensionId?: string;
  extensionPath?: string;
  manifest?: ExtensionManifest;
  error?: string;
}

/**
 * Install a VSIX file from a local path
 * This invokes a Tauri command to extract the VSIX (ZIP) file
 */
export async function installVsixFromPath(vsixPath: string): Promise<VsixInstallResult> {
  try {
    // Call Tauri backend to extract the VSIX file
    const result = await invoke<{
      extensionId: string;
      extensionPath: string;
      manifest: ExtensionManifest;
    }>('install_extension', { vsixPath });

    return {
      success: true,
      extensionId: result.extensionId,
      extensionPath: result.extensionPath,
      manifest: result.manifest,
    };
  } catch (err) {
    console.error('[VsixLoader] Failed to install VSIX:', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Install a VSIX file from binary data (e.g., downloaded from Open VSX)
 */
export async function installVsixFromData(
  data: Uint8Array,
  filename: string
): Promise<VsixInstallResult> {
  try {
    // Call Tauri backend to extract the VSIX data
    const result = await invoke<{
      extensionId: string;
      extensionPath: string;
      manifest: ExtensionManifest;
    }>('install_extension_from_data', {
      data: Array.from(data),
      filename,
    });

    return {
      success: true,
      extensionId: result.extensionId,
      extensionPath: result.extensionPath,
      manifest: result.manifest,
    };
  } catch (err) {
    console.error('[VsixLoader] Failed to install VSIX from data:', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Determine the extension type from its manifest
 */
export function getExtensionType(manifest: ExtensionManifest): ExtensionType {
  const contributes = manifest.contributes;

  if (!contributes) {
    return 'other';
  }

  // Check for themes
  if (contributes.themes && contributes.themes.length > 0) {
    return 'theme';
  }

  // Check for icon themes
  if (contributes.iconThemes && contributes.iconThemes.length > 0) {
    return 'iconTheme';
  }

  // Check for language support (grammars)
  if (contributes.grammars && contributes.grammars.length > 0) {
    return 'language';
  }

  // Check for snippets
  if (contributes.snippets && contributes.snippets.length > 0) {
    return 'snippet';
  }

  // Check for language server (look for activationEvents with onLanguage)
  if (manifest.activationEvents) {
    const hasLanguageActivation = manifest.activationEvents.some(
      (event) => event.startsWith('onLanguage:')
    );
    if (hasLanguageActivation && manifest.main) {
      return 'lsp';
    }
  }

  return 'other';
}

/**
 * Create ExtensionInfo from a manifest and path
 */
export function createExtensionInfo(
  manifest: ExtensionManifest,
  extensionPath: string,
  enabled: boolean = true
): ExtensionInfo {
  const extensionId = `${manifest.publisher}.${manifest.name}`;

  return {
    id: extensionId,
    name: manifest.name,
    displayName: manifest.displayName || manifest.name,
    publisher: manifest.publisher,
    version: manifest.version,
    description: manifest.description || '',
    type: getExtensionType(manifest),
    extensionPath,
    enabled,
    manifest,
    installedAt: Date.now(),
  };
}

/**
 * Validate an extension manifest
 */
export function validateManifest(manifest: unknown): manifest is ExtensionManifest {
  if (!manifest || typeof manifest !== 'object') {
    return false;
  }

  const m = manifest as Record<string, unknown>;

  // Required fields
  if (typeof m.name !== 'string' || !m.name) {
    return false;
  }
  if (typeof m.version !== 'string' || !m.version) {
    return false;
  }
  if (typeof m.publisher !== 'string' || !m.publisher) {
    return false;
  }

  return true;
}

/**
 * Get the extension ID from a manifest
 */
export function getExtensionId(manifest: ExtensionManifest): string {
  return `${manifest.publisher}.${manifest.name}`;
}
