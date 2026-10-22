import { MessageChannel } from 'node:worker_threads';
import type { AppConfig } from '@affiliate-content-os/config';

export interface WorkerRuntimeHandle {
  readonly ref: () => void;
  readonly close: () => void;
}

export interface WorkerDependencies {
  readonly config: AppConfig;
  readonly signal: AbortSignal;
  readonly onStarted?: (() => void) | undefined;
  readonly runtimeHandle?: WorkerRuntimeHandle | undefined;
}

/**
 * Runs the background worker process shell in an idle state.
 * Operates without timers, intervals, polling, CPU spin, fake jobs, or queues.
 * Uses a referenced runtime handle to keep the Node.js event loop active until aborted.
 * Resolves cleanly and closes resources when the injected abort signal is triggered.
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

    let defaultChannel: MessageChannel | undefined;
    let handle: WorkerRuntimeHandle;

    if (deps.runtimeHandle) {
      handle = deps.runtimeHandle;
    } else {
      defaultChannel = new MessageChannel();
      handle = {
        ref: () => defaultChannel?.port1.ref(),
        close: () => {
          defaultChannel?.port1.close();
          defaultChannel?.port2.close();
        },
      };
    }

    handle.ref();

    const onAbort = (): void => {
      deps.signal.removeEventListener('abort', onAbort);
      try {
        handle.close();
      } finally {
        resolve();
      }
    };

    deps.signal.addEventListener('abort', onAbort, { once: true });
  });
}
