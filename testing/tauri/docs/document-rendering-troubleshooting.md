# Document Rendering Troubleshooting Guide

## Overview

Office documents (DOCX, XLSX, PPTX) are rendered using VS Code webviews integrated via the monaco-vscode library. This document explains common issues and how to diagnose them.

## Architecture

```
User opens file → editorResolverXxx.ts intercepts → openWebview() creates webview
                                                          ↓
                               Backend render_document_html() → HTML content
                                                          ↓
                               webview.postMessage({ type: 'render', html })
                                                          ↓
                               Webview script receives message → Updates DOM
                                                          ↓
                               Webview sends renderAck → Confirms display
```

## Common Issues

### 1. Webview iframe has 0x0 dimensions

**Symptoms:**
- Tab shows document name
- `__DOCX_LAST_RENDER_TEXT__` has content
- But nothing visible in editor area
- DOM shows iframe with 0x0 offsetWidth/offsetHeight

**Diagnosis:**
```javascript
// Check iframe dimensions
document.querySelectorAll('iframe').forEach((f,i) =>
  console.log(i, f.className, f.offsetWidth + 'x' + f.offsetHeight));

// Check computed style
getComputedStyle(document.querySelector('iframe.webview')).display
```

**Causes:**
- The iframe might be the extension host iframe (class `web-worker-ext-host-iframe`) which is intentionally hidden
- The webview panel wasn't placed in the editor area

### 2. Webview exists but content is blank

**Symptoms:**
- Iframe has proper dimensions (e.g., 552x425)
- Tab shows document name
- Backend reports rendering success
- But `__DOCX_LAST_RENDER_LENGTH__` is 0 (no renderAck)

**Diagnosis:**
```javascript
// Check if webview HTML was set
document.querySelector('iframe.webview')?.contentDocument?.body?.innerHTML

// Check for #doc element
document.querySelector('iframe.webview')?.contentDocument?.getElementById('doc')
```

**Causes:**
1. **`init.html` not being used**: The `openWebview()` call passes `init.html` but monaco-vscode may not use it
2. **Need explicit `webview.html` setting**: After calling `openWebview()`, you may need to set `webview.html` explicitly
3. **CSP blocking scripts**: Content Security Policy may prevent script execution inside webview

**Fix:**
```typescript
const input = webviewSvc.openWebview(init, viewType, title, undefined, opts);
const webview = input.webview || input._webview;
// Explicitly set HTML if not already set
if (webview && !webview.html) {
  webview.html = yourHtmlContent;
}
```

### 3. postMessage not reaching webview

**Symptoms:**
- `Rendered content to webview` log appears
- But no `renderAck` in logs
- `__DOCX_LAST_RENDER_LENGTH__` remains 0

**Diagnosis:**
```javascript
// Check if webview has message listener
// Inside webview iframe:
window.addEventListener('message', e => console.log('GOT', e.data));
```

**Causes:**
1. Message sent before webview script loaded
2. `postMessage` targeting wrong window/frame
3. Webview HTML doesn't include message handler

### 4. Content rendered but not visible

**Symptoms:**
- renderAck received
- `__DOCX_WEBVIEW_INNER_TEXT__` has content
- But user sees blank area

**Diagnosis:**
```javascript
// Check webview iframe styling
var wv = document.querySelector('iframe.webview.ready');
console.log('Display:', getComputedStyle(wv).display);
console.log('Visibility:', getComputedStyle(wv).visibility);
console.log('Position:', wv.getBoundingClientRect());
```

**Causes:**
1. CSS `display: none` or `visibility: hidden`
2. Positioned outside viewport
3. Z-index issues (covered by other elements)
4. Parent container collapsed

## Debug Variables

These window variables are set during document opening:

| Variable | Description |
|----------|-------------|
| `__DOCX_WEBVIEW_OPEN__` | Boolean - webview was opened |
| `__DOCX_OPEN_REQUESTED_PATH__` | String - path that was requested |
| `__DOCX_LAST_RENDER_TEXT__` | String - preview of rendered text |
| `__DOCX_LAST_RENDER_LENGTH__` | Number - HTML length from renderAck |
| `__DOCX_WEBVIEW_INNER_TEXT__` | String - text from webview innerHTML |
| `__DOCX_IFRAME_COUNT__` | Number - iframe count at open time |

## E2E Tests

Tests that verify document rendering:

| Test | What it checks |
|------|----------------|
| `30-docx-visible-render.sh` | Webview has visible dimensions |
| `33-docx-webview-content-visible.sh` | Content is rendered AND visible |
| `19-docx-tab-rendered.sh` | Tab appears and render metrics set |
| `20-docx-webview-content.sh` | Content matches expected text |

## Running Diagnostics

From the test server:

```bash
# Check render state
curl -s http://127.0.0.1:9999/js -d '{"code": "window.__DOCX_LAST_RENDER_TEXT__"}'

# Check renderAck
curl -s http://127.0.0.1:9999/js -d '{"code": "window.__DOCX_LAST_RENDER_LENGTH__"}'

# Check iframe structure
curl -s http://127.0.0.1:9999/js -d '{"code": "Array.from(document.querySelectorAll(\"iframe\")).map(f => f.className + \":\" + f.offsetWidth + \"x\" + f.offsetHeight)"}'

# Check console logs
curl -s http://127.0.0.1:9999/console | jq '.entries[] | select(.message | contains("DocxResolver"))'
```

## Monaco Webview Integration Notes

The monaco-vscode library's webview system:

1. Creates an outer iframe pointing to `monaco-assets/index-*.html`
2. This outer iframe contains the webview shell code
3. The shell is supposed to load our custom HTML content
4. Message passing uses `postMessage` through the shell

**Known quirks:**
- The `init.html` passed to `openWebview()` may not be automatically used
- Setting `webview.html` after creation may be required
- The webview shell must be fully loaded before receiving messages
- Multiple render calls may be needed (the code does 300ms and 1000ms retries)
