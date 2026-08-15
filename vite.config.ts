import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative, so the same build works served from a domain root, from a
  // project subpath on GitHub Pages, and opened straight off a disk.
  base: './',
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    // A great many of these tests fight whole battles, which take seconds
    // rather than milliseconds and got longer the moment the AI stopped
    // charging into everything. Under vitest's five-second default every one
    // of them was a balance change away from failing on the clock rather than
    // on what it was testing. The genuinely long runs — the mirror-match gate,
    // the campaign acceptance run — still declare their own budget.
    testTimeout: 30_000,
  },
});
