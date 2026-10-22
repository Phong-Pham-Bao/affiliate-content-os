import {
  getRedactedConfigMetadata,
  loadDatabaseConfig,
  readAndValidateSslCaFile,
  type AppConfig,
  type DatabaseConfig,
} from '@affiliate-content-os/config';
import { createDatabase, type Database } from '@affiliate-content-os/infrastructure/database';
import { runWorker, type WorkerRuntimeHandle } from './worker.js';
import {
  raceWithDeadline,
  type ClearTimerFn,
  type SetTimerFn,
  type TimeoutOptions,
} from './timeout.js';

export interface StartWorkerOptions {
  readonly config: AppConfig;
  readonly databaseConfig?: DatabaseConfig | undefined;
  readonly database?: Database | undefined;
  readonly abortController?: AbortController | undefined;
  readonly installSignalHandlers?: boolean | undefined;
  readonly shutdownTimeoutMs?: number | undefined;
  readonly onStarted?: (() => void) | undefined;
  readonly runtimeHandle?: WorkerRuntimeHandle | undefined;
  readonly terminate?: ((exitCode: number) => void) | undefined;
  readonly now?: (() => number) | undefined;
  readonly setTimer?: SetTimerFn | undefined;
  readonly clearTimer?: ClearTimerFn | undefined;
  readonly workerRunner?:
    | ((opts: {
        config: AppConfig;
        signal: AbortSignal;
        onStarted?: () => void;
        runtimeHandle?: WorkerRuntimeHandle;
      }) => Promise<void>)
    | undefined;
}

export async function startWorker(options: StartWorkerOptions): Promise<void> {
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

  const controller = options.abortController ?? new AbortController();

  let closePromise: Promise<void> | undefined;
  let runtimePromise: Promise<void> | undefined;
  let terminated = false;
  let signalHandlersInstalled = false;
  let absoluteDeadline: number | undefined;

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

  let isExecutingClose = false;
  const executeClose = async (): Promise<void> => {
    if (isExecutingClose) {
      return;
    }
    isExecutingClose = true;
    removeSignalHandlers();
    controller.abort();

    if (absoluteDeadline === undefined) {
      absoluteDeadline = getNow() + timeoutMs;
    }

    try {
      // Stage 1: Await worker runtime settlement
      if (runtimePromise) {
        await raceWithDeadline(
          runtimePromise,
          getRemainingMs(),
          `Worker graceful shutdown timed out after ${timeoutMs}ms while awaiting runtime settlement`,
          timerOptions,
        );
      }

      // Stage 2: Close Database pool
      await raceWithDeadline(
        database.close(),
        getRemainingMs(),
        `Worker graceful shutdown timed out after ${timeoutMs}ms while closing database pool`,
        timerOptions,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error(`Worker shutdown failure: ${message}`);
      invokeTerminate(1);
      throw err;
    }
  };

  const close = (): Promise<void> => {
    if (closePromise) {
      return closePromise;
    }
    let resolve!: () => void;
    let reject!: (err: unknown) => void;
    closePromise = new Promise<void>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    executeClose().then(resolve, reject);
    return closePromise;
  };

  const handleSignal = (signalName: string): void => {
    console.log(`Worker process received ${signalName}, shutting down gracefully`);
    void close()
      .then(() => {
        console.log('Worker process stopped gracefully');
        invokeTerminate(0);
      })
      .catch(() => {
        // executeClose already invoked invokeTerminate(1)
      });
  };

  const handleSigint = (): void => handleSignal('SIGINT');
  const handleSigterm = (): void => handleSignal('SIGTERM');

  if (options.installSignalHandlers !== false) {
    signalHandlersInstalled = true;
    process.once('SIGINT', handleSigint);
    process.once('SIGTERM', handleSigterm);
  }

  // Phase 1: Probe Database connection
  try {
    await database.probe(controller.signal);
  } catch (probeErr) {
    removeSignalHandlers();
    if (absoluteDeadline === undefined) {
      absoluteDeadline = getNow() + timeoutMs;
    }

    try {
      await raceWithDeadline(
        database.close(),
        getRemainingMs(),
        `Worker startup cleanup timed out after ${timeoutMs}ms`,
        timerOptions,
      );
    } catch {
      // Best-effort database close
    }

    if (controller.signal.aborted) {
      invokeTerminate(0);
      throw probeErr;
    }

    const message = probeErr instanceof Error ? probeErr.message : 'Database probe failed';
    console.error(`Worker startup failure: ${message}`);
    invokeTerminate(1);
    throw probeErr;
  }

  // Phase 2: Run Worker idle loop
  const handleStarted = (): void => {
    const metadata = getRedactedConfigMetadata(config);
    console.log(
      `Worker process started and entering idle state (nodeEnv: ${metadata.nodeEnv}, logLevel: ${metadata.logLevel})`,
    );
    options.onStarted?.();
  };

  const onAbortSignal = (): void => {
    void close().catch(() => {});
  };
  controller.signal.addEventListener('abort', onAbortSignal, { once: true });

  const workerRunnerFn = options.workerRunner ?? runWorker;

  try {
    runtimePromise = workerRunnerFn({
      config,
      signal: controller.signal,
      onStarted: handleStarted,
      ...(options.runtimeHandle !== undefined ? { runtimeHandle: options.runtimeHandle } : {}),
    });

    const closeRejectionPromise = new Promise<never>((_, reject) => {
      const propagateRejection = () => {
        if (closePromise) {
          closePromise.catch(reject);
        }
      };
      if (controller.signal.aborted) {
        queueMicrotask(propagateRejection);
      } else {
        controller.signal.addEventListener(
          'abort',
          () => {
            queueMicrotask(propagateRejection);
          },
          { once: true },
        );
      }
    });

    await Promise.race([runtimePromise.then(() => close()), closeRejectionPromise]);
  } catch (workerErr) {
    await close().catch(() => {});
    throw workerErr;
  } finally {
    removeSignalHandlers();
  }
}
