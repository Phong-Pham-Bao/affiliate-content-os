import type { UserSnapshot } from '@affiliate-content-os/domain';
import type { Database } from '../database/index.js';
import { DatabaseError } from '../database/errors.js';
import { mapUserRow } from '../tenancy/mappers.js';
import { mapSessionRow, isProxySafe } from './mappers.js';
import {
  INSERT_SESSION_SQL,
  FIND_CANDIDATE_SESSIONS_SQL,
  ROTATE_SESSION_SQL,
  TOUCH_SESSION_SQL,
  REVOKE_SESSION_SQL,
  REVOKE_MATCHING_BY_HASH_SQL,
  FIND_USER_BY_ID_SQL,
} from './postgres-session-statements.js';
import type {
  ApplicationSessionInsert,
  PostgresSessionAdapter,
  QueryRunner,
} from './postgres-session-types.js';

export type {
  ApplicationSessionInsert,
  PostgresSessionAdapter,
  QueryRunner,
} from './postgres-session-types.js';

function createAdapterForRunner(runner: QueryRunner): PostgresSessionAdapter {
  return {
    async createSession(s: ApplicationSessionInsert, overrideRunner?: QueryRunner): Promise<void> {
      const q = overrideRunner ?? runner;
      const params = [
        s.id,
        s.userId,
        Buffer.from(s.currentTokenHash),
        s.createdAt,
        s.lastSeenAt,
        s.idleExpiresAt,
        s.absoluteExpiresAt,
        s.rotatedAt,
      ];
      await q.query(INSERT_SESSION_SQL, params);
    },

    async findCandidateSessions(
      c: { tokenHash: Uint8Array; now: string },
      overrideRunner?: QueryRunner,
    ) {
      const q = overrideRunner ?? runner;
      const params = [Buffer.from(c.tokenHash), c.now];
      const result = await q.query(FIND_CANDIDATE_SESSIONS_SQL, params);
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
      return Object.freeze(rawRows.map((r) => mapSessionRow(r)));
    },

    async findUserById(userId: string, overrideRunner?: QueryRunner): Promise<UserSnapshot | null> {
      const q = overrideRunner ?? runner;
      const result = await q.query(FIND_USER_BY_ID_SQL, [userId]);
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
        throw new DatabaseError('Unexpected duplicate user match');
      }
      const desc0 = Object.getOwnPropertyDescriptor(rawRows, '0');
      if (!desc0 || desc0.get !== undefined || desc0.set !== undefined) {
        throw new DatabaseError('Invalid result row item');
      }
      return mapUserRow(desc0.value);
    },

    async rotateSession(
      c: {
        sessionId: string;
        currentVersion: number;
        newCurrentHash: Uint8Array;
        oldCurrentHash: Uint8Array;
        graceValidUntil: string;
        rotatedAt: string;
        lastSeenAt: string;
        idleExpiresAt: string;
      },
      overrideRunner?: QueryRunner,
    ): Promise<void> {
      const q = overrideRunner ?? runner;
      const params = [
        Buffer.from(c.newCurrentHash),
        Buffer.from(c.oldCurrentHash),
        c.graceValidUntil,
        c.rotatedAt,
        c.lastSeenAt,
        c.idleExpiresAt,
        c.sessionId,
        c.currentVersion,
      ];
      const result = await q.query(ROTATE_SESSION_SQL, params);
      if (result.rowCount !== 1) {
        throw new DatabaseError('Session rotation concurrency conflict');
      }
    },

    async touchSession(
      c: {
        sessionId: string;
        currentVersion: number;
        lastSeenAt: string;
        idleExpiresAt: string;
      },
      overrideRunner?: QueryRunner,
    ): Promise<void> {
      const q = overrideRunner ?? runner;
      const params = [c.lastSeenAt, c.idleExpiresAt, c.sessionId, c.currentVersion];
      const result = await q.query(TOUCH_SESSION_SQL, params);
      if (result.rowCount !== 1) {
        throw new DatabaseError('Session touch concurrency conflict');
      }
    },

    async revokeSession(
      c: {
        sessionId: string;
        currentVersion: number;
        revokedAt: string;
        reason: string;
      },
      overrideRunner?: QueryRunner,
    ): Promise<void> {
      const q = overrideRunner ?? runner;
      const params = [c.revokedAt, c.reason, c.sessionId, c.currentVersion];
      const result = await q.query(REVOKE_SESSION_SQL, params);
      if (result.rowCount !== 1) {
        throw new DatabaseError('Session revocation concurrency conflict');
      }
    },

    async revokeMatchingSessionsByTokenHash(
      c: {
        tokenHash: Uint8Array;
        revokedAt: string;
        reason: string;
      },
      overrideRunner?: QueryRunner,
    ): Promise<void> {
      const q = overrideRunner ?? runner;
      const params = [c.revokedAt, c.reason, Buffer.from(c.tokenHash)];
      await q.query(REVOKE_MATCHING_BY_HASH_SQL, params);
    },

    async withTransaction<T>(fn: (txStore: PostgresSessionAdapter) => Promise<T>): Promise<T> {
      return fn(this);
    },
  };
}

export function createPostgresSessionAdapter(database: Database): PostgresSessionAdapter {
  const rootAdapter = createAdapterForRunner(database);
  return {
    ...rootAdapter,
    async withTransaction<T>(fn: (txStore: PostgresSessionAdapter) => Promise<T>): Promise<T> {
      return database.withTransaction(async (tx) => {
        const txAdapter = createAdapterForRunner(tx);
        return fn(txAdapter);
      });
    },
  };
}
