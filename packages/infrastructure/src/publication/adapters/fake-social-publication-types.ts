import type { SocialAccountEnvironment } from '@affiliate-content-os/domain';

export type FakePublicationBehavior =
  | 'published'
  | 'transient'
  | 'rate_limited'
  | 'permanent_rejected'
  | 'processing'
  | 'outcome_unknown'
  | 'timeout_hang';

export interface FakePublishedPost {
  readonly remotePostId: string;
  readonly remotePermalink: string;
  readonly publishedAt: string;
  readonly publicationId: string;
  readonly socialAccountId: string;
  readonly attemptNumber: number;
  readonly attemptIdempotencyKey: string;
  readonly renderedText: string;
}

export interface FakeSocialPublicationAdapterOptions {
  readonly environment?: SocialAccountEnvironment | 'production' | undefined;
  readonly defaultBehavior?: FakePublicationBehavior | undefined;
  readonly defaultTransientRetryAfterMs?: number | undefined;
  readonly defaultRateLimitRetryAfterMs?: number | undefined;
  readonly hangTimeoutMs?: number | undefined;
  readonly clock?: { now(): Date } | undefined;
}

export class FakePublicationInputValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FakePublicationInputValidationError';
  }
}

export class FakePublicationProductionSelectionError extends Error {
  constructor(
    message: string = 'FakeSocialPublicationAdapter cannot be used in production environment.',
  ) {
    super(message);
    this.name = 'FakePublicationProductionSelectionError';
  }
}
