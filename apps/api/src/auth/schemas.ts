export const problemDetailsJsonSchema = {
  type: 'object',
  required: ['type', 'title', 'status', 'code', 'detail', 'instance', 'requestId'],
  properties: {
    type: { type: 'string', format: 'uri' },
    title: { type: 'string' },
    status: { type: 'integer' },
    code: { type: 'string' },
    detail: { type: 'string' },
    instance: { type: 'string' },
    requestId: { type: 'string' },
    retryAfterSeconds: { type: 'integer' },
  },
  additionalProperties: false,
} as const;

export const loginRouteSchema = {
  tags: ['Authentication'],
  summary: 'Begin OIDC authorization-code flow',
  description:
    'Generates state, nonce, PKCE S256 parameters, creates a one-time login transaction, sets the transaction cookie, and redirects to the identity provider authorization URL.',
  querystring: {
    type: 'object',
    properties: {
      returnTo: {
        type: 'string',
        maxLength: 2048,
        description: 'Relative application redirect path to navigate after successful login.',
      },
    },
    additionalProperties: false,
  },
  response: {
    302: {
      description: 'Redirects to identity provider authorization URL.',
      type: 'null',
    },
    400: {
      description: 'Invalid returnTo parameter.',
      ...problemDetailsJsonSchema,
    },
    503: {
      description: 'Authentication disabled or provider discovery unavailable.',
      ...problemDetailsJsonSchema,
    },
  },
} as const;

export const callbackRouteSchema = {
  tags: ['Authentication'],
  summary: 'Complete OIDC authorization-code flow callback',
  description:
    'Validates callback parameters against the one-time transaction cookie, exchanges authorization code, verifies ID token, resolves or provisions the principal, creates an opaque session, and redirects to the validated returnTo path.',
  querystring: {
    type: 'object',
    properties: {
      code: { type: 'string', maxLength: 4096 },
      state: { type: 'string', maxLength: 4096 },
      error: { type: 'string', maxLength: 256 },
      error_description: { type: 'string', maxLength: 1024 },
      error_uri: { type: 'string', maxLength: 1024 },
    },
    additionalProperties: false,
  },
  response: {
    303: {
      description: 'Redirects to validated application returnTo path with active session cookie.',
      type: 'null',
    },
    400: {
      description: 'Invalid or replayed callback parameters or state mismatch.',
      ...problemDetailsJsonSchema,
    },
    401: {
      description: 'Authenticated identity is disabled or unavailable.',
      ...problemDetailsJsonSchema,
    },
    503: {
      description: 'Identity provider network or token exchange failure.',
      ...problemDetailsJsonSchema,
    },
  },
} as const;

export const meRouteSchema = {
  tags: ['Authentication'],
  summary: 'Get authenticated user, session, and workspace access summary',
  description:
    'Authenticates the opaque session cookie, sliding idle expiry and rotating token when due, and returns current user details and accessible active workspaces.',
  response: {
    200: {
      description: 'Current user, active session, and accessible workspaces.',
      type: 'object',
      required: ['user', 'session', 'workspaceAccess'],
      properties: {
        user: {
          type: 'object',
          required: ['id', 'email', 'displayName'],
          properties: {
            id: { type: 'string', format: 'uuid' },
            email: { type: ['string', 'null'] },
            displayName: { type: ['string', 'null'] },
          },
          additionalProperties: false,
        },
        session: {
          type: 'object',
          required: ['idleExpiresAt', 'absoluteExpiresAt'],
          properties: {
            idleExpiresAt: { type: 'string', format: 'date-time' },
            absoluteExpiresAt: { type: 'string', format: 'date-time' },
          },
          additionalProperties: false,
        },
        workspaceAccess: {
          type: 'object',
          required: ['items', 'hasMore'],
          properties: {
            items: {
              type: 'array',
              items: {
                type: 'object',
                required: ['id', 'name', 'slug', 'timezone', 'role'],
                properties: {
                  id: { type: 'string', format: 'uuid' },
                  name: { type: 'string' },
                  slug: { type: 'string' },
                  timezone: { type: 'string' },
                  role: { type: 'string', enum: ['owner', 'admin', 'member'] },
                },
                additionalProperties: false,
              },
            },
            hasMore: { type: 'boolean' },
          },
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    },
    401: {
      description: 'Session cookie missing, invalid, expired, or revoked.',
      ...problemDetailsJsonSchema,
    },
    503: {
      description: 'Authentication disabled.',
      ...problemDetailsJsonSchema,
    },
  },
} as const;

export const logoutRouteSchema = {
  tags: ['Authentication'],
  summary: 'Revoke active application session',
  description:
    'Validates request Origin, revokes the matching application session in PostgreSQL, scrubs hashes, and clears the session cookie.',
  response: {
    204: {
      description: 'Session revoked successfully.',
      type: 'null',
    },
    400: {
      description: 'Unexpected request body or query parameters.',
      ...problemDetailsJsonSchema,
    },
    403: {
      description: 'Request origin is invalid or untrusted.',
      ...problemDetailsJsonSchema,
    },
    503: {
      description: 'Authentication disabled.',
      ...problemDetailsJsonSchema,
    },
  },
} as const;
