import type { ConfigurationIssue } from './errors.js';
import {
  DEFAULT_AUTH_SESSION_ABSOLUTE_TTL_SECONDS,
  DEFAULT_AUTH_SESSION_IDLE_TTL_SECONDS,
  DEFAULT_AUTH_SESSION_ROTATION_GRACE_SECONDS,
  DEFAULT_AUTH_SESSION_ROTATION_SECONDS,
  DEFAULT_AUTH_SESSION_TOUCH_INTERVAL_SECONDS,
  DEFAULT_AUTH_TRANSACTION_TTL_SECONDS,
  type NodeEnv,
} from './types.js';

export function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === '[::1]' ||
    hostname === 'postgres'
  );
}

export function validateIntegerInRange(
  rawEnv: Record<string, unknown>,
  field: string,
  defaultValue: number,
  min: number,
  max: number,
  issues: ConfigurationIssue[],
): number {
  const value = rawEnv[field];
  if (value === undefined) {
    return defaultValue;
  }
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)$/.test(value)) {
    issues.push({ field, message: `Must be an integer between ${min} and ${max}` });
    return defaultValue;
  }
  const parsed = Number.parseInt(value, 10);
  if (parsed < min || parsed > max) {
    issues.push({ field, message: `Must be an integer between ${min} and ${max}` });
    return defaultValue;
  }
  return parsed;
}

export function validateUrl(
  field: string,
  value: unknown,
  nodeEnv: NodeEnv,
  issues: ConfigurationIssue[],
  pathCheck?: (pathname: string) => boolean,
): string | undefined {
  if (typeof value !== 'string' || value.trim() === '' || value !== value.trim()) {
    issues.push({ field, message: 'Must be a valid absolute URL' });
    return undefined;
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    issues.push({ field, message: 'Must be a valid absolute URL' });
    return undefined;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    issues.push({ field, message: 'Must use http or https protocol' });
    return undefined;
  }
  if (parsed.username !== '' || parsed.password !== '') {
    issues.push({ field, message: 'Must not contain embedded credentials' });
    return undefined;
  }
  if (parsed.search !== '') {
    issues.push({ field, message: 'Must not contain query parameters' });
    return undefined;
  }
  if (parsed.hash !== '') {
    issues.push({ field, message: 'Must not contain a fragment identifier' });
    return undefined;
  }
  if (parsed.protocol === 'http:') {
    const isTest = nodeEnv === 'test';
    const isLoopback = isLoopbackHost(parsed.hostname);
    if (nodeEnv === 'production' || (!isTest && !isLoopback)) {
      issues.push({ field, message: 'HTTPS is required outside test/local loopback' });
      return undefined;
    }
  }
  if (pathCheck && !pathCheck(parsed.pathname)) {
    issues.push({ field, message: 'Path must be exactly /auth/callback' });
    return undefined;
  }
  return value;
}

export function validateEncryptionKey(
  value: unknown,
  issues: ConfigurationIssue[],
): string | undefined {
  const field = 'AUTH_TRANSACTION_ENCRYPTION_KEY';
  if (typeof value !== 'string' || value.length !== 43 || !/^[A-Za-z0-9_-]{43}$/.test(value)) {
    issues.push({
      field,
      message: 'Must be canonical unpadded base64url encoding of exactly 32 bytes',
    });
    return undefined;
  }
  const buf = Buffer.from(value, 'base64url');
  if (buf.length !== 32 || buf.toString('base64url') !== value) {
    issues.push({
      field,
      message: 'Must be canonical unpadded base64url encoding of exactly 32 bytes',
    });
    return undefined;
  }
  return value;
}

export interface ValidatedAuthTtls {
  txTtl: number;
  idleTtl: number;
  absTtl: number;
  rotTtl: number;
  graceTtl: number;
  touchTtl: number;
}

export function validateAuthTtls(
  env: Record<string, unknown>,
  issues: ConfigurationIssue[],
): ValidatedAuthTtls {
  const txTtl = validateIntegerInRange(
    env,
    'AUTH_TRANSACTION_TTL_SECONDS',
    DEFAULT_AUTH_TRANSACTION_TTL_SECONDS,
    120,
    900,
    issues,
  );
  const idleTtl = validateIntegerInRange(
    env,
    'AUTH_SESSION_IDLE_TTL_SECONDS',
    DEFAULT_AUTH_SESSION_IDLE_TTL_SECONDS,
    300,
    3600,
    issues,
  );
  const absTtl = validateIntegerInRange(
    env,
    'AUTH_SESSION_ABSOLUTE_TTL_SECONDS',
    DEFAULT_AUTH_SESSION_ABSOLUTE_TTL_SECONDS,
    3600,
    86400,
    issues,
  );
  const rotTtl = validateIntegerInRange(
    env,
    'AUTH_SESSION_ROTATION_SECONDS',
    DEFAULT_AUTH_SESSION_ROTATION_SECONDS,
    300,
    1800,
    issues,
  );
  const graceTtl = validateIntegerInRange(
    env,
    'AUTH_SESSION_ROTATION_GRACE_SECONDS',
    DEFAULT_AUTH_SESSION_ROTATION_GRACE_SECONDS,
    5,
    120,
    issues,
  );
  const touchTtl = validateIntegerInRange(
    env,
    'AUTH_SESSION_TOUCH_INTERVAL_SECONDS',
    DEFAULT_AUTH_SESSION_TOUCH_INTERVAL_SECONDS,
    60,
    600,
    issues,
  );

  if (absTtl <= idleTtl) {
    issues.push({
      field: 'AUTH_SESSION_ABSOLUTE_TTL_SECONDS',
      message: 'AUTH_SESSION_ABSOLUTE_TTL_SECONDS must be greater than idle TTL',
    });
  }
  if (rotTtl >= idleTtl) {
    issues.push({
      field: 'AUTH_SESSION_ROTATION_SECONDS',
      message: 'AUTH_SESSION_ROTATION_SECONDS must be less than idle TTL',
    });
  }
  if (graceTtl >= rotTtl) {
    issues.push({
      field: 'AUTH_SESSION_ROTATION_GRACE_SECONDS',
      message: 'AUTH_SESSION_ROTATION_GRACE_SECONDS must be less than rotation interval',
    });
  }
  if (touchTtl >= idleTtl) {
    issues.push({
      field: 'AUTH_SESSION_TOUCH_INTERVAL_SECONDS',
      message: 'AUTH_SESSION_TOUCH_INTERVAL_SECONDS must be less than idle TTL',
    });
  }

  return { txTtl, idleTtl, absTtl, rotTtl, graceTtl, touchTtl };
}
