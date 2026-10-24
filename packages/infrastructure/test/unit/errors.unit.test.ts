import util from 'node:util';
import { describe, expect, it } from 'vitest';
import {
  DatabaseError,
  isDatabaseError,
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

  describe('DatabaseError hook-free branding and subclass identity', () => {
    it('recognizes genuine DatabaseError instances with isDatabaseError and instanceof', () => {
      const err = new DatabaseError('Genuine error', { code: 'RELATION_NOT_FOUND' });
      expect(isDatabaseError(err)).toBe(true);
      expect(err instanceof DatabaseError).toBe(true);
      expect(isDatabaseError(new Error('plain'))).toBe(false);
      expect(isDatabaseError(null)).toBe(false);
      expect(isDatabaseError(undefined)).toBe(false);
      expect(isDatabaseError({})).toBe(false);
    });

    it('recognizes normally constructed DatabaseError subclasses', () => {
      class CustomDatabaseError extends DatabaseError {
        constructor(message: string, code?: string) {
          super(message, { code });
        }
      }

      class DeepDatabaseError extends CustomDatabaseError {}

      const custom = new CustomDatabaseError('Custom error', 'CUSTOM_CODE');
      const deep = new DeepDatabaseError('Deep error', 'DEEP_CODE');

      expect(isDatabaseError(custom)).toBe(true);
      expect(custom instanceof DatabaseError).toBe(true);
      expect(custom instanceof CustomDatabaseError).toBe(true);

      expect(isDatabaseError(deep)).toBe(true);
      expect(deep instanceof DatabaseError).toBe(true);
      expect(deep instanceof CustomDatabaseError).toBe(true);
      expect(deep instanceof DeepDatabaseError).toBe(true);

      const base = new DatabaseError('Base error');
      expect(base instanceof CustomDatabaseError).toBe(false);
      expect(base instanceof DeepDatabaseError).toBe(false);
    });

    it('rejects unbranded/counterfeit objects without triggering prototype traps', () => {
      const counterfeit = Object.create(DatabaseError.prototype);
      expect(isDatabaseError(counterfeit)).toBe(false);
      expect(counterfeit instanceof DatabaseError).toBe(false);

      let trapCalls = 0;
      const proxy = new Proxy(
        {},
        {
          getPrototypeOf() {
            trapCalls++;
            throw new Error('Explosion');
          },
        },
      );
      const untrusted = Object.create(proxy);

      expect(isDatabaseError(untrusted)).toBe(false);
      expect(untrusted instanceof DatabaseError).toBe(false);
      expect(trapCalls).toBe(0);
    });

    it('handles normal Error and frozen Error correctly', () => {
      const normalErr = new Error('Normal test error');
      expect(isDatabaseError(normalErr)).toBe(false);

      const sanitizedNormal = sanitizeDatabaseError(normalErr, 'Normal context');
      expect(sanitizedNormal).toBeInstanceOf(DatabaseError);
      expect(sanitizedNormal.message).toBe('Normal context: Database operation failed');

      const frozenSafe = Object.freeze(new DatabaseError('Already safe message'));
      expect(isDatabaseError(frozenSafe)).toBe(true);
      const sanitizedFrozen = sanitizeDatabaseError(frozenSafe);
      expect(sanitizedFrozen).toBe(frozenSafe);

      const frozenTainted = Object.freeze(
        new DatabaseError('postgresql://secret_user:secret_pass@127.0.0.1:5432/secret_db failure'),
      );
      const sanitizedTainted = sanitizeDatabaseError(frozenTainted);
      expect(sanitizedTainted).toBeInstanceOf(DatabaseError);
      expect(sanitizedTainted.message).not.toContain('secret_user');
      expect(sanitizedTainted.message).not.toContain('secret_pass');
    });
  });
});
