#!/usr/bin/env python3
"""
Patch webview index.html to fix DOMContentLoaded timing issue.

The problem: When service workers are disabled (for extension details),
the inner iframe loads fake.html very quickly and the DOMContentLoaded
event fires before the event listener is attached. This causes the
webview content to never be rendered.

The fix: Check if the document is already loaded before adding the
event listener, and add a fallback timeout.
"""

import sys
import re
import os

def patch_webview_index(filepath):
    with open(filepath, 'r') as f:
        content = f.read()

    # Check if already patched
    if 'checkAndLoad' in content:
        print(f'[Webview Patch] Already patched: {filepath}')
        return True

    # Find the target code block
    # Original code:
    #   } else {
    #       assertIsDefined(newFrame.contentWindow).addEventListener('DOMContentLoaded', e => {
    #           const contentDocument = e.target ? (/** @type {HTMLDocument} */ (e.target)) : undefined;
    #           onFrameLoaded(assertIsDefined(contentDocument));
    #       });
    #   }

    # Pattern to match the else block that contains the DOMContentLoaded listener
    # Using a simpler approach - find the exact line and its surrounding context
    pattern = r'''(\} else \{\s*\n)([\t ]*)(assertIsDefined\(newFrame\.contentWindow\)\.addEventListener\('DOMContentLoaded', e => \{\s*\n[\t ]*const contentDocument = e\.target \? \(/\*\* @type \{HTMLDocument\} \*/.*\n[\t ]*onFrameLoaded\(assertIsDefined\(contentDocument\)\);\s*\n[\t ]*\}\);)(\s*\n[\t ]*\})'''

    def replacement(match):
        prefix = match.group(1)  # "} else {\n"
        indent = match.group(2)  # leading whitespace before assertIsDefined
        original = match.group(3)  # the addEventListener block
        suffix = match.group(4)  # closing "\n\t\t\t\t}"

        inner_indent = indent + '\t'

        patch = f'''{prefix}{indent}// Timing fix: check if document already loaded (fake.html loads fast)
{indent}const checkAndLoad = () => {{
{inner_indent}const contentDocument = assertIsDefined(newFrame.contentDocument);
{inner_indent}if (contentDocument.readyState !== 'loading' && contentDocument.location.pathname.endsWith('/fake.html')) {{
{inner_indent}\tonFrameLoaded(contentDocument);
{inner_indent}\treturn true;
{inner_indent}}}
{inner_indent}return false;
{indent}}};
{indent}// Try immediately in case document already loaded
{indent}if (!checkAndLoad()) {{
{indent}{original}
{inner_indent}// Fallback timeout in case event was missed
{inner_indent}setTimeout(() => {{
{inner_indent}\tconst pendingFrame = document.getElementById('pending-frame');
{inner_indent}\tif (pendingFrame) checkAndLoad();
{inner_indent}}}, 100);
{indent}}}{suffix}'''
        return patch

    patched, count = re.subn(pattern, replacement, content)

    if count == 0:
        print(f'[Webview Patch] Could not find target code in: {filepath}')
        return False

    # Also update CSP to allow the modified script
    # The original CSP has a sha256 hash for the script, but our patch changes it
    # Add 'unsafe-inline' to script-src as a fallback for development
    csp_pattern = r"script-src 'sha256-[A-Za-z0-9+/=]+' 'self'"
    csp_replacement = "script-src 'unsafe-inline' 'self'"
    patched = re.sub(csp_pattern, csp_replacement, patched)

    with open(filepath, 'w') as f:
        f.write(patched)

    print(f'[Webview Patch] Applied timing fix to: {filepath}')
    return True


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print('Usage: patch-webview.py <path-to-index.html>')
        sys.exit(1)

    filepath = sys.argv[1]
    if not os.path.exists(filepath):
        print(f'File not found: {filepath}')
        sys.exit(1)

    success = patch_webview_index(filepath)
    sys.exit(0 if success else 1)
