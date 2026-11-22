import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { COOKIE_SESSION } from '../src/auth/constants.js';
import {
  createTestPublicationDeps,
  dummyPublication,
  dummyPublicationDetail,
  FOREIGN_WORKSPACE_ID,
  TEST_PUBLICATION_ID,
  TEST_WORKSPACE_ID,
  VALID_SESSION_COOKIE,
  VIEWER_USER_ID,
} from './helpers/publication-test-deps.js';

describe('Publication Read Routes (List and Detail) (TASK-018 Phase B)', () => {
  const listUrl = `/api/v1/workspaces/${TEST_WORKSPACE_ID}/publications`;
  const detailUrl = `/api/v1/workspaces/${TEST_WORKSPACE_ID}/publications/${TEST_PUBLICATION_ID}`;

  it('lists publications and returns 200 for viewer role', async () => {
    const { deps, setActiveUser } = createTestPublicationDeps();
    setActiveUser(VIEWER_USER_ID);
    const app = createApp({ auth: deps.auth, publication: deps });

    const res = await app.inject({
      method: 'GET',
      url: `${listUrl}?limit=10&status=scheduled&platform=threads`,
      cookies: { [COOKIE_SESSION]: VALID_SESSION_COOKIE },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].id).toBe(dummyPublication.id);
    expect(body.items[0]).not.toHaveProperty('leaseToken');
    expect(body.items[0]).not.toHaveProperty('leaseOwner');
    expect(body.items[0]).not.toHaveProperty('leaseExpiresAt');
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('retrieves publication detail and returns 200 for viewer role', async () => {
    const { deps, setActiveUser } = createTestPublicationDeps();
    setActiveUser(VIEWER_USER_ID);
    const app = createApp({ auth: deps.auth, publication: deps });

    const res = await app.inject({
      method: 'GET',
      url: detailUrl,
      cookies: { [COOKIE_SESSION]: VALID_SESSION_COOKIE },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.publication.id).toBe(dummyPublicationDetail.publication.id);
    expect(body.destination.platform).toBe('threads');
    expect(body.approval.renderedText).toBe(dummyPublicationDetail.approval.renderedText);
    expect(body.attempts).toHaveLength(1);
    expect(body.attempts[0]).not.toHaveProperty('attemptIdempotencyKey');
    expect(body.attempts[0]).not.toHaveProperty('requestHashHex');
    expect(body.attempts[0]).not.toHaveProperty('correlationId');
    expect(body.publication).not.toHaveProperty('leaseToken');
  });

  it('returns 401 AUTHENTICATION_REQUIRED when unauthenticated', async () => {
    const { deps } = createTestPublicationDeps();
    const app = createApp({ auth: deps.auth, publication: deps });

    const resList = await app.inject({ method: 'GET', url: listUrl });
    expect(resList.statusCode).toBe(401);
    expect(resList.json().code).toBe('AUTHENTICATION_REQUIRED');

    const resDetail = await app.inject({ method: 'GET', url: detailUrl });
    expect(resDetail.statusCode).toBe(401);
    expect(resDetail.json().code).toBe('AUTHENTICATION_REQUIRED');
  });

  it('returns closed 404 WORKSPACE_NOT_FOUND for cross-tenant workspace', async () => {
    const { deps } = createTestPublicationDeps();
    const app = createApp({ auth: deps.auth, publication: deps });

    const resList = await app.inject({
      method: 'GET',
      url: `/api/v1/workspaces/${FOREIGN_WORKSPACE_ID}/publications`,
      cookies: { [COOKIE_SESSION]: VALID_SESSION_COOKIE },
    });
    expect(resList.statusCode).toBe(404);
    expect(resList.json().code).toBe('WORKSPACE_NOT_FOUND');
  });

  it('maps PublicationNotFoundError to 404 NOT_FOUND on detail route', async () => {
    const { deps, persistence } = createTestPublicationDeps();
    persistence.findPublicationDetail = async () => null;
    const app = createApp({ auth: deps.auth, publication: deps });

    const res = await app.inject({
      method: 'GET',
      url: detailUrl,
      cookies: { [COOKIE_SESSION]: VALID_SESSION_COOKIE },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('NOT_FOUND');
  });

  it('rejects malformed query parameters and invalid UUIDs with 400', async () => {
    const { deps } = createTestPublicationDeps();
    const app = createApp({ auth: deps.auth, publication: deps });

    const resLimitHigh = await app.inject({
      method: 'GET',
      url: `${listUrl}?limit=999`,
      cookies: { [COOKIE_SESSION]: VALID_SESSION_COOKIE },
    });
    expect(resLimitHigh.statusCode).toBe(400);

    const resBadStatus = await app.inject({
      method: 'GET',
      url: `${listUrl}?status=invalid_status`,
      cookies: { [COOKIE_SESSION]: VALID_SESSION_COOKIE },
    });
    expect(resBadStatus.statusCode).toBe(400);

    const resBadUuid = await app.inject({
      method: 'GET',
      url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/publications/not-a-uuid`,
      cookies: { [COOKIE_SESSION]: VALID_SESSION_COOKIE },
    });
    expect(resBadUuid.statusCode).toBe(400);
  });
});
