import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist/viewer',
    emptyOutDir: true,
    rollupOptions: { input: { viewer: 'index.html', guide: 'guide.html' } },
  },
  server: { host: '127.0.0.1' },
});
