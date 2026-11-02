import { callbackRouteSchema, loginRouteSchema } from './schemas.js';

export const commonHeaders = {
  'Cache-Control': {
    schema: { type: 'string', example: 'no-store' },
    description: 'Disables caching for sensitive authentication responses.',
  },
  Pragma: {
    schema: { type: 'string', example: 'no-cache' },
    description: 'Legacy HTTP 1.0 cache prevention.',
  },
  'Referrer-Policy': {
    schema: { type: 'string', example: 'no-referrer' },
    description: 'Prevents token leakage in Referer headers.',
  },
} as const;

export const problemDetailsContent = {
  'application/problem+json': {
    schema: {
      $ref: '#/components/schemas/ProblemDetails',
    },
  },
} as const;

export function buildOpenApiAuthPaths(): Record<string, unknown> {
  return {
    '/auth/login': {
      get: {
        tags: loginRouteSchema.tags,
        summary: loginRouteSchema.summary,
        description: loginRouteSchema.description,
        parameters: [
          {
            name: 'returnTo',
            in: 'query',
            required: false,
            description: 'Relative application redirect path to navigate after login.',
            schema: { type: 'string', maxLength: 2048 },
          },
        ],
        responses: {
          '302': {
            description: 'Redirects to identity provider authorization URL.',
            headers: {
              Location: {
                schema: { type: 'string', format: 'uri' },
                description: 'Identity provider authorization URL.',
              },
              'Set-Cookie': {
                schema: { type: 'string' },
                description: 'One-time transaction cookie acos_oidc_transaction.',
              },
              ...commonHeaders,
            },
          },
          '400': {
            description: 'Invalid returnTo parameter.',
            headers: commonHeaders,
            content: problemDetailsContent,
          },
          '503': {
            description: 'Authentication disabled or provider discovery unavailable.',
            headers: commonHeaders,
            content: problemDetailsContent,
          },
        },
      },
    },
    '/auth/callback': {
      get: {
        tags: callbackRouteSchema.tags,
        summary: callbackRouteSchema.summary,
        description: callbackRouteSchema.description,
        parameters: [
          {
            name: 'code',
            in: 'query',
            required: false,
            schema: { type: 'string', maxLength: 4096 },
            description: 'Authorization code returned by provider.',
          },
          {
            name: 'state',
            in: 'query',
            required: false,
            schema: { type: 'string', maxLength: 4096 },
            description: 'Opaque transaction state returned by provider.',
          },
          {
            name: 'error',
            in: 'query',
            required: false,
            schema: { type: 'string', maxLength: 256 },
            description: 'Provider error code if user or provider denied access.',
          },
          {
            name: 'error_description',
            in: 'query',
            required: false,
            schema: { type: 'string', maxLength: 1024 },
            description: 'Human-readable provider error description.',
          },
          {
            name: 'error_uri',
            in: 'query',
            required: false,
            schema: { type: 'string', maxLength: 1024 },
            description: 'URI identifying provider error page.',
          },
          {
            name: 'acos_oidc_transaction',
            in: 'cookie',
            required: true,
            schema: { type: 'string' },
            description: 'One-time browser-binding transaction secret.',
          },
        ],
        responses: {
          '303': {
            description:
              'Redirects to validated application returnTo path with active session cookie.',
            headers: {
              Location: {
                schema: { type: 'string', format: 'uri' },
                description: 'Target application redirect URL.',
              },
              'Set-Cookie': {
                schema: { type: 'string' },
                description: 'Sets acos_session and clears acos_oidc_transaction.',
              },
              ...commonHeaders,
            },
          },
          '400': {
            description: 'Invalid or replayed callback parameters or state mismatch.',
            headers: commonHeaders,
            content: problemDetailsContent,
          },
          '401': {
            description: 'Authenticated identity is disabled or unavailable.',
            headers: commonHeaders,
            content: problemDetailsContent,
          },
          '503': {
            description: 'Identity provider network or token exchange failure.',
            headers: commonHeaders,
            content: problemDetailsContent,
          },
        },
      },
    },
  };
}
