import type { AppConfig } from '@affiliate-content-os/config';

export interface WorkerDependencies {
  readonly config: AppConfig;
  readonly signal: AbortSignal;
  readonly onStarted?: () => void;
}

/**
 * Runs the background worker process shell in an idle state.
 * Does not use timers, interval polling, CPU spin, fake jobs, or queues.
 * Resolves cleanly when the injected abort signal is triggered.
 */
export async function runWorker(deps: WorkerDependencies): Promise<void> {
  if (deps.signal.aborted) {
    return;
  }

  deps.onStarted?.();

  return new Promise<void>((resolve) => {
    if (deps.signal.aborted) {
      resolve();
      return;
    }

    const onAbort = (): void => {
      deps.signal.removeEventListener('abort', onAbort);
      resolve();
    };

    deps.signal.addEventListener('abort', onAbort, { once: true });
  });
}
