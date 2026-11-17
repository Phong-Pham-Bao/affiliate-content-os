import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { COOKIE_SESSION } from '../src/auth/constants.js';
import { FOREIGN_WORKSPACE_ID, TEST_WORKSPACE_ID } from './helpers/catalog-test-deps.js';
import {
  createTestWorkforceDeps,
  mockArtifactDetail,
  mockComplianceEvaluation,
} from './helpers/workforce-test-deps.js';

describe('Workforce Compliance & Approval Routes (Checkpoint D)', () => {
  const sessionCookie = 'A'.repeat(43);
  const validOrigin = 'http://127.0.0.1:3000';
  const idempotencyKey = '0192b012-3456-789a-8bcd-ef0123456789';
  const artifactId = mockArtifactDetail.artifact.id;
  const hashHex = 'a'.repeat(64);

  const validAcceptPayload = {
    expectedVersion: 1,
    revisionNumber: 1,
    contentHashHex: hashHex,
    note: 'Looks solid for deployment',
  };

  const validRejectPayload = {
    expectedVersion: 1,
    revisionNumber: 1,
    contentHashHex: hashHex,
    reason: 'Hook promises are not supported by merchant facts',
  };

  it('denies unauthenticated requests on all compliance and decision endpoints', async () => {
    const deps = createTestWorkforceDeps();
    const app = createApp({ auth: deps.auth, workforce: deps });

    const getCompliance = await app.inject({
      method: 'GET',
      url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/artifacts/${artifactId}/compliance`,
    });
    expect(getCompliance.statusCode).toBe(401);

    const getDecisions = await app.inject({
      method: 'GET',
      url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/artifacts/${artifactId}/decisions`,
    });
    expect(getDecisions.statusCode).toBe(401);

    const postAccept = await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/artifacts/${artifactId}/accept`,
      headers: { origin: validOrigin, 'idempotency-key': idempotencyKey },
      payload: validAcceptPayload,
    });
    expect(postAccept.statusCode).toBe(401);

    const postReject = await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/artifacts/${artifactId}/reject`,
      headers: { origin: validOrigin, 'idempotency-key': idempotencyKey },
      payload: validRejectPayload,
    });
    expect(postReject.statusCode).toBe(401);
  });

  it('denies access to foreign workspace (non-disclosing 404)', async () => {
    const deps = createTestWorkforceDeps();
    const app = createApp({ auth: deps.auth, workforce: deps });

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/workspaces/${FOREIGN_WORKSPACE_ID}/artifacts/${artifactId}/compliance`,
      cookies: { [COOKIE_SESSION]: sessionCookie },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('WORKSPACE_NOT_FOUND');
  });

  it('allows viewer role to read compliance and decisions but denies mutations with non-disclosing 404', async () => {
    const deps = createTestWorkforceDeps({ defaultRole: 'viewer' });
    const app = createApp({ auth: deps.auth, workforce: deps });

    const compRes = await app.inject({
      method: 'GET',
      url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/artifacts/${artifactId}/compliance`,
      cookies: { [COOKIE_SESSION]: sessionCookie },
    });
    expect(compRes.statusCode).toBe(200);

    const decRes = await app.inject({
      method: 'GET',
      url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/artifacts/${artifactId}/decisions`,
      cookies: { [COOKIE_SESSION]: sessionCookie },
    });
    expect(decRes.statusCode).toBe(200);

    const acceptRes = await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/artifacts/${artifactId}/accept`,
      cookies: { [COOKIE_SESSION]: sessionCookie },
      headers: {
        origin: validOrigin,
        'idempotency-key': idempotencyKey,
      },
      payload: validAcceptPayload,
    });
    expect(acceptRes.statusCode).toBe(404);
    expect(acceptRes.json().code).toBe('WORKSPACE_NOT_FOUND');

    const rejectRes = await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/artifacts/${artifactId}/reject`,
      cookies: { [COOKIE_SESSION]: sessionCookie },
      headers: {
        origin: validOrigin,
        'idempotency-key': idempotencyKey,
      },
      payload: validRejectPayload,
    });
    expect(rejectRes.statusCode).toBe(404);
    expect(rejectRes.json().code).toBe('WORKSPACE_NOT_FOUND');
  });

  it('denies invalid origin on mutation routes', async () => {
    const deps = createTestWorkforceDeps();
    const app = createApp({ auth: deps.auth, workforce: deps });

    const acceptRes = await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/artifacts/${artifactId}/accept`,
      cookies: { [COOKIE_SESSION]: sessionCookie },
      headers: { origin: 'https://evil.com', 'idempotency-key': idempotencyKey },
      payload: validAcceptPayload,
    });
    expect(acceptRes.statusCode).toBe(403);

    const rejectRes = await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/artifacts/${artifactId}/reject`,
      cookies: { [COOKIE_SESSION]: sessionCookie },
      headers: { origin: 'https://evil.com', 'idempotency-key': idempotencyKey },
      payload: validRejectPayload,
    });
    expect(rejectRes.statusCode).toBe(403);
  });

  it('returns compliance evaluation for current revision', async () => {
    const deps = createTestWorkforceDeps();
    const app = createApp({ auth: deps.auth, workforce: deps });

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/artifacts/${artifactId}/compliance`,
      cookies: { [COOKIE_SESSION]: sessionCookie },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const body = res.json();
    expect(body.id).toBe(mockComplianceEvaluation.id);
    expect(body.status).toBe('completed');
    expect(body.findings).toHaveLength(1);
    expect(body.findings[0].severity).toBe('warning');
  });

  it('returns compliance evaluation for explicit revisionNumber query', async () => {
    const deps = createTestWorkforceDeps();
    const app = createApp({ auth: deps.auth, workforce: deps });

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/artifacts/${artifactId}/compliance?revisionNumber=1`,
      cookies: { [COOKIE_SESSION]: sessionCookie },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().revisionNumber).toBe(1);
  });

  it('returns 404 when compliance evaluation is not found', async () => {
    const deps = createTestWorkforceDeps();
    const app = createApp({ auth: deps.auth, workforce: deps });

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/artifacts/${artifactId}/compliance?revisionNumber=999`,
      cookies: { [COOKIE_SESSION]: sessionCookie },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('COMPLIANCE_EVALUATION_NOT_FOUND');
  });

  it('lists review decisions for an artifact', async () => {
    const deps = createTestWorkforceDeps();
    const app = createApp({ auth: deps.auth, workforce: deps });

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/artifacts/${artifactId}/decisions`,
      cookies: { [COOKIE_SESSION]: sessionCookie },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].decision).toBe('accepted');
  });

  it('accepts script revision when valid and authorized', async () => {
    const deps = createTestWorkforceDeps();
    const app = createApp({ auth: deps.auth, workforce: deps });

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/artifacts/${artifactId}/accept`,
      cookies: { [COOKIE_SESSION]: sessionCookie },
      headers: {
        origin: validOrigin,
        'idempotency-key': idempotencyKey,
      },
      payload: validAcceptPayload,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.artifact.currentLifecycleStatus).toBe('accepted');
    expect(body.decision.decision).toBe('accepted');
    expect(body.approvalSnapshot).toBeDefined();
    expect(body.approvalSnapshot.approvedByUserId).toBeDefined();
  });

  it('rejects script revision when valid and authorized', async () => {
    const deps = createTestWorkforceDeps();
    const app = createApp({ auth: deps.auth, workforce: deps });

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/artifacts/${artifactId}/reject`,
      cookies: { [COOKIE_SESSION]: sessionCookie },
      headers: {
        origin: validOrigin,
        'idempotency-key': idempotencyKey,
      },
      payload: validRejectPayload,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.artifact.currentLifecycleStatus).toBe('rejected');
    expect(body.decision.decision).toBe('rejected');
    expect(body.decision.reason).toBe(validRejectPayload.reason);
  });

  it('returns 409 conflict when revision is not current on accept', async () => {
    const deps = createTestWorkforceDeps();
    const app = createApp({ auth: deps.auth, workforce: deps });

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/artifacts/${artifactId}/accept`,
      cookies: { [COOKIE_SESSION]: sessionCookie },
      headers: {
        origin: validOrigin,
        'idempotency-key': idempotencyKey,
      },
      payload: { ...validAcceptPayload, revisionNumber: 99 },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('VERSION_OR_REVISION_CONFLICT');
  });

  it('returns 422 when accept fails due to blocking findings', async () => {
    const deps = createTestWorkforceDeps();
    deps.workforcePersistence.acceptScriptRevision = () => {
      throw new Error('Precondition failed: Compliance evaluation has blocking findings');
    };
    const app = createApp({ auth: deps.auth, workforce: deps });

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/artifacts/${artifactId}/accept`,
      cookies: { [COOKIE_SESSION]: sessionCookie },
      headers: {
        origin: validOrigin,
        'idempotency-key': idempotencyKey,
      },
      payload: validAcceptPayload,
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe('COMPLIANCE_BLOCKING_FINDINGS');
  });
});
