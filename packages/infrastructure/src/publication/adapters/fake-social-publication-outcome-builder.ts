import crypto from 'node:crypto';
import type { PublicationOutcome } from '@affiliate-content-os/domain';
import type { PublishTextRequest } from '@affiliate-content-os/application';
import type { FakePublishedPost } from './fake-social-publication-types.js';

export interface FakeOutcomeBuilderConfig {
  readonly defaultTransientRetryAfterMs: number;
  readonly defaultRateLimitRetryAfterMs: number;
  readonly clock?: { now(): Date } | undefined;
}

export function buildFakeNonPublishedOutcome(
  behavior: 'transient' | 'rate_limited' | 'permanent_rejected' | 'processing' | 'outcome_unknown',
  config: FakeOutcomeBuilderConfig,
): PublicationOutcome {
  if (behavior === 'transient') {
    return {
      kind: 'transient_failure',
      errorCode: 'SIMULATED_TRANSIENT_NETWORK_ERROR',
      errorMessage: 'Simulated transient network failure in fake publication adapter',
      retryAfterMs: config.defaultTransientRetryAfterMs,
    };
  }

  if (behavior === 'rate_limited') {
    return {
      kind: 'transient_failure',
      errorCode: 'RATE_LIMIT_EXCEEDED',
      errorMessage: 'Simulated rate limit exceeded in fake publication adapter',
      retryAfterMs: config.defaultRateLimitRetryAfterMs,
    };
  }

  if (behavior === 'permanent_rejected') {
    return {
      kind: 'permanent_failure',
      errorCode: 'CONTENT_POLICY_VIOLATION',
      errorMessage: 'Simulated permanent rejection: content policy violation',
    };
  }

  if (behavior === 'processing') {
    return {
      kind: 'outcome_unknown',
      errorCode: 'REMOTE_MEDIA_PROCESSING',
      errorMessage:
        'Remote post is still in progress / processing and cannot be confirmed published',
    };
  }

  return {
    kind: 'outcome_unknown',
    errorCode: 'OUTCOME_UNKNOWN',
    errorMessage: 'Simulated indeterminate outcome from fake publication adapter',
  };
}

export function createFakePublishedPost(
  request: PublishTextRequest,
  clock?: { now(): Date },
): FakePublishedPost {
  const hash = crypto
    .createHash('sha256')
    .update(`${request.socialAccountId}:${request.publicationId}`, 'utf8')
    .digest('hex')
    .slice(0, 16);

  const remotePostId = `fake_threads_post_${hash}`;
  const remotePermalink = `https://threads.net/@fake_threads_creator/post/${hash}`;
  const publishedAt = (clock?.now() ?? new Date()).toISOString();

  return {
    remotePostId,
    remotePermalink,
    publishedAt,
    publicationId: request.publicationId,
    socialAccountId: request.socialAccountId,
    attemptNumber: request.attemptNumber,
    attemptIdempotencyKey: request.attemptIdempotencyKey,
    renderedText: request.renderedText,
  };
}
