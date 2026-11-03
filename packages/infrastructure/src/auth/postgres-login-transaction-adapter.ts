import type {
  ConsumedLoginTransactionDTO,
  EncryptedSecretsDTO,
  LoginTransactionStorePort,
} from '@affiliate-content-os/application';
import type { Database } from '../database/index.js';
import { DatabaseError } from '../database/errors.js';
import {
  mapConsumedTransactionRow,
  type ConsumedLoginTransactionRow,
  isProxySafe,
} from './mappers.js';

export interface OidcLoginTransactionInsert {
  readonly id: string;
  readonly stateHash: Uint8Array;
  readonly browserBindingHash: Uint8Array;
  readonly secretsCiphertext: Uint8Array;
  readonly secretsIv: Uint8Array;
  readonly secretsAuthTag: Uint8Array;
  readonly keyVersion: string;
  readonly returnTo: string;
  readonly createdAt: string;
  readonly expiresAt: string;
}

export interface PostgresLoginTransactionAdapter extends LoginTransactionStorePort {
  createLoginTransaction(transaction: OidcLoginTransactionInsert): Promise<void>;
  consumeLoginTransaction(criteria: {
    stateHash: Uint8Array;
    browserBindingHash: Uint8Array;
    now: string;
  }): Promise<ConsumedLoginTransactionRow | null>;
}

export function createPostgresLoginTransactionAdapter(
  database: Database,
): PostgresLoginTransactionAdapter {
  return {
    async createLoginTransaction(tx: OidcLoginTransactionInsert): Promise<void> {
      const sql = `
        INSERT INTO oidc_login_transactions (
          id, state_hash, browser_binding_hash, secrets_ciphertext, secrets_iv, secrets_auth_tag,
          key_version, return_to, status, created_at, expires_at, version
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', $9, $10, 1);
      `;
      const params = [
        tx.id,
        Buffer.from(tx.stateHash),
        Buffer.from(tx.browserBindingHash),
        Buffer.from(tx.secretsCiphertext),
        Buffer.from(tx.secretsIv),
        Buffer.from(tx.secretsAuthTag),
        tx.keyVersion,
        tx.returnTo,
        tx.createdAt,
        tx.expiresAt,
      ];
      await database.query(sql, params);
    },

    async consumeLoginTransaction(criteria: {
      stateHash: Uint8Array;
      browserBindingHash: Uint8Array;
      now: string;
    }): Promise<ConsumedLoginTransactionRow | null> {
      const sql = `
        WITH target AS (
          SELECT
            id,
            key_version,
            return_to,
            secrets_ciphertext,
            secrets_iv,
            secrets_auth_tag,
            created_at,
            expires_at
          FROM oidc_login_transactions
          WHERE state_hash = $1
            AND browser_binding_hash = $2
            AND status = 'pending'
            AND expires_at > $3
          LIMIT 2
          FOR UPDATE
        ),
        updated AS (
          UPDATE oidc_login_transactions t
          SET status = 'consumed',
              consumed_at = $3,
              secrets_ciphertext = NULL,
              secrets_iv = NULL,
              secrets_auth_tag = NULL,
              version = t.version + 1
          FROM target
          WHERE t.id = target.id
          RETURNING t.id
        )
        SELECT
          target.id,
          target.key_version,
          target.return_to,
          target.secrets_ciphertext,
          target.secrets_iv,
          target.secrets_auth_tag,
          target.created_at,
          target.expires_at
        FROM target
        JOIN updated ON target.id = updated.id;
      `;
      const params = [
        Buffer.from(criteria.stateHash),
        Buffer.from(criteria.browserBindingHash),
        criteria.now,
      ];
      const result = await database.query(sql, params);

      const rawRows = result.rows;
      if (
        typeof rawRows !== 'object' ||
        rawRows === null ||
        isProxySafe(rawRows) ||
        !Array.isArray(rawRows)
      ) {
        throw new DatabaseError('Database result rows must be an array');
      }
      if (Object.getPrototypeOf(rawRows) !== Array.prototype) {
        throw new DatabaseError('Database result rows must have Array.prototype');
      }
      const lenDesc = Object.getOwnPropertyDescriptor(rawRows, 'length');
      if (
        !lenDesc ||
        lenDesc.get !== undefined ||
        lenDesc.set !== undefined ||
        typeof lenDesc.value !== 'number'
      ) {
        throw new DatabaseError('Invalid result rows length');
      }
      if (lenDesc.value === 0) {
        return null;
      }
      if (lenDesc.value > 1) {
        throw new DatabaseError('Unexpected duplicate login transaction match');
      }
      const desc0 = Object.getOwnPropertyDescriptor(rawRows, '0');
      if (!desc0 || desc0.get !== undefined || desc0.set !== undefined) {
        throw new DatabaseError('Invalid result row item');
      }
      return mapConsumedTransactionRow(desc0.value);
    },

    async createPendingTransaction(params: {
      readonly id: string;
      readonly stateHash: Uint8Array;
      readonly browserBindingHash: Uint8Array;
      readonly encryptedSecrets: EncryptedSecretsDTO;
      readonly returnTo: string;
      readonly createdAt: string;
      readonly expiresAt: string;
    }): Promise<void> {
      await this.createLoginTransaction({
        id: params.id,
        stateHash: params.stateHash,
        browserBindingHash: params.browserBindingHash,
        secretsCiphertext: params.encryptedSecrets.ciphertext,
        secretsIv: params.encryptedSecrets.iv,
        secretsAuthTag: params.encryptedSecrets.authTag,
        keyVersion: params.encryptedSecrets.keyVersion,
        returnTo: params.returnTo,
        createdAt: params.createdAt,
        expiresAt: params.expiresAt,
      });
    },

    async consumePendingTransaction(params: {
      readonly stateHash: Uint8Array;
      readonly browserBindingHash: Uint8Array;
      readonly now: string;
    }): Promise<ConsumedLoginTransactionDTO | null> {
      const row = await this.consumeLoginTransaction(params);
      if (!row) {
        return null;
      }
      return Object.freeze({
        id: row.id,
        keyVersion: row.keyVersion,
        returnTo: row.returnTo,
        encryptedSecrets: Object.freeze({
          ciphertext: row.secretsCiphertext,
          iv: row.secretsIv,
          authTag: row.secretsAuthTag,
          keyVersion: row.keyVersion,
        }),
        createdAt: row.createdAt,
        expiresAt: row.expiresAt,
      });
    },
  };
}
