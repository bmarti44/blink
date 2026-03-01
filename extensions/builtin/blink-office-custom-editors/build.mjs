import esbuild from 'esbuild';

await esbuild.build({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  outfile: 'dist/extension.js',
  sourcemap: true,
  external: ['vscode'],
});
