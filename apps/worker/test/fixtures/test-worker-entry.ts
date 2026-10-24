import { loadConfig } from '@affiliate-content-os/config';
import type { Database } from '@affiliate-content-os/infrastructure/database';
import { startWorker } from '../../src/runner.js';

const config = loadConfig(process.env);
const mockDatabase: Database = {
  probe: async () => {},
  close: async () => {},
  query: async () => ({ rows: [], rowCount: 0, command: 'SELECT' }),
  withTransaction: async (fn) =>
    fn({ query: async () => ({ rows: [], rowCount: 0, command: 'SELECT' }) }),
  isClosing: () => false,
};

if (config.nodeEnv === 'test' && !process.stdin.isTTY) {
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    const line = chunk.toString().trim();
    if (line === 'SIGINT') {
      process.emit('SIGINT');
    } else if (line === 'SIGTERM') {
      process.emit('SIGTERM');
    }
  });
}

try {
  await startWorker({ config, database: mockDatabase });
  console.log('Worker process stopped gracefully');
  process.exit(0);
} catch (err) {
  console.error('Worker failed:', err);
  process.exit(1);
}
