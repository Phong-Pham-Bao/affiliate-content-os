import crypto from 'node:crypto';

export function canonicalJsonStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return '[' + value.map((item) => canonicalJsonStringify(item)).join(',') + ']';
  }

  const obj = value as Record<string, unknown>;
  const sortedKeys = Object.keys(obj).sort();
  const entries = sortedKeys.map((k) => `${JSON.stringify(k)}:${canonicalJsonStringify(obj[k])}`);
  return '{' + entries.join(',') + '}';
}

export function computeCanonicalHash(value: unknown): Uint8Array {
  const canonical = canonicalJsonStringify(value);
  return new Uint8Array(crypto.createHash('sha256').update(canonical, 'utf8').digest());
}

export function computeCanonicalHashHex(value: unknown): string {
  return Buffer.from(computeCanonicalHash(value)).toString('hex');
}

export function computeCapabilityFingerprintHex(capabilities: Record<string, boolean>): string {
  return computeCanonicalHashHex(capabilities);
}
