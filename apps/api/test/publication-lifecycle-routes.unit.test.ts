import { describe, expect, it } from 'vitest';
import { IdempotencyConflictError } from '@affiliate-content-os/application';
import {
  PublicationNotFoundError,
  PublicationStateConflictError,
} from '@affiliate-content-os/domain';
import { createApp } from '../src/app.js';
import { COOKIE_SESSION } from '../src/auth/constants.js';
import {
  createTestPublicationDeps,
  EDITOR_USER_ID,
  FOREIGN_WORKSPACE_ID,
  TEST_PUBLICATION_ID,
  TEST_WORKSPACE_ID,
  VALID_ORIGIN,
  VALID_SESSION_COOKIE,
  VIEWER_USER_ID,
} from './helpers/publication-test-deps.js';

describe('Publication Lifecycle Routes (Reschedule and Cancel) (TASK-018 Phase B)', () => {
  const rescheduleUrl = `/api/v1/workspaces/${TEST_WORKSPACE_ID}/publications/${TEST_PUBLICATION_ID}`;
  const cancelUrl = `/api/v1/workspaces/${TEST_WORKSPACE_ID}/publications/${TEST_PUBLICATION_ID}/cancel`;
  const validRescheduleBody = {
    expectedVersion: 1,
    schedule: {
      scheduledAtUtc: '2026-11-26T14:30:00.000Z',
      originalLocalTime: '2026-11-26T09:30:00',
      timezone: 'America/New_York',
    },
  };

  it('reschedules a scheduled publication and returns 200 for editor', async () => {
    const { deps } = createTestPublicationDeps({ defaultUserId: EDITOR_USER_ID });
    const app = createApp({ auth: deps.auth, publication: deps });
    const res = await app.inject({
      method: 'PATCH',
      url: rescheduleUrl,
      cookies: { [COOKIE_SESSION]: VALID_SESSION_COOKIE },
      headers: { 'idempotency-key': 'resched-key-1', origin: VALID_ORIGIN },
      payload: validRescheduleBody,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.version).toBe(2);
    expect(body.timezone).toBe('America/New_York');
    expect(body).not.toHaveProperty('leaseToken');
    expect(body).not.toHaveProperty('leaseOwner');
  });

  it('cancels a scheduled publication and returns 200 for editor', async () => {
    const { deps } = createTestPublicationDeps({ defaultUserId: EDITOR_USER_ID });
    const app = createApp({ auth: deps.auth, publication: deps });
    const res = await app.inject({
      method: 'POST',
      url: cancelUrl,
      cookies: { [COOKIE_SESSION]: VALID_SESSION_COOKIE },
      headers: { 'idempotency-key': 'cancel-key-1', origin: VALID_ORIGIN },
      payload: { expectedVersion: 1 },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('canceled');
    expect(body.completedAt).toBeDefined();
    expect(body).not.toHaveProperty('leaseToken');
  });

  it('requires Idempotency-Key on reschedule and cancel', async () => {
    const { deps } = createTestPublicationDeps();
    const app = createApp({ auth: deps.auth, publication: deps });
    const resPatch = await app.inject({
      method: 'PATCH',
      url: rescheduleUrl,
      cookies: { [COOKIE_SESSION]: VALID_SESSION_COOKIE },
      headers: { origin: VALID_ORIGIN },
      payload: validRescheduleBody,
    });
    expect(resPatch.statusCode).toBe(400);

    const resCancel = await app.inject({
      method: 'POST',
      url: cancelUrl,
      cookies: { [COOKIE_SESSION]: VALID_SESSION_COOKIE },
      headers: { origin: VALID_ORIGIN },
      payload: { expectedVersion: 1 },
    });
    expect(resCancel.statusCode).toBe(400);
  });

  it('maps IdempotencyConflictError to 409 IDEMPOTENCY_CONFLICT', async () => {
    const { deps, persistence } = createTestPublicationDeps();
    persistence.reschedulePublicationTransaction = async () => {
      throw new IdempotencyConflictError();
    };
    const app = createApp({ auth: deps.auth, publication: deps });
    const res = await app.inject({
      method: 'PATCH',
      url: rescheduleUrl,
      cookies: { [COOKIE_SESSION]: VALID_SESSION_COOKIE },
      headers: { 'idempotency-key': 'conflict-key', origin: VALID_ORIGIN },
      payload: validRescheduleBody,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('denies viewer mutations and returns closed 404 WORKSPACE_NOT_FOUND', async () => {
    const { deps, setActiveUser } = createTestPublicationDeps();
    setActiveUser(VIEWER_USER_ID);
    const app = createApp({ auth: deps.auth, publication: deps });

    const p = await app.inject({
      method: 'PATCH',
      url: rescheduleUrl,
      cookies: { [COOKIE_SESSION]: VALID_SESSION_COOKIE },
      headers: { 'idempotency-key': 'v1', origin: VALID_ORIGIN },
      payload: validRescheduleBody,
    });
    expect(p.statusCode).toBe(404);

    const c = await app.inject({
      method: 'POST',
      url: cancelUrl,
      cookies: { [COOKIE_SESSION]: VALID_SESSION_COOKIE },
      headers: { 'idempotency-key': 'v2', origin: VALID_ORIGIN },
      payload: { expectedVersion: 1 },
    });
    expect(c.statusCode).toBe(404);
  });

  it('handles auth, origin, and cross-tenant failures cleanly', async () => {
    const { deps } = createTestPublicationDeps();
    const app = createApp({ auth: deps.auth, publication: deps });
    const u = await app.inject({
      method: 'PATCH',
      url: rescheduleUrl,
      headers: { 'idempotency-key': 'k1', origin: VALID_ORIGIN },
      payload: validRescheduleBody,
    });
    expect(u.statusCode).toBe(401);
    const bo = await app.inject({
      method: 'PATCH',
      url: rescheduleUrl,
      cookies: { [COOKIE_SESSION]: VALID_SESSION_COOKIE },
      headers: { 'idempotency-key': 'k2', origin: 'https://evil.com' },
      payload: validRescheduleBody,
    });
    expect(bo.statusCode).toBe(403);
    const cr = await app.inject({
      method: 'PATCH',
      url: `/api/v1/workspaces/${FOREIGN_WORKSPACE_ID}/publications/${TEST_PUBLICATION_ID}`,
      cookies: { [COOKIE_SESSION]: VALID_SESSION_COOKIE },
      headers: { 'idempotency-key': 'k3', origin: VALID_ORIGIN },
      payload: validRescheduleBody,
    });
    expect(cr.statusCode).toBe(404);
  });

  it('maps PublicationNotFoundError and conflicts to 404 or 409', async () => {
    const { deps, persistence } = createTestPublicationDeps();
    const app = createApp({ auth: deps.auth, publication: deps });

    persistence.cancelPublicationTransaction = async () => {
      throw new PublicationNotFoundError(TEST_PUBLICATION_ID);
    };
    const resNf = await app.inject({
      method: 'POST',
      url: cancelUrl,
      cookies: { [COOKIE_SESSION]: VALID_SESSION_COOKIE },
      headers: { 'idempotency-key': 'nf-key', origin: VALID_ORIGIN },
      payload: { expectedVersion: 1 },
    });
    expect(resNf.statusCode).toBe(404);

    persistence.reschedulePublicationTransaction = async () => {
      throw new PublicationStateConflictError(
        'publishing',
        'reschedule',
        'Expected version 1 but found 2',
      );
    };
    const resConf = await app.inject({
      method: 'PATCH',
      url: rescheduleUrl,
      cookies: { [COOKIE_SESSION]: VALID_SESSION_COOKIE },
      headers: { 'idempotency-key': 'cas-key', origin: VALID_ORIGIN },
      payload: validRescheduleBody,
    });
    expect(resConf.statusCode).toBe(409);
  });

  it('rejects malformed expectedVersion or schedule with 400 or 422', async () => {
    const { deps } = createTestPublicationDeps();
    const app = createApp({ auth: deps.auth, publication: deps });

    const resBadVer = await app.inject({
      method: 'POST',
      url: cancelUrl,
      cookies: { [COOKIE_SESSION]: VALID_SESSION_COOKIE },
      headers: { 'idempotency-key': 'bv-key', origin: VALID_ORIGIN },
      payload: { expectedVersion: 0 },
    });
    expect(resBadVer.statusCode).toBe(400);

    const resBadSched = await app.inject({
      method: 'PATCH',
      url: rescheduleUrl,
      cookies: { [COOKIE_SESSION]: VALID_SESSION_COOKIE },
      headers: { 'idempotency-key': 'bs-key', origin: VALID_ORIGIN },
      payload: {
        ...validRescheduleBody,
        schedule: { ...validRescheduleBody.schedule, timezone: 'Not_A_Timezone' },
      },
    });
    expect(resBadSched.statusCode).toBe(422);
  });
});
