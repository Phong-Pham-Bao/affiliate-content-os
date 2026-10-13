import Fastify, { type FastifyInstance } from 'fastify';
import type { AppConfig } from '@affiliate-content-os/config';

export interface CreateAppOptions {
  readonly config?: AppConfig;
}

/**
 * Creates and configures an import-safe Fastify application instance.
 * Does not start listening, read global process.env, or install signal handlers.
 */
export function createApp(_options?: CreateAppOptions): FastifyInstance {
  const app = Fastify({
    logger: false,
  });

  app.get('/health/live', async (_request, reply) => {
    return reply.status(200).type('application/json').send({
      status: 'ok',
      service: 'api',
    });
  });

  return app;
}
