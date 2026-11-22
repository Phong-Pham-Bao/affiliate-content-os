import { describe, expect, it } from 'vitest';
import { IdempotencyConflictError } from '@affiliate-content-os/application';
import {
  PublicationApprovalSnapshotNotFoundError,
  PublicationStateConflictError,
} from '@affiliate-content-os/domain';
import { createApp } from '../src/app.js';
import { COOKIE_SESSION } from '../src/auth/constants.js';
import {
  createTestPublicationDeps,
  dummyPublication,
  EDITOR_USER_ID,
  FOREIGN_WORKSPACE_ID,
  TEST_APPROVAL_SNAPSHOT_ID,
  TEST_WORKSPACE_ID,
  VALID_ORIGIN,
  VALID_SESSION_COOKIE,
  VIEWER_USER_ID,
} from './helpers/publication-test-deps.js';

describe('Publication Schedule Routes (TASK-018 Phase B)', () => {
  const scheduleUrl = `/api/v1/workspaces/${TEST_WORKSPACE_ID}/publications`;
  const validBody = {
    approvalSnapshotId: TEST_APPROVAL_SNAPSHOT_ID,
    schedule: {
      scheduledAtUtc: '2026-11-25T14:30:00.000Z',
      originalLocalTime: '2026-11-25T09:30:00',
      timezone: 'America/New_York',
    },
  };

  it('schedules a publication and returns 201 for editor', async () => {
    const { deps } = createTestPublicationDeps({ defaultUserId: EDITOR_USER_ID });
    const app = createApp({ auth: deps.auth, publication: deps });

    const res = await app.inject({
      method: 'POST',
      url: scheduleUrl,
      cookies: { [COOKIE_SESSION]: VALID_SESSION_COOKIE },
      headers: { 'idempotency-key': 'sched-key-1', origin: VALID_ORIGIN },
      payload: validBody,
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.id).toBe(dummyPublication.id);
    expect(body.status).toBe('scheduled');
    expect(body.timezone).toBe('America/New_York');
    expect(body).not.toHaveProperty('leaseToken');
    expect(body).not.toHaveProperty('leaseOwner');
    expect(body).not.toHaveProperty('leaseExpiresAt');
    expect(body).not.toHaveProperty('rawError');
  });

  it('requires Idempotency-Key and returns 400 MALFORMED_IDEMPOTENCY_KEY when missing', async () => {
    const { deps } = createTestPublicationDeps();
    const app = createApp({ auth: deps.auth, publication: deps });
    const res = await app.inject({
      method: 'POST',
      url: scheduleUrl,
      cookies: { [COOKIE_SESSION]: VALID_SESSION_COOKIE },
      headers: { origin: VALID_ORIGIN },
      payload: validBody,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('MALFORMED_IDEMPOTENCY_KEY');
  });

  it('maps IdempotencyConflictError to 409 IDEMPOTENCY_CONFLICT', async () => {
    const { deps, persistence } = createTestPublicationDeps();
    persistence.createPublicationScheduleTransaction = async () => {
      throw new IdempotencyConflictError();
    };
    const app = createApp({ auth: deps.auth, publication: deps });
    const res = await app.inject({
      method: 'POST',
      url: scheduleUrl,
      cookies: { [COOKIE_SESSION]: VALID_SESSION_COOKIE },
      headers: { 'idempotency-key': 'sched-conflict-key', origin: VALID_ORIGIN },
      payload: validBody,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('denies viewer mutation and fails closed with 404 WORKSPACE_NOT_FOUND', async () => {
    const { deps, setActiveUser } = createTestPublicationDeps();
    setActiveUser(VIEWER_USER_ID);
    const app = createApp({ auth: deps.auth, publication: deps });
    const res = await app.inject({
      method: 'POST',
      url: scheduleUrl,
      cookies: { [COOKIE_SESSION]: VALID_SESSION_COOKIE },
      headers: { 'idempotency-key': 'viewer-sched-key', origin: VALID_ORIGIN },
      payload: validBody,
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('WORKSPACE_NOT_FOUND');
  });

  it('handles auth, origin, and cross-tenant failures cleanly', async () => {
    const { deps } = createTestPublicationDeps();
    const app = createApp({ auth: deps.auth, publication: deps });

    const unauth = await app.inject({
      method: 'POST',
      url: scheduleUrl,
      headers: { 'idempotency-key': 'k1', origin: VALID_ORIGIN },
      payload: validBody,
    });
    expect(unauth.statusCode).toBe(401);

    const badOrigin = await app.inject({
      method: 'POST',
      url: scheduleUrl,
      cookies: { [COOKIE_SESSION]: VALID_SESSION_COOKIE },
      headers: { 'idempotency-key': 'k2', origin: 'https://evil.com' },
      payload: validBody,
    });
    expect(badOrigin.statusCode).toBe(403);

    const crossTenant = await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${FOREIGN_WORKSPACE_ID}/publications`,
      cookies: { [COOKIE_SESSION]: VALID_SESSION_COOKIE },
      headers: { 'idempotency-key': 'k3', origin: VALID_ORIGIN },
      payload: validBody,
    });
    expect(crossTenant.statusCode).toBe(404);
  });

  it('maps PublicationApprovalSnapshotNotFoundError to 404 NOT_FOUND', async () => {
    const { deps, persistence } = createTestPublicationDeps();
    persistence.createPublicationScheduleTransaction = async () => {
      throw new PublicationApprovalSnapshotNotFoundError(TEST_APPROVAL_SNAPSHOT_ID);
    };
    const app = createApp({ auth: deps.auth, publication: deps });
    const res = await app.inject({
      method: 'POST',
      url: scheduleUrl,
      cookies: { [COOKIE_SESSION]: VALID_SESSION_COOKIE },
      headers: { 'idempotency-key': 'notfound-key', origin: VALID_ORIGIN },
      payload: validBody,
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('NOT_FOUND');
  });

  it('rejects malformed schedule and maps PublicationScheduleInvalidError to 422', async () => {
    const { deps } = createTestPublicationDeps();
    const app = createApp({ auth: deps.auth, publication: deps });

    const badBody = await app.inject({
      method: 'POST',
      url: scheduleUrl,
      cookies: { [COOKIE_SESSION]: VALID_SESSION_COOKIE },
      headers: { 'idempotency-key': 'bad-fmt', origin: VALID_ORIGIN },
      payload: { ...validBody, schedule: { ...validBody.schedule, timezone: '' } },
    });
    expect(badBody.statusCode).toBe(400);

    const badTriple = await app.inject({
      method: 'POST',
      url: scheduleUrl,
      cookies: { [COOKIE_SESSION]: VALID_SESSION_COOKIE },
      headers: { 'idempotency-key': 'bad-triple', origin: VALID_ORIGIN },
      payload: {
        ...validBody,
        schedule: {
          scheduledAtUtc: '2026-11-25T14:30:00.000Z',
          originalLocalTime: '2026-11-25T09:30:00',
          timezone: 'Invalid/Timezone_Not_Real',
        },
      },
    });
    expect(badTriple.statusCode).toBe(422);
    expect(badTriple.json().code).toBe('UNPROCESSABLE_CONTENT');
  });

  it('maps PublicationStateConflictError to 409 CONFLICT', async () => {
    const { deps, persistence } = createTestPublicationDeps();
    persistence.createPublicationScheduleTransaction = async () => {
      throw new PublicationStateConflictError(
        'scheduled',
        'create_schedule',
        'Publication already scheduled for snapshot',
      );
    };
    const app = createApp({ auth: deps.auth, publication: deps });
    const res = await app.inject({
      method: 'POST',
      url: scheduleUrl,
      cookies: { [COOKIE_SESSION]: VALID_SESSION_COOKIE },
      headers: { 'idempotency-key': 'state-conf-key', origin: VALID_ORIGIN },
      payload: validBody,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('CONFLICT');
  });
});
