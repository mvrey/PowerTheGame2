import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Konquest's browser game: one self-contained page, dist/konquest.html, next to Power's.
export default defineConfig({
  base: './',
  publicDir: false,
  plugins: [viteSingleFile()],
  build: {
    target: 'es2020',
    emptyOutDir: false,
    rollupOptions: { input: 'konquest.html' },
  },
});
