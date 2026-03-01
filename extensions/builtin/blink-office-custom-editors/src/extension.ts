import * as vscode from 'vscode';

class BinaryDocument implements vscode.CustomDocument {
  readonly uri: vscode.Uri;
  private _data: Uint8Array;
  private readonly _onDidDispose = new vscode.EventEmitter<void>();
  onDidDispose = this._onDidDispose.event;
  constructor(uri: vscode.Uri, data: Uint8Array) {
    this.uri = uri;
    this._data = data;
  }
  get data() {
    return this._data;
  }
  set data(d: Uint8Array) {
    this._data = d;
  }
  dispose() {
    this._onDidDispose.fire();
    this._onDidDispose.dispose();
  }
}

function getHtml(webview: vscode.Webview): string {
  const nonce = Math.random().toString(36).slice(2);
  const csp = [
    `default-src 'none';`,
    `img-src ${webview.cspSource} data:;`,
    `style-src ${webview.cspSource} 'unsafe-inline';`,
    `script-src ${webview.cspSource} 'nonce-${nonce}';`,
  ].join(' ');
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"/><meta http-equiv="Content-Security-Policy" content="${csp}"/></head><body><div id="root"></div><script nonce="${nonce}">(function(){const vscode=acquireVsCodeApi();window.addEventListener('message',e=>{const m=e.data||{};if(m.type==='render'){document.getElementById('root').innerText=m.text||'';}});vscode.postMessage({type:'ready'});})();</script></body></html>`;
}

function createProvider(): vscode.CustomEditorProvider<BinaryDocument> {
  const onDidChangeCustomDocument = new vscode.EventEmitter<vscode.CustomDocumentEditEvent<BinaryDocument>>();
  return {
    openCustomDocument: async (uri, openContext, _token) => {
      const data = openContext.backupId
        ? await vscode.workspace.fs.readFile(vscode.Uri.parse(openContext.backupId))
        : await vscode.workspace.fs.readFile(uri);
      return new BinaryDocument(uri, data);
    },
    resolveCustomEditor: async (document, webviewPanel, _token) => {
      const { webview } = webviewPanel;
      webview.options = { enableScripts: true, localResourceRoots: [] };
      webview.html = getHtml(webview);
      const post = (type: string, payload: any = {}) => webview.postMessage({ type, ...payload });
      const update = () => {
        const text = `Size: ${document.data.byteLength} bytes\nURI: ${document.uri.fsPath}`;
        post('render', { text });
      };
      webview.onDidReceiveMessage(async (msg) => {
        if (msg?.type === 'edit') {
          const before = document.data;
          const after = new Uint8Array(before.length);
          after.set(before);
          onDidChangeCustomDocument.fire({
            document,
            label: 'Binary Edit',
            undo: async () => {
              document.data = before;
              update();
            },
            redo: async () => {
              document.data = after;
              update();
            },
          });
        }
      });
      webviewPanel.onDidDispose(() => {});
      update();
    },
    onDidChangeCustomDocument: onDidChangeCustomDocument.event,
    saveCustomDocument: async (document, _cancellation) => {
      await vscode.workspace.fs.writeFile(document.uri, document.data);
    },
    saveCustomDocumentAs: async (document, destination, _cancellation) => {
      await vscode.workspace.fs.writeFile(destination, document.data);
    },
    revertCustomDocument: async (document, _cancellation) => {
      document.data = await vscode.workspace.fs.readFile(document.uri);
    },
    backupCustomDocument: async (document, _context, _cancellation) => {
      const disposable = new vscode.Disposable(() => {});
      return {
        id: document.uri.toString(),
        delete: async () => {
          disposable.dispose();
        },
      } as any;
    },
  };
}

export async function activate(context: vscode.ExtensionContext) {
  const providers = [{ vt: 'blink.docxBinary' }, { vt: 'blink.xlsxBinary' }, { vt: 'blink.pptxBinary' }];
  for (const p of providers) {
    const provider = createProvider();
    context.subscriptions.push(vscode.window.registerCustomEditorProvider(p.vt, provider, { supportsMultipleEditorsPerDocument: true }));
  }
}

export function deactivate() {}
