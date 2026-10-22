import { getRedactedConfigMetadata, type AppConfig } from '@affiliate-content-os/config';
import { runWorker, type WorkerRuntimeHandle } from './worker.js';

export interface StartWorkerOptions {
  readonly config: AppConfig;
  readonly abortController?: AbortController | undefined;
  readonly installSignalHandlers?: boolean | undefined;
  readonly onStarted?: (() => void) | undefined;
  readonly runtimeHandle?: WorkerRuntimeHandle | undefined;
}

/**
 * Initializes and executes the worker process with signal handling and injected validated config.
 */
export async function startWorker(options: StartWorkerOptions): Promise<void> {
  const { config } = options;
  const controller = options.abortController ?? new AbortController();

  let isStopping = false;

  const handleSignal = (signalName: string): void => {
    if (isStopping) {
      return;
    }
    isStopping = true;
    console.log(`Worker process received ${signalName}, shutting down gracefully`);
    controller.abort();
  };

  const handleSigint = (): void => handleSignal('SIGINT');
  const handleSigterm = (): void => handleSignal('SIGTERM');

  if (options.installSignalHandlers !== false) {
    process.once('SIGINT', handleSigint);
    process.once('SIGTERM', handleSigterm);
  }

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
  } finally {
    if (options.installSignalHandlers !== false) {
      process.removeListener('SIGINT', handleSigint);
      process.removeListener('SIGTERM', handleSigterm);
    }
  }
}
