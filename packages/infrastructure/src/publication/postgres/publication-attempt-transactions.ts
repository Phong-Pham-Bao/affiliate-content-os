import crypto from 'node:crypto';
import {
  calculatePublicationBackoff,
  computeCanonicalHash,
  dateToIsoTimestamp,
  isTerminalPublication,
  parseAuditEventId,
  parseCorrelationId,
  parseIsoTimestamp,
  parsePublicationAttemptId,
  parseSocialAccountId,
  PublicationFenceLostError,
  PublicationNotFoundError,
  PublicationStateConflictError,
} from '@affiliate-content-os/domain';
import {
  generateUuidV7,
  type PrepareAttemptParams,
  type PrepareAttemptResult,
  type SettleAttemptParams,
  type SocialCredentialProtectorPort,
} from '@affiliate-content-os/application';
import { createTransactionScopedPostgresAuditAdapter } from '../../audit/index.js';
import type { Database } from '../../database/types.js';
import {
  SQL_FIND_COMPLIANCE_EVALUATION,
  SQL_FIND_PUBLICATION_FOR_UPDATE,
  SQL_FIND_SOCIAL_ACCOUNT,
  SQL_FIND_SOCIAL_CREDENTIALS,
  SQL_FIND_SOURCE_ARTIFACT_REVISION,
  SQL_FIND_SOURCE_CONTENT_APPROVAL,
  SQL_INSERT_OUTBOX_EVENT,
  SQL_INSERT_PUBLICATION_ATTEMPT,
  SQL_SETTLE_ATTEMPT_TERMINAL,
  SQL_SETTLE_PUBLICATION_TERMINAL,
  SQL_UPDATE_PUBLICATION_GATED,
  SQL_UPDATE_PUBLICATION_PUBLISHING,
} from './postgres-publication-statements.js';
import type {
  PublicationApprovalSnapshotRow,
  PublicationRow,
} from './postgres-publication-mappers.js';

