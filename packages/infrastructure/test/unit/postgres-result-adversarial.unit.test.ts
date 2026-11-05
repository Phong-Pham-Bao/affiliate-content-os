import { spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
  validateDatabaseQueryResult,
  validateGenuineRowsArray,
  validateSelectQueryResult,
} from '../../src/auth/postgres-result-validator.js';
import { CryptoOperationError } from '../../src/auth/crypto.js';
import { DatabaseError } from '../../src/database/errors.js';

function runNodeChild(script: string): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['--input-type=module', '--conditions=development', '--import', 'tsx', '-e', script],
      {
        cwd: process.cwd(),
        env: { ...process.env, NODE_ENV: 'test' },
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
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ stdout, stderr, code: code ?? 0 });
    });
  });
}

describe('Finding 3 & 4: PostgreSQL Result Validator and Crypto Operation Errors', () => {
  it('rejects hostile wrapper with throwing rows getter with zero getter calls', () => {
    let getterCalls = 0;
    const hostile = {
      get rows() {
        getterCalls++;
        throw new Error('SENTINEL_ROWS_GETTER');
      },
      rowCount: 0,
      command: 'SELECT',
    };

    expect(() => validateDatabaseQueryResult(hostile, 'SELECT')).toThrow(DatabaseError);
    expect(getterCalls).toBe(0);
  });

  it('rejects genuine array with own map method with zero map calls', () => {
    let mapCalls = 0;
    const rows = [{ id: '1' }];
    Object.defineProperty(rows, 'map', {
      value() {
        mapCalls++;
        throw new Error('SENTINEL_MAP_METHOD');
      },
      writable: true,
      configurable: true,
      enumerable: true,
    });

    expect(() => validateGenuineRowsArray(rows, 0, 1)).toThrow(DatabaseError);
    expect(mapCalls).toBe(0);
  });

  it('rejects arrays with extra named keys or symbols', () => {
    const rows = [{ id: '1' }];
    (rows as unknown as { extra: string }).extra = 'bad';
    expect(() => validateGenuineRowsArray(rows, 0, 1)).toThrow(DatabaseError);

    const rowsSym = [{ id: '1' }];
    (rowsSym as unknown as Record<symbol, string>)[Symbol('sym')] = 'bad';
    expect(() => validateGenuineRowsArray(rowsSym, 0, 1)).toThrow(DatabaseError);
  });

  it('enforces rowCount matches rows length exactly in select queries', () => {
    const wrapper = {
      rows: [{ id: '1' }],
      rowCount: 2, // mismatch!
      command: 'SELECT',
    };
    expect(() => validateSelectQueryResult(wrapper, 0, 2)).toThrow(DatabaseError);
  });

  it('enforces CryptoOperationError parameterless safety and non-disclosure', () => {
    const err = new CryptoOperationError();
    expect(err.message).toBe('Cryptographic operation failed');
    expect(err.name).toBe('CryptoOperationError');

    // Unsafe runtime cast with hostile sentinel argument
    const UnsafeCtor = CryptoOperationError as unknown as new (arg: string) => Error;
    const hostileErr = new UnsafeCtor('SENTINEL_CRYPTO_ARGUMENT');
    expect(hostileErr.message).toBe('Cryptographic operation failed');
    expect(JSON.stringify(hostileErr)).not.toContain('SENTINEL_CRYPTO_ARGUMENT');
    expect(String(hostileErr)).not.toContain('SENTINEL_CRYPTO_ARGUMENT');
    expect(Object.getOwnPropertyNames(hostileErr)).not.toContain('arg');
  });

  it('proves child-process execution never leaks sentinels from crypto or DB hostile inputs', async () => {
    const script = `
      import { CryptoOperationError } from './packages/infrastructure/src/auth/crypto.ts';
      import { validateDatabaseQueryResult, validateGenuineRowsArray } from './packages/infrastructure/src/auth/postgres-result-validator.ts';
      import { DatabaseError } from './packages/infrastructure/src/database/errors.ts';

      const UnsafeCtor = CryptoOperationError;
      const cErr = new UnsafeCtor('SECRET_CRYPTO_SENTINEL_VALUE');

      try {
        validateDatabaseQueryResult({
          get rows() { throw new Error('SECRET_DB_GETTER_SENTINEL'); },
          rowCount: 0,
          command: 'SELECT'
        }, 'SELECT');
      } catch (e) {
        if (!(e instanceof DatabaseError)) process.exit(2);
      }

      const rows = [{ id: '1' }];
      Object.defineProperty(rows, 'map', {
        value: () => { throw new Error('SECRET_MAP_SENTINEL'); },
        enumerable: true,
        configurable: true
      });

      try {
        validateGenuineRowsArray(rows, 0, 1);
      } catch (e) {
        if (!(e instanceof DatabaseError)) process.exit(3);
      }

      // Output sanitized state
      console.log(cErr.message);
    `;

    const { stdout, stderr, code } = await runNodeChild(script);
    expect(code).toBe(0);
    expect(stdout).toContain('Cryptographic operation failed');
    expect(stdout).not.toContain('SECRET_CRYPTO_SENTINEL_VALUE');
    expect(stdout).not.toContain('SECRET_DB_GETTER_SENTINEL');
    expect(stdout).not.toContain('SECRET_MAP_SENTINEL');
    expect(stderr).not.toContain('SECRET_CRYPTO_SENTINEL_VALUE');
    expect(stderr).not.toContain('SECRET_DB_GETTER_SENTINEL');
    expect(stderr).not.toContain('SECRET_MAP_SENTINEL');
  }, 15000);
});
