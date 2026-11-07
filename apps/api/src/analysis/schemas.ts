import type { FastifySchema } from 'fastify';

const uuidPattern = '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
const uuid = { type: 'string', pattern: uuidPattern } as const;
const nullableString = { type: ['string', 'null'] } as const;
const dateTime = { type: 'string', format: 'date-time' } as const;
const nullableDateTime = { type: ['string', 'null'], format: 'date-time' } as const;

const analysisSummaryResponse = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'workspaceId',
    'productId',
    'analysisType',
    'revisionNumber',
    'factSetId',
    'factSetRevision',
    'provider',
    'model',
    'status',
    'createdAt',
    'updatedAt',
    'version',
  ],
  properties: {
    id: uuid,
    workspaceId: uuid,
    productId: uuid,
    analysisType: { type: 'string', enum: ['product', 'niche', 'performance'] },
    revisionNumber: { type: 'integer', minimum: 1 },
    factSetId: uuid,
    factSetRevision: { type: ['integer', 'null'], minimum: 1 },
    provider: nullableString,
    model: nullableString,
    status: { type: 'string', enum: ['generated', 'accepted', 'rejected'] },
    createdAt: dateTime,
    updatedAt: dateTime,
    version: { type: 'integer', minimum: 1 },
  },
} as const;

const analysisDetailResponse = {
  ...analysisSummaryResponse,
  required: [
    ...analysisSummaryResponse.required,
    'aiRunId',
    'content',
    'schemaVersion',
    'reviewedByUserId',
    'reviewedAt',
    'reviewReason',
    'rejectionReason',
    'createdByUserId',
    'isRepair',
    'contentHash',
  ],
  properties: {
    ...analysisSummaryResponse.properties,
    aiRunId: uuid,
    content: { type: 'object', additionalProperties: true },
    schemaVersion: { type: 'integer', minimum: 1 },
    reviewedByUserId: { type: ['string', 'null'], pattern: uuidPattern },
    reviewedAt: nullableDateTime,
    reviewReason: nullableString,
    rejectionReason: nullableString,
    createdByUserId: uuid,
    isRepair: { type: 'boolean' },
    contentHash: nullableString,
    provenance: {
      type: 'object',
      additionalProperties: false,
      required: ['provider', 'model', 'promptTemplate', 'promptVersion'],
      properties: {
        provider: { type: 'string' },
        model: { type: 'string' },
        promptTemplate: { type: 'string' },
        promptVersion: { type: 'string' },
      },
    },
  },
} as const;

const operationResponse = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'workspaceId',
    'operationType',
    'resourceType',
    'resourceId',
    'status',
    'progressPercent',
    'resultLocation',
    'errorCategory',
    'errorCode',
    'errorMessage',
    'startedAt',
    'completedAt',
    'createdAt',
    'updatedAt',
    'version',
  ],
  properties: {
    id: uuid,
    workspaceId: uuid,
    operationType: { type: 'string' },
    resourceType: { type: 'string' },
    resourceId: uuid,
    status: { type: 'string', enum: ['queued', 'running', 'succeeded', 'failed', 'canceled'] },
    progressPercent: { type: ['integer', 'null'], minimum: 0, maximum: 100 },
    resultLocation: nullableString,
    errorCategory: nullableString,
    errorCode: nullableString,
    errorMessage: nullableString,
    startedAt: nullableDateTime,
    completedAt: nullableDateTime,
    createdAt: dateTime,
    updatedAt: dateTime,
    version: { type: 'integer', minimum: 1 },
  },
} as const;

export const enqueueAnalysisRouteSchema: FastifySchema = {
  response: {
    202: {
      type: 'object',
      additionalProperties: false,
      required: ['operationId', 'location', 'status'],
      properties: {
        operationId: uuid,
        location: { type: 'string' },
        status: { const: 'queued' },
      },
    },
  },
  params: {
    type: 'object',
    required: ['workspaceId', 'productId'],
    additionalProperties: false,
    properties: {
      workspaceId: { type: 'string', pattern: uuidPattern },
      productId: { type: 'string', pattern: uuidPattern },
    },
  },
  headers: {
    type: 'object',
    required: ['idempotency-key'],
    properties: {
      'idempotency-key': { type: 'string', minLength: 1, maxLength: 128 },
    },
  },
  body: {
    type: 'object',
    required: ['analysisType', 'factSetId'],
    additionalProperties: false,
    properties: {
      analysisType: { type: 'string', enum: ['product', 'niche'] },
      factSetId: { type: 'string', pattern: uuidPattern },
      sourceAnalysisIds: {
        type: 'array',
        items: { type: 'string', pattern: uuidPattern },
      },
    },
  },
};

