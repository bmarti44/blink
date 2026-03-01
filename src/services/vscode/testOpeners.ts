import { getService } from '@codingame/monaco-vscode-api/services';
import { IEditorService } from '@codingame/monaco-vscode-api/vscode/vs/workbench/services/editor/common/editorService.service';
import { IWebviewWorkbenchService } from '@codingame/monaco-vscode-api/vscode/vs/workbench/contrib/webviewPanel/browser/webviewWorkbenchService.service';
import type { WebviewInitInfo } from '@codingame/monaco-vscode-api/vscode/vs/workbench/contrib/webview/browser/webview';
import * as monaco from 'monaco-editor';
import { invoke } from '@tauri-apps/api/core';

function html(cspSource: string, title: string) {
  const nonce = Math.random().toString(36).slice(2);
  return `<!DOCTYPE html><html><head><meta charset=\"UTF-8\"/><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; img-src ${cspSource} https: data:; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';\"/><title>${title}</title></head><body><div id=doc></div><script nonce=\"${nonce}\">const vscode=acquireVsCodeApi();window.addEventListener('message',e=>{const m=e.data||{};if(m.type==='render'){document.getElementById('doc').innerHTML=m.html||''}});vscode.postMessage({type:'ready'});</script></body></html>`;
}

export async function render(path: string): Promise<string> {
  return await invoke('render_document_html', { path });
}

export async function attachTestOpeners(): Promise<void> {
  const editorSvc: any = await getService(IEditorService as any);
  const webviewSvc: any = await getService(IWebviewWorkbenchService as any);
  (window as any).__TEST_OPEN_DEFAULT__ = async (path: string) => {
    const uri = monaco.Uri.file(path);
    (window as any).__BYPASS_DOCX_INTERCEPT__ = { path, until: Date.now() + 5000 };
    try {
      await editorSvc.openEditor({ resource: uri });
      await new Promise((r) => setTimeout(r, 1200));
    } finally {
      (window as any).__BYPASS_DOCX_INTERCEPT__ = null;
    }
    return true;
  };
  (window as any).__TEST_OPEN_DOCX__ = async (path: string) => {
    const title = `Word: ${path.split('/').pop() || path}`;
    const init: WebviewInitInfo = {
      id: 'blink-word-' + Math.random().toString(36).slice(2),
      options: { enableScripts: true },
      html: html('*', title),
      extension: undefined as any,
    } as any;
    const input = webviewSvc.openWebview(init as any, 'blink.wordEditor', title, undefined, { preserveFocus: false });
    const webview = (input as any).webview || (input && (input as any)._webview);
    const doUpdate = async () => {
      try {
        const h = await render(path);
        webview?.postMessage({ type: 'render', html: h });
        console.log('[TestOpeners] Rendered content to webview', { length: (h || '').length });
      } catch (e) {
        webview?.postMessage({ type: 'render', html: `<pre>${String(e)}</pre>` });
        console.log('[TestOpeners] Render error', String(e));
      }
    };
    if (webview?.onMessage)
      webview.onMessage((m: any) => {
        if (m?.type === 'ready' || m?.type === 'refresh') doUpdate();
      });
    if ((webview as any)?.onDidReceiveMessage)
      (webview as any).onDidReceiveMessage((m: any) => {
        if (m?.type === 'ready' || m?.type === 'refresh') doUpdate();
      });
    await doUpdate();
    setTimeout(() => doUpdate(), 300);
    setTimeout(() => doUpdate(), 1000);
    return true;
  };
  console.log('[TestOpeners] Attached __TEST_OPEN_DEFAULT__ and __TEST_OPEN_DOCX__');
}
