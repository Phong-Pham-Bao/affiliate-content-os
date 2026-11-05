import type { UserSnapshot } from '@affiliate-content-os/domain';
import type { Database, TransactionExecutor } from '../database/index.js';
import type { ApplicationSessionRow } from './mappers.js';

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

export type QueryRunner = Pick<Database | TransactionExecutor, 'query'>;

export interface PostgresSessionAdapter {
  createSession(session: ApplicationSessionInsert, runner?: QueryRunner): Promise<void>;
  findCandidateSessions(
    criteria: { tokenHash: Uint8Array; now: string },
    runner?: QueryRunner,
  ): Promise<readonly ApplicationSessionRow[]>;
  findUserById(userId: string, runner?: QueryRunner): Promise<UserSnapshot | null>;
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
  withTransaction<T>(fn: (txStore: PostgresSessionAdapter) => Promise<T>): Promise<T>;
}