export async function executePrepareAttemptTransaction(
  database: Database,
  params: PrepareAttemptParams,
  protector?: SocialCredentialProtectorPort,
): Promise<PrepareAttemptResult> {
  return database.withTransaction(async (tx) => {
    // 1. Lock publication FOR UPDATE and check lease fence
    const pubRes = await tx.query<PublicationRow>(SQL_FIND_PUBLICATION_FOR_UPDATE, [
      params.workspaceId,
      params.publicationId,
    ]);
    if (pubRes.rowCount === 0 || !pubRes.rows[0]) {
      throw new PublicationNotFoundError(params.publicationId);
    }
    const pub = pubRes.rows[0];

    if (
      pub.lease_token !== params.leaseToken ||
      pub.lease_owner !== params.workerId ||
      !['queued', 'publishing'].includes(pub.status)
    ) {
      throw new PublicationFenceLostError(
        params.publicationId,
        'Lease fence lost; lease token mismatch or status invalid',
      );
    }

    if (isTerminalPublication(pub.status)) {
      throw new PublicationStateConflictError(pub.status, 'prepare_attempt');
    }

    // 2. Fetch immutable approval snapshot
    const snapRes = await tx.query<PublicationApprovalSnapshotRow>(
      `SELECT * FROM publication_approval_snapshots WHERE workspace_id = $1 AND id = $2`,
      [params.workspaceId, pub.approval_snapshot_id],
    );
    if (snapRes.rowCount === 0 || !snapRes.rows[0]) {
      return markGated(tx, pub, params, 'APPROVAL_SNAPSHOT_MISSING', 'Approval snapshot not found');
    }
    const snapshot = snapRes.rows[0];

    // 3. Revalidate source content approval & artifact revision
    const contentApprRes = await tx.query<{
      content_hash: Buffer;
      snapshot_hash: Buffer;
      policy_hash: Buffer;
    }>(SQL_FIND_SOURCE_CONTENT_APPROVAL, [params.workspaceId, snapshot.content_approval_id]);
    if (
      contentApprRes.rowCount === 0 ||
      !contentApprRes.rows[0] ||
      !crypto.timingSafeEqual(contentApprRes.rows[0].content_hash, snapshot.content_hash) ||
      !crypto.timingSafeEqual(
        contentApprRes.rows[0].snapshot_hash,
        snapshot.content_approval_snapshot_hash,
      )
    ) {
      return markGated(
        tx,
        pub,
        params,
        'SOURCE_APPROVAL_DRIFT',
        'Source content approval missing or drifted',
      );
    }

    const artRevRes = await tx.query<{ content_hash: Buffer }>(SQL_FIND_SOURCE_ARTIFACT_REVISION, [
      params.workspaceId,
      snapshot.artifact_id,
      snapshot.revision_number,
      snapshot.content_hash,
    ]);
    if (artRevRes.rowCount === 0 || !artRevRes.rows[0]) {
      return markGated(
        tx,
        pub,
        params,
        'ARTIFACT_REVISION_DRIFT',
        'Source artifact revision drifted',
      );
    }

    // 4. Revalidate compliance evaluation
    const compEvalRes = await tx.query<{
      status: string;
      result: string;
      blocking_count: number;
    }>(SQL_FIND_COMPLIANCE_EVALUATION, [
      params.workspaceId,
      snapshot.snapshot_json?.evaluationId ?? '',
    ]);
    // If evaluationId was stored or check via source approval
    if (compEvalRes.rowCount > 0 && compEvalRes.rows[0]) {
      const comp = compEvalRes.rows[0];
      if (comp.status !== 'completed' || comp.result !== 'pass' || comp.blocking_count > 0) {
        return markGated(
          tx,
          pub,
          params,
          'COMPLIANCE_EVALUATION_FAILED',
          'Compliance evaluation not passing',
        );
      }
    }

    // 5. Revalidate destination social account
    const accRes = await tx.query<{
      status: string;
      provider_account_id: string;
      version: string | number;
      capabilities_json: Record<string, boolean>;
    }>(SQL_FIND_SOCIAL_ACCOUNT, [params.workspaceId, snapshot.social_account_id]);
    if (accRes.rowCount === 0 || !accRes.rows[0]) {
      return markGated(
        tx,
        pub,
        params,
        'SOCIAL_ACCOUNT_MISSING',
        'Destination social account missing',
      );
    }
    const acc = accRes.rows[0];
    if (acc.status !== 'active') {
      return markGated(
        tx,
        pub,
        params,
        'SOCIAL_ACCOUNT_INACTIVE',
        `Social account status is ${acc.status}`,
      );
    }
    if (acc.provider_account_id !== snapshot.provider_account_id) {
      return markGated(tx, pub, params, 'PROVIDER_ACCOUNT_DRIFT', 'Provider account ID changed');
    }
    if (Number(acc.version) !== Number(snapshot.account_version)) {
      return markGated(tx, pub, params, 'ACCOUNT_VERSION_DRIFT', 'Social account version drifted');
    }
    if (!acc.capabilities_json?.canPublishText) {
      return markGated(
        tx,
        pub,
        params,
        'CAPABILITY_MISSING',
        'Social account missing text publish capability',
      );
    }
    const currentFp = computeCanonicalHash(acc.capabilities_json ?? {});
    if (
      !crypto.timingSafeEqual(Buffer.from(currentFp), Buffer.from(snapshot.capability_fingerprint))
    ) {
      return markGated(
        tx,
        pub,
        params,
        'CAPABILITY_FINGERPRINT_DRIFT',
        'Social capabilities changed',
      );
    }

    // 6. Check attempt count bounds
    const nextAttemptNumber = Number(pub.current_attempt_number) + 1;
    if (nextAttemptNumber > Number(pub.max_attempts)) {
      return markGated(
        tx,
        pub,
        params,
        'MAX_ATTEMPTS_EXCEEDED',
        'Max publication attempts reached',
      );
    }

    // 7. Check credentials & decrypt access token if available
    let decryptedAccessToken: string | undefined = undefined;
    const credsRes = await tx.query<{
      access_token_ciphertext: Buffer;
      access_token_iv: Buffer;
      access_token_auth_tag: Buffer;
      refresh_token_ciphertext: Buffer | null;
      refresh_token_iv: Buffer | null;
      refresh_token_auth_tag: Buffer | null;
      encryption_key_version: string;
      token_type: 'bearer' | 'mac';
    }>(SQL_FIND_SOCIAL_CREDENTIALS, [params.workspaceId, snapshot.social_account_id]);

    if (credsRes.rowCount > 0 && credsRes.rows[0] && protector) {
      const creds = credsRes.rows[0];
      try {
        const decrypted = protector.decrypt({
          workspaceId: params.workspaceId,
          socialAccountId: snapshot.social_account_id,
          platform: snapshot.platform,
          credentials: {
            accessTokenCiphertext: creds.access_token_ciphertext,
            accessTokenIv: creds.access_token_iv,
            accessTokenAuthTag: creds.access_token_auth_tag,
            refreshTokenCiphertext: creds.refresh_token_ciphertext ?? null,
            refreshTokenIv: creds.refresh_token_iv ?? null,
            refreshTokenAuthTag: creds.refresh_token_auth_tag ?? null,
            keyVersion: creds.encryption_key_version,
          },
        });
        decryptedAccessToken = decrypted.accessToken;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Credential decryption failed';
        return markGated(tx, pub, params, 'CREDENTIAL_DECRYPTION_FAILED', msg);
      }
    }

    // 8. Generate attempt identifiers and request hash
    const attemptId = generateUuidV7();
    const attemptIdempotencyKey = `${params.publicationId}:attempt:${nextAttemptNumber}`;
    const requestPayload = {
      publicationId: params.publicationId,
      attemptNumber: nextAttemptNumber,
      socialAccountId: snapshot.social_account_id,
      providerAccountId: snapshot.provider_account_id,
      renderedText: snapshot.rendered_text,
      platformSettings: snapshot.platform_settings_json,
    };
    const requestHash = computeCanonicalHash(requestPayload);

    // 9. Insert publication attempt with phase = 'provider_attempt_started'
    await tx.query(SQL_INSERT_PUBLICATION_ATTEMPT, [
      attemptId,
      params.workspaceId,
      params.publicationId,
      nextAttemptNumber,
      attemptIdempotencyKey,
      Buffer.from(requestHash),
      params.adapterVersion,
      params.correlationId,
      'provider_attempt_started',
      'running',
      new Date().toISOString(),
    ]);

    // 10. Advance publication status to 'publishing'
    const updateRes = await tx.query(SQL_UPDATE_PUBLICATION_PUBLISHING, [
      nextAttemptNumber,
      params.workspaceId,
      params.publicationId,
      params.leaseToken,
      Number(pub.version),
    ]);
    if (updateRes.rowCount === 0) {
      throw new PublicationFenceLostError(
        params.publicationId,
        'Failed to advance publication to publishing; lease lost',
      );
    }

    // 11. Append audit event
    const auditAdapter = createTransactionScopedPostgresAuditAdapter(tx);
    await auditAdapter.appendAuditEvent({
      id: parseAuditEventId(generateUuidV7()),
      workspaceId: params.workspaceId,
      actorType: 'system',
      actorUserId: null,
      action: 'publication.attempt_started',
      resourceType: 'publication',
      resourceId: params.publicationId,
      result: 'succeeded',
      reasonCode: null,
      changes: {
        status: { before: pub.status, after: 'publishing' },
        currentAttemptNumber: { before: pub.current_attempt_number, after: nextAttemptNumber },
      },
      ipHash: null,
      userAgentSummary: null,
      correlationId: parseCorrelationId(params.correlationId),
      occurredAt: parseIsoTimestamp(new Date().toISOString()),
      createdAt: parseIsoTimestamp(new Date().toISOString()),
    });

    return {
      kind: 'ready',
      attemptId: parsePublicationAttemptId(attemptId),
      attemptNumber: nextAttemptNumber,
      attemptIdempotencyKey,
      requestHashHex: Buffer.from(requestHash).toString('hex'),
      renderedText: snapshot.rendered_text,
      platformSettings: snapshot.platform_settings_json ?? {},
      socialAccountId: parseSocialAccountId(snapshot.social_account_id),
      providerAccountId: snapshot.provider_account_id,
      decryptedAccessToken,
    };
  });
}

