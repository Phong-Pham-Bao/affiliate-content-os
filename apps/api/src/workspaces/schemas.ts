import { problemDetailsJsonSchema } from '../auth/schemas.js';

export const workspaceResourceSchema = {
  type: 'object',
  required: [
    'id',
    'name',
    'slug',
    'timezone',
    'brandVoice',
    'defaultDisclosure',
    'aiEnabled',
    'status',
    'role',
    'createdAt',
    'updatedAt',
    'version',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    name: { type: 'string' },
    slug: { type: 'string' },
    timezone: { type: 'string' },
    brandVoice: { type: ['string', 'null'] },
    defaultDisclosure: { type: ['string', 'null'] },
    aiEnabled: { type: 'boolean' },
    status: { type: 'string', enum: ['active', 'suspended', 'deletion_pending'] },
    role: { type: 'string', enum: ['owner', 'editor', 'viewer'] },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
    version: { type: 'integer' },
  },
  additionalProperties: false,
} as const;

export const createWorkspaceRouteSchema = {
  tags: ['Workspaces'],
  summary: 'Create a new workspace',
  description:
    'Creates a new workspace and owner membership for the authenticated user. Commits workspace, owner membership, idempotency record, and allowlisted audit event atomically.',
  headers: {
    type: 'object',
    required: ['idempotency-key', 'origin'],
    properties: {
      'idempotency-key': {
        type: 'string',
        pattern: '^[!-~]{1,128}$',
      },
      origin: {
        type: 'string',
        minLength: 1,
        maxLength: 2048,
      },
    },
  },
  body: {
    type: 'object',
    required: ['name', 'slug', 'timezone'],
    additionalProperties: false,
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 100 },
      slug: {
        type: 'string',
        minLength: 2,
        maxLength: 64,
      },
      timezone: { type: 'string', minLength: 1, maxLength: 64 },
      brandVoice: { type: ['string', 'null'], maxLength: 2000 },
      defaultDisclosure: { type: ['string', 'null'], maxLength: 2000 },
      aiEnabled: { type: 'boolean' },
    },
  },
  response: {
    201: {
      description: 'Workspace created successfully with owner membership.',
      ...workspaceResourceSchema,
    },
    400: {
      description: 'Invalid input or malformed idempotency key.',
      ...problemDetailsJsonSchema,
    },
    401: {
      description: 'Authentication session required.',
      ...problemDetailsJsonSchema,
    },
    403: {
      description: 'Request origin is invalid or untrusted.',
      ...problemDetailsJsonSchema,
    },
    409: {
      description: 'Workspace slug or idempotency key conflict.',
      ...problemDetailsJsonSchema,
    },
    429: {
      description: 'Rate limit exceeded.',
      ...problemDetailsJsonSchema,
    },
  },
} as const;

export const getWorkspaceRouteSchema = {
  tags: ['Workspaces'],
  summary: 'Get workspace settings and caller role',
  description:
    'Returns workspace settings and the authenticated caller role. Requires caller to have an active membership with workspace.read capability.',
  params: {
    type: 'object',
    required: ['workspaceId'],
    additionalProperties: false,
    properties: {
      workspaceId: { type: 'string', format: 'uuid' },
    },
  },
  response: {
    200: {
      description: 'Workspace settings and caller role.',
      ...workspaceResourceSchema,
    },
    400: {
      description: 'Malformed workspace ID parameter.',
      ...problemDetailsJsonSchema,
    },
    401: {
      description: 'Authentication session required.',
      ...problemDetailsJsonSchema,
    },
    404: {
      description: 'Workspace not found or caller lacks access.',
      ...problemDetailsJsonSchema,
    },
  },
} as const;
