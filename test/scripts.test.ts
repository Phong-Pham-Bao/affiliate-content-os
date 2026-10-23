import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { setupLocalEnv } from '../scripts/setup-local-env.mjs';
import { prepareEnvironment } from '../scripts/run-with-env.mjs';
import {
  extractPostgresReference,
  verifyInfrastructurePins,
} from '../scripts/verify-infrastructure-pins.mjs';
import {
  runComposeUp,
  verifyAuthenticatedQueries,
  classifyReadinessError,
  ALLOWLISTED_READINESS_REASONS,
} from '../scripts/infra-up.mjs';
import {
  verifyTrivyExceptionPolicy,
  parseTrivyIgnoreYaml,
  REQUIRED_EXCEPTION_ID,
  REQUIRED_CVE,
  REQUIRED_PATH,
  REQUIRED_EXPIRY,
  REQUIRED_IMAGE_DIGEST,
  REQUIRED_EVIDENCE_URLS,
} from '../scripts/verify-trivy-exception.mjs';

describe('Scripts unit verification', () => {
  describe('setupLocalEnv', () => {
    it('creates .env from template when .env does not exist', () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acos_env_test_'));
      try {
        const exampleFile = path.join(tempDir, '.env.example');
        const envFile = path.join(tempDir, '.env');
        fs.writeFileSync(exampleFile, 'FOO=bar\n');

        const result = setupLocalEnv({ envFile, exampleFile });
        expect(result.created).toBe(true);
        expect(fs.readFileSync(envFile, 'utf8')).toBe('FOO=bar\n');

        // Repeated call leaves it unchanged
        const secondResult = setupLocalEnv({ envFile, exampleFile });
        expect(secondResult.created).toBe(false);
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('throws if example template is missing', () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acos_env_missing_'));
      try {
        const exampleFile = path.join(tempDir, '.env.example');
        const envFile = path.join(tempDir, '.env');
        expect(() => setupLocalEnv({ envFile, exampleFile })).toThrow(/does not exist/);
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe('verifyInfrastructurePins', () => {
    it('extracts postgres image reference correctly', () => {
      const sample =
        'image: postgres:18.6-bookworm@sha256:bbf83594798e144bff365a9c191c5d779f181fb3135902064ab8ff11918020fc\n';
      const ref = extractPostgresReference(sample);
      expect(ref).toBe(
        'postgres:18.6-bookworm@sha256:bbf83594798e144bff365a9c191c5d779f181fb3135902064ab8ff11918020fc',
      );
    });

    it('verifies infrastructure pins with inspector mock', () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acos_pins_test_'));
      try {
        const composePath = path.join(tempDir, 'compose.yaml');
        const ciPath = path.join(tempDir, 'ci.yml');
        const validRef =
          'postgres:18.6-bookworm@sha256:bbf83594798e144bff365a9c191c5d779f181fb3135902064ab8ff11918020fc';

        fs.writeFileSync(composePath, `image: ${validRef}\n`);
        fs.writeFileSync(ciPath, `image: ${validRef}\n`);

        const mockInspector = vi.fn(() => ({
          mediaType: 'application/vnd.oci.image.index.v1+json',
          digest: 'sha256:bbf83594798e144bff365a9c191c5d779f181fb3135902064ab8ff11918020fc',
        }));

        const result = verifyInfrastructurePins({
          composePath,
          ciPath,
          inspector: mockInspector,
        });

        expect(result.verified).toBe(true);
        expect(result.mediaType).toBe('application/vnd.oci.image.index.v1+json');
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('rejects platform child media types', () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acos_child_test_'));
      try {
        const composePath = path.join(tempDir, 'compose.yaml');
        const ciPath = path.join(tempDir, 'ci.yml');
        const validRef =
          'postgres:18.6-bookworm@sha256:bbf83594798e144bff365a9c191c5d779f181fb3135902064ab8ff11918020fc';

        fs.writeFileSync(composePath, `image: ${validRef}\n`);
        fs.writeFileSync(ciPath, `image: ${validRef}\n`);

        const mockInspector = vi.fn(() => ({
          mediaType: 'application/vnd.oci.image.manifest.v1+json', // child manifest, not index/list!
          digest: 'sha256:bbf83594798e144bff365a9c191c5d779f181fb3135902064ab8ff11918020fc',
        }));

        expect(() =>
          verifyInfrastructurePins({
            composePath,
            ciPath,
            inspector: mockInspector,
          }),
        ).toThrow(/Platform child digests are rejected/);
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe('prepareEnvironment', () => {
    it('fails with Run corepack pnpm env:local when .env is missing and not CI', () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acos_run_env_missing_'));
      const missingEnvPath = path.join(tempDir, '.env');
      const mockExit = vi
        .spyOn(process, 'exit')
        .mockImplementation((code?: string | number | null | undefined) => {
          throw new Error(`process.exit(${code})`);
        });
      const mockConsoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

      try {
        expect(() =>
          prepareEnvironment({
            envPath: missingEnvPath,
            isCi: false,
          }),
        ).toThrow('process.exit(1)');

        expect(mockConsoleError).toHaveBeenCalledWith('Run corepack pnpm env:local');
      } finally {
        mockExit.mockRestore();
        mockConsoleError.mockRestore();
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('loads .env and sets target node env', () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acos_run_env_success_'));
      const envPath = path.join(tempDir, '.env');
      fs.writeFileSync(envPath, 'CUSTOM_VAR=loaded_val\n');

      try {
        prepareEnvironment({
          envPath,
          setNodeEnv: 'test',
          isCi: false,
        });

        expect(process.env['NODE_ENV']).toBe('test');
        expect(process.env['CUSTOM_VAR']).toBe('loaded_val');
      } finally {
        delete process.env['CUSTOM_VAR'];
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe('infraUp readiness', () => {
    it('executes compose up and throws when non-zero exit', () => {
      const mockSpawnSync = vi.fn(() => ({ status: 1 }));
      expect(() => runComposeUp({ spawnSyncFn: mockSpawnSync, throwOnError: true })).toThrow(
        'docker compose up exited with code 1',
      );
    });

    it('requires consecutive successful queries before reporting readiness', async () => {
      let attempts = 0;
      const mockPg = {
        Client: vi.fn(function () {
          return {
            connect: vi.fn(async () => {}),
            query: vi.fn(async () => {
              attempts++;
              // First attempt fails, then 5 consecutive succeed
              if (attempts === 1) {
                throw new Error('Connection refused by bootstrap server');
              }
              return { rows: [{ ready: 1 }] };
            }),
            end: vi.fn(async () => {}),
          };
        }),
      };

      const result = await verifyAuthenticatedQueries({
        pgModule: mockPg,
        requiredSuccesses: 3,
        timeoutMs: 5000,
        retryIntervalMs: 5,
        silent: true,
        throwOnError: true,
      });

      expect(result.verified).toBe(true);
      expect(attempts).toBe(4); // 1 failure + 3 successes = 4
    });

    it('times out and throws when consecutive successes are not achieved within deadline', async () => {
      const mockPg = {
        Client: vi.fn(function () {
          return {
            connect: vi.fn(async () => {}),
            query: vi.fn(async () => {
              throw new Error('Server starting up');
            }),
            end: vi.fn(async () => {}),
          };
        }),
      };

      await expect(
        verifyAuthenticatedQueries({
          pgModule: mockPg,
          requiredSuccesses: 5,
          timeoutMs: 50,
          retryIntervalMs: 10,
          silent: true,
          throwOnError: true,
        }),
      ).rejects.toThrow(/readiness verification timed out/);
    });

    it('redacts credentials and uses allowlisted reasons when errors occur during readiness check', async () => {
      const sentinels = [
        'secret_user',
        'super_secret_pw',
        '10.99.88.77',
        'secret_db',
        'token=xyz123',
      ];
      const sensitiveUrl =
        'postgresql://secret_user:super_secret_pw@10.99.88.77:5432/secret_db?token=xyz123#frag';

      const errorCases = [
        {
          err: Object.assign(new Error(`password authentication failed for ${sensitiveUrl}`), {
            code: '28P01',
          }),
          expectedReason: 'AUTH_FAILED',
        },
        {
          err: Object.assign(new Error(`connect ECONNREFUSED ${sensitiveUrl}`), {
            code: 'ECONNREFUSED',
          }),
          expectedReason: 'CONNECTION_REFUSED',
        },
        {
          err: Object.assign(new Error(`connection timed out to ${sensitiveUrl}`), {
            code: 'ETIMEDOUT',
          }),
          expectedReason: 'CONNECTION_TIMED_OUT',
        },
        {
          err: new Error(`unknown driver failure: ${sensitiveUrl}`),
          expectedReason: 'SERVER_UNAVAILABLE',
        },
      ];

      for (const { err, expectedReason } of errorCases) {
        expect(ALLOWLISTED_READINESS_REASONS).toContain(expectedReason);
        const classified = classifyReadinessError(err);
        expect(classified).toBe(expectedReason);

        const mockConsoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        const mockPg = {
          Client: vi.fn(function () {
            return {
              connect: vi.fn(async () => {
                throw err;
              }),
              end: vi.fn(async () => {}),
            };
          }),
        };

        let thrownError: Error | undefined;
        try {
          await verifyAuthenticatedQueries({
            pgModule: mockPg,
            connectionString: sensitiveUrl,
            requiredSuccesses: 1,
            timeoutMs: 30,
            retryIntervalMs: 10,
            silent: false,
            throwOnError: true,
          });
        } catch (e) {
          thrownError = e as Error;
        }

        expect(thrownError).toBeDefined();
        const thrownMessage = thrownError!.message;
        const loggedMessage = mockConsoleError.mock.calls.map((c) => c.join(' ')).join('\n');

        for (const sentinel of sentinels) {
          expect(thrownMessage).not.toContain(sentinel);
          expect(loggedMessage).not.toContain(sentinel);
        }

        expect(thrownMessage).toContain(`reason: ${expectedReason}`);
        expect(thrownMessage).toMatch(
          /readiness verification timed out after \d+ms \(reason: [A-Z_]+, attempts: \d+\)\./,
        );

        mockConsoleError.mockRestore();
      }
    });
  });

  describe('verifyTrivyExceptionPolicy', () => {
    it('accepts the valid repository configuration', () => {
      const result = verifyTrivyExceptionPolicy();
      expect(result.verified).toBe(true);
      expect(result.exceptionId).toBe(REQUIRED_EXCEPTION_ID);
    });

    it('exports required constants and parses valid schema correctly', () => {
      expect(REQUIRED_IMAGE_DIGEST).toBe(
        'sha256:bbf83594798e144bff365a9c191c5d779f181fb3135902064ab8ff11918020fc',
      );
      expect(REQUIRED_EVIDENCE_URLS.length).toBeGreaterThanOrEqual(5);

      const parsed = parseTrivyIgnoreYaml(
        `vulnerabilities:\n  - id: ${REQUIRED_CVE}\n    paths:\n      - ${REQUIRED_PATH}\n    expired_at: ${REQUIRED_EXPIRY}\n    statement: test doc\n`,
      );
      expect(parsed.topLevelKeys).toEqual(['vulnerabilities']);
      expect(parsed.entries).toHaveLength(1);
      expect(parsed.entries[0]?.id).toBe(REQUIRED_CVE);
    });

    it('rejects missing ignore file', () => {
      expect(() =>
        verifyTrivyExceptionPolicy({ ignorePath: '/non/existent/.trivyignore.yaml' }),
      ).toThrow(/\.trivyignore\.yaml does not exist/);
    });

    it('rejects multiple or unexpected top-level keys in .trivyignore.yaml', () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acos_trivy_keys_'));
      try {
        const ignorePath = path.join(tempDir, '.trivyignore.yaml');
        fs.writeFileSync(
          ignorePath,
          `vulnerabilities:\n  - id: ${REQUIRED_CVE}\n    paths:\n      - ${REQUIRED_PATH}\n    expired_at: ${REQUIRED_EXPIRY}\n    statement: see security/exceptions/TASK-003-CVE-2025-68121-GOSU.md\npackages:\n  - foo\n`,
        );

        expect(() => verifyTrivyExceptionPolicy({ ignorePath })).toThrow(
          /must contain only the 'vulnerabilities' top-level key/,
        );
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('rejects multiple vulnerability items in .trivyignore.yaml', () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acos_trivy_multi_'));
      try {
        const ignorePath = path.join(tempDir, '.trivyignore.yaml');
        fs.writeFileSync(
          ignorePath,
          `vulnerabilities:\n  - id: ${REQUIRED_CVE}\n    paths:\n      - ${REQUIRED_PATH}\n    expired_at: ${REQUIRED_EXPIRY}\n    statement: see security/exceptions/TASK-003-CVE-2025-68121-GOSU.md\n  - id: CVE-2025-99999\n    paths:\n      - usr/bin/foo\n    expired_at: ${REQUIRED_EXPIRY}\n    statement: see doc\n`,
        );

        expect(() => verifyTrivyExceptionPolicy({ ignorePath })).toThrow(
          /must contain exactly one vulnerability item/,
        );
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('rejects wildcard paths in .trivyignore.yaml', () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acos_trivy_wildcard_'));
      try {
        const ignorePath = path.join(tempDir, '.trivyignore.yaml');
        fs.writeFileSync(
          ignorePath,
          `vulnerabilities:\n  - id: ${REQUIRED_CVE}\n    paths:\n      - usr/local/bin/*\n    expired_at: ${REQUIRED_EXPIRY}\n    statement: see security/exceptions/TASK-003-CVE-2025-68121-GOSU.md\n`,
        );

        expect(() => verifyTrivyExceptionPolicy({ ignorePath })).toThrow(
          /paths must contain exactly \['usr\/local\/bin\/gosu'\]/,
        );
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('rejects expired exceptions', () => {
      // Mock 'now' to 2027-01-01
      const futureNow = () => new Date('2027-01-01T00:00:00Z').getTime();
      expect(() => verifyTrivyExceptionPolicy({ now: futureNow })).toThrow(/expired on 2026-12-31/);
    });

    it('rejects missing or altered exception documentation', () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acos_trivy_doc_'));
      try {
        const docPath = path.join(tempDir, 'doc.md');
        fs.writeFileSync(docPath, '# Incomplete doc\n');

        expect(() => verifyTrivyExceptionPolicy({ exceptionDocPath: docPath })).toThrow(
          /missing required exception ID/,
        );
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('rejects CI workflow with missing --ignorefile, missing timeout-minutes, or forbidden suppression flags', () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acos_ci_check_'));
      try {
        const ciPath = path.join(tempDir, 'ci.yml');
        // Missing --ignorefile
        fs.writeFileSync(ciPath, 'run: trivy image --show-suppressed "$POSTGRES_IMAGE"\n');

        expect(() => verifyTrivyExceptionPolicy({ ciPath })).toThrow(
          /must pass '--ignorefile \.trivyignore\.yaml'/,
        );

        // Missing timeout-minutes: 15
        fs.writeFileSync(
          ciPath,
          'run: trivy image --ignorefile .trivyignore.yaml --show-suppressed "$POSTGRES_IMAGE"\n',
        );
        expect(() => verifyTrivyExceptionPolicy({ ciPath })).toThrow(
          /must specify 'timeout-minutes: 15'/,
        );

        // Forbidden --pkg-types flag
        fs.writeFileSync(
          ciPath,
          'timeout-minutes: 15\nrun: trivy image --ignorefile .trivyignore.yaml --show-suppressed --pkg-types os "$POSTGRES_IMAGE"\n',
        );
        expect(() => verifyTrivyExceptionPolicy({ ciPath })).toThrow(
          /forbidden scanning suppression\/bypass: '--pkg-types'/,
        );
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe('README privilege contract', () => {
    it('accurately states local development reuses bootstrap superuser without claiming lack of privileges', () => {
      const readmePath = path.resolve(process.cwd(), 'README.md');
      const readmeContent = fs.readFileSync(readmePath, 'utf8');

      expect(readmeContent).toContain('acos_local');
      expect(readmeContent).toContain('bootstrap `acos_local` PostgreSQL superuser');
      expect(readmeContent).toContain(
        'demonstrates configuration boundary separation rather than local least-privilege role enforcement',
      );
      expect(readmeContent).not.toContain(
        'Does not have administrative privileges to create or drop databases',
      );
      expect(readmeContent).toContain(
        'Production environments strictly require distinct, least-privilege database roles',
      );
    });
  });
});
