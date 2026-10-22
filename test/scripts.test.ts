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
});
