import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '@affiliate-content-os/config';
import type { Database } from '@affiliate-content-os/infrastructure/database';
import { startApiServer } from '../apps/api/src/server.js';
import { startWorker } from '../apps/worker/src/runner.js';

describe('API and Worker composition root ownership and isolation', () => {
  const rootDir = process.cwd();
  const apiServerPath = path.resolve(rootDir, 'apps/api/src/server.ts');
  const apiMainPath = path.resolve(rootDir, 'apps/api/src/main.ts');
  const workerRunnerPath = path.resolve(rootDir, 'apps/worker/src/runner.ts');
  const workerMainPath = path.resolve(rootDir, 'apps/worker/src/main.ts');

  it('proves server.ts has no process.env, config-loader, CA-reader, or database factory ownership', () => {
    const serverCode = fs.readFileSync(apiServerPath, 'utf8');

    expect(serverCode).not.toContain('process.env');
    expect(serverCode).not.toContain('loadConfig');
    expect(serverCode).not.toContain('loadDatabaseConfig');
    expect(serverCode).not.toContain('readAndValidateSslCaFile');
    expect(serverCode).not.toContain('createDatabase');
  });

  it('proves runner.ts has no process.env, config-loader, CA-reader, or database factory ownership', () => {
    const runnerCode = fs.readFileSync(workerRunnerPath, 'utf8');

    expect(runnerCode).not.toContain('process.env');
    expect(runnerCode).not.toContain('loadConfig');
    expect(runnerCode).not.toContain('loadDatabaseConfig');
    expect(runnerCode).not.toContain('readAndValidateSslCaFile');
    expect(runnerCode).not.toContain('createDatabase');
  });

  it('proves apps/api/src/main.ts owns process.env, config validation, CA validation, and database construction', () => {
    const mainCode = fs.readFileSync(apiMainPath, 'utf8');

    expect(mainCode).toContain('process.env');
    expect(mainCode).toContain('loadConfig');
    expect(mainCode).toContain('loadDatabaseConfig');
    expect(mainCode).toContain('readAndValidateSslCaFile');
    expect(mainCode).toContain('createDatabase');
    expect(mainCode).toContain('startApiServer');
  });

  it('proves apps/worker/src/main.ts owns process.env, config validation, CA validation, and database construction', () => {
    const mainCode = fs.readFileSync(workerMainPath, 'utf8');

    expect(mainCode).toContain('process.env');
    expect(mainCode).toContain('loadConfig');
    expect(mainCode).toContain('loadDatabaseConfig');
    expect(mainCode).toContain('readAndValidateSslCaFile');
    expect(mainCode).toContain('createDatabase');
    expect(mainCode).toContain('startWorker');
  });

  it('behaviorally proves startApiServer and startWorker ignore poisoned process.env and operate on injected dependencies', async () => {
    const originalEnv = { ...process.env };
    try {
      // Poison process.env with values that would throw if loaded
      process.env['NODE_ENV'] = 'poisoned_invalid_node_env';
      process.env['DATABASE_URL'] = 'not_a_valid_postgres_url';
      process.env['DATABASE_SSL_MODE'] = 'invalid_mode';
      process.env['DATABASE_SSL_CA_FILE'] = '/non/existent/ca/bundle.pem';

      const validConfig: AppConfig = Object.freeze({
        nodeEnv: 'test',
        logLevel: 'info',
        apiHost: '127.0.0.1',
        apiPort: 3001,
      });

      const mockDb: Database = {
        probe: vi.fn(async () => {}),
        close: vi.fn(async () => {}),
        query: vi.fn(async () => ({ rows: [], rowCount: 0, command: 'SELECT' })),
        withTransaction: vi.fn(async (fn) =>
          fn({
            query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0, command: 'SELECT' }),
          }),
        ),
        isClosing: vi.fn(() => false),
      };

      // 1. startApiServer operates purely on injected config and database without reading process.env
      const apiServer = await startApiServer({
        config: validConfig,
        database: mockDb,
        installSignalHandlers: false,
        listener: async (app) => {
          await app.ready();
        },
      });
      expect(mockDb.probe).toHaveBeenCalledTimes(1);
      await apiServer.close();
      expect(mockDb.close).toHaveBeenCalledTimes(1);

      // 2. startWorker operates purely on injected config and database without reading process.env
      const workerController = new AbortController();
      const workerPromise = startWorker({
        config: validConfig,
        database: mockDb,
        abortController: workerController,
        installSignalHandlers: false,
      });
      workerController.abort();
      await workerPromise;
      expect(mockDb.close).toHaveBeenCalledTimes(2);
    } finally {
      process.env = originalEnv;
    }
  });
});
