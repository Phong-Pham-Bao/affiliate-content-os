import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { COOKIE_SESSION } from '../src/auth/constants.js';
import { FOREIGN_WORKSPACE_ID, TEST_WORKSPACE_ID } from './helpers/catalog-test-deps.js';
import { createTestWorkforceDeps, mockArtifactDetail } from './helpers/workforce-test-deps.js';

describe('Workforce Revision Routes (Checkpoint C)', () => {
  const sessionCookie = 'A'.repeat(43);
  const validOrigin = 'http://127.0.0.1:3000';
  const artifactId = mockArtifactDetail.artifact.id;
  const changeRequestId = '019318b2-5f33-722e-a5df-036f007b89fc';
  const notFoundChangeRequestId = '019318b2-5f33-722e-a5df-036f007b8999';
  const hashHex = 'a'.repeat(64);

  const validManualRevisionPayload = {
    expectedVersion: 1,
    baseRevisionNumber: 1,
    baseContentHashHex: hashHex,
    rawContent: {
      schemaVersion: 1,
      seriesTitle: 'Updated Series',
      targetAudienceSummary: 'Target segment',
      creativeDirectionSummary: 'Creative direction',
      videos: [1, 2, 3, 4, 5].map((n) => ({
        videoNumber: n,
        title: `Video ${n}`,
        objective: `Objective ${n}`,
        targetDurationSeconds: 60,
        hook: { spokenHook: 'Hook', visualHook: 'Visual' },
        voiceOver: 'Voice over text',
        scenes: [
          {
            sceneNumber: 1,
            timeRangeSeconds: { start: 0, end: 5 },
            visualDescription: 'Visual scene',
            spokenText: 'Spoken text',
          },
        ],
        onScreenOverlays: [],
        callToAction: { text: 'CTA text', visualDirection: 'Visual CTA' },
        disclosure: { placement: 'bottom', text: 'Disclosure' },
        shotList: [
          {
            shotNumber: 1,
            durationSeconds: 5,
            description: 'Shot description',
            cameraAngle: 'Eye-level',
            framing: 'Medium',
            movement: 'Static',
            props: [],
          },
        ],
        evidenceReferences: [],
        creativeHypotheses: [],
      })),
      evidenceReferences: [],
    },
    note: 'Manual script adjustments',
  };

  const validRequestChangesPayload = {
    expectedVersion: 1,
    baseRevisionNumber: 1,
    baseContentHashHex: hashHex,
    instructionText: 'Make hooks punchier and focus on ergonomics',
    selectedVideoNumbers: [1, 3],
    targetVariantCount: 1,
  };

  it('denies unauthenticated requests on all revision endpoints', async () => {
    const deps = createTestWorkforceDeps();
    const app = createApp({ auth: deps.auth, workforce: deps });

    const getRevs = await app.inject({
      method: 'GET',
      url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/artifacts/${artifactId}/revisions`,
    });
    expect(getRevs.statusCode).toBe(401);

    const getRevNum = await app.inject({
      method: 'GET',
      url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/artifacts/${artifactId}/revisions/1`,
    });
    expect(getRevNum.statusCode).toBe(401);

    const postRev = await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/artifacts/${artifactId}/revisions`,
      headers: { origin: validOrigin },
      payload: validManualRevisionPayload,
    });
    expect(postRev.statusCode).toBe(401);

    const postChanges = await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/artifacts/${artifactId}/request-changes`,
      headers: { origin: validOrigin },
      payload: validRequestChangesPayload,
    });
    expect(postChanges.statusCode).toBe(401);

    const getCr = await app.inject({
      method: 'GET',
      url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/artifacts/${artifactId}/change-requests/${changeRequestId}`,
    });
    expect(getCr.statusCode).toBe(401);
  });

  it('allows viewer role to read revisions but denies mutations with non-disclosing 404', async () => {
    const deps = createTestWorkforceDeps({ defaultRole: 'viewer' });
    const app = createApp({ auth: deps.auth, workforce: deps });

    const listRevs = await app.inject({
      method: 'GET',
      url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/artifacts/${artifactId}/revisions`,
      cookies: { [COOKIE_SESSION]: sessionCookie },
    });
    expect(listRevs.statusCode).toBe(200);

    const postRev = await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/artifacts/${artifactId}/revisions`,
      cookies: { [COOKIE_SESSION]: sessionCookie },
      headers: { origin: validOrigin },
      payload: validManualRevisionPayload,
    });
    expect(postRev.statusCode).toBe(404);
    expect(postRev.json().code).toBe('WORKSPACE_NOT_FOUND');

    const postChanges = await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/artifacts/${artifactId}/request-changes`,
      cookies: { [COOKIE_SESSION]: sessionCookie },
      headers: { origin: validOrigin },
      payload: validRequestChangesPayload,
    });
    expect(postChanges.statusCode).toBe(404);
    expect(postChanges.json().code).toBe('WORKSPACE_NOT_FOUND');
  });

  it('denies invalid origin on mutation routes', async () => {
    const deps = createTestWorkforceDeps();
    const app = createApp({ auth: deps.auth, workforce: deps });

    const postRev = await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/artifacts/${artifactId}/revisions`,
      cookies: { [COOKIE_SESSION]: sessionCookie },
      headers: { origin: 'https://evil.com' },
      payload: validManualRevisionPayload,
    });
    expect(postRev.statusCode).toBe(403);

    const postChanges = await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/artifacts/${artifactId}/request-changes`,
      cookies: { [COOKIE_SESSION]: sessionCookie },
      headers: { origin: 'https://evil.com' },
      payload: validRequestChangesPayload,
    });
    expect(postChanges.statusCode).toBe(403);
  });

  it('handles GET revisions, GET revision by number, and GET change request', async () => {
    const deps = createTestWorkforceDeps();
    const app = createApp({ auth: deps.auth, workforce: deps });

    const revsRes = await app.inject({
      method: 'GET',
      url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/artifacts/${artifactId}/revisions`,
      cookies: { [COOKIE_SESSION]: sessionCookie },
    });
    expect(revsRes.statusCode).toBe(200);
    expect(revsRes.headers['cache-control']).toBe('no-store');
    expect(revsRes.json().items).toHaveLength(1);

    const revNumRes = await app.inject({
      method: 'GET',
      url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/artifacts/${artifactId}/revisions/1`,
      cookies: { [COOKIE_SESSION]: sessionCookie },
    });
    expect(revNumRes.statusCode).toBe(200);
    expect(revNumRes.json().artifact.id).toBe(artifactId);

    const notFoundRevRes = await app.inject({
      method: 'GET',
      url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/artifacts/${artifactId}/revisions/999`,
      cookies: { [COOKIE_SESSION]: sessionCookie },
    });
    expect(notFoundRevRes.statusCode).toBe(404);

    const crRes = await app.inject({
      method: 'GET',
      url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/artifacts/${artifactId}/change-requests/${changeRequestId}`,
      cookies: { [COOKIE_SESSION]: sessionCookie },
    });
    expect(crRes.statusCode).toBe(200);
    expect(crRes.json().id).toBe(changeRequestId);

    const notFoundCrRes = await app.inject({
      method: 'GET',
      url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/artifacts/${artifactId}/change-requests/${notFoundChangeRequestId}`,
      cookies: { [COOKIE_SESSION]: sessionCookie },
    });
    expect(notFoundCrRes.statusCode).toBe(404);
  });

  it('creates manual revision and returns 201', async () => {
    const deps = createTestWorkforceDeps();
    const app = createApp({ auth: deps.auth, workforce: deps });

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/artifacts/${artifactId}/revisions`,
      cookies: { [COOKIE_SESSION]: sessionCookie },
      headers: { origin: validOrigin },
      payload: validManualRevisionPayload,
    });
    expect(res.statusCode).toBe(201);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.json().artifact.id).toBe(artifactId);
  });

  it('requests script changes and returns 202', async () => {
    const deps = createTestWorkforceDeps();
    const app = createApp({ auth: deps.auth, workforce: deps });

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/artifacts/${artifactId}/request-changes`,
      cookies: { [COOKIE_SESSION]: sessionCookie },
      headers: { origin: validOrigin },
      payload: validRequestChangesPayload,
    });
    expect(res.statusCode).toBe(202);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.json().id).toBe(changeRequestId);
  });

  it('enforces tenant isolation against foreign workspace ID', async () => {
    const deps = createTestWorkforceDeps();
    const app = createApp({ auth: deps.auth, workforce: deps });

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/workspaces/${FOREIGN_WORKSPACE_ID}/artifacts/${artifactId}/revisions`,
      cookies: { [COOKIE_SESSION]: sessionCookie },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('WORKSPACE_NOT_FOUND');
  });
});
