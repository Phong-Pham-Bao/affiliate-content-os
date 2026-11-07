import { describe, expect, it, vi } from 'vitest';
import { reviewAnalysis, type ReviewAnalysisDependencies } from '../../src/index.js';
import { ReviewConflictError } from '../../src/analysis/errors.js';
import { ValidationError, WorkspaceAccessDeniedError } from '../../src/errors.js';
import type { WorkspaceMembershipSnapshot } from '@affiliate-content-os/domain';

describe('reviewAnalysis use case', () => {
  const wsId = '018f6c5b-21a4-789a-8def-000000000001';
  const analysisId = '018f6c5b-21a4-789a-8def-000000000002';
  const userId = '018f6c5b-21a4-789a-8def-000000000003';

  function createMockDeps(
    analysisStatus: 'generated' | 'accepted' | 'rejected' = 'generated',
  ): ReviewAnalysisDependencies {
    return {
      authPort: {
        findMembership: vi.fn().mockResolvedValue({
          id: '018f6c5b-21a4-789a-8def-000000000004',
          workspaceId: wsId,
          userId,
          role: 'editor',
          status: 'active',
          createdAt: '2026-11-06T00:00:00.000Z',
          updatedAt: '2026-11-06T00:00:00.000Z',
          version: 1,
        }),
      },
      analysisPort: {
        getAnalysisById: vi.fn(),
        listAnalyses: vi.fn(),
        reviewAnalysisAtomic: vi.fn().mockImplementation(async (params) => {
          if (analysisStatus === params.decision) {
            return {
              id: analysisId,
              workspaceId: wsId,
              productId: '018f6c5b-21a4-789a-8def-000000000010',
              analysisType: 'product',
              revisionNumber: 1,
              factSetId: '018f6c5b-21a4-789a-8def-000000000020',
              aiRunId: '018f6c5b-21a4-789a-8def-000000000030',
              contentJson: { summary: 'test' },
              schemaVersion: 1,
              status: analysisStatus,
              reviewedByUserId: userId,
              reviewedAt: '2026-11-06T10:00:00.000Z',
              reviewReason: null,
              createdByUserId: userId,
              createdAt: '2026-11-06T09:00:00.000Z',
              updatedAt: '2026-11-06T09:00:00.000Z',
              version: 1,
            };
          }
          if (analysisStatus !== 'generated') {
            throw new ReviewConflictError(
              'Cannot change review decision on already reviewed analysis',
            );
          }
          return {
            id: analysisId,
            workspaceId: wsId,
            productId: '018f6c5b-21a4-789a-8def-000000000010',
            analysisType: 'product',
            revisionNumber: 1,
            factSetId: '018f6c5b-21a4-789a-8def-000000000020',
            aiRunId: '018f6c5b-21a4-789a-8def-000000000030',
            contentJson: { summary: 'test' },
            schemaVersion: 1,
            status: params.decision,
            reviewedByUserId: params.reviewedByUserId,
            reviewedAt: params.reviewedAt,
            reviewReason: params.reviewReason ?? null,
            createdByUserId: userId,
            createdAt: '2026-11-06T09:00:00.000Z',
            updatedAt: params.reviewedAt,
            version: 2,
          };
        }),
      },
      clock: { now: () => new Date('2026-11-06T12:00:00.000Z') },
    };
  }

  it('rejects caller with insufficient role with WorkspaceAccessDeniedError', async () => {
    const deps = createMockDeps('generated');
    deps.authPort.findMembership = vi.fn().mockResolvedValue({
      role: 'viewer',
      status: 'active',
    } as unknown as WorkspaceMembershipSnapshot);

    await expect(
      reviewAnalysis(
        {
          workspaceId: wsId,
          analysisId,
          decision: 'accepted',
          expectedVersion: 1,
          actorUserId: userId,
        },
        deps,
      ),
    ).rejects.toThrow(WorkspaceAccessDeniedError);
  });

  it('accepts a generated analysis and commits review and audit atomically', async () => {
    const deps = createMockDeps('generated');
    const result = await reviewAnalysis(
      {
        workspaceId: wsId,
        analysisId,
        decision: 'accepted',
        expectedVersion: 1,
        actorUserId: userId,
      },
      deps,
    );

    expect(result.status).toBe('accepted');
    expect(deps.analysisPort.reviewAnalysisAtomic).toHaveBeenCalledOnce();
    const mockReview = vi.mocked(deps.analysisPort.reviewAnalysisAtomic);
    const callArgs = mockReview.mock.calls[0]?.[0];
    expect(callArgs?.decision).toBe('accepted');
    expect(callArgs?.auditEvent).toBeDefined();
    expect(callArgs?.auditEvent.action).toBe('analysis.accepted');
  });

  it('rejects a generated analysis with reason and commits review and audit atomically', async () => {
    const deps = createMockDeps('generated');
    const result = await reviewAnalysis(
      {
        workspaceId: wsId,
        analysisId,
        decision: 'rejected',
        expectedVersion: 1,
        reason: 'Missing key benefit detail',
        actorUserId: userId,
      },
      deps,
    );

    expect(result.status).toBe('rejected');
    expect(deps.analysisPort.reviewAnalysisAtomic).toHaveBeenCalledOnce();
    const mockReview = vi.mocked(deps.analysisPort.reviewAnalysisAtomic);
    const callArgs = mockReview.mock.calls[0]?.[0];
    expect(callArgs?.decision).toBe('rejected');
    expect(callArgs?.reviewReason).toBe('Missing key benefit detail');
  });

  it('same review decision is idempotent and does not create conflicting mutation', async () => {
    const deps = createMockDeps('accepted');
    const result = await reviewAnalysis(
      {
        workspaceId: wsId,
        analysisId,
        decision: 'accepted',
        expectedVersion: 1,
        actorUserId: userId,
      },
      deps,
    );

    expect(result.status).toBe('accepted');
    expect(deps.analysisPort.reviewAnalysisAtomic).toHaveBeenCalledOnce();
  });

  it('opposite review decision produces stable ReviewConflictError', async () => {
    const deps = createMockDeps('accepted');
    await expect(
      reviewAnalysis(
        {
          workspaceId: wsId,
          analysisId,
          decision: 'rejected',
          expectedVersion: 1,
          actorUserId: userId,
        },
        deps,
      ),
    ).rejects.toThrow(ReviewConflictError);
  });

  it('rejects invalid reason with control characters', async () => {
    const deps = createMockDeps('generated');
    await expect(
      reviewAnalysis(
        {
          workspaceId: wsId,
          analysisId,
          decision: 'rejected',
          expectedVersion: 1,
          reason: 'Invalid\x00control',
          actorUserId: userId,
        },
        deps,
      ),
    ).rejects.toThrow(ValidationError);
  });
});
