export type IdempotencyKeyFactory = () => string | null;

export class IdempotencyKeyTracker {
  private signature: string | null = null;
  private key: string | null = null;

  constructor(private readonly createKey: IdempotencyKeyFactory) {}

  getKey(signature: string): string | null {
    if (this.signature === signature && this.key !== null) {
      return this.key;
    }

    const nextKey = this.createKey();
    if (nextKey === null) {
      return null;
    }

    this.signature = signature;
    this.key = nextKey;
    return nextKey;
  }

  clear(): void {
    this.signature = null;
    this.key = null;
  }
}

export function createCanonicalPayloadSignature(payload: unknown): string {
  return JSON.stringify(payload);
}

export function normalizeCanonicalProductUrlForSignature(rawUrl: string): string {
  const parsed = new URL(rawUrl.trim());
  parsed.protocol = parsed.protocol.toLowerCase();
  parsed.hostname = parsed.hostname.toLowerCase();
  if (
    (parsed.protocol === 'http:' && parsed.port === '80') ||
    (parsed.protocol === 'https:' && parsed.port === '443')
  ) {
    parsed.port = '';
  }
  parsed.hash = '';
  return parsed.pathname === '/' && !parsed.search ? parsed.origin : parsed.toString();
}
