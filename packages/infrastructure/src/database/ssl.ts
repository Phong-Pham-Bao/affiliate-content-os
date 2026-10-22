import fs from 'node:fs';
import tls from 'node:tls';
import type { DatabaseConfig } from '@affiliate-content-os/config';
import type pg from 'pg';
import { DatabaseError } from './errors.js';

export function resolveSslOptions(
  config: DatabaseConfig,
  caContentOverride?: string,
): boolean | pg.ConnectionConfig['ssl'] {
  if (config.sslMode === 'disable') {
    return false;
  }

  let caContent = caContentOverride;
  if (!caContent && config.sslCaFile) {
    try {
      const stat = fs.statSync(config.sslCaFile);
      if (!stat.isFile()) {
        throw new Error('SSL CA path is not a regular file');
      }
      caContent = fs.readFileSync(config.sslCaFile, 'utf8');
    } catch {
      throw new DatabaseError('Failed to read SSL CA bundle file for verify-full mode');
    }
  }

  if (!caContent || caContent.trim() === '') {
    throw new DatabaseError('SSL CA bundle content is empty or missing for verify-full mode');
  }

  try {
    tls.createSecureContext({ ca: caContent });
  } catch {
    throw new DatabaseError('Invalid SSL CA bundle: failed to create secure TLS context');
  }

  return {
    rejectUnauthorized: true,
    ca: caContent,
  };
}
