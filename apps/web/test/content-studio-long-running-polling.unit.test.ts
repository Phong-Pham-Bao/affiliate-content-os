import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PollingDeadlineError,
  pollChangeRequestUntilTerminal,
} from '../src/lib/workforce-operation-polling.js';
import type { ArtifactChangeRequestDTO } from '../src/types/script-studio.js';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import { ContentStudioStatusBanner } from '../src/components/workforce/content-studio/content-studio-status-banner.js';

describe('TASK-013-REMEDIATION-03: Long-running Polling Deadline & Resume Correctness', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
  });

  describe('1. Simulated 50-minute lifecycle & Bounded Backoff', () => {
    it('continues polling across a 50-minute legitimate duration with bounded backoff and returns completed DTO', async () => {
      vi.useFakeTimers();

      const startTime = Date.now();
      const fiftyMinutesMs = 50 * 60 * 1000; // 3,000,000 ms

      const baseCr: ArtifactChangeRequestDTO = {
        id: 'cr-long-running-50m',
        artifactId: 'art-1',
        baseRevisionNumber: 1,
        baseContentHashHex: 'hash-abc',
        requestedByUserId: 'usr-1',
        instructionText: 'Refine hook and scenes across 5 videos',
        selectedVideoNumbers: [1, 2, 3, 4, 5],
        targetVariantCount: 1,
        status: 'in_progress',
        resultingRevisionNumber: null,
        failureReason: null,
        createdAt: new Date(startTime).toISOString(),
        updatedAt: new Date(startTime).toISOString(),
        version: 1,
      };

      let fetchCount = 0;
      const pollTimestamps: number[] = [];

      globalThis.fetch = vi.fn().mockImplementation(async () => {
        fetchCount++;
        const elapsed = Date.now() - startTime;
        pollTimestamps.push(elapsed);

        // At or after 50 minutes, the server finishes script generation
        if (elapsed >= fiftyMinutesMs) {
          return {
            ok: true,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({
              ...baseCr,
              status: 'completed' as const,
              resultingRevisionNumber: 2,
              updatedAt: new Date(Date.now()).toISOString(),
              version: 2,
            }),
          };
        }

        return {
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            ...baseCr,
            updatedAt: new Date(Date.now()).toISOString(),
          }),
        };
      });

      const abortCtrl = new AbortController();
      const updates: ArtifactChangeRequestDTO[] = [];

      let finalResult: ArtifactChangeRequestDTO | null = null;
      const pollPromise = pollChangeRequestUntilTerminal(
        'ws-1',
        'art-1',
        'cr-long-running-50m',
        abortCtrl.signal,
        (cr) => updates.push(cr),
      ).then((res) => {
        finalResult = res;
        return res;
      });

      // First fetch happens immediately at t=0
      await vi.advanceTimersByTimeAsync(0);
      expect(fetchCount).toBe(1);
      expect(updates[0]?.status).toBe('in_progress');

      // Advance timers across the 50-minute legitimate duration
      while (!finalResult) {
        await vi.advanceTimersByTimeAsync(15000);
      }

      const result = await pollPromise;

      expect(result.status).toBe('completed');
      expect(result.resultingRevisionNumber).toBe(2);
      expect(fetchCount).toBeGreaterThan(150); // Continues polling across 50 minutes
      expect(updates[updates.length - 1]?.status).toBe('completed');

      // Verify bounded backoff: intervals grow then stay capped at 15000ms
      const interval1 = pollTimestamps[1]! - pollTimestamps[0]!;
      expect(interval1).toBe(2000); // initialIntervalMs

      const interval2 = pollTimestamps[2]! - pollTimestamps[1]!;
      expect(interval2).toBe(3000); // 2000 * 1.5

      // Later intervals should be capped at 15000ms
      const lateInterval = pollTimestamps[50]! - pollTimestamps[49]!;
      expect(lateInterval).toBe(15000);
    });
  });

  describe('2. Polling Deadline Exhaustion', () => {
    it('throws PollingDeadlineError when budget expires and NEVER resolves with a non-terminal response', async () => {
      vi.useFakeTimers();

      const inProgressCr: ArtifactChangeRequestDTO = {
        id: 'cr-never-finishes',
        artifactId: 'art-1',
        baseRevisionNumber: 1,
        baseContentHashHex: 'hash-abc',
        requestedByUserId: 'usr-1',
        instructionText: 'Wait forever',
        selectedVideoNumbers: [1],
        targetVariantCount: 1,
        status: 'in_progress',
        resultingRevisionNumber: null,
        failureReason: null,
        createdAt: '2026-11-09T00:00:00.000Z',
        updatedAt: '2026-11-09T00:00:01.000Z',
        version: 1,
      };

      globalThis.fetch = vi.fn().mockImplementation(async () => ({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => inProgressCr,
      }));

      const abortCtrl = new AbortController();

      // Configure a 10-second maxDuration budget
      const pollPromise = pollChangeRequestUntilTerminal(
        'ws-1',
        'art-1',
        'cr-never-finishes',
        abortCtrl.signal,
        undefined,
        { initialIntervalMs: 2000, maxIntervalMs: 4000, maxDurationMs: 10000 },
      );

      // Attach rejection handler to verify it rejects
      let caughtError: unknown = null;
      pollPromise.catch((err) => {
        caughtError = err;
      });

      // Advance through the entire 10-second budget
      await vi.advanceTimersByTimeAsync(11000);

      expect(caughtError).toBeInstanceOf(PollingDeadlineError);
      const deadlineErr = caughtError as PollingDeadlineError;
      expect(deadlineErr.code).toBe('POLLING_DEADLINE_EXCEEDED');
      expect(deadlineErr.changeRequestId).toBe('cr-never-finishes');
      expect(deadlineErr.elapsedMs).toBeGreaterThanOrEqual(10000);
      expect(deadlineErr.message).toContain('Hết thời gian chờ phản hồi');
    });

    it('throws PollingDeadlineError when maxAttempts is reached', async () => {
      vi.useFakeTimers();

      const inProgressCr: ArtifactChangeRequestDTO = {
        id: 'cr-attempts-exceeded',
        artifactId: 'art-1',
        baseRevisionNumber: 1,
        baseContentHashHex: 'hash-abc',
        requestedByUserId: 'usr-1',
        instructionText: 'Wait forever',
        selectedVideoNumbers: [1],
        targetVariantCount: 1,
        status: 'in_progress',
        resultingRevisionNumber: null,
        failureReason: null,
        createdAt: '2026-11-09T00:00:00.000Z',
        updatedAt: '2026-11-09T00:00:01.000Z',
        version: 1,
      };

      globalThis.fetch = vi.fn().mockImplementation(async () => ({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => inProgressCr,
      }));

      const abortCtrl = new AbortController();

      const pollPromise = pollChangeRequestUntilTerminal(
        'ws-1',
        'art-1',
        'cr-attempts-exceeded',
        abortCtrl.signal,
        undefined,
        { intervalMs: 500, maxAttempts: 3 },
      );

      let caughtError: unknown = null;
      pollPromise.catch((err) => {
        caughtError = err;
      });

      await vi.advanceTimersByTimeAsync(2000);

      expect(caughtError).toBeInstanceOf(PollingDeadlineError);
      const deadlineErr = caughtError as PollingDeadlineError;
      expect(deadlineErr.code).toBe('POLLING_DEADLINE_EXCEEDED');
      expect(deadlineErr.changeRequestId).toBe('cr-attempts-exceeded');
      expect(deadlineErr.attempts).toBe(3);
    });

    it('succeeds if completed right before deadline expires (edge case: milliseconds before deadline)', async () => {
      vi.useFakeTimers();

      const baseCr: ArtifactChangeRequestDTO = {
        id: 'cr-almost-timeout',
        artifactId: 'art-1',
        baseRevisionNumber: 1,
        baseContentHashHex: 'hash-abc',
        requestedByUserId: 'usr-1',
        instructionText: 'Finish in the nick of time',
        selectedVideoNumbers: [1],
        targetVariantCount: 1,
        status: 'in_progress',
        resultingRevisionNumber: null,
        failureReason: null,
        createdAt: '2026-11-09T00:00:00.000Z',
        updatedAt: '2026-11-09T00:00:01.000Z',
        version: 1,
      };

      const startTime = Date.now();
      let fetchCount = 0;

      globalThis.fetch = vi.fn().mockImplementation(async () => {
        fetchCount++;
        const elapsed = Date.now() - startTime;
        // Completes at 9000ms, while maxDurationMs is 10000ms
        if (elapsed >= 9000) {
          return {
            ok: true,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({
              ...baseCr,
              status: 'completed',
              resultingRevisionNumber: 2,
            }),
          };
        }
        return {
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => baseCr,
        };
      });

      const abortCtrl = new AbortController();
      let finalResult: ArtifactChangeRequestDTO | null = null;

      const pollPromise = pollChangeRequestUntilTerminal(
        'ws-1',
        'art-1',
        'cr-almost-timeout',
        abortCtrl.signal,
        undefined,
        { initialIntervalMs: 3000, maxIntervalMs: 3000, maxDurationMs: 10000 },
      ).then((res) => {
        finalResult = res;
        return res;
      });

      // Advance through intervals: t=0 (in_prog), t=3000 (in_prog), t=6000 (in_prog), t=9000 (completed)
      while (!finalResult) {
        await vi.advanceTimersByTimeAsync(3000);
      }

      const result = await pollPromise;
      expect(result.status).toBe('completed');
      expect(result.resultingRevisionNumber).toBe(2);
      expect(fetchCount).toBe(4); // t=0, 3000, 6000, 9000
    });
  });

  describe('3. Abort Cleanup and Timer Cancellation', () => {
    it('aborts immediately during backoff sleep, clears timer, and removes event listener', async () => {
      vi.useFakeTimers();

      const inProgressCr: ArtifactChangeRequestDTO = {
        id: 'cr-abort-test',
        artifactId: 'art-1',
        baseRevisionNumber: 1,
        baseContentHashHex: 'hash-abc',
        requestedByUserId: 'usr-1',
        instructionText: 'Test abort',
        selectedVideoNumbers: [1],
        targetVariantCount: 1,
        status: 'in_progress',
        resultingRevisionNumber: null,
        failureReason: null,
        createdAt: '2026-11-09T00:00:00.000Z',
        updatedAt: '2026-11-09T00:00:01.000Z',
        version: 1,
      };

      let fetchCount = 0;
      globalThis.fetch = vi.fn().mockImplementation(async () => {
        fetchCount++;
        return {
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => inProgressCr,
        };
      });

      const abortCtrl = new AbortController();
      const pollPromise = pollChangeRequestUntilTerminal(
        'ws-1',
        'art-1',
        'cr-abort-test',
        abortCtrl.signal,
        undefined,
        { initialIntervalMs: 5000, maxIntervalMs: 10000 },
      );

      // First fetch happens at t=0
      await vi.advanceTimersByTimeAsync(0);
      expect(fetchCount).toBe(1);

      // Now we are waiting in the 5000ms sleep. Abort at t=2000
      await vi.advanceTimersByTimeAsync(2000);
      abortCtrl.abort();

      await expect(pollPromise).rejects.toThrow(/abort/i);

      // Fast-forward further: no additional fetches should occur
      await vi.advanceTimersByTimeAsync(20000);
      expect(fetchCount).toBe(1);
    });

    it('rejects immediately when signal is already aborted without making network requests', async () => {
      const abortCtrl = new AbortController();
      abortCtrl.abort();

      globalThis.fetch = vi.fn();

      await expect(
        pollChangeRequestUntilTerminal('ws-1', 'art-1', 'cr-pre-aborted', abortCtrl.signal),
      ).rejects.toThrow(/abort/i);

      expect(globalThis.fetch).not.toHaveBeenCalled();
    });
  });

  describe('4. Resume Status Checking & Zero Mutation Invocations', () => {
    it('proves resume reuses identical changeRequestId and makes zero mutation calls or new idempotency keys', async () => {
      vi.useFakeTimers();

      const existingChangeRequestId = 'cr-persisted-789';
      let mutationCallCount = 0;
      let readCallCount = 0;

      // Track all HTTP requests
      globalThis.fetch = vi
        .fn()
        .mockImplementation(async (url: string | URL, init?: RequestInit) => {
          const urlStr = url.toString();
          const method = init?.method ?? 'GET';

          // Check if any mutation endpoint is called
          if (method === 'POST') {
            mutationCallCount++;
            throw new Error(`Forbidden mutation call to ${urlStr}`);
          }

          if (urlStr.includes(`/change-requests/${existingChangeRequestId}`)) {
            readCallCount++;
            // First check after resume finds that the server has completed!
            return {
              ok: true,
              headers: new Headers({ 'content-type': 'application/json' }),
              json: async () => ({
                id: existingChangeRequestId,
                artifactId: 'art-1',
                baseRevisionNumber: 1,
                baseContentHashHex: 'hash-abc',
                requestedByUserId: 'usr-1',
                instructionText: 'Update hook',
                selectedVideoNumbers: [1, 2],
                targetVariantCount: 1,
                status: 'completed',
                resultingRevisionNumber: 2,
                failureReason: null,
                createdAt: '2026-11-09T00:00:00.000Z',
                updatedAt: '2026-11-09T00:50:00.000Z',
                version: 2,
              }),
            };
          }

          throw new Error(`Unexpected endpoint: ${urlStr}`);
        });

      const abortCtrl = new AbortController();

      // Resume action executes polling directly on the existing changeRequestId
      const finalCr = await pollChangeRequestUntilTerminal(
        'ws-1',
        'art-1',
        existingChangeRequestId,
        abortCtrl.signal,
        undefined,
        { initialIntervalMs: 1000 },
      );

      // Verify zero mutations occurred
      expect(mutationCallCount).toBe(0);
      expect(readCallCount).toBe(1);
      expect(finalCr.status).toBe('completed');
      expect(finalCr.id).toBe(existingChangeRequestId);
      expect(finalCr.resultingRevisionNumber).toBe(2);
    });

    it('renders honest polling_deadline banner and enables resume action in UI', () => {
      let resumed = false;
      const html = renderToStaticMarkup(
        React.createElement(ContentStudioStatusBanner, {
          status: 'polling_deadline',
          message:
            'Quá thời gian theo dõi tự động cho yêu cầu thay đổi. Tác vụ vẫn có thể đang chạy trên máy chủ.',
          onResume: () => {
            resumed = true;
          },
        }),
      );

      expect(html).toContain('Chờ phản hồi quá thời gian:');
      expect(html).toContain('Quá thời gian theo dõi tự động');
      expect(html).toContain('Tiếp tục kiểm tra');
      expect(html).toContain('alert-warning');
      expect(resumed).toBe(false);
    });
  });
});
