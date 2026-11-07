export const sessionCookieParam = {
  name: 'acos_session',
  in: 'cookie',
  required: true,
  schema: { type: 'string' },
  description: 'Opaque application session token.',
} as const;

export const workspaceIdParam = {
  name: 'workspaceId',
  in: 'path',
  required: true,
  schema: { type: 'string', format: 'uuid' },
  description: 'Unique identifier of the workspace.',
} as const;

export const productIdParam = {
  name: 'productId',
  in: 'path',
  required: true,
  schema: { type: 'string', format: 'uuid' },
  description: 'Unique identifier of the product.',
} as const;

export const analysisIdParam = {
  name: 'analysisId',
  in: 'path',
  required: true,
  schema: { type: 'string', format: 'uuid' },
  description: 'Unique identifier of the analysis.',
} as const;

export const operationIdParam = {
  name: 'operationId',
  in: 'path',
  required: true,
  schema: { type: 'string', format: 'uuid' },
  description: 'Unique identifier of the asynchronous operation.',
} as const;

export const originHeaderParam = {
  name: 'Origin',
  in: 'header',
  required: true,
  schema: { type: 'string', minLength: 1, maxLength: 2048 },
  description: 'Request origin validated against application base URL.',
} as const;

export const idempotencyHeaderParam = {
  name: 'Idempotency-Key',
  in: 'header',
  required: true,
  schema: { type: 'string', pattern: '^[!-~]{1,128}$' },
  description: 'Mandatory idempotency key for safe duplicate prevention.',
} as const;

export const ifMatchHeaderParam = {
  name: 'If-Match',
  in: 'header',
  required: false,
  schema: { type: 'string', pattern: '^"?[1-9][0-9]*"?$' },
  description: 'Optimistic concurrency version. Required unless expectedVersion is in the body.',
} as const;
