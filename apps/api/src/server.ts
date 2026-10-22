import type { FastifyInstance } from 'fastify';
import {
  loadDatabaseConfig,
  readAndValidateSslCaFile,
  type AppConfig,
  type DatabaseConfig,
} from '@affiliate-content-os/config';
import { createDatabase, type Database } from '@affiliate-content-os/infrastructure/database';
import { createApp } from './app.js';
import {
  raceWithDeadline,
  type ClearTimerFn,
  type SetTimerFn,
  type TimeoutOptions,
} from './timeout.js';

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
  readonly listener?:
    ((app: FastifyInstance, config: AppConfig, signal?: AbortSignal) => Promise<void>) | undefined;
  readonly terminate?: ((exitCode: number) => void) | undefined;
  readonly now?: (() => number) | undefined;
  readonly setTimer?: SetTimerFn | undefined;
  readonly clearTimer?: ClearTimerFn | undefined;
}

export async function startApiServer(options: StartServerOptions): Promise<ApiServerHandle> {
  const { config } = options;
  const timeoutMs = options.shutdownTimeoutMs ?? 5000;
  const terminate = options.terminate ?? ((exitCode: number): void => process.exit(exitCode));
  const getNow = options.now ?? (() => performance.now());
  const timerOptions: TimeoutOptions = {
    setTimer: options.setTimer,
    clearTimer: options.clearTimer,
  };

  let database: Database;
  if (options.database) {
    database = options.database;
  } else {
    const dbConfig = options.databaseConfig ?? loadDatabaseConfig(process.env);
    let sslCaContent: string | undefined;
    if (dbConfig.sslMode === 'verify-full' && dbConfig.sslCaFile) {
      sslCaContent = readAndValidateSslCaFile(dbConfig.sslCaFile);
    }
    database = createDatabase(dbConfig, { sslCaContent });
  }

  const app = options.app ?? createApp({ config });

  type ServerState = 'starting' | 'running' | 'closing' | 'closed';
  let state: ServerState = 'starting';
  let closePromise: Promise<void> | undefined;
  let terminated = false;
  let signalHandlersInstalled = false;
  let absoluteDeadline: number | undefined;

  const startupAbortController = new AbortController();

  const getRemainingMs = (): number => {
    if (absoluteDeadline === undefined) {
      absoluteDeadline = getNow() + timeoutMs;
    }
    return Math.max(0, absoluteDeadline - getNow());
  };

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
        // executeClose already logged failure and invoked invokeTerminate(1)
      });
  };

  const handleSigint = (): void => handleSignal();
  const handleSigterm = (): void => handleSignal();

  if (options.installSignalHandlers !== false) {
    signalHandlersInstalled = true;
    process.on('SIGINT', handleSigint);
    process.on('SIGTERM', handleSigterm);
  }

  const defaultListener = async (
    fastifyApp: FastifyInstance,
    cfg: AppConfig,
    signal?: AbortSignal,
  ): Promise<void> => {
    if (signal?.aborted) {
      throw new Error('API server listener aborted before listen');
    }
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

    try {
      // 1. Close Fastify listener if started
      await raceWithDeadline(
        app.close(),
        getRemainingMs(),
        `API server graceful shutdown timed out after ${timeoutMs}ms while closing HTTP listener`,
        timerOptions,
      );

      // 2. Close Database pool within the remaining total budget
      await raceWithDeadline(
        database.close(),
        getRemainingMs(),
        `API server graceful shutdown timed out after ${timeoutMs}ms while closing database pool`,
        timerOptions,
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
    if (absoluteDeadline === undefined) {
      absoluteDeadline = getNow() + timeoutMs;
    }

    try {
      await raceWithDeadline(
        database.close(),
        getRemainingMs(),
        `API server startup cleanup timed out after ${timeoutMs}ms`,
        timerOptions,
      );
    } catch {
      // Best-effort cleanup failure
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
    await listener(app, config, startupAbortController.signal);
    if (startupAbortController.signal.aborted) {
      throw new Error('API server startup aborted after listener bound');
    }
    state = 'running';
  } catch (listenErr) {
    removeSignalHandlers();
    state = 'closing';
    if (absoluteDeadline === undefined) {
      absoluteDeadline = getNow() + timeoutMs;
    }

    try {
      await raceWithDeadline(
        app.close(),
        getRemainingMs(),
        `API server startup cleanup timed out while closing listener`,
        timerOptions,
      );
    } catch {
      // Best-effort listener close
    }

    try {
      await raceWithDeadline(
        database.close(),
        getRemainingMs(),
        `API server startup cleanup timed out while closing database pool`,
        timerOptions,
      );
    } catch {
      // Best-effort database close
    }
    state = 'closed';

    if (startupAbortController.signal.aborted) {
      invokeTerminate(0);
      throw listenErr;
    }

    const message = listenErr instanceof Error ? listenErr.message : 'Fastify listen failed';
    console.error(`API server startup failure: ${message}`);
    invokeTerminate(1);
    throw listenErr;
  }

  return {
    app,
    config,
    database,
    close,
  };
}
