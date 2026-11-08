import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pollChangeRequestUntilTerminal } from '../src/lib/workforce-operation-polling.js';
import {
  createManualRevisionApi,
  requestScriptChangesApi,
} from '../src/lib/workforce-api-client-revisions.js';
import { IdempotencyKeyTracker } from '../src/lib/catalog-idempotency.js';
import {
  generateCryptoIdempotencyKey,
  normalizeManualSavePayload,
  normalizeRequestChangesPayload,
} from '../src/lib/crypto-idempotency.js';
import { createMockScriptPackage } from './content-studio-components.unit.test.js';
import type { ArtifactChangeRequestDTO } from '../src/types/script-studio.js';

describe('Content Studio Observable Lifecycle & Key Retention Remediation', () => {
  const originalFetch = globalThis.fetch;
  const originalCrypto = globalThis.crypto;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    Object.defineProperty(globalThis, 'crypto', {
      value: originalCrypto,
      configurable: true,
      writable: true,
    });
    vi.useRealTimers();
  });

  describe('1. pollChangeRequestUntilTerminal (Observable Lifecycle)', () => {
    it('polls in-progress until completed refresh with fake timers and returns final completed DTO', async () => {
      vi.useFakeTimers();

      const inProgressCr: ArtifactChangeRequestDTO = {
        id: 'cr-100',
        artifactId: 'art-1',
        baseRevisionNumber: 1,
        baseContentHashHex: 'hash1',
        requestedByUserId: 'usr-1',
        instructionText: 'Update hook',
        selectedVideoNumbers: [1, 2],
        targetVariantCount: 1,
        status: 'in_progress',
        resultingRevisionNumber: null,
        failureReason: null,
        createdAt: '2026-11-09T00:00:00.000Z',
        updatedAt: '2026-11-09T00:00:01.000Z',
        version: 1,
      };

      const completedCr: ArtifactChangeRequestDTO = {
        ...inProgressCr,
        status: 'completed',
        resultingRevisionNumber: 2,
        updatedAt: '2026-11-09T00:00:05.000Z',
        version: 2,
      };

      let callCount = 0;
      globalThis.fetch = vi.fn().mockImplementation(async () => {
        callCount++;
        const cr = callCount === 1 ? inProgressCr : completedCr;
        return {
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => cr,
        };
      });

      const updates: ArtifactChangeRequestDTO[] = [];
      const abortCtrl = new AbortController();

      const pollPromise = pollChangeRequestUntilTerminal(
        'ws-1',
        'art-1',
        'cr-100',
        abortCtrl.signal,
        (cr) => updates.push(cr),
        { intervalMs: 500, maxAttempts: 10 },
      );

      // Fast-forward initial poll + timer
      await vi.advanceTimersByTimeAsync(0);
      expect(callCount).toBe(1);
      expect(updates).toHaveLength(1);
      expect(updates[0]?.status).toBe('in_progress');

      // Advance timer to trigger second poll
      await vi.advanceTimersByTimeAsync(500);

      const result = await pollPromise;
      expect(callCount).toBe(2);
      expect(result.status).toBe('completed');
      expect(result.resultingRevisionNumber).toBe(2);
      expect(updates).toHaveLength(2);
      expect(updates[1]?.status).toBe('completed');
    });

    it('proves no fake completion: does not stop polling until server actually returns completed', async () => {
      vi.useFakeTimers();

      const pendingCr: ArtifactChangeRequestDTO = {
        id: 'cr-101',
        artifactId: 'art-1',
        baseRevisionNumber: 1,
        baseContentHashHex: 'hash1',
        requestedByUserId: 'usr-1',
        instructionText: 'Update hook',
        selectedVideoNumbers: [1],
        targetVariantCount: 1,
        status: 'pending',
        resultingRevisionNumber: null,
        failureReason: null,
        createdAt: '2026-11-09T00:00:00.000Z',
        updatedAt: '2026-11-09T00:00:01.000Z',
        version: 1,
      };

      let callCount = 0;
      globalThis.fetch = vi.fn().mockImplementation(async () => {
        callCount++;
        return {
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => pendingCr,
        };
      });

      const abortCtrl = new AbortController();
      let completed = false;

      const pollPromise = pollChangeRequestUntilTerminal(
        'ws-1',
        'art-1',
        'cr-101',
        abortCtrl.signal,
        undefined,
        { intervalMs: 300, maxAttempts: 5 },
      ).then((res) => {
        completed = true;
        return res;
      });

      await vi.advanceTimersByTimeAsync(0);
      expect(callCount).toBe(1);
      expect(completed).toBe(false);

      await vi.advanceTimersByTimeAsync(300);
      expect(callCount).toBe(2);
      expect(completed).toBe(false);

      // Abort
      abortCtrl.abort();
      await expect(pollPromise).rejects.toThrow();
    });

    it('stops polling immediately on failed / stale-conflict terminal state', async () => {
      vi.useFakeTimers();

      const failedCr: ArtifactChangeRequestDTO = {
        id: 'cr-102',
        artifactId: 'art-1',
        baseRevisionNumber: 1,
        baseContentHashHex: 'hash1',
        requestedByUserId: 'usr-1',
        instructionText: 'Update hook',
        selectedVideoNumbers: [1],
        targetVariantCount: 1,
        status: 'failed',
        failureCode: 'stale_base_conflict',
        failureReason:
          'Stale base revision: artifact was updated by another revision prior to change request completion',
        resultingRevisionNumber: null,
        createdAt: '2026-11-09T00:00:00.000Z',
        updatedAt: '2026-11-09T00:00:02.000Z',
        version: 2,
      };

      let callCount = 0;
      globalThis.fetch = vi.fn().mockImplementation(async () => {
        callCount++;
        return {
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => failedCr,
        };
      });

      const abortCtrl = new AbortController();
      const res = await pollChangeRequestUntilTerminal(
        'ws-1',
        'art-1',
        'cr-102',
        abortCtrl.signal,
        undefined,
        { intervalMs: 500, maxAttempts: 10 },
      );

      expect(callCount).toBe(1);
      expect(res.status).toBe('failed');
      expect(res.failureCode).toBe('stale_base_conflict');

      // Advance timers to confirm no further calls were made
      await vi.advanceTimersByTimeAsync(2000);
      expect(callCount).toBe(1);
    });

    it('aborts cleanly on unmount / signal abort without leaking background timers', async () => {
      vi.useFakeTimers();

      const pendingCr: ArtifactChangeRequestDTO = {
        id: 'cr-103',
        artifactId: 'art-1',
        baseRevisionNumber: 1,
        baseContentHashHex: 'hash1',
        requestedByUserId: 'usr-1',
        instructionText: 'Update hook',
        selectedVideoNumbers: [1],
        targetVariantCount: 1,
        status: 'pending',
        resultingRevisionNumber: null,
        failureReason: null,
        createdAt: '2026-11-09T00:00:00.000Z',
        updatedAt: '2026-11-09T00:00:01.000Z',
        version: 1,
      };

      globalThis.fetch = vi.fn().mockImplementation(async () => ({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => pendingCr,
      }));

      const abortCtrl = new AbortController();
      const pollPromise = pollChangeRequestUntilTerminal(
        'ws-1',
        'art-1',
        'cr-103',
        abortCtrl.signal,
        undefined,
        { intervalMs: 1000, maxAttempts: 10 },
      );

      await vi.advanceTimersByTimeAsync(0);
      abortCtrl.abort();

      await expect(pollPromise).rejects.toThrow(/abort/i);
    });
  });

  describe('2. Idempotency Key Retention Across Ambiguous Client Retries', () => {
    it('reuses identical key when retrying identical payload after ambiguous failure, and rotates key when payload changes', () => {
      const keys = ['key-alpha', 'key-beta', 'key-gamma'];
      let keyIdx = 0;
      const tracker = new IdempotencyKeyTracker(() => keys[keyIdx++] ?? null);

      const payload1 = {
        expectedVersion: 1,
        baseRevisionNumber: 1,
        baseContentHashHex: 'hash1',
        instructionText: 'Improve clarity in hook',
        selectedVideoNumbers: [1, 2] as const,
        targetVariantCount: 1,
      };

      const sig1 = normalizeRequestChangesPayload('ws-1', 'art-1', payload1);
      const firstKey = tracker.getKey(sig1);
      expect(firstKey).toBe('key-alpha');

      // Ambiguous retry: user sends the identical payload again
      const retryKey = tracker.getKey(sig1);
      expect(retryKey).toBe('key-alpha'); // Exact same key reused!
      expect(keyIdx).toBe(1);

      // Payload changes: user edits instruction text
      const payload2 = {
        ...payload1,
        instructionText: 'Make hook shorter and more dramatic',
      };
      const sig2 = normalizeRequestChangesPayload('ws-1', 'art-1', payload2);
      const changedKey = tracker.getKey(sig2);
      expect(changedKey).toBe('key-beta'); // Rotated to new key!
      expect(keyIdx).toBe(2);

      // Clearing tracker after definitive server response
      tracker.clear();
      const nextKey = tracker.getKey(sig2);
      expect(nextKey).toBe('key-gamma'); // Rotated after clear!
    });

    it('normalizes manual save payload for reliable comparison', () => {
      const pkg = createMockScriptPackage();
      const payloadA = {
        expectedVersion: 1,
        baseRevisionNumber: 1,
        baseContentHashHex: 'hash1',
        rawContent: pkg,
        note: '  Changed CTA  ',
      };
      const payloadB = {
        expectedVersion: 1,
        baseRevisionNumber: 1,
        baseContentHashHex: 'hash1',
        rawContent: pkg,
        note: 'Changed CTA',
      };

      const sigA = normalizeManualSavePayload('ws-1', 'art-1', payloadA);
      const sigB = normalizeManualSavePayload('ws-1', 'art-1', payloadB);
      expect(sigA).toBe(sigB);
    });

    it('fails visibly without making network requests if Web Crypto is unavailable', async () => {
      // Simulate unavailable Web Crypto
      Object.defineProperty(globalThis, 'crypto', {
        value: undefined,
        configurable: true,
        writable: true,
      });

      const key = generateCryptoIdempotencyKey();
      expect(key).toBeNull(); // Never falls back to string 'key' or Math.random!

      // Verify createManualRevisionApi rejects when key is empty/null without calling fetch
      globalThis.fetch = vi.fn();
      const pkg = createMockScriptPackage();

      await expect(
        createManualRevisionApi(
          'ws-1',
          'art-1',
          {
            expectedVersion: 1,
            baseRevisionNumber: 1,
            baseContentHashHex: 'hash1',
            rawContent: pkg,
          },
          '', // Empty key
        ),
      ).rejects.toThrow(/Idempotency key is required/);

      expect(globalThis.fetch).not.toHaveBeenCalled();

      await expect(
        requestScriptChangesApi(
          'ws-1',
          'art-1',
          {
            expectedVersion: 1,
            baseRevisionNumber: 1,
            baseContentHashHex: 'hash1',
            instructionText: 'Update',
            selectedVideoNumbers: [1],
            targetVariantCount: 1,
          },
          '   ', // Whitespace key
        ),
      ).rejects.toThrow(/Idempotency key is required/);

      expect(globalThis.fetch).not.toHaveBeenCalled();
    });
  });
});
