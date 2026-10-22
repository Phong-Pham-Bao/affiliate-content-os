import type { FastifyInstance } from 'fastify';
import {
  loadDatabaseConfig,
  type AppConfig,
  type DatabaseConfig,
} from '@affiliate-content-os/config';
import { createDatabase, type Database } from '@affiliate-content-os/infrastructure/database';
import { createApp } from './app.js';
import { raceWithDeadline } from './timeout.js';

export interface ApiServerHandle {
  readonly app: FastifyInstance;
  readonly config: AppConfig;
  readonly database: Database;
  readonly close: () => Promise<void>;
}

export interface StartServerOptions {
  readonly config: AppConfig;
  readonly databaseConfig?: DatabaseConfig | undefined;
  readonly database?: Database | undefined;
  readonly app?: FastifyInstance | undefined;
  readonly installSignalHandlers?: boolean | undefined;
  readonly shutdownTimeoutMs?: number | undefined;
  readonly listener?: ((app: FastifyInstance, config: AppConfig) => Promise<void>) | undefined;
  readonly terminate?: ((exitCode: number) => void) | undefined;
  readonly now?: (() => number) | undefined;
}

export async function startApiServer(options: StartServerOptions): Promise<ApiServerHandle> {
  const { config } = options;
  const timeoutMs = options.shutdownTimeoutMs ?? 5000;
  const terminate = options.terminate ?? ((exitCode: number): void => process.exit(exitCode));
  const getNow = options.now ?? (() => performance.now());

  const database =
    options.database ?? createDatabase(options.databaseConfig ?? loadDatabaseConfig(process.env));
  const app = options.app ?? createApp({ config });

  type ServerState = 'starting' | 'running' | 'closing' | 'closed';
  let state: ServerState = 'starting';
  let closePromise: Promise<void> | undefined;
  let terminated = false;
  let signalHandlersInstalled = false;
  let absoluteDeadline: number | undefined;

  const startupAbortController = new AbortController();

  const invokeTerminate = (exitCode: number): void => {
    if (terminated) {
      return;
    }
    terminated = true;
    terminate(exitCode);
  };

  const removeSignalHandlers = (): void => {
    if (signalHandlersInstalled) {
      signalHandlersInstalled = false;
      process.removeListener('SIGINT', handleSigint);
      process.removeListener('SIGTERM', handleSigterm);
    }
  };

  const handleSignal = (): void => {
    startupAbortController.abort();
    void close()
      .then(() => {
        invokeTerminate(0);
      })
      .catch(() => {
        // executeClose already logged failure and called invokeTerminate(1)
      });
  };

  const handleSigint = (): void => handleSignal();
  const handleSigterm = (): void => handleSignal();

  if (options.installSignalHandlers !== false) {
    signalHandlersInstalled = true;
    process.on('SIGINT', handleSigint);
    process.on('SIGTERM', handleSigterm);
  }

  const defaultListener = async (fastifyApp: FastifyInstance, cfg: AppConfig): Promise<void> => {
    await fastifyApp.listen({
      host: cfg.apiHost,
      port: cfg.apiPort,
    });
  };
  const listener = options.listener ?? defaultListener;

  const executeClose = async (): Promise<void> => {
    removeSignalHandlers();
    state = 'closing';
    startupAbortController.abort();

    if (absoluteDeadline === undefined) {
      absoluteDeadline = getNow() + timeoutMs;
    }

    const remaining = (): number => Math.max(0, absoluteDeadline! - getNow());

    try {
      // 1. Close Fastify listener if started
      await raceWithDeadline(
        app.close(),
        remaining(),
        `API server graceful shutdown timed out after ${timeoutMs}ms while closing HTTP listener`,
      );

      // 2. Close Database pool within the remaining total budget
      await raceWithDeadline(
        database.close(),
        remaining(),
        `API server graceful shutdown timed out after ${timeoutMs}ms while closing database pool`,
      );

      state = 'closed';
    } catch (err) {
      state = 'closed';
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error(`API server shutdown failure: ${message}`);
      invokeTerminate(1);
      throw err;
    }
  };

  const close = (): Promise<void> => {
    if (state === 'closed') {
      return Promise.resolve();
    }
    if (closePromise) {
      return closePromise;
    }
    closePromise = executeClose();
    return closePromise;
  };

  // Phase 1: Probe Database connection before listening
  try {
    await database.probe(startupAbortController.signal);
  } catch (probeErr) {
    removeSignalHandlers();
    state = 'closing';
    try {
      await database.close();
    } catch {
      // Best-effort cleanup
    }
    state = 'closed';

    if (startupAbortController.signal.aborted) {
      invokeTerminate(0);
      throw probeErr;
    }

    const message = probeErr instanceof Error ? probeErr.message : 'Database probe failed';
    console.error(`API server startup failure: ${message}`);
    invokeTerminate(1);
    throw probeErr;
  }

  // Phase 2: Start Fastify HTTP listener
  try {
    if (startupAbortController.signal.aborted) {
      throw new Error('API server startup aborted before listener bound');
    }
    await listener(app, config);
    state = 'running';
  } catch (listenErr) {
    removeSignalHandlers();
    state = 'closing';
    try {
      await app.close();
    } catch {
      // Best-effort listener close
    }
    try {
      await database.close();
    } catch {
      // Best-effort database close
    }
    state = 'closed';

    if (startupAbortController.signal.aborted) {
      invokeTerminate(0);
    } else {
      const message = listenErr instanceof Error ? listenErr.message : 'Listener failed';
      console.error(`API server startup failure: ${message}`);
      invokeTerminate(1);
    }
    throw listenErr;
  }

  return {
    app,
    config,
    database,
    close,
  };
}
