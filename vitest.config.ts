import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@affiliate-content-os/config': path.resolve(__dirname, 'packages/config/src/index.ts'),
      '@affiliate-content-os/infrastructure/database': path.resolve(
        __dirname,
        'packages/infrastructure/src/database/index.ts',
      ),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: [
      'packages/**/*.test.ts',
      'packages/**/*.spec.ts',
      'apps/**/*.test.ts',
      'apps/**/*.test.tsx',
      'apps/**/*.spec.ts',
      'test/**/*.test.ts',
    ],
    exclude: ['**/node_modules/**', '**/dist/**', 'packages/infrastructure/test/integration/**'],
  },
});
