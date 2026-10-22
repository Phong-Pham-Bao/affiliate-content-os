import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseError } from '../errors.js';
import type { MigrationFile } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function getDefaultMigrationsDir(): string {
  // Try relative to current file in src or dist
  const candidate1 = path.resolve(__dirname, '../../../migrations');
  if (fs.existsSync(candidate1)) {
    return candidate1;
  }
  const candidate2 = path.resolve(__dirname, '../../migrations');
  if (fs.existsSync(candidate2)) {
    return candidate2;
  }
  return candidate1;
}

const FILENAME_REGEX = /^(\d{4})_([a-z0-9_]+)\.sql$/;

export function discoverMigrations(
  migrationsDir: string = getDefaultMigrationsDir(),
): readonly MigrationFile[] {
  if (!fs.existsSync(migrationsDir)) {
    throw new DatabaseError(`Migrations directory does not exist: ${migrationsDir}`);
  }

  const entries = fs.readdirSync(migrationsDir, { withFileTypes: true });
  const sqlFiles = entries.filter((e) => e.isFile() && e.name.endsWith('.sql'));

  if (sqlFiles.length === 0) {
    throw new DatabaseError(`No migration files found in ${migrationsDir}`);
  }

  const discovered: MigrationFile[] = [];
  const seenNumbers = new Set<number>();
  const seenNames = new Set<string>();

  for (const file of sqlFiles) {
    const match = file.name.match(FILENAME_REGEX);
    if (!match) {
      throw new DatabaseError(
        `Invalid migration filename format "${file.name}". Expected: ^\\d{4}_[a-z0-9_]+\\.sql$ (e.g. 0001_baseline.sql)`,
      );
    }

    const numStr = match[1]!;
    const name = match[2]!;
    const num = parseInt(numStr, 10);

    if (num < 1 || num > 9999) {
      throw new DatabaseError(
        `Migration number out of valid range (0001-9999) in file "${file.name}"`,
      );
    }

    if (seenNumbers.has(num)) {
      throw new DatabaseError(`Duplicate migration number ${numStr} in file "${file.name}"`);
    }
    seenNumbers.add(num);

    if (seenNames.has(name)) {
      throw new DatabaseError(`Duplicate migration name "${name}" in file "${file.name}"`);
    }
    seenNames.add(name);

    const filepath = path.join(migrationsDir, file.name);
    const sql = fs.readFileSync(filepath, 'utf8');
    const checksumSha256 = crypto.createHash('sha256').update(sql, 'utf8').digest('hex');

    discovered.push({
      number: num,
      name,
      filename: file.name,
      filepath,
      sql,
      checksumSha256,
    });
  }

  discovered.sort((a, b) => a.number - b.number);

  if (discovered[0]?.number !== 1) {
    throw new DatabaseError(
      `Migration sequence must start at 0001. Found first migration: ${discovered[0]?.filename ?? 'none'}`,
    );
  }

  for (let i = 0; i < discovered.length; i++) {
    const expected = i + 1;
    const actual = discovered[i]!.number;
    if (actual !== expected) {
      throw new DatabaseError(
        `Migration sequence gap detected: expected migration ${String(expected).padStart(4, '0')}, but found ${String(actual).padStart(4, '0')}`,
      );
    }
  }

  return Object.freeze(discovered);
}
