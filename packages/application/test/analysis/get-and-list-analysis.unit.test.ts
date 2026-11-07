import { describe, expect, it, vi } from 'vitest';
import {
  getAnalysis,
  getOperation,
  listAnalyses,
  type AnalysisPersistencePort,
  type CatalogPersistencePort,
  type OperationPersistencePort,
} from '../../src/index.js';
import { AnalysisNotFoundError, OperationNotFoundError } from '../../src/analysis/errors.js';
import { ProductNotFoundError } from '../../src/catalog/errors.js';
import { WorkspaceAccessDeniedError } from '../../src/errors.js';
import type { AnalysisSnapshot, OperationSnapshot } from '@affiliate-content-os/domain';

describe('get and list analysis use cases', () => {
  const wsId = '018f6c5b-21a4-789a-8def-000000000001';
  const prodId = '018f6c5b-21a4-789a-8def-000000000002';
  const analysisId = '018f6c5b-21a4-789a-8def-000000000003';
  const opId = '018f6c5b-21a4-789a-8def-000000000004';
  const userId = '018f6c5b-21a4-789a-8def-000000000005';

  const authPort = {
    findMembership: vi.fn().mockResolvedValue({
      id: '018f6c5b-21a4-789a-8def-000000000006',
      workspaceId: wsId,
      userId,
      role: 'viewer',
      status: 'active',
      createdAt: '2026-11-06T00:00:00.000Z',
      updatedAt: '2026-11-06T00:00:00.000Z',
      version: 1,
    }),
  };

  it('throws WorkspaceAccessDeniedError when user has no active membership', async () => {
    const deniedAuth = {
      findMembership: vi.fn().mockResolvedValue(null),
    };
    await expect(
      getAnalysis(
        { workspaceId: wsId, analysisId, actorUserId: userId },
        { authPort: deniedAuth, analysisPort: {} as unknown as AnalysisPersistencePort },
      ),
    ).rejects.toThrow(WorkspaceAccessDeniedError);
  });

  it('getAnalysis returns analysis snapshot when authorized', async () => {
    const analysisPort: AnalysisPersistencePort = {
      getAnalysisById: vi.fn().mockResolvedValue({
        id: analysisId,
        workspaceId: wsId,
        productId: prodId,
        status: 'generated',
      } as unknown as AnalysisSnapshot),
      listAnalyses: vi.fn(),
      reviewAnalysisAtomic: vi.fn(),
    };

    const res = await getAnalysis(
      { workspaceId: wsId, analysisId, actorUserId: userId },
      { authPort, analysisPort },
    );
    expect(res.id).toBe(analysisId);
  });

  it('getAnalysis throws AnalysisNotFoundError when not found', async () => {
    const analysisPort: AnalysisPersistencePort = {
      getAnalysisById: vi.fn().mockResolvedValue(null),
      listAnalyses: vi.fn(),
      reviewAnalysisAtomic: vi.fn(),
    };

    await expect(
      getAnalysis(
        { workspaceId: wsId, analysisId, actorUserId: userId },
        { authPort, analysisPort },
      ),
    ).rejects.toThrow(AnalysisNotFoundError);
  });

  it('getOperation returns operation snapshot when authorized', async () => {
    const operationPort: OperationPersistencePort = {
      getOperationById: vi.fn().mockResolvedValue({
        id: opId,
        workspaceId: wsId,
        status: 'queued',
      } as unknown as OperationSnapshot),
    };

    const res = await getOperation(
      { workspaceId: wsId, operationId: opId, actorUserId: userId },
      { authPort, operationPort },
    );
    expect(res.id).toBe(opId);
  });

  it('getOperation throws OperationNotFoundError when not found', async () => {
    const operationPort: OperationPersistencePort = {
      getOperationById: vi.fn().mockResolvedValue(null),
    };

    await expect(
      getOperation(
        { workspaceId: wsId, operationId: opId, actorUserId: userId },
        { authPort, operationPort },
      ),
    ).rejects.toThrow(OperationNotFoundError);
  });

  it('listAnalyses throws ProductNotFoundError when product does not exist in workspace', async () => {
    const catalogPort = {
      findProductById: vi.fn().mockResolvedValue(null),
    } as unknown as CatalogPersistencePort;
    const analysisPort = {
      listAnalyses: vi.fn(),
    } as unknown as AnalysisPersistencePort;

    await expect(
      listAnalyses(
        { workspaceId: wsId, productId: prodId, actorUserId: userId },
        { authPort, catalogPort, analysisPort },
      ),
    ).rejects.toThrow(ProductNotFoundError);
  });
});
