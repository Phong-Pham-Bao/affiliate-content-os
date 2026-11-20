import {
  parseAuditEventId,
  parseCorrelationId,
  parseIsoTimestamp,
  parseUserId,
  parseWorkspaceId,
} from '@affiliate-content-os/domain';
import {
  generateUuidV7,
  SocialAccountNotFoundError,
  SocialAccountVersionMismatchError,
  SocialCredentialEncryptionError,
  SocialOperationFenceLostError,
  type DisconnectSocialAccountParams,
  type UpdateExternalRevocationResultParams,
} from '@affiliate-content-os/application';
import { createTransactionScopedPostgresAuditAdapter } from '../../audit/index.js';
import type { Database } from '../../database/types.js';
import { mapSocialAccountRow, type SocialAccountRow } from './postgres-social-mappers.js';
import {
  SQL_COMPLETE_OPERATION,
  SQL_DELETE_SOCIAL_CREDENTIALS,
  SQL_DISCONNECT_SOCIAL_ACCOUNT,
  SQL_UPDATE_EXTERNAL_REVOCATION_RESULT,
} from './postgres-social-lifecycle-statements.js';

export async function executeDisconnectSocialAccount(
  database: Database,
  params: DisconnectSocialAccountParams,
) {
  return database.withTransaction(async (tx) => {
    const updateRes = await tx.query<SocialAccountRow>(SQL_DISCONNECT_SOCIAL_ACCOUNT, [
      params.workspaceId,
      params.accountId,
      params.now,
      params.actorUserId,
      params.externalRevocationAttempted,
      params.externalRevocationSupported,
      params.externalRevocationResult,
      params.expectedVersion,
    ]);

    if (updateRes.rows.length === 0) {
      // Check whether it was already disconnected or version mismatch
      const checkRes = await tx.query<SocialAccountRow>(
        'SELECT * FROM social_accounts WHERE workspace_id = $1 AND id = $2 FOR UPDATE;',
        [params.workspaceId, params.accountId],
      );
      if (checkRes.rows.length === 0) {
        throw new SocialAccountNotFoundError();
      }
      const existing = checkRes.rows[0]!;
      if (existing.status === 'disconnected') {
        const mappedExisting = mapSocialAccountRow(existing);
        if (params.operationId && params.operationLeaseToken) {
          const opRes = await tx.query(SQL_COMPLETE_OPERATION, [
            params.operationId,
            params.operationLeaseToken,
            mappedExisting.version,
            200,
            JSON.stringify({
              id: mappedExisting.id,
              version: mappedExisting.version,
              status: mappedExisting.status,
            }),
            params.now,
          ]);
          if (opRes.rowCount !== 1) {
            throw new SocialOperationFenceLostError(
              'Operation lease or fencing was lost during disconnect completion',
            );
          }
        }
        return mappedExisting;
      }
      throw new SocialAccountVersionMismatchError(
        `Account version mismatch: expected ${params.expectedVersion}, found ${existing.version}`,
      );
    }

    // For supported platforms, stage encrypted token material to durable revocation job before deletion
    if (params.externalRevocationSupported) {
      const revocationJobId = generateUuidV7();
      const insertJobRes = await tx.query(
        `INSERT INTO social_account_revocations (
           id, workspace_id, social_account_id, platform,
           encrypted_token, token_iv, token_auth_tag, encryption_key_version,
           status, phase, created_at, updated_at
         )
         SELECT
           $1, c.workspace_id, c.social_account_id, a.platform,
           c.access_token_ciphertext, c.access_token_iv, c.access_token_auth_tag, c.encryption_key_version,
           'pending', 'claimed', $2, $2
         FROM social_credentials c
         JOIN social_accounts a ON a.id = c.social_account_id AND a.workspace_id = c.workspace_id
         WHERE c.workspace_id = $3 AND c.social_account_id = $4;`,
        [revocationJobId, params.now, params.workspaceId, params.accountId],
      );
      if (insertJobRes.rowCount !== 1) {
        throw new SocialCredentialEncryptionError(
          'Failed to stage revocation job: active credentials missing or duplicate active job',
        );
      }
    }

    // Cryptographically erase / delete usable credentials
    const delCredRes = await tx.query(SQL_DELETE_SOCIAL_CREDENTIALS, [
      params.workspaceId,
      params.accountId,
    ]);
    if (params.externalRevocationSupported && delCredRes.rowCount !== 1) {
      throw new SocialCredentialEncryptionError('Failed to delete credentials during disconnect');
    }

    // Audit disconnect event
    const audit = createTransactionScopedPostgresAuditAdapter(tx);
    await audit.appendAuditEvent({
      id: parseAuditEventId(generateUuidV7()),
      workspaceId: parseWorkspaceId(params.workspaceId),
      actorType: 'user',
      actorUserId: parseUserId(params.actorUserId),
      action: 'social_connection.disconnected',
      resourceType: 'social_account',
      resourceId: params.accountId,
      result: 'succeeded',
      reasonCode: null,
      changes: {
        status: { before: null, after: 'disconnected' },
        external_revocation_supported: {
          before: null,
          after: String(params.externalRevocationSupported),
        },
        external_revocation_result: { before: null, after: params.externalRevocationResult },
      },
      ipHash: params.auditContext?.ipHash ?? null,
      userAgentSummary: params.auditContext?.userAgentSummary ?? null,
      correlationId: params.auditContext?.correlationId
        ? parseCorrelationId(params.auditContext.correlationId)
        : null,
      occurredAt: parseIsoTimestamp(params.now),
      createdAt: parseIsoTimestamp(params.now),
    });

    const mappedAcc = mapSocialAccountRow(updateRes.rows[0]!);

    if (params.operationId && params.operationLeaseToken) {
      const opRes = await tx.query(SQL_COMPLETE_OPERATION, [
        params.operationId,
        params.operationLeaseToken,
        mappedAcc.version,
        200,
        JSON.stringify({
          id: mappedAcc.id,
          version: mappedAcc.version,
          status: mappedAcc.status,
        }),
        params.now,
      ]);
      if (opRes.rowCount !== 1) {
        throw new SocialOperationFenceLostError(
          'Operation lease or fencing was lost during disconnect completion',
        );
      }
    }

    return mappedAcc;
  });
}

export async function executeUpdateExternalRevocationResult(
  database: Database,
  params: UpdateExternalRevocationResultParams,
): Promise<void> {
  await database.query(SQL_UPDATE_EXTERNAL_REVOCATION_RESULT, [
    params.workspaceId,
    params.accountId,
    params.externalRevocationResult,
    params.now,
  ]);
}
