import { describe, expect, it } from 'vitest';
import {
  validateAnalysis,
  validateAnalysisList,
  validateAnalysisSummary,
  validateOperation,
  validateEnqueueResponse,
  validateAIPolicy,
} from '../src/lib/catalog-validators-analysis.js';

describe('Catalog Analysis Validators', () => {
  const validSummary = {
    id: '0192b012-3456-789a-8bcd-ef0123456701',
    productId: '0192b012-3456-789a-8bcd-ef0123456702',
    analysisType: 'product',
    status: 'generated',
    factSetRevision: 1,
    provider: 'google',
    model: 'gemini-3.8-flash',
    version: 1,
    createdAt: '2026-11-06T12:00:00Z',
    updatedAt: '2026-11-06T12:00:00Z',
  };

  it('validates valid analysis summary', () => {
    const res = validateAnalysisSummary(validSummary);
    expect(res.id).toBe(validSummary.id);
    expect(res.analysisType).toBe('product');
    expect(res.status).toBe('generated');
  });

  it('throws on invalid summary fields', () => {
    expect(() => validateAnalysisSummary(null)).toThrow('Analysis summary must be an object');
    expect(() => validateAnalysisSummary({ ...validSummary, id: 'bad-id' })).toThrow(
      'Invalid analysis id',
    );
    expect(() => validateAnalysisSummary({ ...validSummary, status: 'invalid_status' })).toThrow(
      'Invalid analysis status',
    );
  });

  it('validates full analysis DTO', () => {
    const validFull = {
      ...validSummary,
      workspaceId: '0192b012-3456-789a-8bcd-ef0123456703',
      factSetId: '0192b012-3456-789a-8bcd-ef0123456704',
      content: { summary: 'Great desk chair' },
      contentHash: 'hash123',
      isRepair: false,
      reviewedByUserId: null,
      reviewedAt: null,
      rejectionReason: null,
    };
    const res = validateAnalysis(validFull);
    expect(res.workspaceId).toBe(validFull.workspaceId);
    expect(res.content).toEqual({ summary: 'Great desk chair' });
  });

  it('validates analysis list', () => {
    const listData = {
      items: [validSummary],
      nextCursor: 'next-123',
    };
    const res = validateAnalysisList(listData);
    expect(res.items).toHaveLength(1);
    expect(res.page.nextCursor).toBe('next-123');
    expect(res.page.hasMore).toBe(true);
  });

  it('validates operation DTO', () => {
    const validOp = {
      id: '0192b012-3456-789a-8bcd-ef0123456705',
      workspaceId: '0192b012-3456-789a-8bcd-ef0123456703',
      operationType: 'product_analysis',
      status: 'queued',
      resourceId: '0192b012-3456-789a-8bcd-ef0123456702',
      resourceType: 'product',
      progressPercent: null,
      resultLocation: null,
      errorCode: null,
      errorCategory: null,
      errorMessage: null,
      startedAt: null,
      completedAt: null,
      version: 1,
      createdAt: '2026-11-06T12:00:00Z',
      updatedAt: '2026-11-06T12:00:00Z',
    };
    const res = validateOperation(validOp);
    expect(res.status).toBe('queued');
    expect(res.operationType).toBe('product_analysis');
  });

  it('validates enqueue response', () => {
    const res = validateEnqueueResponse({
      operationId: '0192b012-3456-789a-8bcd-ef0123456705',
      location: '/api/v1/workspaces/ws1/operations/op1',
      status: 'queued',
    });
    expect(res.operationId).toBe('0192b012-3456-789a-8bcd-ef0123456705');
  });

  it('validates AI policy DTO', () => {
    const policy = {
      workspaceId: '0192b012-3456-789a-8bcd-ef0123456703',
      aiEnabled: true,
      monthlyBudgetMicrounits: 50000000,
      currentSpendMicrounits: 100000,
      reservedSpendMicrounits: 50000,
      rateLimitPerMinute: 60,
      budgetPeriodStart: '2026-11-01T00:00:00Z',
      updatedAt: '2026-11-06T12:00:00Z',
      version: 1,
    };
    const res = validateAIPolicy(policy);
    expect(res.aiEnabled).toBe(true);
    expect(res.monthlyBudgetMicrounits).toBe(50000000);
  });

  it('rejects unsafe or out-of-range AI policy values', () => {
    const policy = {
      workspaceId: '0192b012-3456-789a-8bcd-ef0123456703',
      aiEnabled: true,
      monthlyBudgetMicrounits: 50000000,
      currentSpendMicrounits: 100000,
      reservedSpendMicrounits: 50000,
      rateLimitPerMinute: 60,
      budgetPeriodStart: '2026-11-01T00:00:00Z',
      updatedAt: '2026-11-06T12:00:00Z',
      version: 1,
    };

    expect(() => validateAIPolicy({ ...policy, monthlyBudgetMicrounits: -1 })).toThrow(
      'Invalid monthlyBudgetMicrounits',
    );
    expect(() => validateAIPolicy({ ...policy, rateLimitPerMinute: 1001 })).toThrow(
      'Invalid rateLimitPerMinute',
    );
    expect(() => validateAIPolicy({ ...policy, version: 1.5 })).toThrow('Invalid version');
    expect(() => validateAIPolicy({ ...policy, updatedAt: 'not-a-date' })).toThrow(
      'Invalid updatedAt',
    );
  });
});
