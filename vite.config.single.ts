import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * One bundle with every asset inlined, for the self-contained playable build.
 * The normal `npm run build` still code-splits; this target exists so the whole
 * game can be served as a single HTML file.
 */
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist-single',
    emptyOutDir: true,
    cssCodeSplit: false,
    assetsInlineLimit: 100_000_000,
    rolldownOptions: { output: { inlineDynamicImports: true } },
  },
});
