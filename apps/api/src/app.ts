import Fastify, { type FastifyInstance } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyRateLimit from '@fastify/rate-limit';
import {
  DEFAULT_AUTH_SESSION_ABSOLUTE_TTL_SECONDS,
  DEFAULT_AUTH_SESSION_IDLE_TTL_SECONDS,
  DEFAULT_AUTH_SESSION_ROTATION_GRACE_SECONDS,
  DEFAULT_AUTH_SESSION_ROTATION_SECONDS,
  DEFAULT_AUTH_SESSION_TOUCH_INTERVAL_SECONDS,
  DEFAULT_AUTH_TRANSACTION_TTL_SECONDS,
  type AppConfig,
  type AuthConfig,
} from '@affiliate-content-os/config';
import { createAuthRoutes, type AuthDependencies } from './auth/index.js';
import { createWorkspaceRoutes, type WorkspaceRouteDependencies } from './workspaces/index.js';

export interface CreateAppOptions {
  readonly config?: AppConfig | undefined;
  readonly auth?: AuthDependencies | undefined;
  readonly workspaces?: WorkspaceRouteDependencies | undefined;
}

const defaultDisabledAuthConfig: AuthConfig = Object.freeze({
  enabled: false,
  issuer: null,
  clientId: null,
  clientSecret: null,
  redirectUri: null,
  transactionEncryptionKeyBase64Url: null,
  transactionKeyVersion: null,
  transactionTtlSeconds: DEFAULT_AUTH_TRANSACTION_TTL_SECONDS,
  sessionIdleTtlSeconds: DEFAULT_AUTH_SESSION_IDLE_TTL_SECONDS,
  sessionAbsoluteTtlSeconds: DEFAULT_AUTH_SESSION_ABSOLUTE_TTL_SECONDS,
  sessionRotationSeconds: DEFAULT_AUTH_SESSION_ROTATION_SECONDS,
  sessionRotationGraceSeconds: DEFAULT_AUTH_SESSION_ROTATION_GRACE_SECONDS,
  sessionTouchIntervalSeconds: DEFAULT_AUTH_SESSION_TOUCH_INTERVAL_SECONDS,
  cookieSecure: false,
});

/**
 * Creates and configures an import-safe Fastify application instance.
 * Does not start listening, read global process.env, or install signal handlers.
 */
export function createApp(options?: CreateAppOptions): FastifyInstance {
  const app = Fastify({
    logger: false,
    ajv: {
      customOptions: {
        removeAdditional: false,
      },
    },
  });

  void app.register(fastifyCookie);
  void app.register(fastifyRateLimit, { global: false });

  app.get('/health/live', async (_request, reply) => {
    return reply.status(200).type('application/json').send({
      status: 'ok',
      service: 'api',
    });
  });

  const authDeps: AuthDependencies = options?.auth ?? {
    config: defaultDisabledAuthConfig,
    appBaseUrl: options?.config?.appBaseUrl,
  };
  void app.register(createAuthRoutes(authDeps));

  if (options?.workspaces) {
    void app.register(createWorkspaceRoutes(options.workspaces));
  }

  return app;
}
