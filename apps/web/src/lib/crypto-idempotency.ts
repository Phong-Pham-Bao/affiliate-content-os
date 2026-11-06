/**
 * Cryptographically generates an idempotency key using Web Crypto only.
 * Strictly uses crypto.randomUUID or crypto.getRandomValues.
 * Never uses Math.random or Date fallbacks.
 * Returns null if Web Crypto is unavailable.
 */
export function generateCryptoIdempotencyKey(): string | null {
  if (typeof globalThis.crypto === 'undefined' || !globalThis.crypto) {
    return null;
  }

  if (typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }

  if (typeof globalThis.crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    // RFC 4122 v4 variant & version bits
    bytes[6] = (bytes[6]! & 0x0f) | 0x40;
    bytes[8] = (bytes[8]! & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  return null;
}

/**
 * Normalizes logical workspace creation payload for idempotency key retention comparison.
 */
export function normalizeWorkspacePayload(
  name: string,
  slug: string,
  timezone: string,
  brandVoice?: string | null,
  defaultDisclosure?: string | null,
  aiEnabled?: boolean,
): string {
  return JSON.stringify({
    name: name.trim(),
    slug: slug.trim(),
    timezone: timezone.trim(),
    brandVoice: brandVoice?.trim() || null,
    defaultDisclosure: defaultDisclosure?.trim() || null,
    aiEnabled: aiEnabled ?? false,
  });
}
