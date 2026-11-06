import { buildOpenApiAuthPaths } from './openapi-auth-paths.js';
import { buildOpenApiApiPaths } from './openapi-api-paths.js';
import { buildOpenApiWorkspacePaths } from '../workspaces/openapi.js';
import { buildOpenApiCatalogPaths } from '../catalog/openapi.js';

export { commonHeaders, problemDetailsContent } from './openapi-auth-paths.js';

export function buildOpenApiPaths(): Record<string, unknown> {
  return {
    ...buildOpenApiAuthPaths(),
    ...buildOpenApiApiPaths(),
    ...buildOpenApiWorkspacePaths(),
    ...buildOpenApiCatalogPaths(),
  };
}
