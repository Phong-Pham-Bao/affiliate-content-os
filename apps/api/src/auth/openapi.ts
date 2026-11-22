import { buildOpenApiPaths } from './openapi-paths.js';
import { problemDetailsJsonSchema } from './schemas.js';
import { buildOpenApiPublicationComponents } from '../publication/openapi.js';

export function buildOpenApiDocument(): Record<string, unknown> {
  const publicationComponents = buildOpenApiPublicationComponents();
  return {
    openapi: '3.1.0',
    info: {
      title: 'Affiliate Content OS - Application API',
      version: '1.0.0',
      description: 'Managed OIDC authentication and opaque PostgreSQL-backed application sessions.',
    },
    servers: [
      {
        url: 'http://127.0.0.1:3001',
        description: 'Local development server',
      },
    ],
    paths: buildOpenApiPaths(),
    components: {
      schemas: {
        ProblemDetails: problemDetailsJsonSchema,
        ...publicationComponents.schemas,
      },
    },
  };
}
