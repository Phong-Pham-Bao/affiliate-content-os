import net from 'node:net';
import type { ConfigurationIssue } from './errors.js';
import { DEFAULT_API_HOST, DEFAULT_API_PORT } from './types.js';

const HOSTNAME_REGEX =
  /^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)*[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/;
const PORT_REGEX = /^[1-9][0-9]*$/;

/**
 * Validates API_HOST from injected environment record.
 * Must be a valid hostname or IP address without scheme, credentials, path, or port.
 */
export function validateApiHost(
  rawEnv: Record<string, unknown>,
  issues: ConfigurationIssue[],
): string {
  const value = rawEnv['API_HOST'];

  if (value === undefined) {
    return DEFAULT_API_HOST;
  }

  if (typeof value !== 'string' || value.trim() === '' || value !== value.trim()) {
    issues.push({
      field: 'API_HOST',
      message: 'Must be a valid hostname or IP address',
    });
    return DEFAULT_API_HOST;
  }

  if (
    value.includes(' ') ||
    value.includes('/') ||
    value.includes('\\') ||
    value.includes('?') ||
    value.includes('#')
  ) {
    issues.push({
      field: 'API_HOST',
      message: 'Must be a valid hostname or IP address',
    });
    return DEFAULT_API_HOST;
  }

  const isIp = net.isIP(value) !== 0;
  if (!isIp && !HOSTNAME_REGEX.test(value)) {
    issues.push({
      field: 'API_HOST',
      message: 'Must be a valid hostname or IP address',
    });
    return DEFAULT_API_HOST;
  }

  return value;
}

/**
 * Validates API_PORT from injected environment record.
 * Must be a valid TCP port number between 1 and 65535.
 */
export function validateApiPort(
  rawEnv: Record<string, unknown>,
  issues: ConfigurationIssue[],
): number {
  const value = rawEnv['API_PORT'];

  if (value === undefined) {
    return DEFAULT_API_PORT;
  }

  if (
    typeof value !== 'string' ||
    value.trim() === '' ||
    value !== value.trim() ||
    !PORT_REGEX.test(value)
  ) {
    issues.push({
      field: 'API_PORT',
      message: 'Must be a valid TCP port between 1 and 65535',
    });
    return DEFAULT_API_PORT;
  }

  const port = Number(value);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    issues.push({
      field: 'API_PORT',
      message: 'Must be a valid TCP port between 1 and 65535',
    });
    return DEFAULT_API_PORT;
  }

  return port;
}
