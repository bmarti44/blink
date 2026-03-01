/**
 * Extension Storage Service
 *
 * Handles persistence of extension data using Tauri file system.
 * Extensions are stored in the app's data directory.
 */

import { appDataDir } from '@tauri-apps/api/path';
import {
  readDir,
  readTextFile,
  writeTextFile,
  mkdir,
  remove,
  exists,
} from '@tauri-apps/plugin-fs';
import type { ExtensionInfo, ExtensionManifest } from './types';

// Extension storage paths
const EXTENSIONS_DIR = 'extensions';
const INSTALLED_DIR = 'installed';
const REGISTRY_FILE = 'registry.json';

let extensionsBasePath: string | null = null;

/**
 * Get the base path for extensions storage
 */
export async function getExtensionsBasePath(): Promise<string> {
  if (extensionsBasePath) {
    return extensionsBasePath;
  }

  const appData = await appDataDir();
  extensionsBasePath = `${appData}${EXTENSIONS_DIR}`;

  // Ensure directories exist
  await ensureDirectoryExists(extensionsBasePath);
  await ensureDirectoryExists(`${extensionsBasePath}/${INSTALLED_DIR}`);

  return extensionsBasePath;
}

/**
 * Ensure a directory exists, create if it doesn't
 */
async function ensureDirectoryExists(path: string): Promise<void> {
  try {
    const dirExists = await exists(path);
    if (!dirExists) {
      await mkdir(path, { recursive: true });
    }
  } catch (err) {
    console.error(`[ExtensionStorage] Failed to create directory ${path}:`, err);
    throw err;
  }
}

/**
 * Get the path to a specific extension's directory
 */
export async function getExtensionPath(extensionId: string): Promise<string> {
  const basePath = await getExtensionsBasePath();
  return `${basePath}/${INSTALLED_DIR}/${extensionId}`;
}

/**
 * Load the extension registry from disk
 */
export async function loadRegistry(): Promise<ExtensionInfo[]> {
  try {
    const basePath = await getExtensionsBasePath();
    const registryPath = `${basePath}/${REGISTRY_FILE}`;

    console.log('[ExtensionStorage] Loading registry from:', registryPath);

    const registryExists = await exists(registryPath);
    if (!registryExists) {
      console.log('[ExtensionStorage] Registry file does not exist');
      return [];
    }

    const content = await readTextFile(registryPath);
    const registry = JSON.parse(content) as ExtensionInfo[];
    console.log('[ExtensionStorage] Loaded', registry.length, 'extensions from registry');
    return registry;
  } catch (err) {
    console.error('[ExtensionStorage] Failed to load registry:', err);
    return [];
  }
}

/**
 * Save the extension registry to disk
 */
export async function saveRegistry(extensions: ExtensionInfo[]): Promise<void> {
  try {
    const basePath = await getExtensionsBasePath();
    const registryPath = `${basePath}/${REGISTRY_FILE}`;

    console.log('[ExtensionStorage] Saving registry to:', registryPath);
    console.log('[ExtensionStorage] Saving', extensions.length, 'extensions');

    const content = JSON.stringify(extensions, null, 2);
    await writeTextFile(registryPath, content);

    console.log('[ExtensionStorage] Registry saved successfully');
  } catch (err) {
    console.error('[ExtensionStorage] Failed to save registry:', err);
    throw err;
  }
}

/**
 * Read an extension's manifest (package.json)
 */
export async function readExtensionManifest(extensionPath: string): Promise<ExtensionManifest> {
  const manifestPath = `${extensionPath}/package.json`;
  const content = await readTextFile(manifestPath);
  return JSON.parse(content) as ExtensionManifest;
}

/**
 * List all installed extension directories
 */
export async function listInstalledExtensionDirs(): Promise<string[]> {
  try {
    const basePath = await getExtensionsBasePath();
    const installedPath = `${basePath}/${INSTALLED_DIR}`;

    const entries = await readDir(installedPath);
    return entries
      .filter((entry) => entry.isDirectory)
      .map((entry) => entry.name);
  } catch (err) {
    console.error('[ExtensionStorage] Failed to list extensions:', err);
    return [];
  }
}

/**
 * Remove an extension's directory
 */
export async function removeExtensionDir(extensionId: string): Promise<void> {
  try {
    const extensionPath = await getExtensionPath(extensionId);
    await remove(extensionPath, { recursive: true });
  } catch (err) {
    console.error(`[ExtensionStorage] Failed to remove extension ${extensionId}:`, err);
    throw err;
  }
}

/**
 * Write a file to an extension's directory
 */
export async function writeExtensionFile(
  extensionId: string,
  relativePath: string,
  content: string
): Promise<void> {
  const extensionPath = await getExtensionPath(extensionId);
  const filePath = `${extensionPath}/${relativePath}`;

  // Ensure parent directory exists
  const parentDir = filePath.substring(0, filePath.lastIndexOf('/'));
  await ensureDirectoryExists(parentDir);

  await writeTextFile(filePath, content);
}

/**
 * Read a file from an extension's directory
 */
export async function readExtensionFile(
  extensionId: string,
  relativePath: string
): Promise<string> {
  const extensionPath = await getExtensionPath(extensionId);
  const filePath = `${extensionPath}/${relativePath}`;
  return await readTextFile(filePath);
}

/**
 * Check if an extension is installed on disk
 */
export async function isExtensionInstalled(extensionId: string): Promise<boolean> {
  try {
    const extensionPath = await getExtensionPath(extensionId);
    return await exists(extensionPath);
  } catch {
    return false;
  }
}
