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

  const removeSignalHandlers = (): void => {
    if (options.installSignalHandlers !== false) {
      process.removeListener('SIGINT', handleSigint);
      process.removeListener('SIGTERM', handleSigterm);
    }
  };

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
      terminate(1);
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
      closePromise = (async () => {
        try {
          await startupPromise;
        } catch {
          removeSignalHandlers();
          state = 'closed';
          return;
        }
        await executeClose();
      })();
      return closePromise;
    }

    closePromise = executeClose();
    return closePromise;
  };

  const handleSignal = (): void => {
    void close()
      .then(() => {
        terminate(0);
      })
      .catch(() => {
        // executeClose already logged failure and invoked terminate(1)
      });
  };

  const handleSigint = (): void => handleSignal();
  const handleSigterm = (): void => handleSignal();

  if (options.installSignalHandlers !== false) {
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
  const startupPromise = listener(app, config);

  try {
    await startupPromise;
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
