import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '@affiliate-content-os/config';
import { createApp } from './app.js';

export interface ApiServerHandle {
  readonly app: FastifyInstance;
  readonly config: AppConfig;
  readonly close: () => Promise<void>;
}

export interface StartServerOptions {
  readonly config: AppConfig;
  readonly app?: FastifyInstance | undefined;
  readonly installSignalHandlers?: boolean | undefined;
  readonly shutdownTimeoutMs?: number | undefined;
  readonly listener?: ((app: FastifyInstance, config: AppConfig) => Promise<void>) | undefined;
  readonly terminate?: ((exitCode: number) => void) | undefined;
}

/**
 * Starts the API HTTP server with validated configuration and bounded signal handling.
 */
export async function startApiServer(options: StartServerOptions): Promise<ApiServerHandle> {
  const { config } = options;
  const app = options.app ?? createApp({ config });
  const timeoutMs = options.shutdownTimeoutMs ?? 5000;
  const terminate = options.terminate ?? ((exitCode: number): void => process.exit(exitCode));

  type ServerState = 'starting' | 'running' | 'closing' | 'closed';
  let state: ServerState = 'starting';
  let closePromise: Promise<void> | undefined;
  let closeRequestedDuringStartup = false;
  let terminated = false;
  let signalHandlersInstalled = false;

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
    void close()
      .then(() => {
        invokeTerminate(0);
      })
      .catch(() => {
        // executeClose or timeout handler already logged failure and invoked invokeTerminate(1)
      });
  };

  const handleSigint = (): void => handleSignal();
  const handleSigterm = (): void => handleSignal();

  if (options.installSignalHandlers !== false) {
    signalHandlersInstalled = true;
    process.on('SIGINT', handleSigint);
    process.on('SIGTERM', handleSigterm);
  }

  let rejectStartup: ((err: Error) => void) | undefined;
  const startupAbortPromise = new Promise<never>((_, reject) => {
    rejectStartup = reject;
  });

  const defaultListener = async (fastifyApp: FastifyInstance, cfg: AppConfig): Promise<void> => {
    await fastifyApp.listen({
      host: cfg.apiHost,
      port: cfg.apiPort,
    });
  };

  const listener = options.listener ?? defaultListener;
  const startupPromise = listener(app, config);

  const executeClose = async (): Promise<void> => {
    removeSignalHandlers();
    state = 'closing';

    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        app.close(),
        new Promise<void>((_, reject) => {
          timer = setTimeout(() => {
            reject(new Error(`API server graceful shutdown timed out after ${timeoutMs}ms`));
          }, timeoutMs);
        }),
      ]);
      state = 'closed';
    } catch (err) {
      state = 'closed';
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error(`API server shutdown failure: ${message}`);
      invokeTerminate(1);
      throw err;
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  };

  const close = (): Promise<void> => {
    if (state === 'closed') {
      return Promise.resolve();
    }
    if (closePromise) {
      return closePromise;
    }
    if (state === 'starting') {
      closeRequestedDuringStartup = true;
      state = 'closing';
      removeSignalHandlers();

      closePromise = (async () => {
        let shutdownTimer: NodeJS.Timeout | undefined;
        const shutdownTimeoutPromise = new Promise<never>((_, reject) => {
          shutdownTimer = setTimeout(() => {
            reject(new Error(`API server graceful shutdown timed out after ${timeoutMs}ms`));
          }, timeoutMs);
        });

        try {
          // Bounded wait for startupPromise so hung startup listener cannot block shutdown indefinitely
          await Promise.race([startupPromise, shutdownTimeoutPromise]);
        } catch (err) {
          state = 'closed';
          removeSignalHandlers();
          const message = err instanceof Error ? err.message : 'Unknown error';
          console.error(`API server shutdown failure: ${message}`);
          invokeTerminate(1);
          const errorObj = err instanceof Error ? err : new Error(message);
          rejectStartup?.(errorObj);
          throw errorObj;
        } finally {
          if (shutdownTimer) {
            clearTimeout(shutdownTimer);
          }
        }

        // If startup completed within deadline, proceed to close the server
        await executeClose();
      })();

      return closePromise;
    }

    closePromise = executeClose();
    return closePromise;
  };

  try {
    await Promise.race([startupPromise, startupAbortPromise]);
    state = 'running';
  } catch (err) {
    removeSignalHandlers();
    state = 'closed';
    throw err;
  }

  if (closeRequestedDuringStartup) {
    await close();
  }

  return {
    app,
    config,
    close,
  };
}