async function markGated(
  tx: { query: Database['query'] },
  pub: PublicationRow,
  params: PrepareAttemptParams,
  errorCode: string,
  errorMessage: string,
): Promise<PrepareAttemptResult> {
  await tx.query(SQL_UPDATE_PUBLICATION_GATED, [
    'rejected',
    errorCode,
    errorCode,
    errorMessage,
    params.workspaceId,
    params.publicationId,
    params.leaseToken,
  ]);

  const auditAdapter = createTransactionScopedPostgresAuditAdapter(tx);
  await auditAdapter.appendAuditEvent({
    id: parseAuditEventId(generateUuidV7()),
    workspaceId: params.workspaceId,
    actorType: 'system',
    actorUserId: null,
    action: 'publication.gated',
    resourceType: 'publication',
    resourceId: params.publicationId,
    result: 'failed',
    reasonCode: errorCode,
    changes: { status: { before: pub.status, after: 'rejected' } },
    ipHash: null,
    userAgentSummary: null,
    correlationId: parseCorrelationId(params.correlationId),
    occurredAt: parseIsoTimestamp(new Date().toISOString()),
    createdAt: parseIsoTimestamp(new Date().toISOString()),
  });

  return {
    kind: 'gated_drift',
    reason: errorCode,
    errorCode,
    errorMessage,
  };
}

