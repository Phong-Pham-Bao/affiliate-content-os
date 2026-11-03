import type { UserSnapshot } from '@affiliate-content-os/domain';
import type { Database } from '../database/index.js';
import { DatabaseError } from '../database/errors.js';
import { mapUserRow, type RawUserRow } from '../tenancy/mappers.js';
import { mapSessionRow, type ApplicationSessionRow } from './mappers.js';
import {
  INSERT_SESSION_SQL,
  FIND_CANDIDATE_SESSIONS_SQL,
  ROTATE_SESSION_SQL,
  TOUCH_SESSION_SQL,
  REVOKE_SESSION_SQL,
  REVOKE_MATCHING_BY_HASH_SQL,
  FIND_USER_BY_ID_SQL,
} from './postgres-session-statements.js';
import {
  validateDatabaseQueryResult,
  validateGenuineRowsArray,
} from './postgres-result-validator.js';
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
    ): Promise<readonly ApplicationSessionRow[]> {
      const q = overrideRunner ?? runner;
      const params = [Buffer.from(c.tokenHash), c.now];
      const result = await q.query(FIND_CANDIDATE_SESSIONS_SQL, params);

      const validated = validateDatabaseQueryResult(result, 'SELECT');
      const rows = validateGenuineRowsArray(validated.rows, 0, 2);
      if (validated.rowCount !== rows.length) {
        throw new DatabaseError('Database query result validation failed');
      }

      const mapped: ApplicationSessionRow[] = new Array(rows.length);
      for (let i = 0; i < rows.length; i++) {
        mapped[i] = mapSessionRow(rows[i]);
      }
      return Object.freeze(mapped);
    },

    async findUserById(userId: string, overrideRunner?: QueryRunner): Promise<UserSnapshot | null> {
      const q = overrideRunner ?? runner;
      const result = await q.query(FIND_USER_BY_ID_SQL, [userId]);

      const validated = validateDatabaseQueryResult(result, 'SELECT');
      const rows = validateGenuineRowsArray(validated.rows, 0, 2);
      if (validated.rowCount !== rows.length) {
        throw new DatabaseError('Database query result validation failed');
      }

      if (rows.length === 0) {
        return null;
      }
      if (rows.length > 1) {
        throw new DatabaseError('Unexpected duplicate user match');
      }

      return mapUserRow(rows[0] as RawUserRow);
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
      const validated = validateDatabaseQueryResult(result, 'UPDATE');
      validateGenuineRowsArray(validated.rows, 0, 0);
      if (validated.rowCount !== 1) {
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
      const validated = validateDatabaseQueryResult(result, 'UPDATE');
      validateGenuineRowsArray(validated.rows, 0, 0);
      if (validated.rowCount !== 1) {
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
      const validated = validateDatabaseQueryResult(result, 'UPDATE');
      validateGenuineRowsArray(validated.rows, 0, 0);
      if (validated.rowCount !== 1) {
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
