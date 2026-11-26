import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    globals: true,
    css: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      thresholds: { lines: 85, functions: 85, branches: 80, statements: 85 },
      include: [
        'src/components/common/**',
        'src/components/Layout/**',
        'src/contexts/**',
        'src/hooks/**',
        'src/stores/**',
        'src/config/**',
        'src/utils/**',
        'src/pages/UserDetail/*Card.tsx',
      ],
    },
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
});
