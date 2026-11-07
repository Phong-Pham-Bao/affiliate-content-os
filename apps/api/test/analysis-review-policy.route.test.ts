import { describe, expect, it } from 'vitest';
import {
  parseAnalysisId,
  parseAIRunId,
  parseIsoTimestamp,
  parseProductFactSetId,
  parseProductId,
  parseUserId,
} from '@affiliate-content-os/domain';
import { createApp } from '../src/app.js';
import { COOKIE_SESSION } from '../src/auth/constants.js';
import { TEST_WORKSPACE_ID } from './helpers/catalog-test-deps.js';
import { createTestAnalysisDeps } from './helpers/analysis-test-deps.js';

describe('Analysis Review & Policy Routes', () => {
  const sessionCookie = 'A'.repeat(43);
  const productId = '0192b012-3456-789a-8bcd-ef0123456705';
  const factSetId = '0192b012-3456-789a-8bcd-ef0123456706';
  const analysisId = '0192b012-3456-789a-8bcd-ef0123456707';

  it('POST accept and reject analysis with concurrency check', async () => {
    const { deps, savedAnalyses } = createTestAnalysisDeps();
    savedAnalyses.set(analysisId, {
      id: parseAnalysisId(analysisId),
      workspaceId: TEST_WORKSPACE_ID,
      productId: parseProductId(productId),
      analysisType: 'product',
      status: 'generated',
      revisionNumber: 1,
      factSetId: parseProductFactSetId(factSetId),
      aiRunId: parseAIRunId('0192b012-3456-789a-8bcd-ef0123456715'),
      contentJson: { summary: 'Great chair' },
      schemaVersion: 1,
      reviewedByUserId: null,
      reviewedAt: null,
      reviewReason: null,
      createdByUserId: parseUserId('0192b012-3456-789a-8bcd-ef0123456701'),
      version: 1,
      createdAt: parseIsoTimestamp('2026-11-02T12:00:00.000Z'),
      updatedAt: parseIsoTimestamp('2026-11-02T12:00:00.000Z'),
    });

    const app = createApp({ auth: deps.auth, analysis: deps });
    const acceptRes = await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/analyses/${analysisId}/accept`,
      cookies: { [COOKIE_SESSION]: sessionCookie },
      headers: {
        origin: 'http://127.0.0.1:3000',
        'if-match': '"1"',
      },
      payload: {},
    });
    expect(acceptRes.statusCode).toBe(200);
    expect(acceptRes.json().status).toBe('accepted');
    expect(acceptRes.headers.etag).toBe('"2"');

    const rejectRes = await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/analyses/${analysisId}/reject`,
      cookies: { [COOKIE_SESSION]: sessionCookie },
      headers: {
        origin: 'http://127.0.0.1:3000',
        'if-match': '"2"',
      },
      payload: {
        reason: 'Missing key benefits details',
      },
    });
    expect(rejectRes.statusCode).toBe(409);
    expect(rejectRes.json().code).toBe('REVIEW_CONFLICT');
  });

  it('PUT ai-policy updates workspace policy', async () => {
    const { deps } = createTestAnalysisDeps();
    const app = createApp({ auth: deps.auth, analysis: deps });

    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/ai-policy`,
      cookies: { [COOKIE_SESSION]: sessionCookie },
      headers: {
        origin: 'http://127.0.0.1:3000',
        'if-match': '"1"',
      },
      payload: {
        aiEnabled: true,
        monthlyBudgetMicrounits: 50_000_000,
        rateLimitPerMinute: 30,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.aiEnabled).toBe(true);
    expect(body.monthlyBudgetMicrounits).toBe(50_000_000);
    expect(body.version).toBe(2);
  });

  it('PUT ai-policy rejects an active editor', async () => {
    const { deps } = createTestAnalysisDeps({ defaultRole: 'editor' });
    const app = createApp({ auth: deps.auth, analysis: deps });

    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/ai-policy`,
      cookies: { [COOKIE_SESSION]: sessionCookie },
      headers: { origin: 'http://127.0.0.1:3000', 'if-match': '"1"' },
      payload: {
        aiEnabled: true,
        monthlyBudgetMicrounits: 50_000_000,
        rateLimitPerMinute: 30,
      },
    });

    expect(res.statusCode).toBe(404);
  });
});
