import { spawn } from 'node:child_process';
import util from 'node:util';
import { describe, expect, it } from 'vitest';
import {
  IdentityClaimsValidationError,
  IdentityPersistenceError,
  IdentityProvisioningRaceError,
  IdentityUnavailableError,
} from '../src/errors.js';

describe('Identity Error Sentinel Non-Disclosure Tests', () => {
  const SENTINEL = 'RAW_IDENTITY_SENTINEL';

  it('ignores extra arguments and excludes sentinel across in-process inspection surfaces', () => {
    type HostileConstructor<T> = new (...args: unknown[]) => T;
    const errorFactories: Array<() => Error> = [
      () =>
        new (
          IdentityClaimsValidationError as unknown as HostileConstructor<IdentityClaimsValidationError>
        )('claims', SENTINEL, 'EXTRA_LEAK_3'),
      () =>
        new (IdentityUnavailableError as unknown as HostileConstructor<IdentityUnavailableError>)(
          SENTINEL,
          'EXTRA_LEAK_2',
        ),
      () =>
        new (IdentityPersistenceError as unknown as HostileConstructor<IdentityPersistenceError>)(
          'lookup',
          SENTINEL,
          'EXTRA_LEAK_3',
        ),
      () =>
        new (
          IdentityProvisioningRaceError as unknown as HostileConstructor<IdentityProvisioningRaceError>
        )(SENTINEL, 'EXTRA_LEAK_2'),
    ];

    for (const make of errorFactories) {
      const err = make();
      expect(err.message).not.toContain(SENTINEL);
      expect(String(err)).not.toContain(SENTINEL);
      expect(err.stack).not.toContain(SENTINEL);

      const keys = Object.keys(err);
      expect(keys).not.toContain(SENTINEL);
      for (const k of keys) {
        expect(String((err as unknown as Record<string, unknown>)[k])).not.toContain(SENTINEL);
      }

      const ownKeys = Reflect.ownKeys(err);
      expect(ownKeys.map(String)).not.toContain(SENTINEL);
      for (const k of ownKeys) {
        const val = (err as unknown as Record<string | symbol, unknown>)[k];
        if (typeof val === 'string') {
          expect(val).not.toContain(SENTINEL);
        }
      }

      expect(JSON.stringify(err)).not.toContain(SENTINEL);
      expect(util.inspect(err, { customInspect: true, depth: null })).not.toContain(SENTINEL);
      expect(util.inspect(err, { customInspect: false, depth: null })).not.toContain(SENTINEL);

      const logs: string[] = [];
      const fakeLogger = {
        info: (...args: unknown[]) => logs.push(args.map(String).join(' ')),
        error: (...args: unknown[]) => logs.push(args.map(String).join(' ')),
      };
      fakeLogger.info('info message', err);
      fakeLogger.error('error message', err);
      for (const log of logs) {
        expect(log).not.toContain(SENTINEL);
      }

      try {
        throw err;
      } catch (caught: unknown) {
        const thrownOut = `${String(caught)} ${(caught as Error).stack ?? ''} ${(caught as Error).message}`;
        expect(thrownOut).not.toContain(SENTINEL);
      }
    }
  });

  it('proves extra sentinel arguments never leak to child process stdout or stderr', async () => {
    const childScript = `
      import {
        IdentityClaimsValidationError,
        IdentityUnavailableError,
        IdentityPersistenceError,
        IdentityProvisioningRaceError,
      } from './packages/application/src/errors.ts';
      import util from 'node:util';

      const s = '${SENTINEL}';
      const instances = [
        new IdentityClaimsValidationError('claims', s, 'EXTRA_ARG'),
        new IdentityUnavailableError(s, 'EXTRA_ARG'),
        new IdentityPersistenceError('recovery', s, 'EXTRA_ARG'),
        new IdentityProvisioningRaceError(s, 'EXTRA_ARG'),
      ];

      for (const err of instances) {
        console.log(String(err));
        console.log(JSON.stringify(err));
        console.log(util.inspect(err, { customInspect: true, depth: null }));
        console.log(util.inspect(err, { customInspect: false, depth: null }));
        console.error(String(err));
        try { throw err; } catch (e) { console.log(e.message, e.stack); }
      }
    `;

    const child = spawn(
      process.execPath,
      ['--conditions=development', '--import', 'tsx', '-e', childScript],
      { cwd: process.cwd(), stdio: ['pipe', 'pipe', 'pipe'] },
    );

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => {
      stdout += d.toString();
    });
    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });

    const exitCode = await new Promise<number>((res) => {
      child.on('close', res);
    });
    expect(exitCode).toBe(0);
    expect(stdout).not.toContain(SENTINEL);
    expect(stderr).not.toContain(SENTINEL);
  }, 15000);
});
