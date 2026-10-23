import util from 'node:util';
import { describe, expect, it } from 'vitest';
import {
  DatabaseError,
  sanitizeDatabaseError,
  stripCredentials,
} from '../../src/database/errors.js';

describe('Database error categorization and non-disclosure (unit tests)', () => {
  it('strips postgres URLs with credentials from raw strings', () => {
    const raw = 'Failed at postgresql://app_user:secret_pwd@127.0.0.1:5432/my_db while executing';
    const stripped = stripCredentials(raw);
    expect(stripped).toBe('Failed at postgresql://[REDACTED] while executing');
    expect(stripped).not.toContain('app_user');
    expect(stripped).not.toContain('secret_pwd');
    expect(stripped).not.toContain('127.0.0.1');
    expect(stripped).not.toContain('my_db');
  });

  it('classifies known PostgreSQL error codes to allowlisted categories', () => {
    const cases: [string, string, string][] = [
      ['28P01', 'AUTH_FAILED', 'Authentication failed'],
      ['28000', 'AUTH_FAILED', 'Authentication failed'],
      ['3D000', 'DATABASE_NOT_FOUND', 'Database does not exist'],
      ['42P01', 'RELATION_NOT_FOUND', 'Relation does not exist'],
      ['23505', 'UNIQUE_VIOLATION', 'Unique constraint violation'],
      ['55P03', 'LOCK_NOT_AVAILABLE', 'Lock acquisition timed out or lock unavailable'],
      ['57014', 'QUERY_CANCELED', 'Query canceled or statement timeout exceeded'],
      ['57P01', 'SERVER_SHUTDOWN', 'Database server is shutting down'],
      ['ECONNREFUSED', 'CONNECTION_REFUSED', 'Connection refused'],
      ['ECONNRESET', 'CONNECTION_RESET', 'Connection reset by peer'],
      ['ENOTFOUND', 'HOST_NOT_FOUND', 'Database host not found'],
      ['ETIMEDOUT', 'CONNECTION_TIMED_OUT', 'Connection timed out'],
      [
        'DEPTH_ZERO_SELF_SIGNED_CERT',
        'TLS_VERIFICATION_FAILED',
        'TLS certificate verification failed',
      ],
    ];

    for (const [rawCode, expectedCode, expectedMsg] of cases) {
      const err = sanitizeDatabaseError({
        code: rawCode,
        message: 'some internal text with db_name',
      });
      expect(err).toBeInstanceOf(DatabaseError);
      expect(err.code).toBe(expectedCode);
      expect(err.message).toBe(expectedMsg);
      expect(err.message).not.toContain('db_name');
    }
  });

  it('maps unknown errors to generic DATABASE_ERROR without leaking driver properties', () => {
    const raw = {
      name: 'error',
      severity: 'ERROR',
      code: 'UNKNOWN_999',
      file: 'auth.c',
      line: '1234',
      routine: 'auth_check',
      message: 'Secret table acos_secret_data leaked in query SELECT * FROM sensitive_table',
    };

    const sanitized = sanitizeDatabaseError(raw);
    expect(sanitized.code).toBe('DATABASE_ERROR');
    expect(sanitized.message).toBe('Database operation failed');
    expect(sanitized.message).not.toContain('acos_secret_data');
    expect(sanitized.message).not.toContain('sensitive_table');
  });

  it('provides safe toJSON() and util.inspect() implementations', () => {
    const err = new DatabaseError('Failed securely', { code: 'AUTH_FAILED' });

    const json = err.toJSON();
    expect(json).toEqual({
      name: 'DatabaseError',
      message: 'Failed securely',
      code: 'AUTH_FAILED',
    });

    const inspected = util.inspect(err);
    expect(inspected).toContain('DatabaseError');
    expect(inspected).toContain('Failed securely');
    expect(inspected).toContain('AUTH_FAILED');
    // Does not leak stack or internal details in inspected custom output
    expect(inspected).not.toContain('at Object.<anonymous>');
  });
});
