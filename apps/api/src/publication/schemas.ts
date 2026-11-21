import type { FastifySchema } from 'fastify';
import { problemDetailsJsonSchema } from '../auth/schemas.js';

export const uuidPattern =
  '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
export const sha256HexPattern = '^[0-9a-fA-F]{64}$';
export const idempotencyKeyPattern = '^[!-~]{1,128}$';

export const publicationApprovalSnapshotSchema = {
  type: 'object',
  required: [
    'id',
    'workspaceId',
    'contentApprovalId',
    'contentApprovalSnapshotHashHex',
    'artifactId',
    'revisionNumber',
    'contentHashHex',
    'platform',
    'socialAccountId',
    'providerAccountId',
    'accountVersion',
    'capabilityFingerprintHex',
    'capabilitiesSnapshot',
    'capabilitiesCheckedAt',
    'renderedText',
    'previewHashHex',
    'disclosureState',
    'platformSettings',
    'approvedByUserId',
    'consentType',
    'policyVersion',
    'policyHashHex',
    'snapshotJson',
    'snapshotHashHex',
    'createdAt',
  ],
  properties: {
    id: { type: 'string', pattern: uuidPattern },
    workspaceId: { type: 'string', pattern: uuidPattern },
    contentApprovalId: { type: 'string', pattern: uuidPattern },
    contentApprovalSnapshotHashHex: { type: 'string', pattern: sha256HexPattern },
    artifactId: { type: 'string', pattern: uuidPattern },
    revisionNumber: { type: 'integer', minimum: 1 },
    contentHashHex: { type: 'string', pattern: sha256HexPattern },
    platform: { type: 'string', enum: ['threads', 'tiktok'] },
    socialAccountId: { type: 'string', pattern: uuidPattern },
    providerAccountId: { type: 'string', minLength: 1, maxLength: 256 },
    accountVersion: { type: 'integer', minimum: 1 },
    capabilityFingerprintHex: { type: 'string', pattern: sha256HexPattern },
    capabilitiesSnapshot: {
      type: 'object',
      additionalProperties: { type: 'boolean' },
    },
    capabilitiesCheckedAt: { type: 'string', format: 'date-time' },
    renderedText: { type: 'string', minLength: 1, maxLength: 500 },
    previewHashHex: { type: 'string', pattern: sha256HexPattern },
    disclosureState: {
      type: 'object',
      additionalProperties: true,
    },
    platformSettings: {
      type: 'object',
      additionalProperties: true,
    },
    approvedByUserId: { type: 'string', pattern: uuidPattern },
    consentType: { type: 'string', enum: ['human_publisher'] },
    policyVersion: { type: 'string', minLength: 1, maxLength: 64 },
    policyHashHex: { type: 'string', pattern: sha256HexPattern },
    snapshotJson: {
      type: 'object',
      additionalProperties: true,
    },
    snapshotHashHex: { type: 'string', pattern: sha256HexPattern },
    createdAt: { type: 'string', format: 'date-time' },
  },
  additionalProperties: false,
} as const;

