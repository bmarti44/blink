import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import wasm from 'vite-plugin-wasm';

export default defineConfig({
  plugins: [react(), wasm()],
  build: {
    outDir: 'web',
    emptyOutDir: true,
    target: 'esnext',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('@codingame/monaco-vscode')) {
            return 'monaco-vscode';
          }
        },
      },
    },
  },
  server: {
    port: 1420,
    strictPort: true,
  },
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    exclude: ['@codingame/monaco-vscode-api', 'vscode'],
  },
});
