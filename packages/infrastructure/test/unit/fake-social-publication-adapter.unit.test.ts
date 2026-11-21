import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  FakeSocialPublicationAdapter,
  FakePublicationProductionSelectionError,
  resolveSocialPublicationAdapter,
} from '../../src/publication/index.js';
import { createValidPublishTextRequest } from './fake-social-publication-fixtures.js';

describe('FakeSocialPublicationAdapter', () => {
  const originalNodeEnv = process.env['NODE_ENV'];
  beforeEach(() => {
    process.env['NODE_ENV'] = 'test';
  });
  afterEach(() => {
    process.env['NODE_ENV'] = originalNodeEnv;
  });

  describe('production rejection', () => {
    it('rejects instantiation when environment option is production', () => {
      expect(() => new FakeSocialPublicationAdapter({ environment: 'production' })).toThrow(
        FakePublicationProductionSelectionError,
      );
    });

    it('rejects instantiation when NODE_ENV is production', () => {
      process.env['NODE_ENV'] = 'production';
      expect(() => new FakeSocialPublicationAdapter()).toThrow(
        FakePublicationProductionSelectionError,
      );
    });

    it('resolveSocialPublicationAdapter rejects fake adapter in production', () => {
      expect(() =>
        resolveSocialPublicationAdapter({ fakeAdapterEnabled: true, environment: 'production' }),
      ).toThrow(FakePublicationProductionSelectionError);
    });

    it('resolveSocialPublicationAdapter returns adapter in local/test environment', () => {
      const adapter = resolveSocialPublicationAdapter({
        fakeAdapterEnabled: true,
        environment: 'local',
      });
      expect(adapter).toBeInstanceOf(FakeSocialPublicationAdapter);
    });
  });

  describe('published behavior & stable idempotency', () => {
    it('returns deterministic published outcome with remote post ID and permalink', async () => {
      const adapter = new FakeSocialPublicationAdapter();
      const outcome = await adapter.publishText(createValidPublishTextRequest());
      expect(outcome.kind).toBe('published');
      if (outcome.kind === 'published') {
        expect(outcome.remotePostId).toMatch(/^fake_threads_post_[a-f0-9]{16}$/);
        expect(outcome.remotePermalink).toMatch(
          /^https:\/\/threads\.net\/@fake_threads_creator\/post\/[a-f0-9]{16}$/,
        );
        expect(outcome.publishedAt).toBeDefined();
      }
    });

    it('maintains stable attempt idempotency with no duplicate fake remote post', async () => {
      const adapter = new FakeSocialPublicationAdapter();
      const req = createValidPublishTextRequest();
      const outcome1 = await adapter.publishText(req);
      const outcome2 = await adapter.publishText(req);
      expect(outcome1).toEqual(outcome2);
      expect(adapter.getPublishedPosts()).toHaveLength(1);
    });

    it('returns same post when retry arrives for already published publication', async () => {
      const adapter = new FakeSocialPublicationAdapter();
      const req1 = createValidPublishTextRequest({ attemptNumber: 1, attemptIdempotencyKey: 'k1' });
      const req2 = createValidPublishTextRequest({ attemptNumber: 2, attemptIdempotencyKey: 'k2' });
      const outcome1 = await adapter.publishText(req1);
      const outcome2 = await adapter.publishText(req2);
      expect(outcome1).toEqual(outcome2);
      expect(adapter.getPublishedPosts()).toHaveLength(1);
    });

    it('generates distinct remote posts for distinct publications', async () => {
      const adapter = new FakeSocialPublicationAdapter();
      const out1 = await adapter.publishText(
        createValidPublishTextRequest({ publicationId: '018f3a2c-pub-1' }),
      );
      const out2 = await adapter.publishText(
        createValidPublishTextRequest({ publicationId: '018f3a2c-pub-2' }),
      );
      expect(out1.kind).toBe('published');
      expect(out2.kind).toBe('published');
      if (out1.kind === 'published' && out2.kind === 'published') {
        expect(out1.remotePostId).not.toBe(out2.remotePostId);
      }
      expect(adapter.getPublishedPosts()).toHaveLength(2);
    });
  });

  describe('exact call counts', () => {
    it('accurately tracks total calls, publication calls, and history', async () => {
      const adapter = new FakeSocialPublicationAdapter();
      await adapter.publishText(createValidPublishTextRequest({ publicationId: 'pub_A' }));
      await adapter.publishText(createValidPublishTextRequest({ publicationId: 'pub_A' }));
      await adapter.publishText(createValidPublishTextRequest({ publicationId: 'pub_B' }));

      expect(adapter.getTotalCallCount()).toBe(3);
      expect(adapter.getCallCountForPublication('pub_A')).toBe(2);
      expect(adapter.getCallCountForPublication('pub_B')).toBe(1);
      expect(adapter.getCallCountForPublication('pub_C')).toBe(0);
      expect(adapter.getCalls()).toHaveLength(3);
      expect(adapter.getLastCall()?.publicationId).toBe('pub_B');

      adapter.reset();
      expect(adapter.getTotalCallCount()).toBe(0);
      expect(adapter.getCallCountForPublication('pub_A')).toBe(0);
      expect(adapter.getCalls()).toHaveLength(0);
      expect(adapter.getPublishedPosts()).toHaveLength(0);
    });
  });

  describe('deterministic failure, processing, and timeout behaviors', () => {
    it('supports transient failure via setting or marker', async () => {
      const adapter = new FakeSocialPublicationAdapter({ defaultTransientRetryAfterMs: 3000 });
      const outSetting = await adapter.publishText(
        createValidPublishTextRequest({ platformSettings: { simulatedBehavior: 'transient' } }),
      );
      expect(outSetting).toEqual({
        kind: 'transient_failure',
        errorCode: 'SIMULATED_TRANSIENT_NETWORK_ERROR',
        errorMessage: expect.any(String),
        retryAfterMs: 3000,
      });

      const outMarker = await adapter.publishText(
        createValidPublishTextRequest({ renderedText: 'Hello world sim:transient' }),
      );
      expect(outMarker.kind).toBe('transient_failure');
    });

    it('supports rate-limited failure with retryAfterMs', async () => {
      const adapter = new FakeSocialPublicationAdapter({ defaultRateLimitRetryAfterMs: 45_000 });
      const outcome = await adapter.publishText(
        createValidPublishTextRequest({ attemptIdempotencyKey: 'idem_fail_rate_limit_01' }),
      );
      expect(outcome).toEqual({
        kind: 'transient_failure',
        errorCode: 'RATE_LIMIT_EXCEEDED',
        errorMessage: expect.any(String),
        retryAfterMs: 45_000,
      });
    });

    it('supports permanent rejection with non-retryable error', async () => {
      const adapter = new FakeSocialPublicationAdapter();
      const outcome = await adapter.publishText(
        createValidPublishTextRequest({ renderedText: 'sim:permanent_rejected' }),
      );
      expect(outcome).toEqual({
        kind: 'permanent_failure',
        errorCode: 'CONTENT_POLICY_VIOLATION',
        errorMessage: expect.any(String),
      });
    });

    it('supports processing behavior returning outcome_unknown', async () => {
      const adapter = new FakeSocialPublicationAdapter();
      const outcome = await adapter.publishText(
        createValidPublishTextRequest({ renderedText: 'sim:processing async video' }),
      );
      expect(outcome).toEqual({
        kind: 'outcome_unknown',
        errorCode: 'REMOTE_MEDIA_PROCESSING',
        errorMessage: expect.any(String),
      });
    });

    it('supports outcome_unknown behavior', async () => {
      const adapter = new FakeSocialPublicationAdapter();
      const outcome = await adapter.publishText(
        createValidPublishTextRequest({
          platformSettings: { simulatedBehavior: 'outcome_unknown' },
        }),
      );
      expect(outcome).toEqual({
        kind: 'outcome_unknown',
        errorCode: 'OUTCOME_UNKNOWN',
        errorMessage: expect.any(String),
      });
    });

    it('supports timeout hang behavior', async () => {
      const adapter = new FakeSocialPublicationAdapter({ hangTimeoutMs: 50 });
      await expect(
        adapter.publishText(
          createValidPublishTextRequest({
            platformSettings: { simulatedBehavior: 'timeout_hang' },
          }),
        ),
      ).rejects.toThrow('Simulated adapter timeout hang reached');
    });
  });
});
