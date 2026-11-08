import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '@affiliate-content-os/config';
import type { Database } from '@affiliate-content-os/infrastructure/database';
import { createApp } from './app.js';
import type { AuthDependencies } from './auth/index.js';
import type { WorkspaceRouteDependencies } from './workspaces/index.js';
import type { CatalogRouteDependencies } from './catalog/index.js';
import type { AnalysisRouteDependencies } from './analysis/index.js';
import type { WorkforceRouteDependencies } from './workforce/index.js';
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
  readonly database: Database;
  readonly auth?:
    AuthDependencies | ((signal: AbortSignal) => Promise<AuthDependencies>) | undefined;
  readonly workspaces?:
    | WorkspaceRouteDependencies
    | ((signal: AbortSignal) => Promise<WorkspaceRouteDependencies>)
    | undefined;
  readonly catalog?:
    | CatalogRouteDependencies
    | ((signal: AbortSignal) => Promise<CatalogRouteDependencies>)
    | undefined;
  readonly analysis?:
    | AnalysisRouteDependencies
    | ((signal: AbortSignal) => Promise<AnalysisRouteDependencies>)
    | undefined;
  readonly workforce?:
    | WorkforceRouteDependencies
    | ((signal: AbortSignal) => Promise<WorkforceRouteDependencies>)
    | undefined;
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
  const { config, database } = options;
  const timeoutMs = options.shutdownTimeoutMs ?? 5000;
  const terminate = options.terminate ?? ((exitCode: number): void => process.exit(exitCode));
  const getNow = options.now ?? (() => performance.now());
  const timerOptions: TimeoutOptions = {
    setTimer: options.setTimer,
    clearTimer: options.clearTimer,
  };

  let app =
    options.app ??
    (typeof options.auth !== 'function' &&
    typeof options.workspaces !== 'function' &&
    typeof options.catalog !== 'function' &&
    typeof options.analysis !== 'function' &&
    typeof options.workforce !== 'function'
      ? createApp({
          config,
          auth: options.auth,
          workspaces: options.workspaces,
          catalog: options.catalog,
          analysis: options.analysis,
          workforce: options.workforce,
        })
      : undefined);

  type ServerState = 'starting' | 'running' | 'closing' | 'closed';
  let state: ServerState = 'starting';
  let closePromise: Promise<void> | undefined;
  let terminated = false;
  let signalHandlersInstalled = false;
  let absoluteDeadline: number | undefined;
  let abortedBySignal = false;

  let probePromise: Promise<void> | undefined;
  let probeSettled = false;
  let listenerPromise: Promise<void> | undefined;
  let listenerSettled = false;

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
    abortedBySignal = true;
    startupAbortController.abort();
    void close()
      .then(() => {
        invokeTerminate(0);
      })
      .catch(() => {
        invokeTerminate(1);
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
    if (signal?.aborted) {
      await fastifyApp.close().catch(() => {});
      throw new Error('API server listener aborted after listen');
    }
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
      // 1. Wait for in-flight startup probe to settle within deadline budget if still pending
      if (probePromise && !probeSettled) {
        await raceWithDeadline(
          probePromise.catch(() => {}),
          getRemainingMs(),
          `API server graceful shutdown timed out after ${timeoutMs}ms while waiting for probe settlement`,
          timerOptions,
        );
      }

      // 2. Wait for in-flight startup listener to settle within deadline budget if still pending
      if (listenerPromise && !listenerSettled) {
        await raceWithDeadline(
          listenerPromise.catch(() => {}),
          getRemainingMs(),
          `API server graceful shutdown timed out after ${timeoutMs}ms while waiting for listener settlement`,
          timerOptions,
        );
      }

      // 3. Close Fastify listener if started
      if (app) {
        await raceWithDeadline(
          app.close(),
          getRemainingMs(),
          `API server graceful shutdown timed out after ${timeoutMs}ms while closing HTTP listener`,
          timerOptions,
        );
      }

      // 4. Close Database pool within the remaining total budget
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

  const startupAbortPromise = new Promise<never>((_, reject) => {
    if (startupAbortController.signal.aborted) {
      reject(new Error('API server startup aborted'));
      return;
    }
    startupAbortController.signal.addEventListener(
      'abort',
      () => reject(new Error('API server startup aborted')),
      { once: true },
    );
  });

  try {
    // Phase 0: Resolve auth, workspace, and catalog dependencies if factories were provided
    if (
      typeof options.auth === 'function' ||
      typeof options.workspaces === 'function' ||
      typeof options.catalog === 'function' ||
      typeof options.analysis === 'function' ||
      typeof options.workforce === 'function'
    ) {
      if (startupAbortController.signal.aborted) {
        throw new Error('API server startup aborted before dependency resolution');
      }
      let authDeps = typeof options.auth !== 'function' ? options.auth : undefined;
      let workspaceDeps = typeof options.workspaces !== 'function' ? options.workspaces : undefined;
      let catalogDeps = typeof options.catalog !== 'function' ? options.catalog : undefined;
      let analysisDeps = typeof options.analysis !== 'function' ? options.analysis : undefined;
      let workforceDeps = typeof options.workforce !== 'function' ? options.workforce : undefined;

      if (typeof options.auth === 'function') {
        const authPromise = options.auth(startupAbortController.signal);
        authDeps = await Promise.race([authPromise, startupAbortPromise]);
      }
      if (typeof options.workspaces === 'function') {
        const wsPromise = options.workspaces(startupAbortController.signal);
        workspaceDeps = await Promise.race([wsPromise, startupAbortPromise]);
      }
      if (typeof options.catalog === 'function') {
        const catPromise = options.catalog(startupAbortController.signal);
        catalogDeps = await Promise.race([catPromise, startupAbortPromise]);
      }
      if (typeof options.analysis === 'function') {
        const analysisPromise = options.analysis(startupAbortController.signal);
        analysisDeps = await Promise.race([analysisPromise, startupAbortPromise]);
      }
      if (typeof options.workforce === 'function') {
        const workforcePromise = options.workforce(startupAbortController.signal);
        workforceDeps = await Promise.race([workforcePromise, startupAbortPromise]);
      }
      app = createApp({
        config,
        auth: authDeps,
        workspaces: workspaceDeps,
        catalog: catalogDeps,
        analysis: analysisDeps,
        workforce: workforceDeps,
      });
    }

    // Phase 1: Probe Database connection before listening
    if (startupAbortController.signal.aborted) {
      throw new Error('API server startup aborted before database probe');
    }
    probePromise = database.probe(startupAbortController.signal).finally(() => {
      probeSettled = true;
    });
    await Promise.race([probePromise, startupAbortPromise]);

    // Phase 2: Start Fastify HTTP listener
    if (startupAbortController.signal.aborted) {
      throw new Error('API server startup aborted before listener bound');
    }
    listenerPromise = listener(app!, config, startupAbortController.signal).finally(() => {
      listenerSettled = true;
    });
    await Promise.race([listenerPromise, startupAbortPromise]);

    if (startupAbortController.signal.aborted) {
      throw new Error('API server startup aborted after listener bound');
    }
    state = 'running';
  } catch (startupErr) {
    removeSignalHandlers();

    let cleanupTimedOut = false;
    let cleanupError: unknown;
    try {
      await close();
    } catch (err) {
      cleanupTimedOut = true;
      cleanupError = err;
    }

    if (cleanupTimedOut) {
      invokeTerminate(1);
      throw cleanupError ?? startupErr;
    }

    if (abortedBySignal) {
      invokeTerminate(0);
      throw startupErr;
    }

    const message = startupErr instanceof Error ? startupErr.message : 'API server startup failure';
    console.error(`API server startup failure: ${message}`);
    invokeTerminate(1);
    throw startupErr;
  }

  return {
    app: app!,
    config,
    database,
    close,
  };
}
