import {
  getRedactedConfigMetadata,
  loadDatabaseConfig,
  type AppConfig,
  type DatabaseConfig,
} from '@affiliate-content-os/config';
import { createDatabase, type Database } from '@affiliate-content-os/infrastructure/database';
import { runWorker, type WorkerRuntimeHandle } from './worker.js';
import { raceWithDeadline } from './timeout.js';

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
}

export async function startWorker(options: StartWorkerOptions): Promise<void> {
  const { config } = options;
  const timeoutMs = options.shutdownTimeoutMs ?? 5000;
  const terminate = options.terminate ?? ((exitCode: number): void => process.exit(exitCode));
  const getNow = options.now ?? (() => performance.now());

  const database =
    options.database ?? createDatabase(options.databaseConfig ?? loadDatabaseConfig(process.env));

  const controller = options.abortController ?? new AbortController();

  let closePromise: Promise<void> | undefined;
  let terminated = false;
  let signalHandlersInstalled = false;
  let absoluteDeadline: number | undefined;

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

  const executeClose = async (): Promise<void> => {
    removeSignalHandlers();
    controller.abort();

    if (absoluteDeadline === undefined) {
      absoluteDeadline = getNow() + timeoutMs;
    }

    const remaining = (): number => Math.max(0, absoluteDeadline! - getNow());

    try {
      await raceWithDeadline(
        database.close(),
        remaining(),
        `Worker graceful shutdown timed out after ${timeoutMs}ms while closing database pool`,
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
    closePromise = executeClose();
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
    try {
      await database.close();
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

  try {
    await runWorker({
      config,
      signal: controller.signal,
      onStarted: handleStarted,
      runtimeHandle: options.runtimeHandle,
    });
    await close();
  } catch (workerErr) {
    await close().catch(() => {});
    throw workerErr;
  } finally {
    removeSignalHandlers();
  }
}
