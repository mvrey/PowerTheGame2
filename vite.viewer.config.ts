import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// The spectator viewer: one self-contained page in dist/viewer, served by `jam serve`.
export default defineConfig({
  root: 'src/viewer',
  base: './',
  publicDir: false,
  plugins: [viteSingleFile()],
  build: { target: 'es2020', outDir: '../../dist/viewer', emptyOutDir: true },
});
