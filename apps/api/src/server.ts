import type { FastifyInstance } from 'fastify';
import { loadConfig, type AppConfig, type RawEnvironment } from '@affiliate-content-os/config';
import { createApp } from './app.js';

export interface ApiServerHandle {
  readonly app: FastifyInstance;
  readonly config: AppConfig;
  readonly close: () => Promise<void>;
}

export interface StartServerOptions {
  readonly rawEnv?: RawEnvironment;
  readonly app?: FastifyInstance;
  readonly installSignalHandlers?: boolean;
}

/**
 * Starts the API HTTP server with validated configuration and bounded signal handling.
 */
export async function startApiServer(options?: StartServerOptions): Promise<ApiServerHandle> {
  const config = loadConfig(options?.rawEnv ?? process.env);
  const app = options?.app ?? createApp({ config });

  let isClosing = false;
  let closePromise: Promise<void> | undefined;

  const close = async (): Promise<void> => {
    if (closePromise) {
      return closePromise;
    }

    isClosing = true;

    // Remove installed signal handlers
    if (options?.installSignalHandlers !== false) {
      process.removeListener('SIGINT', handleSigint);
      process.removeListener('SIGTERM', handleSigterm);
    }

    closePromise = (async () => {
      try {
        await app.close();
      } catch {
        // Bounded idempotent close fallback
      }
    })();

    return closePromise;
  };

  const handleSignal = (_signal: 'SIGINT' | 'SIGTERM'): void => {
    if (isClosing) {
      return;
    }
    void close();
  };

  const handleSigint = (): void => handleSignal('SIGINT');
  const handleSigterm = (): void => handleSignal('SIGTERM');

  if (options?.installSignalHandlers !== false) {
    process.on('SIGINT', handleSigint);
    process.on('SIGTERM', handleSigterm);
  }

  try {
    await app.listen({
      host: config.apiHost,
      port: config.apiPort,
    });
  } catch (err) {
    if (options?.installSignalHandlers !== false) {
      process.removeListener('SIGINT', handleSigint);
      process.removeListener('SIGTERM', handleSigterm);
    }
    throw err;
  }

  return {
    app,
    config,
    close,
  };
}