export async function executeSettleAttemptTransaction(
  database: Database,
  params: SettleAttemptParams,
): Promise<void> {
  return database.withTransaction(async (tx) => {
    // 1. Determine attempt terminal status & payload
    let attemptStatus: string;
    let outcomeCode: string | null = null;
    let outcomeMessage: string | null = null;
    let remotePostId: string | null = null;
    let remotePermalink: string | null = null;

    if (params.outcome.kind === 'published') {
      attemptStatus = 'succeeded';
      remotePostId = params.outcome.remotePostId;
      remotePermalink = params.outcome.remotePermalink ?? null;
    } else if (params.outcome.kind === 'transient_failure') {
      attemptStatus = 'transient_failure';
      outcomeCode = params.outcome.errorCode;
      outcomeMessage = params.outcome.errorMessage;
    } else if (params.outcome.kind === 'permanent_failure') {
      attemptStatus = 'permanent_failure';
      outcomeCode = params.outcome.errorCode;
      outcomeMessage = params.outcome.errorMessage;
    } else {
      attemptStatus = 'outcome_unknown';
      outcomeCode = params.outcome.errorCode;
      outcomeMessage = params.outcome.errorMessage;
    }

    // 2. CAS update attempt row
    const attemptRes = await tx.query(SQL_SETTLE_ATTEMPT_TERMINAL, [
      attemptStatus,
      outcomeCode,
      outcomeMessage,
      remotePostId,
      remotePermalink,
      params.workspaceId,
      params.attemptId,
    ]);
    if (attemptRes.rowCount === 0) {
      throw new PublicationFenceLostError(
        params.publicationId,
        'Attempt settlement fence lost; attempt was not in provider_attempt_started phase',
      );
    }

    // 3. Lock publication with lease token fence
    const pubRes = await tx.query<PublicationRow>(
      `SELECT * FROM publications WHERE workspace_id = $1 AND id = $2 AND lease_token = $3 FOR UPDATE`,
      [params.workspaceId, params.publicationId, params.leaseToken],
    );
    if (pubRes.rowCount === 0 || !pubRes.rows[0]) {
      throw new PublicationFenceLostError(
        params.publicationId,
        'Publication settlement fence lost; lease mismatch or already reclaimed',
      );
    }
    const pub = pubRes.rows[0];

    // 4. Compute publication status, fields, and events
    let newStatus: string;
    let pubRemotePostId: string | null = null;
    let pubRemotePermalink: string | null = null;
    let pubPublishedAt: string | null = null;
    let pubLastErrorCode: string | null = null;
    let pubLastErrorMessage: string | null = null;
    let pubGatedReason: string | null = null;
    let pubCompletedAt: string | null = null;
    let pubNextAttemptAt: string | null = null;
    let auditAction: string;
    let outboxType: string;
    let outboxAvailableAt: string = new Date().toISOString();

    if (params.outcome.kind === 'published') {
      newStatus = 'published';
      pubRemotePostId = params.outcome.remotePostId;
      pubRemotePermalink = params.outcome.remotePermalink ?? null;
      pubPublishedAt = params.outcome.publishedAt;
      pubCompletedAt = new Date().toISOString();
      auditAction = 'publication.published';
      outboxType = 'publication.published';
    } else if (params.outcome.kind === 'transient_failure') {
      if (Number(pub.current_attempt_number) >= Number(pub.max_attempts)) {
        newStatus = 'failed';
        pubLastErrorCode = params.outcome.errorCode;
        pubLastErrorMessage = params.outcome.errorMessage;
        pubGatedReason = 'MAX_ATTEMPTS_EXCEEDED';
        pubCompletedAt = new Date().toISOString();
        auditAction = 'publication.failed';
        outboxType = 'publication.failed';
      } else {
        newStatus = 'retry_wait';
        pubLastErrorCode = params.outcome.errorCode;
        pubLastErrorMessage = params.outcome.errorMessage;
        const backoffMs = calculatePublicationBackoff(
          params.attemptNumber,
          params.outcome.retryAfterMs,
        );
        pubNextAttemptAt =
          params.nextAttemptAt ?? dateToIsoTimestamp(new Date(Date.now() + backoffMs));
        outboxAvailableAt = pubNextAttemptAt;
        auditAction = 'publication.retry_scheduled';
        outboxType = 'publication.retry_scheduled';
      }
    } else if (params.outcome.kind === 'permanent_failure') {
      newStatus = 'failed';
      pubLastErrorCode = params.outcome.errorCode;
      pubLastErrorMessage = params.outcome.errorMessage;
      pubCompletedAt = new Date().toISOString();
      auditAction = 'publication.failed';
      outboxType = 'publication.failed';
    } else {
      newStatus = 'outcome_unknown';
      pubLastErrorCode = params.outcome.errorCode;
      pubLastErrorMessage = params.outcome.errorMessage;
      pubCompletedAt = new Date().toISOString();
      auditAction = 'publication.outcome_unknown';
      outboxType = 'publication.outcome_unknown';
    }

    // 5. Update publication row
    const pubUpdateRes = await tx.query(SQL_SETTLE_PUBLICATION_TERMINAL, [
      newStatus,
      pubRemotePostId,
      pubRemotePermalink,
      pubPublishedAt,
      pubLastErrorCode,
      pubLastErrorMessage,
      pubGatedReason,
      pubCompletedAt,
      pubNextAttemptAt,
      params.workspaceId,
      params.publicationId,
      params.leaseToken,
    ]);
    if (pubUpdateRes.rowCount === 0) {
      throw new PublicationFenceLostError(
        params.publicationId,
        'Publication settlement CAS failed on update',
      );
    }

    // 6. Insert outbox event
    const outboxId = generateUuidV7();
    await tx.query(SQL_INSERT_OUTBOX_EVENT, [
      outboxId,
      params.workspaceId,
      outboxType,
      'publication',
      params.publicationId,
      Number(pub.version) + 1,
      JSON.stringify({
        publicationId: params.publicationId,
        attemptId: params.attemptId,
        status: newStatus,
        version: Number(pub.version) + 1,
        ...(pubRemotePostId ? { remotePostId: pubRemotePostId } : {}),
      }),
      outboxAvailableAt,
    ]);

    // 7. Append audit event
    const auditAdapter = createTransactionScopedPostgresAuditAdapter(tx);
    await auditAdapter.appendAuditEvent({
      id: parseAuditEventId(generateUuidV7()),
      workspaceId: params.workspaceId,
      actorType: 'system',
      actorUserId: null,
      action: auditAction,
      resourceType: 'publication',
      resourceId: params.publicationId,
      result: 'succeeded',
      reasonCode: pubLastErrorCode,
      changes: {
        status: { before: pub.status, after: newStatus },
        currentAttemptNumber: { before: pub.current_attempt_number, after: params.attemptNumber },
      },
      ipHash: null,
      userAgentSummary: null,
      correlationId: null,
      occurredAt: parseIsoTimestamp(new Date().toISOString()),
      createdAt: parseIsoTimestamp(new Date().toISOString()),
    });
  });
}
