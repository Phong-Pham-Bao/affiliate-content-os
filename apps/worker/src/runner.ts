import { getRedactedConfigMetadata, type AppConfig } from '@affiliate-content-os/config';
import { runWorker } from './worker.js';

export interface StartWorkerOptions {
  readonly config: AppConfig;
  readonly abortController?: AbortController;
  readonly installSignalHandlers?: boolean;
  readonly onStarted?: () => void;
}

/**
 * Initializes and executes the worker process with signal handling and injected validated config.
 */
export async function startWorker(options: StartWorkerOptions): Promise<void> {
  const { config } = options;
  const controller = options.abortController ?? new AbortController();

  let isStopping = false;

  const handleSignal = (): void => {
    if (isStopping) {
      return;
    }
    isStopping = true;
    controller.abort();
  };

  if (options.installSignalHandlers !== false) {
    process.once('SIGINT', handleSignal);
    process.once('SIGTERM', handleSignal);
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
    });
  } finally {
    if (options.installSignalHandlers !== false) {
      process.removeListener('SIGINT', handleSignal);
      process.removeListener('SIGTERM', handleSignal);
    }
  }
}
