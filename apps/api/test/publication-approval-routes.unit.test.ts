import { describe, expect, it } from 'vitest';
import {
  IdempotencyConflictError,
  SocialKillSwitchActiveError,
} from '@affiliate-content-os/application';
import {
  PublicationDriftError,
  PublicationGatedError,
  PublicationPreviewMismatchError,
} from '@affiliate-content-os/domain';
import { createApp } from '../src/app.js';
import { COOKIE_SESSION } from '../src/auth/constants.js';
import {
  createTestPublicationDeps,
  dummySnapshot,
  EDITOR_USER_ID,
  FOREIGN_WORKSPACE_ID,
  TEST_CONTENT_APPROVAL_ID,
  TEST_SOCIAL_ACCOUNT_ID,
  TEST_WORKSPACE_ID,
  VALID_ORIGIN,
  VALID_SESSION_COOKIE,
  VIEWER_USER_ID,
} from './helpers/publication-test-deps.js';

describe('Publication Approval Routes (TASK-018 Phase B)', () => {
  const approvalUrl = `/api/v1/workspaces/${TEST_WORKSPACE_ID}/publication-approvals`;
  const validBody = {
    contentApprovalId: TEST_CONTENT_APPROVAL_ID,
    socialAccountId: TEST_SOCIAL_ACCOUNT_ID,
    videoNumber: 1,
    platformSettings: { replyControl: 'everyone' },
    previewHashHex: 'd'.repeat(64),
    consent: { consentType: 'human_publisher', policyVersion: '1.0.0' },
  };

  it('creates destination approval snapshot and returns 201 for editor', async () => {
    const { deps } = createTestPublicationDeps({ defaultUserId: EDITOR_USER_ID });
    const app = createApp({ auth: deps.auth, publication: deps });

    const res = await app.inject({
      method: 'POST',
      url: approvalUrl,
      cookies: { [COOKIE_SESSION]: VALID_SESSION_COOKIE },
      headers: { 'idempotency-key': 'appr-key-1', origin: VALID_ORIGIN },
      payload: validBody,
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.id).toBe(dummySnapshot.id);
    expect(body.approvedByUserId).toBe(EDITOR_USER_ID);
    expect(body).not.toHaveProperty('rawError');
    expect(body).not.toHaveProperty('token');
  });

  it('requires Idempotency-Key and returns 400 MALFORMED_IDEMPOTENCY_KEY when missing', async () => {
    const { deps } = createTestPublicationDeps();
    const app = createApp({ auth: deps.auth, publication: deps });
    const res = await app.inject({
      method: 'POST',
      url: approvalUrl,
      cookies: { [COOKIE_SESSION]: VALID_SESSION_COOKIE },
      headers: { origin: VALID_ORIGIN },
      payload: validBody,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('MALFORMED_IDEMPOTENCY_KEY');
  });

  it('maps IdempotencyConflictError to 409 IDEMPOTENCY_CONFLICT', async () => {
    const { deps, persistence } = createTestPublicationDeps();
    persistence.createApprovalSnapshotTransaction = async () => {
      throw new IdempotencyConflictError();
    };
    const app = createApp({ auth: deps.auth, publication: deps });
    const res = await app.inject({
      method: 'POST',
      url: approvalUrl,
      cookies: { [COOKIE_SESSION]: VALID_SESSION_COOKIE },
      headers: { 'idempotency-key': 'conflict-key', origin: VALID_ORIGIN },
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
      url: approvalUrl,
      cookies: { [COOKIE_SESSION]: VALID_SESSION_COOKIE },
      headers: { 'idempotency-key': 'viewer-key', origin: VALID_ORIGIN },
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
      url: approvalUrl,
      headers: { 'idempotency-key': 'k1', origin: VALID_ORIGIN },
      payload: validBody,
    });
    expect(unauth.statusCode).toBe(401);

    const badOrigin = await app.inject({
      method: 'POST',
      url: approvalUrl,
      cookies: { [COOKIE_SESSION]: VALID_SESSION_COOKIE },
      headers: { 'idempotency-key': 'k2', origin: 'https://evil.com' },
      payload: validBody,
    });
    expect(badOrigin.statusCode).toBe(403);

    const crossTenant = await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${FOREIGN_WORKSPACE_ID}/publication-approvals`,
      cookies: { [COOKIE_SESSION]: VALID_SESSION_COOKIE },
      headers: { 'idempotency-key': 'k3', origin: VALID_ORIGIN },
      payload: validBody,
    });
    expect(crossTenant.statusCode).toBe(404);
  });

  it('rejects malformed bounds such as invalid videoNumber with 400', async () => {
    const { deps } = createTestPublicationDeps();
    const app = createApp({ auth: deps.auth, publication: deps });
    const res = await app.inject({
      method: 'POST',
      url: approvalUrl,
      cookies: { [COOKIE_SESSION]: VALID_SESSION_COOKIE },
      headers: { 'idempotency-key': 'bound-key', origin: VALID_ORIGIN },
      payload: { ...validBody, videoNumber: 99 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('maps domain preview mismatch, drift, gated, and kill switch errors', async () => {
    const { deps, persistence } = createTestPublicationDeps();
    const app = createApp({ auth: deps.auth, publication: deps });

    persistence.createApprovalSnapshotTransaction = async () => {
      throw new PublicationPreviewMismatchError('d'.repeat(64), 'e'.repeat(64));
    };
    let res = await app.inject({
      method: 'POST',
      url: approvalUrl,
      cookies: { [COOKIE_SESSION]: VALID_SESSION_COOKIE },
      headers: { 'idempotency-key': 'm1', origin: VALID_ORIGIN },
      payload: validBody,
    });
    expect(res.statusCode).toBe(422);

    persistence.createApprovalSnapshotTransaction = async () => {
      throw new PublicationDriftError('capabilities', 'Capability drift');
    };
    res = await app.inject({
      method: 'POST',
      url: approvalUrl,
      cookies: { [COOKIE_SESSION]: VALID_SESSION_COOKIE },
      headers: { 'idempotency-key': 'm2', origin: VALID_ORIGIN },
      payload: validBody,
    });
    expect(res.statusCode).toBe(422);

    persistence.createApprovalSnapshotTransaction = async () => {
      throw new SocialKillSwitchActiveError('threads');
    };
    res = await app.inject({
      method: 'POST',
      url: approvalUrl,
      cookies: { [COOKIE_SESSION]: VALID_SESSION_COOKIE },
      headers: { 'idempotency-key': 'm3', origin: VALID_ORIGIN },
      payload: validBody,
    });
    expect(res.statusCode).toBe(503);

    persistence.createApprovalSnapshotTransaction = async () => {
      throw new PublicationGatedError('kill_switch', 'Platform kill switch active');
    };
    res = await app.inject({
      method: 'POST',
      url: approvalUrl,
      cookies: { [COOKIE_SESSION]: VALID_SESSION_COOKIE },
      headers: { 'idempotency-key': 'm4', origin: VALID_ORIGIN },
      payload: validBody,
    });
    expect(res.statusCode).toBe(503);
  });
});
