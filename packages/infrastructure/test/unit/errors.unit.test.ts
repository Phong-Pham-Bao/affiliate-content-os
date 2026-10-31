import { spawn } from 'node:child_process';
import util from 'node:util';
import { describe, expect, it } from 'vitest';
import {
  DatabaseError,
  isDatabaseError,
  sanitizeCallbackError,
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

  describe('PostgreSQL constraint payloads privacy (Remediation 02 Finding 1)', () => {
    it('proves DatabaseError has no public constraint property or options', () => {
      const err = new DatabaseError('Standard message', {
        code: 'UNIQUE_VIOLATION',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...({ constraint: 'hostile_constraint' } as any),
      });

      expect((err as unknown as { constraint?: unknown }).constraint).toBeUndefined();
      expect('constraint' in err).toBe(false);
      expect(Object.keys(err)).not.toContain('constraint');
      expect(Reflect.ownKeys(err)).not.toContain('constraint');
      expect(err.toJSON()).not.toHaveProperty('constraint');
      expect(JSON.stringify(err)).not.toContain('hostile_constraint');
      expect(util.inspect(err)).not.toContain('hostile_constraint');
      expect(String(err)).not.toContain('hostile_constraint');
    });

    it('proves sanitizeDatabaseError never returns error with public constraint property', () => {
      const driverErrors = [
        { code: '23505', constraint: 'workspaces_slug_unique' },
        { code: '23505', constraint: 'workspaces_pkey' },
        { code: '42P01', constraint: 'some_relation_constraint' },
        { message: 'failed', constraint: 'arbitrary_constraint' },
      ];

      for (const raw of driverErrors) {
        const sanitized = sanitizeDatabaseError(raw);
        expect(sanitized).toBeInstanceOf(DatabaseError);
        expect((sanitized as unknown as { constraint?: unknown }).constraint).toBeUndefined();
        expect('constraint' in sanitized).toBe(false);
        expect(Object.keys(sanitized)).not.toContain('constraint');
        expect(Reflect.ownKeys(sanitized)).not.toContain('constraint');
        expect(sanitized.toJSON()).not.toHaveProperty('constraint');
        expect(JSON.stringify(sanitized)).not.toContain(raw.constraint);
        expect(util.inspect(sanitized)).not.toContain(raw.constraint);
        expect(String(sanitized)).not.toContain(raw.constraint);
      }
    });

    it('proves hostile constraint sentinels are completely absent from all observable surfaces', async () => {
      const hostileConstraint =
        'workspaces_slug_unique; postgresql://raw_user:raw_pass_secret@10.88.77.66:5432/raw_target_db; SELECT * FROM secrets; $1::text; newline\nstack\r\nat /app/secret.ts:1:1';
      const sentinels = [
        'raw_user',
        'raw_pass_secret',
        '10.88.77.66',
        'raw_target_db',
        'SELECT * FROM secrets',
        '$1::text',
        'newline\nstack',
        '/app/secret.ts',
      ];

      const raw = {
        name: 'error',
        code: '23505',
        message: 'duplicate key value violates unique constraint',
        constraint: hostileConstraint,
      };

      const sanitized = sanitizeDatabaseError(raw);

      // 1. Direct properties & keys
      expect((sanitized as unknown as { constraint?: unknown }).constraint).toBeUndefined();
      expect('constraint' in sanitized).toBe(false);
      expect(Object.keys(sanitized)).not.toContain('constraint');

      for (const key of Reflect.ownKeys(sanitized)) {
        const val = String((sanitized as unknown as Record<string | symbol, unknown>)[key]);
        for (const s of sentinels) {
          expect(val).not.toContain(s);
        }
      }

      // 2. JSON.stringify
      const json = JSON.stringify(sanitized);
      for (const s of sentinels) {
        expect(json).not.toContain(s);
      }

      // 3. String & message & stack
      const str = String(sanitized);
      const msg = sanitized.message;
      const stack = sanitized.stack ?? '';
      for (const s of sentinels) {
        expect(str).not.toContain(s);
        expect(msg).not.toContain(s);
        expect(stack).not.toContain(s);
      }

      // 4. util.inspect
      const inspected = util.inspect(sanitized);
      for (const s of sentinels) {
        expect(inspected).not.toContain(s);
      }

      // 5. Child process execution to prove no leak to stdout/stderr or logger
      const childScript = `
        import { sanitizeDatabaseError, DatabaseError } from './packages/infrastructure/src/database/errors.ts';
        import util from 'node:util';
        const raw = {
          code: '23505',
          constraint: ${JSON.stringify(hostileConstraint)},
          message: 'duplicate key value violates unique constraint'
        };
        const sanitized = sanitizeDatabaseError(raw);
        console.log(JSON.stringify(sanitized));
        console.error(String(sanitized));
        console.log(util.inspect(sanitized));
      `;

      const child = spawn(
        process.execPath,
        ['--conditions=development', '--import', 'tsx', '-e', childScript],
        {
          cwd: process.cwd(),
          stdio: ['pipe', 'pipe', 'pipe'],
        },
      );

      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d) => {
        stdout += d.toString();
      });
      child.stderr.on('data', (d) => {
        stderr += d.toString();
      });

      const exitCode = await new Promise<number>((resolve) => {
        child.on('close', resolve);
      });

      expect(exitCode).toBe(0);
      const combined = stdout + stderr;
      for (const s of sentinels) {
        expect(combined).not.toContain(s);
      }
    });
  });

  describe('DatabaseError arbitrary cause removal and closed surface (Remediation 03 Finding 1)', () => {
    it('proves DatabaseError constructor does not accept or store cause', () => {
      const hostileCause = new Error('Hostile cause with postgresql://secret:pwd@host/db');
      const err = new DatabaseError('Standard error', {
        code: 'UNIQUE_VIOLATION',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...({ cause: hostileCause } as any),
      });

      expect('cause' in err).toBe(false);
      expect((err as unknown as { cause?: unknown }).cause).toBeUndefined();
      expect(Object.keys(err)).not.toContain('cause');
      expect(Reflect.ownKeys(err)).not.toContain('cause');
      expect(err.toJSON()).toEqual({
        name: 'DatabaseError',
        message: 'Standard error',
        code: 'UNIQUE_VIOLATION',
      });
      expect(err.toJSON()).not.toHaveProperty('cause');
      expect(JSON.stringify(err)).not.toContain('Hostile cause');
      expect(JSON.stringify(err)).not.toContain('secret:pwd');
      expect(util.inspect(err)).not.toContain('Hostile cause');
      expect(String(err)).not.toContain('Hostile cause');
    });

    it('proves sanitizeDatabaseError never attaches input or metadata as cause', () => {
      const rawErrorWithCause = {
        name: 'error',
        code: '23505',
        message: 'duplicate key value violates unique constraint',
        cause: {
          secret: 'classified_credential_sentinel',
          databaseUrl: 'postgresql://admin:super_secret@localhost:5432/secrets_db',
        },
      };

      const sanitized = sanitizeDatabaseError(rawErrorWithCause);
      expect(sanitized).toBeInstanceOf(DatabaseError);
      expect('cause' in sanitized).toBe(false);
      expect((sanitized as unknown as { cause?: unknown }).cause).toBeUndefined();
      expect(Object.keys(sanitized)).not.toContain('cause');
      expect(Reflect.ownKeys(sanitized)).not.toContain('cause');
      expect(sanitized.toJSON()).not.toHaveProperty('cause');
      expect(JSON.stringify(sanitized)).not.toContain('classified_credential_sentinel');
      expect(JSON.stringify(sanitized)).not.toContain('super_secret');
      expect(util.inspect(sanitized)).not.toContain('classified_credential_sentinel');
      expect(String(sanitized)).not.toContain('classified_credential_sentinel');
    });

    it('executes zero hooks or traps on hostile cause objects with getters, proxies, and inspect hooks', () => {
      let getterCalls = 0;
      let trapCalls = 0;
      let hookCalls = 0;

      const hostile = new Proxy(
        {},
        {
          get(target, prop) {
            trapCalls++;
            if (prop === 'toJSON' || prop === 'toString' || prop === 'valueOf') {
              hookCalls++;
              return () => 'hostile_string_sentinel';
            }
            if (prop === Symbol.for('nodejs.util.inspect.custom')) {
              hookCalls++;
              return () => 'hostile_inspect_sentinel';
            }
            if (prop === 'secret') {
              getterCalls++;
              return 'secret_getter_value';
            }
            return Reflect.get(target, prop);
          },
        },
      );

      const err = new DatabaseError('Standard message', {
        code: 'DATABASE_ERROR',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...({ cause: hostile } as any),
      });

      expect(trapCalls).toBe(0);
      expect(getterCalls).toBe(0);
      expect(hookCalls).toBe(0);

      // Inspect and serialize the DatabaseError
      const json = JSON.stringify(err);
      const inspected = util.inspect(err);
      const str = String(err);

      expect(trapCalls).toBe(0);
      expect(getterCalls).toBe(0);
      expect(hookCalls).toBe(0);
      expect(json).not.toContain('hostile');
      expect(inspected).not.toContain('hostile');
      expect(str).not.toContain('hostile');
    });

    it('returns fresh DatabaseError when genuine DatabaseError has been tainted with cause or extra own properties', () => {
      const genuine = new DatabaseError('Original safe message', { code: 'DATABASE_ERROR' });
      // Taint with cause
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (genuine as any).cause = 'hostile_tainted_cause';

      const sanitized = sanitizeDatabaseError(genuine);
      expect(sanitized).toBeInstanceOf(DatabaseError);
      expect(sanitized).not.toBe(genuine); // Must NOT return tainted instance
      expect('cause' in sanitized).toBe(false);
      expect((sanitized as unknown as { cause?: unknown }).cause).toBeUndefined();
      expect(JSON.stringify(sanitized)).not.toContain('hostile_tainted_cause');

      // Taint with arbitrary property
      const genuine2 = new DatabaseError('Original safe message 2', { code: 'AUTH_FAILED' });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (genuine2 as any).secretField = 'secret_metadata';

      const sanitized2 = sanitizeDatabaseError(genuine2);
      expect(sanitized2).toBeInstanceOf(DatabaseError);
      expect(sanitized2).not.toBe(genuine2);
      expect('secretField' in sanitized2).toBe(false);
      expect(JSON.stringify(sanitized2)).not.toContain('secret_metadata');
    });

    it('proves child-process execution outputs no hostile cause sentinels through stdout or stderr', async () => {
      const hostileSentinels = [
        'cause_sentinel_secret_user',
        'cause_sentinel_secret_password',
        'cause_sentinel_bind_param',
        'cause_sentinel_sql_text',
      ];

      const childScript = `
        import { sanitizeDatabaseError, DatabaseError } from './packages/infrastructure/src/database/errors.ts';
        import util from 'node:util';

        const hostileCause = {
          user: '${hostileSentinels[0]}',
          pwd: '${hostileSentinels[1]}',
          bind: '${hostileSentinels[2]}',
          sql: '${hostileSentinels[3]}'
        };

        const dbErr = new DatabaseError('Failed query', {
          code: 'DATABASE_ERROR',
          ...({ cause: hostileCause })
        });

        const fromSanitize = sanitizeDatabaseError({
          code: '42P01',
          message: 'table missing',
          cause: hostileCause
        });

        console.log(JSON.stringify(dbErr));
        console.log(util.inspect(dbErr));
        console.error(String(dbErr));

        console.log(JSON.stringify(fromSanitize));
        console.log(util.inspect(fromSanitize));
        console.error(String(fromSanitize));
      `;

      const child = spawn(
        process.execPath,
        ['--conditions=development', '--import', 'tsx', '-e', childScript],
        {
          cwd: process.cwd(),
          stdio: ['pipe', 'pipe', 'pipe'],
        },
      );

      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d) => {
        stdout += d.toString();
      });
      child.stderr.on('data', (d) => {
        stderr += d.toString();
      });

      const exitCode = await new Promise<number>((resolve) => {
        child.on('close', resolve);
      });

      expect(exitCode).toBe(0);
      const combined = stdout + stderr;
      for (const s of hostileSentinels) {
        expect(combined).not.toContain(s);
      }
    });
  });

  describe('TASK-004 Remediation 04 - Tainted genuine DatabaseError observable surface closure', () => {
    it('proves tainted genuine DatabaseError with enumerable, non-enumerable, and accessor-backed cause returns fresh safe DatabaseError without in-place mutation', () => {
      // 1. Enumerable cause
      const err1 = new DatabaseError('Standard error 1', { code: 'DATABASE_ERROR' });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (err1 as any).cause = 'hostile_enumerable_cause';

      const s1 = sanitizeDatabaseError(err1);
      expect(s1).toBeInstanceOf(DatabaseError);
      expect(s1).not.toBe(err1);
      expect('cause' in (s1 as object)).toBe(false);
      expect((s1 as unknown as { cause?: unknown }).cause).toBeUndefined();
      expect(JSON.stringify(s1)).not.toContain('hostile_enumerable_cause');
      expect((err1 as unknown as { cause?: unknown }).cause).toBe('hostile_enumerable_cause'); // Not mutated in place

      // 2. Non-enumerable cause
      const err2 = new DatabaseError('Standard error 2', { code: 'AUTH_FAILED' });
      Object.defineProperty(err2, 'cause', {
        value: 'hostile_non_enumerable_cause',
        enumerable: false,
        configurable: true,
        writable: true,
      });

      const s2 = sanitizeDatabaseError(err2);
      expect(s2).toBeInstanceOf(DatabaseError);
      expect(s2).not.toBe(err2);
      expect('cause' in (s2 as object)).toBe(false);
      expect((s2 as unknown as { cause?: unknown }).cause).toBeUndefined();
      expect(JSON.stringify(s2)).not.toContain('hostile_non_enumerable_cause');
      expect(s2.code).toBe('AUTH_FAILED');

      // 3. Accessor-backed cause (with throwing getter to prove getter is NEVER executed)
      const err3 = new DatabaseError('Standard error 3', { code: 'QUERY_CANCELED' });
      let getterCalled = false;
      Object.defineProperty(err3, 'cause', {
        get() {
          getterCalled = true;
          throw new Error('Hostile getter executed!');
        },
        configurable: true,
      });

      const s3 = sanitizeDatabaseError(err3);
      expect(getterCalled).toBe(false);
      expect(s3).toBeInstanceOf(DatabaseError);
      expect(s3 === err3).toBe(false);
      expect('cause' in (s3 as object)).toBe(false);
      expect((s3 as unknown as { cause?: unknown }).cause).toBeUndefined();
      expect(s3.code).toBe('QUERY_CANCELED');
      expect(getterCalled).toBe(false);
    });

    it('proves tainted genuine DatabaseError with constraint, SQL, bind values, credentials, symbols, unexpected own keys returns fresh safe DatabaseError', () => {
      const err = new DatabaseError('Base message', { code: 'DATABASE_ERROR' });
      const symbolKey = Symbol('secret_metadata_symbol');

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const anyErr = err as any;
      anyErr.constraint = 'hostile_constraint_secret';
      anyErr.sql = 'SELECT * FROM secrets WHERE id = 1';
      anyErr.bind = ['bind_value_1', 'bind_value_2'];
      anyErr[symbolKey] = 'symbol_value_secret';
      anyErr.unexpectedMeta = 'unexpected_value_secret';

      const sanitized = sanitizeDatabaseError(err);
      expect(sanitized).toBeInstanceOf(DatabaseError);
      expect(sanitized !== err).toBe(true);

      // Caller-owned error must NOT be mutated in place
      expect(anyErr.constraint).toBe('hostile_constraint_secret');
      expect(anyErr.sql).toBe('SELECT * FROM secrets WHERE id = 1');
      expect(anyErr[symbolKey]).toBe('symbol_value_secret');
      expect(anyErr.unexpectedMeta).toBe('unexpected_value_secret');

      // Sanitized error must not have any of these fields
      expect('constraint' in sanitized).toBe(false);
      expect('sql' in sanitized).toBe(false);
      expect('bind' in sanitized).toBe(false);
      expect(symbolKey in (sanitized as object)).toBe(false);
      expect('unexpectedMeta' in sanitized).toBe(false);

      expect(JSON.stringify(sanitized)).not.toContain('hostile_constraint_secret');
      expect(JSON.stringify(sanitized)).not.toContain('SELECT * FROM secrets');
      expect(JSON.stringify(sanitized)).not.toContain('bind_value_1');
      expect(JSON.stringify(sanitized)).not.toContain('symbol_value_secret');
      expect(JSON.stringify(sanitized)).not.toContain('unexpected_value_secret');
    });

    it('proves hostile stack data and stack accessors are rejected and replaced with fresh stack', () => {
      // 1. Stack getter
      const err1 = new DatabaseError('Stack accessor message');
      let stackGetterCalled = false;
      Object.defineProperty(err1, 'stack', {
        get() {
          stackGetterCalled = true;
          throw new Error('Hostile stack getter executed!');
        },
        configurable: true,
      });

      const s1 = sanitizeDatabaseError(err1);
      expect(stackGetterCalled).toBe(false);
      expect(s1).toBeInstanceOf(DatabaseError);
      expect(s1).not.toBe(err1);
      expect(typeof s1.stack).toBe('string');
      expect(s1.stack).toContain('DatabaseError: Stack accessor message');

      // 2. Stack with credentials
      const err2 = new DatabaseError('Standard message');
      err2.stack = `DatabaseError: query failed\n    at postgresql://user_secret:pass_secret@host:5432/db`;

      const s2 = sanitizeDatabaseError(err2);
      expect(s2).toBeInstanceOf(DatabaseError);
      expect(s2).not.toBe(err2);
      expect(s2.stack).not.toContain('user_secret');
      expect(s2.stack).not.toContain('pass_secret');
    });

    it('proves sanitizeCallbackError routes genuine DatabaseError through sanitizeDatabaseError and preserves non-database errors', () => {
      // 1. Tainted genuine DatabaseError
      const taintedDbErr = new DatabaseError('Tainted db error', { code: 'DATABASE_ERROR' });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (taintedDbErr as any).cause = 'hostile_cause_in_callback';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (taintedDbErr as any).constraint = 'hostile_constraint';

      const sanitizedDb = sanitizeCallbackError(taintedDbErr);
      expect(sanitizedDb).toBeInstanceOf(DatabaseError);
      expect(sanitizedDb).not.toBe(taintedDbErr);
      expect('cause' in (sanitizedDb as object)).toBe(false);
      expect('constraint' in (sanitizedDb as object)).toBe(false);
      expect(JSON.stringify(sanitizedDb)).not.toContain('hostile_cause_in_callback');
      expect((taintedDbErr as unknown as { cause?: unknown }).cause).toBe(
        'hostile_cause_in_callback',
      ); // Not mutated in place

      // 2. Untainted genuine DatabaseError preserves identity
      const safeDbErr = new DatabaseError('Safe db error', { code: 'UNIQUE_VIOLATION' });
      const preservedDb = sanitizeCallbackError(safeDbErr);
      expect(preservedDb).toBe(safeDbErr);

      // 3. Non-database business error preserves identity and class
      class DomainBusinessError extends Error {
        public readonly domainCode = 'DOMAIN_RULE_VIOLATION';
        constructor(message: string) {
          super(message);
          this.name = 'DomainBusinessError';
        }
      }

      const businessErr = new DomainBusinessError('Workspace slug is restricted');
      const preservedBusiness = sanitizeCallbackError(businessErr);
      expect(preservedBusiness).toBe(businessErr);
      expect((preservedBusiness as DomainBusinessError).domainCode).toBe('DOMAIN_RULE_VIOLATION');
      expect(preservedBusiness.name).toBe('DomainBusinessError');
    });

    it('proves child-process execution outputs no hostile cause, constraint, SQL, bind, symbol, or stack sentinels through stdout or stderr', async () => {
      const sentinels = [
        'cause_sentinel_pwd_999',
        'constraint_sentinel_workspaces',
        'sql_sentinel_select_credit_cards',
        'bind_sentinel_param_value',
        'symbol_sentinel_secret_token',
        'unexpected_key_sentinel_secret',
      ];

      const childScript = `
        import { sanitizeDatabaseError, sanitizeCallbackError, DatabaseError } from './packages/infrastructure/src/database/errors.ts';
        import util from 'node:util';

        const dbErr = new DatabaseError('Tainted child test error', { code: 'DATABASE_ERROR' });
        const sym = Symbol('token');
        dbErr.cause = '${sentinels[0]}';
        dbErr.constraint = '${sentinels[1]}';
        dbErr.sql = '${sentinels[2]}';
        dbErr.bind = ['${sentinels[3]}'];
        dbErr[sym] = '${sentinels[4]}';
        dbErr.secretMeta = '${sentinels[5]}';

        const s1 = sanitizeDatabaseError(dbErr);
        const s2 = sanitizeCallbackError(dbErr);

        console.log(JSON.stringify(s1));
        console.error(String(s1));
        console.log(util.inspect(s1));

        console.log(JSON.stringify(s2));
        console.error(String(s2));
        console.log(util.inspect(s2));
      `;

      const child = spawn(
        process.execPath,
        ['--conditions=development', '--import', 'tsx', '-e', childScript],
        {
          cwd: process.cwd(),
          stdio: ['pipe', 'pipe', 'pipe'],
        },
      );

      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d) => {
        stdout += d.toString();
      });
      child.stderr.on('data', (d) => {
        stderr += d.toString();
      });

      const exitCode = await new Promise<number>((resolve) => {
        child.on('close', resolve);
      });

      expect(exitCode).toBe(0);
      const combined = stdout + stderr;
      for (const s of sentinels) {
        expect(combined).not.toContain(s);
      }
    });
  });

  describe('TASK-004 Remediation 05 - Trusted Construction State and Mutation Invariants', () => {
    it('proves replacing DatabaseError.prototype.toJSON fails closed without executing the hostile hook', () => {
      const originalToJSON = DatabaseError.prototype.toJSON;
      let hookExecuted = false;

      try {
        DatabaseError.prototype.toJSON = function () {
          hookExecuted = true;
          throw new Error('HOSTILE_TO_JSON_HOOK_EXECUTED');
        };

        const err = new DatabaseError('Original safe message', { code: 'DATABASE_ERROR' });
        const sanitized = sanitizeDatabaseError(err);

        expect(sanitized).toBeInstanceOf(DatabaseError);
        expect(sanitized).not.toBe(err); // Must NOT preserve identity when prototype is tainted

        // Test JSON serialization
        const jsonStr = JSON.stringify(sanitized);
        expect(hookExecuted).toBe(false); // Hostile hook was NEVER executed
        expect(jsonStr).toContain('"name":"DatabaseError"');
        expect(jsonStr).toContain('"message":"Original safe message"');
        expect(jsonStr).toContain('"code":"DATABASE_ERROR"');
      } finally {
        DatabaseError.prototype.toJSON = originalToJSON;
      }
    });

    it('proves replacing custom inspect hook on prototype fails closed without executing the hostile hook', () => {
      const customInspectSym = Symbol.for('nodejs.util.inspect.custom');
      const originalInspect = (DatabaseError.prototype as unknown as Record<symbol, unknown>)[
        customInspectSym
      ];
      let hookExecuted = false;

      try {
        (DatabaseError.prototype as unknown as Record<symbol, unknown>)[customInspectSym] =
          function () {
            hookExecuted = true;
            throw new Error('HOSTILE_CUSTOM_INSPECT_HOOK_EXECUTED');
          };

        const err = new DatabaseError('Inspect test message', { code: 'UNIQUE_VIOLATION' });
        const sanitized = sanitizeDatabaseError(err);

        expect(sanitized).toBeInstanceOf(DatabaseError);
        expect(sanitized).not.toBe(err);

        // Test util.inspect
        const inspected = util.inspect(sanitized);
        expect(hookExecuted).toBe(false); // Hostile hook was NEVER executed
        expect(inspected).toContain('name:');
        expect(inspected).toContain('DatabaseError');
        expect(inspected).toContain('Inspect test message');
      } finally {
        (DatabaseError.prototype as unknown as Record<symbol, unknown>)[customInspectSym] =
          originalInspect;
      }
    });

    it('proves replacing toString on prototype fails closed without executing the hostile hook', () => {
      const originalToString = DatabaseError.prototype.toString;
      let hookExecuted = false;

      try {
        DatabaseError.prototype.toString = function () {
          hookExecuted = true;
          throw new Error('HOSTILE_TO_STRING_HOOK_EXECUTED');
        };

        const err = new DatabaseError('ToString test message');
        const sanitized = sanitizeDatabaseError(err);

        expect(sanitized).toBeInstanceOf(DatabaseError);
        expect(sanitized).not.toBe(err);

        const str = String(sanitized);
        expect(hookExecuted).toBe(false);
        expect(str).toBe('DatabaseError: ToString test message');
      } finally {
        DatabaseError.prototype.toString = originalToString;
      }
    });

    it('proves stack replaced with non-URL SQL, bind, password, token, constraint, newline, and stack-frame sentinels is rejected generically', () => {
      const sentinels = [
        'NON_URL_SQL_SENTINEL_SELECT_CREDIT_CARDS',
        'BIND_PARAM_SENTINEL_$1_SECRET',
        'PWD_SENTINEL_SUPER_SECRET',
        'TOKEN_SENTINEL_BEARER_XYZ',
        'CONSTRAINT_SENTINEL_WORKSPACES_SLUG',
        'NEWLINE_STACK_FRAME_SENTINEL_AT_SECRET_JS',
      ];

      const err = new DatabaseError('Base message', { code: 'DATABASE_ERROR' });
      err.stack = `DatabaseError: Base message\n    at ${sentinels[0]}\n    at ${sentinels[1]}\n    at password=${sentinels[2]}\n    at token=${sentinels[3]}\n    at constraint=${sentinels[4]}\n    at ${sentinels[5]}:1:1`;

      const sanitized = sanitizeDatabaseError(err);
      expect(sanitized).toBeInstanceOf(DatabaseError);
      expect(sanitized !== err).toBe(true); // Must NOT preserve identity when stack is mutated

      const finalStack = sanitized.stack ?? '';
      for (const s of sentinels) {
        expect(finalStack).not.toContain(s);
      }
      expect(finalStack).toContain('DatabaseError: Base message');
    });

    it('proves enumerable, non-enumerable, and symbol unexpected properties fail closed', () => {
      const err = new DatabaseError('Props test', { code: 'AUTH_FAILED' });
      const secretSymbol = Symbol('HOSTILE_SYMBOL_KEY');

      // 1. Enumerable unexpected property
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (err as any).enumerableSecret = 'ENUMERABLE_SECRET_SENTINEL';

      // 2. Non-enumerable unexpected property
      Object.defineProperty(err, 'nonEnumSecret', {
        value: 'NON_ENUMERABLE_SECRET_SENTINEL',
        enumerable: false,
        configurable: true,
      });

      // 3. Symbol property
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (err as any)[secretSymbol] = 'SYMBOL_SECRET_SENTINEL';

      const sanitized = sanitizeDatabaseError(err);
      expect(sanitized).toBeInstanceOf(DatabaseError);
      expect(sanitized !== err).toBe(true);

      // Verify direct access
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((sanitized as any).enumerableSecret).toBeUndefined();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((sanitized as any).nonEnumSecret).toBeUndefined();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((sanitized as any)[secretSymbol]).toBeUndefined();

      // Verify Object.keys and Reflect.ownKeys
      expect(Object.keys(sanitized)).not.toContain('enumerableSecret');
      expect(Reflect.ownKeys(sanitized)).not.toContain('enumerableSecret');
      expect(Reflect.ownKeys(sanitized)).not.toContain('nonEnumSecret');
      expect(Reflect.ownKeys(sanitized)).not.toContain(secretSymbol);

      // Verify JSON, util.inspect, String
      const json = JSON.stringify(sanitized);
      const inspected = util.inspect(sanitized);
      const str = String(sanitized);

      expect(json).not.toContain('ENUMERABLE_SECRET_SENTINEL');
      expect(json).not.toContain('NON_ENUMERABLE_SECRET_SENTINEL');
      expect(json).not.toContain('SYMBOL_SECRET_SENTINEL');

      expect(inspected).not.toContain('ENUMERABLE_SECRET_SENTINEL');
      expect(inspected).not.toContain('NON_ENUMERABLE_SECRET_SENTINEL');
      expect(inspected).not.toContain('SYMBOL_SECRET_SENTINEL');

      expect(str).not.toContain('ENUMERABLE_SECRET_SENTINEL');
    });

    it('proves hostile accessors on all known fields fail closed with zero getter executions', () => {
      const err = new DatabaseError('Accessor test', { code: 'DATABASE_ERROR' });
      let nameGetterCalled = false;
      let msgGetterCalled = false;
      let codeGetterCalled = false;
      let stackGetterCalled = false;
      let causeGetterCalled = false;
      let toJSONGetterCalled = false;
      let toStringGetterCalled = false;

      Object.defineProperty(err, 'name', {
        get() {
          nameGetterCalled = true;
          throw new Error('HOSTILE_NAME_GETTER');
        },
        configurable: true,
      });
      Object.defineProperty(err, 'message', {
        get() {
          msgGetterCalled = true;
          throw new Error('HOSTILE_MSG_GETTER');
        },
        configurable: true,
      });
      Object.defineProperty(err, 'code', {
        get() {
          codeGetterCalled = true;
          throw new Error('HOSTILE_CODE_GETTER');
        },
        configurable: true,
      });
      Object.defineProperty(err, 'stack', {
        get() {
          stackGetterCalled = true;
          throw new Error('HOSTILE_STACK_GETTER');
        },
        configurable: true,
      });
      Object.defineProperty(err, 'cause', {
        get() {
          causeGetterCalled = true;
          throw new Error('HOSTILE_CAUSE_GETTER');
        },
        configurable: true,
      });
      Object.defineProperty(err, 'toJSON', {
        get() {
          toJSONGetterCalled = true;
          throw new Error('HOSTILE_TOJSON_GETTER');
        },
        configurable: true,
      });
      Object.defineProperty(err, 'toString', {
        get() {
          toStringGetterCalled = true;
          throw new Error('HOSTILE_TOSTRING_GETTER');
        },
        configurable: true,
      });

      const sanitized = sanitizeDatabaseError(err);
      expect(sanitized).toBeInstanceOf(DatabaseError);
      expect(sanitized !== err).toBe(true);

      // Verify ZERO getters were called
      expect(nameGetterCalled).toBe(false);
      expect(msgGetterCalled).toBe(false);
      expect(codeGetterCalled).toBe(false);
      expect(stackGetterCalled).toBe(false);
      expect(causeGetterCalled).toBe(false);
      expect(toJSONGetterCalled).toBe(false);
      expect(toStringGetterCalled).toBe(false);

      expect(sanitized.message).toBe('Accessor test');
      expect(sanitized.code).toBe('DATABASE_ERROR');
    });

    it('proves changing instance prototype fails closed to safe DatabaseError', () => {
      const err = new DatabaseError('Proto change test', { code: 'DATABASE_ERROR' });
      Object.setPrototypeOf(err, Object.prototype);

      const sanitized = sanitizeDatabaseError(err);
      expect(sanitized).toBeInstanceOf(DatabaseError);
      expect(sanitized !== err).toBe(true);
      expect(Object.getPrototypeOf(sanitized)).toBe(DatabaseError.prototype);
      expect(sanitized.message).toBe('Proto change test');
    });

    it('proves Proxy wrapped genuine error fails closed with zero trap executions', () => {
      const err = new DatabaseError('Proxy test', { code: 'DATABASE_ERROR' });
      let trapCalls = 0;

      const proxy = new Proxy(err, {
        get(_t, p) {
          trapCalls++;
          throw new Error(`HOSTILE_GET_TRAP_${String(p)}`);
        },
        ownKeys() {
          trapCalls++;
          throw new Error('HOSTILE_OWNKEYS_TRAP');
        },
        getPrototypeOf() {
          trapCalls++;
          throw new Error('HOSTILE_GETPROTO_TRAP');
        },
        getOwnPropertyDescriptor() {
          trapCalls++;
          throw new Error('HOSTILE_GETDESC_TRAP');
        },
      });

      const sanitized = sanitizeDatabaseError(proxy);
      expect(sanitized).toBeInstanceOf(DatabaseError);
      expect(sanitized).not.toBe(err);
      expect(trapCalls).toBe(0); // ZERO traps executed
    });

    it('proves child-process execution with hostile prototype, stack sentinels, unexpected keys, and symbols outputs zero sentinels to stdout/stderr', async () => {
      const sentinels = [
        'CHILD_PROC_HOSTILE_TO_JSON_SECRET',
        'CHILD_PROC_SQL_SENTINEL_SELECT_EVERYTHING',
        'CHILD_PROC_BIND_PARAM_SENTINEL',
        'CHILD_PROC_PASSWORD_SENTINEL_123',
        'CHILD_PROC_TOKEN_SENTINEL_BEARER',
        'CHILD_PROC_SYMBOL_SECRET_VAL',
        'CHILD_PROC_UNEXPECTED_KEY_VAL',
      ];

      const childScript = `
        import { sanitizeDatabaseError, sanitizeCallbackError, DatabaseError } from './packages/infrastructure/src/database/errors.ts';
        import util from 'node:util';

        // 1. Replaced prototype toJSON
        const origToJSON = DatabaseError.prototype.toJSON;
        DatabaseError.prototype.toJSON = function() {
          return { leak: '${sentinels[0]}' };
        };

        const dbErr1 = new DatabaseError('Child err 1', { code: 'DATABASE_ERROR' });
        const s1 = sanitizeDatabaseError(dbErr1);

        // Restore toJSON for subsequent tests
        DatabaseError.prototype.toJSON = origToJSON;

        // 2. Mutated stack with non-URL SQL, bind, password, token sentinels
        const dbErr2 = new DatabaseError('Child err 2', { code: 'AUTH_FAILED' });
        dbErr2.stack = 'DatabaseError: Child err 2\\n    at ${sentinels[1]}\\n    at ${sentinels[2]}\\n    at ${sentinels[3]}\\n    at ${sentinels[4]}';
        const s2 = sanitizeDatabaseError(dbErr2);

        // 3. Symbol and unexpected property
        const sym = Symbol('tokenSym');
        const dbErr3 = new DatabaseError('Child err 3', { code: 'UNIQUE_VIOLATION' });
        dbErr3[sym] = '${sentinels[5]}';
        dbErr3.extraMeta = '${sentinels[6]}';
        const s3 = sanitizeCallbackError(dbErr3);

        // Output to stdout and stderr
        for (const s of [s1, s2, s3]) {
          console.log(JSON.stringify(s));
          console.error(String(s));
          console.log(util.inspect(s));
        }
      `;

      const child = spawn(
        process.execPath,
        ['--conditions=development', '--import', 'tsx', '-e', childScript],
        {
          cwd: process.cwd(),
          stdio: ['pipe', 'pipe', 'pipe'],
        },
      );

      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d) => {
        stdout += d.toString();
      });
      child.stderr.on('data', (d) => {
        stderr += d.toString();
      });

      const exitCode = await new Promise<number>((resolve) => {
        child.on('close', resolve);
      });

      expect(exitCode).toBe(0);
      const combined = stdout + stderr;
      for (const s of sentinels) {
        expect(combined).not.toContain(s);
      }
    });
  });
});
