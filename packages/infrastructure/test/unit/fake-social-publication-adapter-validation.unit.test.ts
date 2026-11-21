import { describe, expect, it } from 'vitest';
import type { PublishTextRequest } from '@affiliate-content-os/application';
import {
  FakeSocialPublicationAdapter,
  FakePublicationInputValidationError,
} from '../../src/publication/index.js';
import { createValidPublishTextRequest } from './fake-social-publication-fixtures.js';

describe('FakeSocialPublicationAdapter validation', () => {
  const adapter = new FakeSocialPublicationAdapter();

  it('rejects null or non-object request', async () => {
    await expect(adapter.publishText(null as unknown as PublishTextRequest)).rejects.toThrow(
      FakePublicationInputValidationError,
    );
    await expect(adapter.publishText(undefined as unknown as PublishTextRequest)).rejects.toThrow(
      FakePublicationInputValidationError,
    );
  });

  it('rejects missing or empty string fields', async () => {
    const invalidWorkspace = { ...createValidPublishTextRequest(), workspaceId: '   ' };
    await expect(adapter.publishText(invalidWorkspace)).rejects.toThrow(
      FakePublicationInputValidationError,
    );

    const invalidPublicationId = { ...createValidPublishTextRequest(), publicationId: '' };
    await expect(adapter.publishText(invalidPublicationId)).rejects.toThrow(
      FakePublicationInputValidationError,
    );
  });

  it('rejects oversized string fields exceeding explicit bounds', async () => {
    const oversizedId = { ...createValidPublishTextRequest(), publicationId: 'a'.repeat(129) };
    await expect(adapter.publishText(oversizedId)).rejects.toThrow(
      FakePublicationInputValidationError,
    );

    const oversizedKey = {
      ...createValidPublishTextRequest(),
      attemptIdempotencyKey: 'k'.repeat(257),
    };
    await expect(adapter.publishText(oversizedKey)).rejects.toThrow(
      FakePublicationInputValidationError,
    );

    const oversizedText = { ...createValidPublishTextRequest(), renderedText: 't'.repeat(10_001) };
    await expect(adapter.publishText(oversizedText)).rejects.toThrow(
      FakePublicationInputValidationError,
    );
  });

  it('rejects invalid attemptNumber (non-integer, zero, negative, or > 100)', async () => {
    const zeroAttempt = { ...createValidPublishTextRequest(), attemptNumber: 0 };
    await expect(adapter.publishText(zeroAttempt)).rejects.toThrow(
      FakePublicationInputValidationError,
    );

    const floatAttempt = { ...createValidPublishTextRequest(), attemptNumber: 1.5 };
    await expect(adapter.publishText(floatAttempt)).rejects.toThrow(
      FakePublicationInputValidationError,
    );

    const excessiveAttempt = { ...createValidPublishTextRequest(), attemptNumber: 101 };
    await expect(adapter.publishText(excessiveAttempt)).rejects.toThrow(
      FakePublicationInputValidationError,
    );
  });

  it('rejects invalid platformSettings or oversized accessToken', async () => {
    const invalidSettings = {
      ...createValidPublishTextRequest(),
      platformSettings: null as unknown as Record<string, unknown>,
    };
    await expect(adapter.publishText(invalidSettings)).rejects.toThrow(
      FakePublicationInputValidationError,
    );

    const oversizedToken = { ...createValidPublishTextRequest(), accessToken: 'x'.repeat(4097) };
    await expect(adapter.publishText(oversizedToken)).rejects.toThrow(
      FakePublicationInputValidationError,
    );
  });
});