export const listAnalysesRouteSchema: FastifySchema = {
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      required: ['items', 'nextCursor'],
      properties: {
        items: { type: 'array', items: analysisSummaryResponse },
        nextCursor: nullableString,
      },
    },
  },
  params: {
    type: 'object',
    required: ['workspaceId', 'productId'],
    additionalProperties: false,
    properties: {
      workspaceId: { type: 'string', pattern: uuidPattern },
      productId: { type: 'string', pattern: uuidPattern },
    },
  },
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: {
      type: { type: 'string', enum: ['product', 'niche', 'performance'] },
      status: { type: 'string', enum: ['generated', 'accepted', 'rejected'] },
      cursor: { type: 'string' },
      limit: { type: 'integer', minimum: 1, maximum: 100 },
    },
  },
};

export const getAnalysisRouteSchema: FastifySchema = {
  response: { 200: analysisDetailResponse },
  params: {
    type: 'object',
    required: ['workspaceId', 'analysisId'],
    additionalProperties: false,
    properties: {
      workspaceId: { type: 'string', pattern: uuidPattern },
      analysisId: { type: 'string', pattern: uuidPattern },
    },
  },
};

export const acceptAnalysisRouteSchema: FastifySchema = {
  response: { 200: analysisDetailResponse },
  params: {
    type: 'object',
    required: ['workspaceId', 'analysisId'],
    additionalProperties: false,
    properties: {
      workspaceId: { type: 'string', pattern: uuidPattern },
      analysisId: { type: 'string', pattern: uuidPattern },
    },
  },
  body: {
    type: ['object', 'null'],
    additionalProperties: false,
    properties: {
      expectedVersion: { type: 'integer', minimum: 1 },
    },
  },
};

export const rejectAnalysisRouteSchema: FastifySchema = {
  response: { 200: analysisDetailResponse },
  params: {
    type: 'object',
    required: ['workspaceId', 'analysisId'],
    additionalProperties: false,
    properties: {
      workspaceId: { type: 'string', pattern: uuidPattern },
      analysisId: { type: 'string', pattern: uuidPattern },
    },
  },
  body: {
    type: ['object', 'null'],
    additionalProperties: false,
    properties: {
      expectedVersion: { type: 'integer', minimum: 1 },
      reason: { type: 'string', maxLength: 2048 },
    },
  },
};

export const getOperationRouteSchema: FastifySchema = {
  response: { 200: operationResponse },
  params: {
    type: 'object',
    required: ['workspaceId', 'operationId'],
    additionalProperties: false,
    properties: {
      workspaceId: { type: 'string', pattern: uuidPattern },
      operationId: { type: 'string', pattern: uuidPattern },
    },
  },
};

const aiPolicyResponse = {
  type: 'object',
  additionalProperties: false,
  required: [
    'workspaceId',
    'aiEnabled',
    'monthlyBudgetMicrounits',
    'currentSpendMicrounits',
    'reservedSpendMicrounits',
    'rateLimitPerMinute',
    'budgetPeriodStart',
    'updatedAt',
    'version',
  ],
  properties: {
    workspaceId: uuid,
    aiEnabled: { type: 'boolean' },
    monthlyBudgetMicrounits: { type: 'integer', minimum: 0 },
    currentSpendMicrounits: { type: 'integer', minimum: 0 },
    reservedSpendMicrounits: { type: 'integer', minimum: 0 },
    rateLimitPerMinute: { type: 'integer', minimum: 1 },
    budgetPeriodStart: dateTime,
    updatedAt: dateTime,
    version: { type: 'integer', minimum: 1 },
  },
} as const;

const aiPolicyParams = {
  type: 'object',
  required: ['workspaceId'],
  additionalProperties: false,
  properties: {
    workspaceId: { type: 'string', pattern: uuidPattern },
  },
} as const;

export const getAIPolicyRouteSchema: FastifySchema = {
  response: { 200: aiPolicyResponse },
  params: aiPolicyParams,
};

export const updateAIPolicyRouteSchema: FastifySchema = {
  response: { 200: aiPolicyResponse },
  params: aiPolicyParams,
  body: {
    type: 'object',
    required: ['aiEnabled', 'monthlyBudgetMicrounits', 'rateLimitPerMinute'],
    additionalProperties: false,
    properties: {
      aiEnabled: { type: 'boolean' },
      monthlyBudgetMicrounits: { type: 'integer', minimum: 0 },
      rateLimitPerMinute: { type: 'integer', minimum: 1, maximum: 1000 },
      expectedVersion: { type: 'integer', minimum: 1 },
    },
  },
};
