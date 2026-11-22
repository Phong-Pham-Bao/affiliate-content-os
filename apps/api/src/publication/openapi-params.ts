import {
  cancelPublicationRouteSchema,
  createPublicationApprovalRouteSchema,
  createPublicationScheduleRouteSchema,
  publicationApprovalSnapshotSchema,
  publicationAttemptSummarySchema,
  publicationDetailSchema,
  publicationListSchema,
  publicationSchema,
  reschedulePublicationRouteSchema,
  scheduleFactsSchema,
} from './schemas.js';

export const workspaceIdParam = {
  name: 'workspaceId',
  in: 'path',
  required: true,
  schema: { type: 'string', format: 'uuid' },
  description: 'Unique identifier of the workspace.',
} as const;

export const publicationIdParam = {
  name: 'publicationId',
  in: 'path',
  required: true,
  schema: { type: 'string', format: 'uuid' },
  description: 'Unique identifier of the publication.',
} as const;

export const sessionCookieParam = {
  name: 'acos_session',
  in: 'cookie',
  required: true,
  schema: { type: 'string' },
  description: 'Opaque application session token.',
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
  description: 'Mandatory idempotency key for safe duplicate prevention and replay.',
} as const;

export const limitQueryParam = {
  name: 'limit',
  in: 'query',
  required: false,
  schema: { type: 'integer', minimum: 1, maximum: 100 },
  description: 'Maximum number of publications to return (default 50, maximum 100).',
} as const;

export const cursorQueryParam = {
  name: 'cursor',
  in: 'query',
  required: false,
  schema: { type: 'string', maxLength: 1024 },
  description: 'Opaque cursor for keyset pagination.',
} as const;

export const statusQueryParam = {
  name: 'status',
  in: 'query',
  required: false,
  schema: {
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
  description: 'Filter publications by lifecycle status.',
} as const;

export const socialAccountIdQueryParam = {
  name: 'socialAccountId',
  in: 'query',
  required: false,
  schema: { type: 'string', format: 'uuid' },
  description: 'Filter publications by connected destination social account ID.',
} as const;

export const platformQueryParam = {
  name: 'platform',
  in: 'query',
  required: false,
  schema: { type: 'string', enum: ['threads', 'tiktok'] },
  description: 'Filter publications by destination social platform.',
} as const;

export function buildOpenApiPublicationComponents(): {
  schemas: Record<string, unknown>;
} {
  return {
    schemas: {
      PublicationApprovalSnapshot: publicationApprovalSnapshotSchema,
      Publication: publicationSchema,
      PublicationDetail: publicationDetailSchema,
      PublicationList: publicationListSchema,
      PublicationAttemptSummary: publicationAttemptSummarySchema,
      ScheduleFacts: scheduleFactsSchema,
      CreatePublicationApprovalRequest: createPublicationApprovalRouteSchema.body,
      CreatePublicationScheduleRequest: createPublicationScheduleRouteSchema.body,
      ReschedulePublicationRequest: reschedulePublicationRouteSchema.body,
      CancelPublicationRequest: cancelPublicationRouteSchema.body,
    },
  };
}
