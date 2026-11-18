import {
  type OAuthCallbackResultSnapshot,
  type OAuthTransactionSnapshot,
  type SocialAccountSnapshot,
} from '@affiliate-content-os/domain';
import {
  type CompleteOAuthCallbackAtomicParams,
  type CompleteOAuthCallbackAtomicResult,
  type ConsumeCallbackResultParams,
  type RecordFailedOAuthCallbackParams,
  type SaveOAuthTransactionParams,
  type SocialPersistencePort,
} from '@affiliate-content-os/application';
import type { Database } from '../../database/types.js';
import {
  mapOAuthCallbackResultRow,
  mapOAuthTransactionRow,
  mapSocialAccountRow,
  type OAuthCallbackResultRow,
  type OAuthTransactionRow,
  type SocialAccountRow,
} from './postgres-social-mappers.js';
import {
  SQL_CONSUME_CALLBACK_RESULT,
  SQL_FIND_SOCIAL_ACCOUNT_BY_ID,
  SQL_FIND_TRANSACTION_BY_STATE_HASH,
  SQL_INSERT_OAUTH_TRANSACTION,
  SQL_LIST_SOCIAL_ACCOUNTS,
} from './postgres-social-statements.js';
import { executeCompleteOAuthCallbackTransaction } from './social-callback-transactions.js';
import { executeRecordFailedOAuthCallbackTransaction } from './social-callback-failed-transaction.js';

export class PostgresSocialPersistenceAdapter implements SocialPersistencePort {
  public constructor(private readonly database: Database) {}

  public async saveOAuthTransaction(
    params: SaveOAuthTransactionParams,
  ): Promise<OAuthTransactionSnapshot> {
    const res = await this.database.query<OAuthTransactionRow>(SQL_INSERT_OAUTH_TRANSACTION, [
      params.id,
      params.workspaceId,
      params.platform,
      params.initiatedByUserId,
      Buffer.from(params.stateHash),
      null, // pkce_verifier_ciphertext
      null, // pkce_verifier_iv
      null, // pkce_verifier_auth_tag
      null, // encryption_key_version
      params.redirectUri,
      params.returnTo,
      JSON.stringify(params.requestedScopes),
      params.createdAt,
      params.expiresAt,
    ]);
    return mapOAuthTransactionRow(res.rows[0]!);
  }

  public async findPendingTransactionByStateHash(
    stateHash: Uint8Array,
  ): Promise<OAuthTransactionSnapshot | null> {
    const res = await this.database.query<OAuthTransactionRow>(SQL_FIND_TRANSACTION_BY_STATE_HASH, [
      Buffer.from(stateHash),
    ]);
    if (res.rows.length === 0) return null;
    return mapOAuthTransactionRow(res.rows[0]!);
  }

  public async completeOAuthCallbackAtomic(
    params: CompleteOAuthCallbackAtomicParams,
  ): Promise<CompleteOAuthCallbackAtomicResult> {
    return executeCompleteOAuthCallbackTransaction(this.database, params);
  }

  public async recordFailedOAuthCallbackAtomic(
    params: RecordFailedOAuthCallbackParams,
  ): Promise<OAuthCallbackResultSnapshot> {
    return executeRecordFailedOAuthCallbackTransaction(this.database, params);
  }

  public async consumeCallbackResult(
    params: ConsumeCallbackResultParams,
  ): Promise<OAuthCallbackResultSnapshot | null> {
    const res = await this.database.query<OAuthCallbackResultRow>(SQL_CONSUME_CALLBACK_RESULT, [
      params.workspaceId,
      Buffer.from(params.resultKeyHash),
      params.now,
    ]);
    if (res.rows.length === 0) return null;
    return mapOAuthCallbackResultRow(res.rows[0]!);
  }

  public async listSocialAccounts(params: {
    workspaceId: string;
  }): Promise<SocialAccountSnapshot[]> {
    const res = await this.database.query<SocialAccountRow>(SQL_LIST_SOCIAL_ACCOUNTS, [
      params.workspaceId,
    ]);
    return res.rows.map(mapSocialAccountRow);
  }

  public async findSocialAccountById(params: {
    workspaceId: string;
    accountId: string;
  }): Promise<SocialAccountSnapshot | null> {
    const res = await this.database.query<SocialAccountRow>(SQL_FIND_SOCIAL_ACCOUNT_BY_ID, [
      params.workspaceId,
      params.accountId,
    ]);
    if (res.rows.length === 0) return null;
    return mapSocialAccountRow(res.rows[0]!);
  }
}
