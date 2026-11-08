const uuidPattern = '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';

export const kickoffWorkOrderRouteSchema = {
  params: {
    type: 'object',
    required: ['workspaceId', 'productId'],
    properties: {
      workspaceId: { type: 'string', pattern: uuidPattern },
      productId: { type: 'string', pattern: uuidPattern },
    },
    additionalProperties: false,
  },
  body: {
    type: 'object',
    required: ['missionType', 'directiveText'],
    properties: {
      missionType: { type: 'string', enum: ['single_product_affiliate_launch'] },
      directiveText: { type: 'string', minLength: 1, maxLength: 5000 },
      acceptedAnalysisIds: {
        type: 'array',
        items: { type: 'string', pattern: uuidPattern },
        maxItems: 20,
      },
      priority: { type: 'integer', minimum: 1, maximum: 100 },
    },
    additionalProperties: false,
  },
} as const;

export const getWorkOrderRouteSchema = {
  params: {
    type: 'object',
    required: ['workspaceId', 'workOrderId'],
    properties: {
      workspaceId: { type: 'string', pattern: uuidPattern },
      workOrderId: { type: 'string', pattern: uuidPattern },
    },
    additionalProperties: false,
  },
} as const;

export const listWorkOrdersRouteSchema = {
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
      cursor: { type: 'string' },
      limit: { type: 'integer', minimum: 1, maximum: 100 },
      productId: { type: 'string', pattern: uuidPattern },
    },
    additionalProperties: false,
  },
} as const;

export const listWorkOrderArtifactsRouteSchema = {
  params: {
    type: 'object',
    required: ['workspaceId', 'workOrderId'],
    properties: {
      workspaceId: { type: 'string', pattern: uuidPattern },
      workOrderId: { type: 'string', pattern: uuidPattern },
    },
    additionalProperties: false,
  },
} as const;

export const getArtifactByIdRouteSchema = {
  params: {
    type: 'object',
    required: ['workspaceId', 'artifactId'],
    properties: {
      workspaceId: { type: 'string', pattern: uuidPattern },
      artifactId: { type: 'string', pattern: uuidPattern },
    },
    additionalProperties: false,
  },
} as const;

export const listWorkOrderActivitiesRouteSchema = {
  params: {
    type: 'object',
    required: ['workspaceId', 'workOrderId'],
    properties: {
      workspaceId: { type: 'string', pattern: uuidPattern },
      workOrderId: { type: 'string', pattern: uuidPattern },
    },
    additionalProperties: false,
  },
} as const;

export const retryWorkOrderPlanningRouteSchema = {
  params: {
    type: 'object',
    required: ['workspaceId', 'workOrderId'],
    properties: {
      workspaceId: { type: 'string', pattern: uuidPattern },
      workOrderId: { type: 'string', pattern: uuidPattern },
    },
    additionalProperties: false,
  },
} as const;
