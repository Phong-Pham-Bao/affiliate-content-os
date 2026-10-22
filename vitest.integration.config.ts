import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
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
    testTimeout: 30000,
    hookTimeout: 30000,
    include: ['packages/infrastructure/test/integration/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
});
