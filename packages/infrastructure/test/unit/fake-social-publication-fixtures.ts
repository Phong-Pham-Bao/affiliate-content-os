import type { PublishTextRequest } from '@affiliate-content-os/application';

export function createValidPublishTextRequest(
  overrides?: Partial<PublishTextRequest>,
): PublishTextRequest {
  return {
    workspaceId: '018f3a2c-4e5b-7c8d-9e0f-1a2b3c4d5e6f',
    publicationId: '018f3a2c-4e5b-7c8d-9e0f-2b3c4d5e6f7a',
    attemptId: '018f3a2c-4e5b-7c8d-9e0f-3c4d5e6f7a8b',
    attemptNumber: 1,
    attemptIdempotencyKey: 'idem_key_attempt_001',
    socialAccountId: '018f3a2c-4e5b-7c8d-9e0f-4d5e6f7a8b9c',
    providerAccountId: 'threads_user_12345',
    renderedText: 'Affiliate product review: check this out! #affiliate',
    platformSettings: {},
    correlationId: '018f3a2c-4e5b-7c8d-9e0f-5e6f7a8b9c0d',
    accessToken: 'fake_access_token',
    ...overrides,
  };
}
