import { invoke } from '@tauri-apps/api/core';
import { StandaloneServices } from '@codingame/monaco-vscode-api/services';
import { IWorkbenchExtensionEnablementService } from '@codingame/monaco-vscode-api/vscode/vs/workbench/services/extensionManagement/common/extensionManagement.service';

export async function loadBuiltinExtensions(): Promise<void> {
  try {
    type Scanned = { id: string; path: string; manifest: any; is_builtin: boolean };
    const scanned = await invoke<Scanned[]>('scan_extensions');
    const enablement = StandaloneServices.get(IWorkbenchExtensionEnablementService) as any;
    (window as any).__SCANNED_EXTENSIONS__ = scanned;
    if (!enablement?._extensions) return;
    for (const ext of scanned) {
      try {
        const id = ext.id.toLowerCase();
        if (!enablement._extensions.has(id)) {
          enablement._extensions.set(id, {
            identifier: { id },
            manifest: ext.manifest,
            location: { path: ext.path, fsPath: ext.path, scheme: 'file' },
            type: ext.is_builtin ? 0 : 1,
          });
        }
      } catch {}
    }
  } catch (e) {
    console.warn('[BuiltinExtensions] Failed to load scanned extensions', e);
  }
}
