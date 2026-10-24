import path from 'node:path';
import type { ConfigurationIssue } from './errors.js';
import { ALLOWED_DATABASE_SSL_MODES, type DatabaseSslMode, type NodeEnv } from './types.js';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export function validateInteger(
  rawVal: unknown,
  field: string,
  min: number,
  max: number,
  defaultValue: number,
  issues: ConfigurationIssue[],
): number {
  if (rawVal === undefined || rawVal === null || rawVal === '') {
    return defaultValue;
  }

  if (typeof rawVal !== 'string' || !/^[0-9]+$/.test(rawVal)) {
    issues.push({
      field,
      message: `Must be a base-10 integer between ${min} and ${max}`,
    });
    return defaultValue;
  }

  const parsed = Number(rawVal);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    issues.push({
      field,
      message: `Must be a base-10 integer between ${min} and ${max}`,
    });
    return defaultValue;
  }

  return parsed;
}

export function validateDatabaseUrl(
  rawVal: unknown,
  field: string,
  issues: ConfigurationIssue[],
  options?: { readonly requireAdminPostgresDb?: boolean },
): string | undefined {
  if (rawVal === undefined || rawVal === null || rawVal === '') {
    issues.push({
      field,
      message: `${field} is required`,
    });
    return undefined;
  }

  if (typeof rawVal !== 'string' || rawVal.trim() === '' || rawVal !== rawVal.trim()) {
    issues.push({
      field,
      message: 'Must be a valid absolute postgresql or postgres URL',
    });
    return undefined;
  }

  let parsed: URL;
  try {
    parsed = new URL(rawVal);
  } catch {
    issues.push({
      field,
      message: 'Must be a valid absolute postgresql or postgres URL',
    });
    return undefined;
  }

  if (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') {
    issues.push({
      field,
      message: 'Must use postgresql or postgres protocol',
    });
    return undefined;
  }

  if (!parsed.hostname || parsed.hostname.trim() === '') {
    issues.push({
      field,
      message: 'Must specify a valid hostname',
    });
    return undefined;
  }

  const dbName = parsed.pathname.replace(/^\/+/, '');
  if (!dbName) {
    issues.push({
      field,
      message: 'Must specify a database name',
    });
    return undefined;
  }

  if (options?.requireAdminPostgresDb && dbName !== 'postgres') {
    issues.push({
      field,
      message: 'Must specify the administrative database postgres',
    });
    return undefined;
  }

  if (parsed.search !== '') {
    issues.push({
      field,
      message: 'Must not contain query parameters',
    });
    return undefined;
  }

  if (parsed.hash !== '') {
    issues.push({
      field,
      message: 'Must not contain a fragment identifier',
    });
    return undefined;
  }

  return rawVal;
}

export function validateSslConfig(
  rawEnv: Record<string, unknown>,
  nodeEnv: NodeEnv | undefined,
  urlsToCheck: readonly (string | undefined)[],
  issues: ConfigurationIssue[],
): { sslMode: DatabaseSslMode; sslCaFile?: string } {
  const rawMode = rawEnv['DATABASE_SSL_MODE'];
  const rawCaFile = rawEnv['DATABASE_SSL_CA_FILE'];

  let mode: DatabaseSslMode;

  if (rawMode === undefined || rawMode === null || rawMode === '') {
    if (nodeEnv === 'production') {
      issues.push({
        field: 'DATABASE_SSL_MODE',
        message: 'DATABASE_SSL_MODE is required in production and must be verify-full',
      });
      mode = 'verify-full';
    } else {
      mode = 'disable';
    }
  } else if (
    typeof rawMode !== 'string' ||
    !(ALLOWED_DATABASE_SSL_MODES as readonly string[]).includes(rawMode)
  ) {
    issues.push({
      field: 'DATABASE_SSL_MODE',
      message: 'Must be one of: disable, verify-full',
    });
    mode = 'disable';
  } else {
    mode = rawMode as DatabaseSslMode;
  }

  if (nodeEnv === 'production' && mode !== 'verify-full') {
    issues.push({
      field: 'DATABASE_SSL_MODE',
      message: 'DATABASE_SSL_MODE must be verify-full in production',
    });
  }

  if (mode === 'disable') {
    for (const urlStr of urlsToCheck) {
      if (urlStr) {
        try {
          const parsed = new URL(urlStr);
          const hostname = parsed.hostname.toLowerCase();
          if (!LOOPBACK_HOSTS.has(hostname)) {
            issues.push({
              field: 'DATABASE_SSL_MODE',
              message:
                'DATABASE_SSL_MODE disable is only permitted for loopback hosts (localhost, 127.0.0.1, ::1)',
            });
            break;
          }
        } catch {
          // Handled in URL validator
        }
      }
    }

    if (rawCaFile !== undefined && rawCaFile !== null && rawCaFile !== '') {
      issues.push({
        field: 'DATABASE_SSL_CA_FILE',
        message: 'DATABASE_SSL_CA_FILE must not be provided when DATABASE_SSL_MODE is disable',
      });
    }
    return { sslMode: mode };
  }

  // verify-full mode
  if (rawCaFile === undefined || rawCaFile === null || rawCaFile === '') {
    issues.push({
      field: 'DATABASE_SSL_CA_FILE',
      message: 'DATABASE_SSL_CA_FILE is required when DATABASE_SSL_MODE is verify-full',
    });
    return { sslMode: mode };
  }

  if (
    typeof rawCaFile !== 'string' ||
    rawCaFile.trim() === '' ||
    rawCaFile !== rawCaFile.trim() ||
    !path.isAbsolute(rawCaFile)
  ) {
    issues.push({
      field: 'DATABASE_SSL_CA_FILE',
      message: 'DATABASE_SSL_CA_FILE must be an absolute path to a PEM CA bundle',
    });
    return { sslMode: mode };
  }

  return { sslMode: mode, sslCaFile: rawCaFile };
}