export const publicationSchema = {
  type: 'object',
  required: [
    'id',
    'workspaceId',
    'approvalSnapshotId',
    'socialAccountId',
    'platform',
    'status',
    'scheduledAtUtc',
    'originalLocalTime',
    'timezone',
    'currentAttemptNumber',
    'maxAttempts',
    'nextAttemptAt',
    'remotePostId',
    'remotePermalink',
    'publishedAt',
    'lastErrorCode',
    'lastErrorMessage',
    'gatedReason',
    'completedAt',
    'createdByUserId',
    'createdAt',
    'updatedAt',
    'version',
  ],
  properties: {
    id: { type: 'string', pattern: uuidPattern },
    workspaceId: { type: 'string', pattern: uuidPattern },
    approvalSnapshotId: { type: 'string', pattern: uuidPattern },
    socialAccountId: { type: 'string', pattern: uuidPattern },
    platform: { type: 'string', enum: ['threads', 'tiktok'] },
    status: {
      type: 'string',
      enum: [
        'scheduled',
        'queued',
        'publishing',
        'processing_remote',
        'published',
        'retry_wait',
        'outcome_unknown',
        'failed',
        'rejected',
        'canceled',
      ],
    },
    scheduledAtUtc: { type: 'string', format: 'date-time' },
    originalLocalTime: {
      type: 'string',
      pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{3})?$',
    },
    timezone: { type: 'string', minLength: 1, maxLength: 64 },
    currentAttemptNumber: { type: 'integer', minimum: 0, maximum: 20 },
    maxAttempts: { type: 'integer', minimum: 1, maximum: 20 },
    nextAttemptAt: { type: 'string', format: 'date-time' },
    remotePostId: { type: ['string', 'null'], maxLength: 256 },
    remotePermalink: { type: ['string', 'null'], maxLength: 2048 },
    publishedAt: { type: ['string', 'null'], format: 'date-time' },
    lastErrorCode: { type: ['string', 'null'], maxLength: 64 },
    lastErrorMessage: { type: ['string', 'null'], maxLength: 2000 },
    gatedReason: { type: ['string', 'null'], maxLength: 2000 },
    completedAt: { type: ['string', 'null'], format: 'date-time' },
    createdByUserId: { type: 'string', pattern: uuidPattern },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
    version: { type: 'integer', minimum: 1 },
  },
  additionalProperties: false,
} as const;

export const publicationAttemptSummarySchema = {
  type: 'object',
  required: [
    'attemptNumber',
    'status',
    'phase',
    'startedAt',
    'completedAt',
    'outcomeCode',
    'outcomeMessage',
    'remotePostId',
  ],
  properties: {
    attemptNumber: { type: 'integer', minimum: 1, maximum: 20 },
    status: {
      type: 'string',
      enum: ['running', 'succeeded', 'transient_failure', 'permanent_failure', 'outcome_unknown'],
    },
    phase: {
      type: 'string',
      enum: ['prepared', 'provider_attempt_started', 'terminal'],
    },
    startedAt: { type: 'string', format: 'date-time' },
    completedAt: { type: ['string', 'null'], format: 'date-time' },
    outcomeCode: { type: ['string', 'null'], maxLength: 64 },
    outcomeMessage: { type: ['string', 'null'], maxLength: 2000 },
    remotePostId: { type: ['string', 'null'], maxLength: 256 },
  },
  additionalProperties: false,
} as const;

export const publicationDetailSchema = {
  type: 'object',
  required: ['publication', 'destination', 'approval', 'attempts'],
  properties: {
    publication: publicationSchema,
    destination: {
      type: 'object',
      required: ['platform', 'displayName', 'handle'],
      properties: {
        platform: { type: 'string', enum: ['threads', 'tiktok'] },
        displayName: { type: 'string', minLength: 1, maxLength: 256 },
        handle: { type: ['string', 'null'], maxLength: 256 },
      },
      additionalProperties: false,
    },
    approval: {
      type: 'object',
      required: ['renderedText', 'previewHashHex', 'approvedAt', 'approvedByUserId'],
      properties: {
        renderedText: { type: 'string', minLength: 1, maxLength: 500 },
        previewHashHex: { type: 'string', pattern: sha256HexPattern },
        approvedAt: { type: 'string', format: 'date-time' },
        approvedByUserId: { type: 'string', pattern: uuidPattern },
      },
      additionalProperties: false,
    },
    attempts: {
      type: 'array',
      items: publicationAttemptSummarySchema,
      maxItems: 20,
    },
  },
  additionalProperties: false,
} as const;

export const publicationListSchema = {
  type: 'object',
  required: ['items', 'nextCursor'],
  properties: {
    items: {
      type: 'array',
      items: publicationSchema,
    },
    nextCursor: { type: ['string', 'null'], maxLength: 1024 },
  },
  additionalProperties: false,
} as const;

