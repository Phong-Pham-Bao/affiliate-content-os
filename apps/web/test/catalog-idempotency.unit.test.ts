import { describe, expect, it, vi } from 'vitest';
import {
  createCanonicalPayloadSignature,
  IdempotencyKeyTracker,
  normalizeCanonicalProductUrlForSignature,
} from '../src/lib/catalog-idempotency.js';

describe('catalog form idempotency key lifecycle', () => {
  it('retains a key for the same normalized payload and rotates for a material change', () => {
    const createKey = vi.fn().mockReturnValueOnce('key-1').mockReturnValueOnce('key-2');
    const tracker = new IdempotencyKeyTracker(createKey);
    const first = createCanonicalPayloadSignature({ name: 'Desk', notes: null });
    const changed = createCanonicalPayloadSignature({ name: 'Desk Pro', notes: null });

    expect(tracker.getKey(first)).toBe('key-1');
    expect(tracker.getKey(first)).toBe('key-1');
    expect(tracker.getKey(changed)).toBe('key-2');
    expect(createKey).toHaveBeenCalledTimes(2);
  });

  it('clears the retained key after success', () => {
    const createKey = vi.fn().mockReturnValueOnce('key-1').mockReturnValueOnce('key-2');
    const tracker = new IdempotencyKeyTracker(createKey);
    const signature = createCanonicalPayloadSignature({ facts: [{ factKey: 'weight' }] });

    expect(tracker.getKey(signature)).toBe('key-1');
    tracker.clear();
    expect(tracker.getKey(signature)).toBe('key-2');
  });

  it('does not retain a failed key generation', () => {
    const createKey = vi.fn().mockReturnValueOnce(null).mockReturnValueOnce('key-1');
    const tracker = new IdempotencyKeyTracker(createKey);

    expect(tracker.getKey('payload')).toBeNull();
    expect(tracker.getKey('payload')).toBe('key-1');
  });

  it('uses the same signature for equivalent canonical product URLs', () => {
    const first = normalizeCanonicalProductUrlForSignature(
      'https://example.com:443/product#details',
    );
    const second = normalizeCanonicalProductUrlForSignature('HTTPS://EXAMPLE.COM/product');
    expect(first).toBe(second);
  });
});
