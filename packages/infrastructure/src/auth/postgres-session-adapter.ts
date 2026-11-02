import type { Database, TransactionExecutor } from '../database/index.js';
import { DatabaseError } from '../database/errors.js';
import { mapSessionRow, type ApplicationSessionRow } from './mappers.js';
import {
  INSERT_SESSION_SQL,
  FIND_CANDIDATE_SESSIONS_SQL,
  ROTATE_SESSION_SQL,
  TOUCH_SESSION_SQL,
  REVOKE_SESSION_SQL,
  REVOKE_MATCHING_BY_HASH_SQL,
} from './postgres-session-statements.js';

export interface ApplicationSessionInsert {
  readonly id: string;
  readonly userId: string;
  readonly currentTokenHash: Uint8Array;
  readonly createdAt: string;
  readonly lastSeenAt: string;
  readonly idleExpiresAt: string;
  readonly absoluteExpiresAt: string;
  readonly rotatedAt: string;
}

type QueryRunner = Pick<Database | TransactionExecutor, 'query'>;

export interface PostgresSessionAdapter {
  createSession(session: ApplicationSessionInsert, runner?: QueryRunner): Promise<void>;
  findCandidateSessions(
    criteria: { tokenHash: Uint8Array; now: string },
    runner?: QueryRunner,
  ): Promise<ApplicationSessionRow[]>;
  rotateSession(
    criteria: {
      sessionId: string;
      currentVersion: number;
      newCurrentHash: Uint8Array;
      oldCurrentHash: Uint8Array;
      graceValidUntil: string;
      rotatedAt: string;
      lastSeenAt: string;
      idleExpiresAt: string;
    },
    runner?: QueryRunner,
  ): Promise<void>;
  touchSession(
    criteria: {
      sessionId: string;
      currentVersion: number;
      lastSeenAt: string;
      idleExpiresAt: string;
    },
    runner?: QueryRunner,
  ): Promise<void>;
  revokeSession(
    criteria: {
      sessionId: string;
      currentVersion: number;
      revokedAt: string;
      reason: string;
    },
    runner?: QueryRunner,
  ): Promise<void>;
  revokeMatchingSessionsByTokenHash(
    criteria: {
      tokenHash: Uint8Array;
      revokedAt: string;
      reason: string;
    },
    runner?: QueryRunner,
  ): Promise<void>;
  withTransaction<T>(fn: (tx: TransactionExecutor) => Promise<T>): Promise<T>;
}

export function createPostgresSessionAdapter(database: Database): PostgresSessionAdapter {
  return {
    async createSession(s: ApplicationSessionInsert, runner?: QueryRunner): Promise<void> {
      const q = runner ?? database;
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
      runner?: QueryRunner,
    ): Promise<ApplicationSessionRow[]> {
      const q = runner ?? database;
      const params = [Buffer.from(c.tokenHash), c.now];
      const result = await q.query(FIND_CANDIDATE_SESSIONS_SQL, params);
      if (!Array.isArray(result.rows)) {
        throw new DatabaseError('Database result rows must be an array');
      }
      return result.rows.map((r) => mapSessionRow(r));
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
      runner?: QueryRunner,
    ): Promise<void> {
      const q = runner ?? database;
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
      runner?: QueryRunner,
    ): Promise<void> {
      const q = runner ?? database;
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
      runner?: QueryRunner,
    ): Promise<void> {
      const q = runner ?? database;
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
      runner?: QueryRunner,
    ): Promise<void> {
      const q = runner ?? database;
      const params = [c.revokedAt, c.reason, Buffer.from(c.tokenHash)];
      await q.query(REVOKE_MATCHING_BY_HASH_SQL, params);
    },

    async withTransaction<T>(fn: (tx: TransactionExecutor) => Promise<T>): Promise<T> {
      return database.withTransaction(fn);
    },
  };
}