export const scheduleFactsSchema = {
  type: 'object',
  required: ['scheduledAtUtc', 'originalLocalTime', 'timezone'],
  properties: {
    scheduledAtUtc: { type: 'string', format: 'date-time' },
    originalLocalTime: {
      type: 'string',
      pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{3})?$',
    },
    timezone: { type: 'string', minLength: 1, maxLength: 64 },
  },
  additionalProperties: false,
} as const;

export const createPublicationApprovalRouteSchema: FastifySchema = {
  params: {
    type: 'object',
    required: ['workspaceId'],
    properties: {
      workspaceId: { type: 'string', pattern: uuidPattern },
    },
    additionalProperties: false,
  },
  headers: {
    type: 'object',
    required: ['idempotency-key'],
    properties: {
      'idempotency-key': { type: 'string', pattern: idempotencyKeyPattern },
      origin: { type: 'string', minLength: 1, maxLength: 2048 },
    },
  },
  body: {
    type: 'object',
    required: [
      'contentApprovalId',
      'socialAccountId',
      'videoNumber',
      'platformSettings',
      'consent',
    ],
    properties: {
      contentApprovalId: { type: 'string', pattern: uuidPattern },
      socialAccountId: { type: 'string', pattern: uuidPattern },
      videoNumber: { type: 'integer', minimum: 1, maximum: 10 },
      platformSettings: {
        type: 'object',
        additionalProperties: true,
      },
      previewHashHex: { type: 'string', pattern: sha256HexPattern },
      consent: {
        type: 'object',
        required: ['consentType', 'policyVersion'],
        properties: {
          consentType: { type: 'string', enum: ['human_publisher'] },
          policyVersion: { type: 'string', minLength: 1, maxLength: 64 },
        },
        additionalProperties: false,
      },
    },
    additionalProperties: false,
  },
  response: {
    201: publicationApprovalSnapshotSchema,
    400: problemDetailsJsonSchema,
    401: problemDetailsJsonSchema,
    403: problemDetailsJsonSchema,
    404: problemDetailsJsonSchema,
    409: problemDetailsJsonSchema,
    422: problemDetailsJsonSchema,
    429: problemDetailsJsonSchema,
    500: problemDetailsJsonSchema,
  },
};

export const createPublicationScheduleRouteSchema: FastifySchema = {
  params: {
    type: 'object',
    required: ['workspaceId'],
    properties: {
      workspaceId: { type: 'string', pattern: uuidPattern },
    },
    additionalProperties: false,
  },
  headers: {
    type: 'object',
    required: ['idempotency-key'],
    properties: {
      'idempotency-key': { type: 'string', pattern: idempotencyKeyPattern },
      origin: { type: 'string', minLength: 1, maxLength: 2048 },
    },
  },
  body: {
    type: 'object',
    required: ['approvalSnapshotId', 'schedule'],
    properties: {
      approvalSnapshotId: { type: 'string', pattern: uuidPattern },
      schedule: scheduleFactsSchema,
    },
    additionalProperties: false,
  },
  response: {
    201: publicationSchema,
    400: problemDetailsJsonSchema,
    401: problemDetailsJsonSchema,
    403: problemDetailsJsonSchema,
    404: problemDetailsJsonSchema,
    409: problemDetailsJsonSchema,
    422: problemDetailsJsonSchema,
    429: problemDetailsJsonSchema,
    500: problemDetailsJsonSchema,
  },
};

