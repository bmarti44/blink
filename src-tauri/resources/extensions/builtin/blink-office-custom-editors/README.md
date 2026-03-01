Blink Office Custom Editors (DOCX/XLSX/PPTX)

- Contributes three custom editors using VS Code CustomEditorProvider
- Editable with undo/redo/save (binary placeholder edit)
- Web extension (browser), bundled via esbuild

Build:

- npx esbuild --bundle src/extension.ts --format=cjs --platform=browser --outfile=dist/extension.js --external:vscode
