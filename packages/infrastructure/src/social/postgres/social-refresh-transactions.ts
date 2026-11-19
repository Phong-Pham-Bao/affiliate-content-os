import crypto from 'node:crypto';
import {
  parseAuditEventId,
  parseCorrelationId,
  parseIsoTimestamp,
  parseUserId,
  parseWorkspaceId,
} from '@affiliate-content-os/domain';
import {
  generateUuidV7,
  SocialAccountVersionMismatchError,
  type ClaimedSocialAccountRefresh,
  type ClaimSocialAccountForRefreshParams,
  type CompleteSocialAccountRefreshParams,
  type EncryptedSocialCredentials,
  type RecordFailedSocialAccountRefreshParams,
} from '@affiliate-content-os/application';
import { createTransactionScopedPostgresAuditAdapter } from '../../audit/index.js';
import type { Database } from '../../database/types.js';
import { mapSocialAccountRow, type SocialAccountRow } from './postgres-social-mappers.js';
import {
  SQL_CLAIM_REFRESH_LEASE,
  SQL_COMPLETE_ACCOUNT_REFRESH,
  SQL_COMPLETE_CREDENTIALS_REFRESH,
  SQL_FIND_ACCOUNT_FOR_REFRESH_CLAIM,
  SQL_FIND_CREDENTIALS_FOR_REFRESH,
  SQL_RECORD_FAILED_ACCOUNT_REFRESH,
} from './postgres-social-lifecycle-statements.js';

export function computeSocialAccountRefreshAdvisoryLockKey(accountId: string): string {
  const hash = crypto.createHash('sha256');
  hash.update('social_account_refresh_lock:');
  hash.update(accountId);
  return hash.digest().readBigInt64BE(0).toString();
}

interface CredentialRow {
  access_token_ciphertext: Buffer;
  access_token_iv: Buffer;
  access_token_auth_tag: Buffer;
  refresh_token_ciphertext: Buffer | null;
  refresh_token_iv: Buffer | null;
  refresh_token_auth_tag: Buffer | null;
  encryption_key_version: string;
  version: string | number;
}

export async function executeClaimSocialAccountForRefresh(
  database: Database,
  params: ClaimSocialAccountForRefreshParams,
): Promise<ClaimedSocialAccountRefresh | null> {
  return database.withTransaction(async (tx) => {
    const accRes = await tx.query<SocialAccountRow>(SQL_FIND_ACCOUNT_FOR_REFRESH_CLAIM, [
      params.workspaceId,
      params.accountId,
    ]);
    if (accRes.rows.length === 0) return null;
    const accRow = accRes.rows[0]!;

    const credRes = await tx.query<CredentialRow>(SQL_FIND_CREDENTIALS_FOR_REFRESH, [
      params.workspaceId,
      params.accountId,
    ]);
    if (credRes.rows.length === 0) return null;
    const credRow = credRes.rows[0]!;

    const leaseRes = await tx.query<SocialAccountRow>(SQL_CLAIM_REFRESH_LEASE, [
      params.workspaceId,
      params.accountId,
      params.now,
      params.leaseDurationSeconds,
      params.workerId ?? 'manual_refresh',
    ]);
    const claimedAccRow = leaseRes.rows[0] ?? accRow;

    const encryptedCredentials: EncryptedSocialCredentials = {
      accessTokenCiphertext: new Uint8Array(credRow.access_token_ciphertext),
      accessTokenIv: new Uint8Array(credRow.access_token_iv),
      accessTokenAuthTag: new Uint8Array(credRow.access_token_auth_tag),
      refreshTokenCiphertext: credRow.refresh_token_ciphertext
        ? new Uint8Array(credRow.refresh_token_ciphertext)
        : null,
      refreshTokenIv: credRow.refresh_token_iv ? new Uint8Array(credRow.refresh_token_iv) : null,
      refreshTokenAuthTag: credRow.refresh_token_auth_tag
        ? new Uint8Array(credRow.refresh_token_auth_tag)
        : null,
      keyVersion: credRow.encryption_key_version,
    };

    return {
      account: mapSocialAccountRow(claimedAccRow),
      encryptedCredentials,
      claimedAccountVersion: Number(accRow.version),
      claimedCredentialVersion: Number(credRow.version),
    };
  });
}

export async function executeCompleteSocialAccountRefresh(
  database: Database,
  params: CompleteSocialAccountRefreshParams,
) {
  return database.withTransaction(async (tx) => {
    const accRes = await tx.query<SocialAccountRow>(SQL_COMPLETE_ACCOUNT_REFRESH, [
      params.workspaceId,
      params.accountId,
      params.derivedStatus,
      params.statusReason,
      params.tokenExpiresAt,
      params.nextRefreshAt,
      params.now,
      params.expectedAccountVersion,
    ]);

    if (accRes.rows.length === 0) {
      throw new SocialAccountVersionMismatchError(
        'Account version mismatch during refresh rotation',
      );
    }

    const enc = params.encryptedCredentials;
    const credRes = await tx.query(SQL_COMPLETE_CREDENTIALS_REFRESH, [
      params.workspaceId,
      params.accountId,
      Buffer.from(enc.accessTokenCiphertext),
      Buffer.from(enc.accessTokenIv),
      Buffer.from(enc.accessTokenAuthTag),
      enc.refreshTokenCiphertext ? Buffer.from(enc.refreshTokenCiphertext) : null,
      enc.refreshTokenIv ? Buffer.from(enc.refreshTokenIv) : null,
      enc.refreshTokenAuthTag ? Buffer.from(enc.refreshTokenAuthTag) : null,
      enc.keyVersion,
      params.tokenExpiresAt,
      params.now,
      params.expectedCredentialVersion,
    ]);

    if (credRes.rowCount === 0) {
      throw new SocialAccountVersionMismatchError(
        'Credential version mismatch during refresh rotation',
      );
    }

    if (params.actorUserId) {
      const audit = createTransactionScopedPostgresAuditAdapter(tx);
      await audit.appendAuditEvent({
        id: parseAuditEventId(generateUuidV7()),
        workspaceId: parseWorkspaceId(params.workspaceId),
        actorType: 'user',
        actorUserId: parseUserId(params.actorUserId),
        action: 'social_connection.refreshed',
        resourceType: 'social_account',
        resourceId: params.accountId,
        result: 'succeeded',
        reasonCode: null,
        changes: { status: { before: null, after: params.derivedStatus } },
        ipHash: params.auditContext?.ipHash ?? null,
        userAgentSummary: params.auditContext?.userAgentSummary ?? null,
        correlationId: params.auditContext?.correlationId
          ? parseCorrelationId(params.auditContext.correlationId)
          : null,
        occurredAt: parseIsoTimestamp(params.now),
        createdAt: parseIsoTimestamp(params.now),
      });
    }

    return mapSocialAccountRow(accRes.rows[0]!);
  });
}

export async function executeRecordFailedSocialAccountRefresh(
  database: Database,
  params: RecordFailedSocialAccountRefreshParams,
) {
  return database.withTransaction(async (tx) => {
    const accRes = await tx.query<SocialAccountRow>(SQL_RECORD_FAILED_ACCOUNT_REFRESH, [
      params.workspaceId,
      params.accountId,
      params.derivedStatus,
      params.statusReason,
      params.nextRefreshAt,
      params.reauthRequiredAt ?? null,
      params.now,
      params.expectedAccountVersion,
    ]);

    if (accRes.rows.length === 0) {
      throw new SocialAccountVersionMismatchError(
        'Account version mismatch while recording failed refresh',
      );
    }

    return mapSocialAccountRow(accRes.rows[0]!);
  });
}
