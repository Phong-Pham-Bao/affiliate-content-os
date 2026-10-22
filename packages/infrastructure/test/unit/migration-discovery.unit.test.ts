import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DatabaseError,
  discoverMigrations,
  fetchMigrationStatus,
  getDefaultMigrationsDir,
} from '../../src/database/index.js';

describe('Migration discovery and status verification (unit tests)', () => {
  it('discovers committed 0001_baseline.sql in package migrations directory', () => {
    const dir = getDefaultMigrationsDir();
    const migrations = discoverMigrations(dir);

    expect(migrations.length).toBeGreaterThanOrEqual(1);
    expect(migrations[0]!.number).toBe(1);
    expect(migrations[0]!.name).toBe('baseline');
    expect(migrations[0]!.filename).toBe('0001_baseline.sql');
    expect(migrations[0]!.checksumSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(migrations[0]!.sql).toContain('CREATE TABLE IF NOT EXISTS schema_migrations');
  });

  it('rejects directory with no sql migrations', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acos_mig_empty_'));
    try {
      expect(() => discoverMigrations(tempDir)).toThrow(DatabaseError);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('rejects invalid migration filename formats', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acos_mig_invalid_'));
    try {
      fs.writeFileSync(path.join(tempDir, 'invalid_name.sql'), 'SELECT 1;');
      expect(() => discoverMigrations(tempDir)).toThrow(DatabaseError);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('rejects migration sequence not starting at 0001', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acos_mig_not_one_'));
    try {
      fs.writeFileSync(path.join(tempDir, '0002_second.sql'), 'SELECT 1;');
      expect(() => discoverMigrations(tempDir)).toThrow('Migration sequence must start at 0001');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('rejects migration sequence with gaps', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acos_mig_gap_'));
    try {
      fs.writeFileSync(path.join(tempDir, '0001_first.sql'), 'SELECT 1;');
      fs.writeFileSync(path.join(tempDir, '0003_third.sql'), 'SELECT 2;');
      expect(() => discoverMigrations(tempDir)).toThrow(/gap detected/);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('rejects duplicate migration numbers or duplicate names', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acos_mig_dups_'));
    try {
      fs.writeFileSync(path.join(tempDir, '0001_init.sql'), 'SELECT 1;');
      fs.writeFileSync(path.join(tempDir, '0002_init.sql'), 'SELECT 2;');
      expect(() => discoverMigrations(tempDir)).toThrow(/Duplicate migration name/);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('detects checksum drift between database rows and local files', async () => {
    const local = [
      {
        number: 1,
        name: 'baseline',
        filename: '0001_baseline.sql',
        filepath: '/path/0001_baseline.sql',
        sql: 'SELECT 1;',
        checksumSha256: 'abc123expectedchecksum',
      },
    ];

    const mockClient = {
      query: async (queryText: string) => {
        if (queryText.includes('information_schema.tables')) {
          return { rows: [{ exists: true }] };
        }
        if (queryText.includes('SELECT migration_number')) {
          return {
            rows: [
              {
                migration_number: 1,
                name: 'baseline',
                checksum_sha256: 'different_checksum',
                applied_at: new Date(),
              },
            ],
          };
        }
        return { rows: [] };
      },
    };

    await expect(
      fetchMigrationStatus(mockClient as unknown as import('pg').ClientBase, local),
    ).rejects.toThrow(/checksum mismatch/);
  });
});
