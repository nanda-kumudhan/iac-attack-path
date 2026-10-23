import { build } from 'esbuild';

// Commit the bundle when releasing so `uses: owner/repo@ref` needs no npm install.
await build({
  entryPoints: ['src/action/index.ts'],
  outfile: 'lib/action.cjs',
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'cjs',
  legalComments: 'eof',
});
