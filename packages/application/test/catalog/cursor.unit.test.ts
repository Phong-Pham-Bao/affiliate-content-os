import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../src/errors.js';
import {
  decodeAffiliateCursor,
  decodeFactSetCursor,
  decodeProductCursor,
  encodeAffiliateCursor,
  encodeFactSetCursor,
  encodeProductCursor,
} from '../../src/catalog/cursor.js';
import type { IsoTimestamp } from '@affiliate-content-os/domain';

describe('Catalog Cursor - Strict Validation & Canonical Encoding', () => {
  const validUuid = '018f6c5b-21a4-789a-8def-0123456789ab';
  const validIso = '2026-11-06T12:00:00.000Z' as IsoTimestamp;

  describe('Product Cursor', () => {
    it('encodes and decodes canonical cursor', () => {
      const cursorStr = encodeProductCursor(validIso, validUuid);
      expect(typeof cursorStr).toBe('string');
      // Must not contain +, /, or = (base64url)
      expect(cursorStr).not.toContain('+');
      expect(cursorStr).not.toContain('/');
      expect(cursorStr).not.toContain('=');

      const decoded = decodeProductCursor(cursorStr);
      expect(decoded).toEqual({ updatedAt: validIso, id: validUuid });
    });

    it('rejects cursor with standard base64 padding =', () => {
      const json = JSON.stringify({ u: validIso, i: validUuid });
      const paddedBase64 = Buffer.from(json).toString('base64');
      // Ensure it has padding
      if (paddedBase64.includes('=')) {
        expect(() => decodeProductCursor(paddedBase64)).toThrow(ValidationError);
      }
    });

    it('rejects cursor with standard base64 characters + or /', () => {
      const hostileCursor = 'eyJ1Ijoi' + '+/' + '==';
      expect(() => decodeProductCursor(hostileCursor)).toThrow(ValidationError);
    });

    it('rejects cursor string exceeding 512 bytes', () => {
      const hugeCursor = 'a'.repeat(513);
      expect(() => decodeProductCursor(hugeCursor)).toThrow(ValidationError);
    });

    it('rejects decoded JSON exceeding 512 bytes', () => {
      const payload = { u: validIso, i: validUuid, extra: 'x'.repeat(600) };
      const raw = Buffer.from(JSON.stringify(payload)).toString('base64url');
      expect(() => decodeProductCursor(raw)).toThrow(ValidationError);
    });

    it('rejects cursor with extra keys', () => {
      const payload = { u: validIso, i: validUuid, sneak: true };
      const raw = Buffer.from(JSON.stringify(payload)).toString('base64url');
      expect(() => decodeProductCursor(raw)).toThrow(ValidationError);
    });

    it('rejects cursor with invalid timestamp', () => {
      const payload = { u: 'invalid-date', i: validUuid };
      const raw = Buffer.from(JSON.stringify(payload)).toString('base64url');
      expect(() => decodeProductCursor(raw)).toThrow(ValidationError);
    });

    it('rejects cursor with invalid UUIDv7', () => {
      const payload = { u: validIso, i: 'not-a-uuid' };
      const raw = Buffer.from(JSON.stringify(payload)).toString('base64url');
      expect(() => decodeProductCursor(raw)).toThrow(ValidationError);
    });

    it('rejects non-object JSON payloads (array, number, string, null)', () => {
      for (const val of [[], 123, 'string', null]) {
        const raw = Buffer.from(JSON.stringify(val)).toString('base64url');
        expect(() => decodeProductCursor(raw)).toThrow(ValidationError);
      }
    });
  });

  describe('FactSet Cursor', () => {
    it('encodes and decodes valid fact set cursor', () => {
      const encoded = encodeFactSetCursor(5, validUuid);
      const decoded = decodeFactSetCursor(encoded);
      expect(decoded).toEqual({ revisionNumber: 5, id: validUuid });
    });

    it('rejects non-positive revision numbers', () => {
      const p1 = { r: 0, i: validUuid };
      const raw1 = Buffer.from(JSON.stringify(p1)).toString('base64url');
      expect(() => decodeFactSetCursor(raw1)).toThrow(ValidationError);

      const p2 = { r: -3, i: validUuid };
      const raw2 = Buffer.from(JSON.stringify(p2)).toString('base64url');
      expect(() => decodeFactSetCursor(raw2)).toThrow(ValidationError);
    });

    it('rejects non-integer revision numbers', () => {
      const p = { r: 3.14, i: validUuid };
      const raw = Buffer.from(JSON.stringify(p)).toString('base64url');
      expect(() => decodeFactSetCursor(raw)).toThrow(ValidationError);
    });

    it('rejects missing or extra keys in fact set cursor', () => {
      const p1 = { r: 1 };
      const raw1 = Buffer.from(JSON.stringify(p1)).toString('base64url');
      expect(() => decodeFactSetCursor(raw1)).toThrow(ValidationError);

      const p2 = { r: 1, i: validUuid, extra: 'bad' };
      const raw2 = Buffer.from(JSON.stringify(p2)).toString('base64url');
      expect(() => decodeFactSetCursor(raw2)).toThrow(ValidationError);
    });
  });

  describe('Affiliate Destination Cursor', () => {
    it('encodes and decodes valid affiliate cursor', () => {
      const encoded = encodeAffiliateCursor(validIso, validUuid);
      const decoded = decodeAffiliateCursor(encoded);
      expect(decoded).toEqual({ updatedAt: validIso, id: validUuid });
    });

    it('rejects invalid timestamp or id in affiliate cursor', () => {
      const p1 = { u: 'bogus', i: validUuid };
      const raw1 = Buffer.from(JSON.stringify(p1)).toString('base64url');
      expect(() => decodeAffiliateCursor(raw1)).toThrow(ValidationError);

      const p2 = { u: validIso, i: 'bogus' };
      const raw2 = Buffer.from(JSON.stringify(p2)).toString('base64url');
      expect(() => decodeAffiliateCursor(raw2)).toThrow(ValidationError);
    });
  });
});
