import tls from 'node:tls';
import type { DatabaseSslMode } from '@affiliate-content-os/config';
import type pg from 'pg';
import { DatabaseError } from './errors.js';

export function resolveSslOptions(
  sslModeOrConfig: DatabaseSslMode | { readonly sslMode: DatabaseSslMode },
  sslCaContent?: string,
): boolean | pg.ConnectionConfig['ssl'] {
  const mode = typeof sslModeOrConfig === 'string' ? sslModeOrConfig : sslModeOrConfig.sslMode;

  if (mode === 'disable') {
    return false;
  }

  if (mode === 'verify-full') {
    if (!sslCaContent || sslCaContent.trim() === '') {
      throw new DatabaseError('SSL CA content is required for verify-full mode');
    }

    try {
      tls.createSecureContext({ ca: sslCaContent });
    } catch {
      throw new DatabaseError('Invalid SSL CA bundle: failed to create secure TLS context');
    }

    return {
      rejectUnauthorized: true,
      ca: sslCaContent,
    };
  }

  throw new DatabaseError('Unsupported database SSL mode');
}
