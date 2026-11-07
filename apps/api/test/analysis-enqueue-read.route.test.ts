import { describe, expect, it } from 'vitest';
import {
  parseAnalysisId,
  parseAIRunId,
  parseIsoTimestamp,
  parseOperationId,
  parseProductFactId,
  parseProductFactSetId,
  parseProductId,
  parseUserId,
  type ProductFactSetSnapshot,
  type ProductFactSnapshot,
  type ProductSnapshot,
} from '@affiliate-content-os/domain';
import { createApp } from '../src/app.js';
import { COOKIE_SESSION } from '../src/auth/constants.js';
import { TEST_WORKSPACE_ID } from './helpers/catalog-test-deps.js';
import { createTestAnalysisDeps } from './helpers/analysis-test-deps.js';

describe('Analysis Enqueue & Read Routes', () => {
  const sessionCookie = 'A'.repeat(43);
  const productId = '0192b012-3456-789a-8bcd-ef0123456705';
  const factSetId = '0192b012-3456-789a-8bcd-ef0123456706';
  const analysisId = '0192b012-3456-789a-8bcd-ef0123456707';
  const operationId = '0192b012-3456-789a-8bcd-ef0123456708';

  it('POST analysis returns 202 + Location with valid payload', async () => {
    const { deps, catalogPersistence } = createTestAnalysisDeps();
    catalogPersistence.products.set(`${TEST_WORKSPACE_ID}:${productId}`, {
      id: parseProductId(productId),
      workspaceId: TEST_WORKSPACE_ID,
      title: 'Ergonomic Desk Chair',
      description: 'Comfortable mesh chair',
      category: 'Furniture',
      status: 'active',
      tags: [],
      createdAt: parseIsoTimestamp('2026-11-02T12:00:00.000Z'),
      updatedAt: parseIsoTimestamp('2026-11-02T12:00:00.000Z'),
      version: 1,
    } as unknown as ProductSnapshot);

    const fact: ProductFactSnapshot = {
      id: parseProductFactId('0192b012-3456-789a-8bcd-ef0123456711'),
      workspaceId: TEST_WORKSPACE_ID,
      productId: parseProductId(productId),
      factSetId: parseProductFactSetId(factSetId),
      factKey: 'material',
      valueText: 'mesh',
      sourceType: 'user',
      sourceUrl: null,
      sourceExcerpt: null,
      confidence: 'confirmed',
      claimUsage: 'allowed',
      createdAt: parseIsoTimestamp('2026-11-02T12:00:00.000Z'),
    };
    catalogPersistence.factSets.set(`${TEST_WORKSPACE_ID}:${productId}:${factSetId}`, {
      id: parseProductFactSetId(factSetId),
      workspaceId: TEST_WORKSPACE_ID,
      productId: parseProductId(productId),
      status: 'confirmed',
      revisionNumber: 1,
      createdAt: parseIsoTimestamp('2026-11-02T12:00:00.000Z'),
      updatedAt: parseIsoTimestamp('2026-11-02T12:00:00.000Z'),
      version: 1,
    } as unknown as ProductFactSetSnapshot);
    catalogPersistence.factSetFacts.set(`${TEST_WORKSPACE_ID}:${productId}:${factSetId}`, [fact]);

    const app = createApp({ auth: deps.auth, analysis: deps });
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/products/${productId}/analyses`,
      cookies: { [COOKIE_SESSION]: sessionCookie },
      headers: {
        origin: 'http://127.0.0.1:3000',
        'idempotency-key': '0192b012-3456-789a-8bcd-ef0123456799',
      },
      payload: {
        analysisType: 'product',
        factSetId,
      },
    });

    expect(res.statusCode).toBe(202);
    expect(res.headers.location).toMatch(/\/operations\//);
    const body = res.json();
    expect(body.operationId).toBeDefined();
    expect(body.status).toBe('queued');
  });

  it('GET analyses list and GET single analysis', async () => {
    const { deps, savedAnalyses, catalogPersistence } = createTestAnalysisDeps();
    catalogPersistence.products.set(`${TEST_WORKSPACE_ID}:${productId}`, {
      id: parseProductId(productId),
      workspaceId: TEST_WORKSPACE_ID,
      title: 'Ergonomic Desk Chair',
      description: 'Comfortable mesh chair',
      category: 'Furniture',
      status: 'active',
      tags: [],
      createdAt: parseIsoTimestamp('2026-11-02T12:00:00.000Z'),
      updatedAt: parseIsoTimestamp('2026-11-02T12:00:00.000Z'),
      version: 1,
    } as unknown as ProductSnapshot);

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
    const listRes = await app.inject({
      method: 'GET',
      url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/products/${productId}/analyses`,
      cookies: { [COOKIE_SESSION]: sessionCookie },
    });
    expect(listRes.statusCode).toBe(200);
    expect(listRes.json().items).toHaveLength(1);

    const getRes = await app.inject({
      method: 'GET',
      url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/analyses/${analysisId}`,
      cookies: { [COOKIE_SESSION]: sessionCookie },
    });
    expect(getRes.statusCode).toBe(200);
    expect(getRes.headers.etag).toBe('"1"');
    expect(getRes.json().id).toBe(analysisId);
  });

  it('GET operation returns operation snapshot', async () => {
    const { deps, savedOperations } = createTestAnalysisDeps();
    savedOperations.set(operationId, {
      id: parseOperationId(operationId),
      workspaceId: TEST_WORKSPACE_ID,
      operationType: 'product_analysis',
      resourceType: 'product',
      resourceId: parseProductId(productId),
      status: 'queued',
      progressPercent: null,
      resultLocation: null,
      errorCategory: null,
      errorCode: null,
      errorMessage: null,
      requestedByUserId: parseUserId('0192b012-3456-789a-8bcd-ef0123456701'),
      startedAt: null,
      completedAt: null,
      version: 1,
      createdAt: parseIsoTimestamp('2026-11-02T12:00:00.000Z'),
      updatedAt: parseIsoTimestamp('2026-11-02T12:00:00.000Z'),
    });

    const app = createApp({ auth: deps.auth, analysis: deps });
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/operations/${operationId}`,
      cookies: { [COOKIE_SESSION]: sessionCookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe(operationId);
    expect(res.json().status).toBe('queued');
  });
});