export const listPublicationsRouteSchema: FastifySchema = {
  params: {
    type: 'object',
    required: ['workspaceId'],
    properties: {
      workspaceId: { type: 'string', pattern: uuidPattern },
    },
    additionalProperties: false,
  },
  querystring: {
    type: 'object',
    properties: {
      limit: { type: 'integer', minimum: 1, maximum: 100 },
      cursor: { type: 'string', maxLength: 1024 },
      status: {
        type: 'string',
        enum: [
          'scheduled',
          'queued',
          'publishing',
          'processing_remote',
          'published',
          'retry_wait',
          'outcome_unknown',
          'failed',
          'rejected',
          'canceled',
        ],
      },
      socialAccountId: { type: 'string', pattern: uuidPattern },
      platform: { type: 'string', enum: ['threads', 'tiktok'] },
    },
    additionalProperties: false,
  },
  response: {
    200: publicationListSchema,
    400: problemDetailsJsonSchema,
    401: problemDetailsJsonSchema,
    403: problemDetailsJsonSchema,
    404: problemDetailsJsonSchema,
    429: problemDetailsJsonSchema,
    500: problemDetailsJsonSchema,
  },
};

export const getPublicationRouteSchema: FastifySchema = {
  params: {
    type: 'object',
    required: ['workspaceId', 'publicationId'],
    properties: {
      workspaceId: { type: 'string', pattern: uuidPattern },
      publicationId: { type: 'string', pattern: uuidPattern },
    },
    additionalProperties: false,
  },
  response: {
    200: publicationDetailSchema,
    400: problemDetailsJsonSchema,
    401: problemDetailsJsonSchema,
    403: problemDetailsJsonSchema,
    404: problemDetailsJsonSchema,
    429: problemDetailsJsonSchema,
    500: problemDetailsJsonSchema,
  },
};

export const reschedulePublicationRouteSchema: FastifySchema = {
  params: {
    type: 'object',
    required: ['workspaceId', 'publicationId'],
    properties: {
      workspaceId: { type: 'string', pattern: uuidPattern },
      publicationId: { type: 'string', pattern: uuidPattern },
    },
    additionalProperties: false,
  },
  headers: {
    type: 'object',
    required: ['idempotency-key'],
    properties: {
      'idempotency-key': { type: 'string', pattern: idempotencyKeyPattern },
      origin: { type: 'string', minLength: 1, maxLength: 2048 },
    },
  },
  body: {
    type: 'object',
    required: ['expectedVersion', 'schedule'],
    properties: {
      expectedVersion: { type: 'integer', minimum: 1 },
      schedule: scheduleFactsSchema,
    },
    additionalProperties: false,
  },
  response: {
    200: publicationSchema,
    400: problemDetailsJsonSchema,
    401: problemDetailsJsonSchema,
    403: problemDetailsJsonSchema,
    404: problemDetailsJsonSchema,
    409: problemDetailsJsonSchema,
    422: problemDetailsJsonSchema,
    429: problemDetailsJsonSchema,
    500: problemDetailsJsonSchema,
  },
};

export const cancelPublicationRouteSchema: FastifySchema = {
  params: {
    type: 'object',
    required: ['workspaceId', 'publicationId'],
    properties: {
      workspaceId: { type: 'string', pattern: uuidPattern },
      publicationId: { type: 'string', pattern: uuidPattern },
    },
    additionalProperties: false,
  },
  headers: {
    type: 'object',
    required: ['idempotency-key'],
    properties: {
      'idempotency-key': { type: 'string', pattern: idempotencyKeyPattern },
      origin: { type: 'string', minLength: 1, maxLength: 2048 },
    },
  },
  body: {
    type: 'object',
    required: ['expectedVersion'],
    properties: {
      expectedVersion: { type: 'integer', minimum: 1 },
    },
    additionalProperties: false,
  },
  response: {
    200: publicationSchema,
    400: problemDetailsJsonSchema,
    401: problemDetailsJsonSchema,
    403: problemDetailsJsonSchema,
    404: problemDetailsJsonSchema,
    409: problemDetailsJsonSchema,
    422: problemDetailsJsonSchema,
    429: problemDetailsJsonSchema,
    500: problemDetailsJsonSchema,
  },
};
