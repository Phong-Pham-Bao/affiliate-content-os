import type { PublicationOutcome } from '@affiliate-content-os/domain';
import type {
  PublishTextRequest,
  SocialPublicationAdapter,
} from '@affiliate-content-os/application';
import {
  type FakePublicationBehavior,
  type FakePublishedPost,
  type FakeSocialPublicationAdapterOptions,
  FakePublicationProductionSelectionError,
} from './fake-social-publication-types.js';
import { validatePublishTextRequest } from './fake-social-publication-validation.js';
import { resolveFakePublicationBehavior } from './fake-social-publication-behavior-resolver.js';
import {
  buildFakeNonPublishedOutcome,
  createFakePublishedPost,
} from './fake-social-publication-outcome-builder.js';

export class FakeSocialPublicationAdapter implements SocialPublicationAdapter {
  private defaultBehavior: FakePublicationBehavior;
  private readonly defaultTransientRetryAfterMs: number;
  private readonly defaultRateLimitRetryAfterMs: number;
  private readonly hangTimeoutMs: number | undefined;
  private readonly clock: { now(): Date } | undefined;

  private totalCallCount = 0;
  private readonly callsByPublication = new Map<string, number>();
  private readonly callHistory: PublishTextRequest[] = [];
  private readonly publishedPosts = new Map<string, FakePublishedPost>();
  private readonly behaviorByPublication = new Map<string, FakePublicationBehavior>();
  private readonly behaviorByAttempt = new Map<string, FakePublicationBehavior>();
  private readonly activeHangTimers = new Set<NodeJS.Timeout>();

  constructor(options?: FakeSocialPublicationAdapterOptions) {
    if (options?.environment === 'production' || process.env['NODE_ENV'] === 'production') {
      throw new FakePublicationProductionSelectionError();
    }

    this.defaultBehavior = options?.defaultBehavior ?? 'published';
    this.defaultTransientRetryAfterMs = options?.defaultTransientRetryAfterMs ?? 5000;
    this.defaultRateLimitRetryAfterMs = options?.defaultRateLimitRetryAfterMs ?? 60_000;
    this.hangTimeoutMs = options?.hangTimeoutMs;
    this.clock = options?.clock;
  }

  public async publishText(request: PublishTextRequest): Promise<PublicationOutcome> {
    validatePublishTextRequest(request);

    this.totalCallCount++;
    const currentPubCount = this.callsByPublication.get(request.publicationId) ?? 0;
    this.callsByPublication.set(request.publicationId, currentPubCount + 1);
    this.callHistory.push(request);

    const behavior = resolveFakePublicationBehavior(request, {
      defaultBehavior: this.defaultBehavior,
      behaviorByPublication: this.behaviorByPublication,
      behaviorByAttempt: this.behaviorByAttempt,
    });

    if (behavior === 'timeout_hang') {
      return new Promise<never>((_resolve, reject) => {
        if (this.hangTimeoutMs !== undefined && this.hangTimeoutMs > 0) {
          const timer = setTimeout(() => {
            this.activeHangTimers.delete(timer);
            reject(new Error('Simulated adapter timeout hang reached'));
          }, this.hangTimeoutMs);
          this.activeHangTimers.add(timer);
        }
      });
    }

    if (behavior !== 'published') {
      return buildFakeNonPublishedOutcome(behavior, {
        defaultTransientRetryAfterMs: this.defaultTransientRetryAfterMs,
        defaultRateLimitRetryAfterMs: this.defaultRateLimitRetryAfterMs,
        clock: this.clock,
      });
    }

    return this.publishWithStableIdempotency(request);
  }

  private publishWithStableIdempotency(request: PublishTextRequest): PublicationOutcome {
    const existing = this.publishedPosts.get(request.publicationId);
    if (existing) {
      return {
        kind: 'published',
        remotePostId: existing.remotePostId,
        remotePermalink: existing.remotePermalink,
        publishedAt: existing.publishedAt,
      };
    }

    const newPost = createFakePublishedPost(request, this.clock);
    this.publishedPosts.set(request.publicationId, newPost);

    return {
      kind: 'published',
      remotePostId: newPost.remotePostId,
      remotePermalink: newPost.remotePermalink,
      publishedAt: newPost.publishedAt,
    };
  }

  public getTotalCallCount(): number {
    return this.totalCallCount;
  }

  public getCallCountForPublication(publicationId: string): number {
    return this.callsByPublication.get(publicationId) ?? 0;
  }

  public getCalls(): readonly PublishTextRequest[] {
    return [...this.callHistory];
  }

  public getLastCall(): PublishTextRequest | undefined {
    return this.callHistory[this.callHistory.length - 1];
  }

  public getPublishedPosts(): readonly FakePublishedPost[] {
    return Array.from(this.publishedPosts.values());
  }

  public getPublishedPost(publicationId: string): FakePublishedPost | undefined {
    return this.publishedPosts.get(publicationId);
  }

  public setBehavior(behavior: FakePublicationBehavior): void {
    this.defaultBehavior = behavior;
  }

  public setPublicationBehavior(publicationId: string, behavior: FakePublicationBehavior): void {
    this.behaviorByPublication.set(publicationId, behavior);
  }

  public setAttemptBehavior(attemptKey: string, behavior: FakePublicationBehavior): void {
    this.behaviorByAttempt.set(attemptKey, behavior);
  }

  public unblockHangs(): void {
    for (const timer of this.activeHangTimers) {
      clearTimeout(timer);
    }
    this.activeHangTimers.clear();
  }

  public reset(): void {
    this.unblockHangs();
    this.totalCallCount = 0;
    this.callsByPublication.clear();
    this.callHistory.length = 0;
    this.publishedPosts.clear();
    this.behaviorByPublication.clear();
    this.behaviorByAttempt.clear();
  }
}
