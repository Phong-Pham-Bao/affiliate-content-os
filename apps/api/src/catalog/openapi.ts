import { buildOpenApiAffiliatePaths } from './openapi-affiliate-paths.js';
import { buildOpenApiFactPaths } from './openapi-fact-paths.js';
import { buildOpenApiProductPaths } from './openapi-product-paths.js';

export function buildOpenApiCatalogPaths(): Record<string, unknown> {
  return {
    ...buildOpenApiProductPaths(),
    ...buildOpenApiFactPaths(),
    ...buildOpenApiAffiliatePaths(),
  };
}
