import { describe, expect, it } from 'vitest';
import {
  CryptoOperationError,
  fromCanonicalBase64Url,
  generateSecureRandomBytes,
  LoginTransactionSecretsProtector,
  sha256,
  toCanonicalBase64Url,
} from '../../src/auth/crypto.js';

describe('packages/infrastructure/auth/crypto', () => {
  const validKey = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  const validKeyVersion = 'v1';
  const sampleTxId = '0192b012-3456-789a-8bcd-ef0123456789';

  describe('CryptoOperationError', () => {
    it('constructs with fixed message and rejects arguments without leaking them', () => {
      const err = new CryptoOperationError();
      expect(err.name).toBe('CryptoOperationError');
      expect(err.message).toBe('Cryptographic operation failed');

      type HostileCtor = new (...args: unknown[]) => CryptoOperationError;
      const hostileErr = new (CryptoOperationError as unknown as HostileCtor)(
        'SENTINEL_DISCLOSURE_TEXT',
        { cause: 'SENTINEL_CAUSE' },
      );
      expect(hostileErr.message).toBe('Cryptographic operation failed');
      expect((hostileErr as unknown as { cause?: unknown }).cause).toBeUndefined();
      expect(String(hostileErr)).not.toContain('SENTINEL');
      expect(JSON.stringify(hostileErr)).not.toContain('SENTINEL');
    });
  });

  describe('secure random bytes', () => {
    it('generates random bytes of requested length', () => {
      const bytes16 = generateSecureRandomBytes(16);
      expect(bytes16).toHaveLength(16);

      const bytes32 = generateSecureRandomBytes(32);
      expect(bytes32).toHaveLength(32);

      const bytes32Second = generateSecureRandomBytes(32);
      expect(bytes32).not.toEqual(bytes32Second);
    });

    it('rejects invalid byte counts', () => {
      expect(() => generateSecureRandomBytes(0)).toThrow(CryptoOperationError);
      expect(() => generateSecureRandomBytes(-5)).toThrow(CryptoOperationError);
      expect(() => generateSecureRandomBytes(2000)).toThrow(CryptoOperationError);
    });
  });

  describe('canonical base64url', () => {
    it('round trips arbitrary bytes', () => {
      const original = generateSecureRandomBytes(32);
      const encoded = toCanonicalBase64Url(original);
      expect(encoded).not.toContain('=');
      expect(encoded).not.toContain('+');
      expect(encoded).not.toContain('/');

      const decoded = fromCanonicalBase64Url(encoded, 32);
      expect(decoded).toEqual(original);
    });

    it('rejects padded strings', () => {
      expect(() => fromCanonicalBase64Url('AAA=')).toThrow(CryptoOperationError);
      expect(() => fromCanonicalBase64Url('AAAA==')).toThrow(CryptoOperationError);
    });

    it('rejects wrong decoded length', () => {
      const shortEncoded = toCanonicalBase64Url(generateSecureRandomBytes(16));
      expect(() => fromCanonicalBase64Url(shortEncoded, 32)).toThrow(CryptoOperationError);
    });

    it('rejects non-canonical base64url encoding (unused bits not zeroed)', () => {
      // 43 chars of 'A' has valid length for 32 bytes
      // But if the 43rd character has non-zero unused bits, re-encoding will differ
      const nonCanonical = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB';
      expect(() => fromCanonicalBase64Url(nonCanonical, 32)).toThrow(CryptoOperationError);
    });
  });

  describe('SHA-256', () => {
    it('computes known test vector for empty string', () => {
      const hash = sha256('');
      const hex = Buffer.from(hash).toString('hex');
      expect(hex).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    });

    it('computes known test vector for "hello"', () => {
      const hash = sha256('hello');
      const hex = Buffer.from(hash).toString('hex');
      expect(hex).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
    });

    it('accepts Uint8Array input', () => {
      const input = Buffer.from('hello', 'utf8');
      const hash = sha256(new Uint8Array(input.buffer, input.byteOffset, input.byteLength));
      const hex = Buffer.from(hash).toString('hex');
      expect(hex).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
    });
  });

  describe('LoginTransactionSecretsProtector (AES-256-GCM)', () => {
    const sentinelSecret = 'SUPER_SECRET_PKCE_VERIFIER_12345';
    const sentinelNonce = 'SUPER_SECRET_NONCE_67890';

    it('encrypts and decrypts payload successfully', () => {
      const protector = new LoginTransactionSecretsProtector(validKey, validKeyVersion);
      const encrypted = protector.encrypt(sampleTxId, {
        pkceVerifier: sentinelSecret,
        nonce: sentinelNonce,
      });

      expect(encrypted.iv).toHaveLength(12);
      expect(encrypted.authTag).toHaveLength(16);
      expect(encrypted.keyVersion).toBe(validKeyVersion);

      const decrypted = protector.decrypt(sampleTxId, encrypted);
      expect(decrypted.pkceVerifier).toBe(sentinelSecret);
      expect(decrypted.nonce).toBe(sentinelNonce);
    });

    it('generates unique IV per encryption call', () => {
      const protector = new LoginTransactionSecretsProtector(validKey, validKeyVersion);
      const payload = { pkceVerifier: 'v1', nonce: 'n1' };
      const enc1 = protector.encrypt(sampleTxId, payload);
      const enc2 = protector.encrypt(sampleTxId, payload);

      expect(enc1.iv).not.toEqual(enc2.iv);
      expect(enc1.ciphertext).not.toEqual(enc2.ciphertext);
    });

    it('fails closed on transaction ID mismatch (authenticated additional data failure)', () => {
      const protector = new LoginTransactionSecretsProtector(validKey, validKeyVersion);
      const encrypted = protector.encrypt(sampleTxId, {
        pkceVerifier: sentinelSecret,
        nonce: sentinelNonce,
      });

      const differentTxId = '0192b012-3456-789a-8bcd-ef0123456999';
      expect(() => protector.decrypt(differentTxId, encrypted)).toThrow(CryptoOperationError);
    });

    it('fails closed on key version mismatch', () => {
      const protectorV1 = new LoginTransactionSecretsProtector(validKey, 'v1');
      const encrypted = protectorV1.encrypt(sampleTxId, {
        pkceVerifier: sentinelSecret,
        nonce: sentinelNonce,
      });

      const protectorV2 = new LoginTransactionSecretsProtector(validKey, 'v2');
      expect(() => protectorV2.decrypt(sampleTxId, encrypted)).toThrow(CryptoOperationError);
    });

    it('fails closed on wrong key', () => {
      const protector1 = new LoginTransactionSecretsProtector(validKey, 'v1');
      const otherKey = toCanonicalBase64Url(generateSecureRandomBytes(32));
      const protector2 = new LoginTransactionSecretsProtector(otherKey, 'v1');

      const encrypted = protector1.encrypt(sampleTxId, {
        pkceVerifier: sentinelSecret,
        nonce: sentinelNonce,
      });

      expect(() => protector2.decrypt(sampleTxId, encrypted)).toThrow(CryptoOperationError);
    });

    it('fails closed on corrupted ciphertext, auth tag, or IV', () => {
      const protector = new LoginTransactionSecretsProtector(validKey, validKeyVersion);
      const encrypted = protector.encrypt(sampleTxId, {
        pkceVerifier: sentinelSecret,
        nonce: sentinelNonce,
      });

      // Corrupted ciphertext
      const tamperedCiphertext = new Uint8Array(encrypted.ciphertext);
      tamperedCiphertext[0]! ^= 0xff;
      expect(() =>
        protector.decrypt(sampleTxId, { ...encrypted, ciphertext: tamperedCiphertext }),
      ).toThrow(CryptoOperationError);

      // Corrupted tag
      const tamperedTag = new Uint8Array(encrypted.authTag);
      tamperedTag[0]! ^= 0xff;
      expect(() => protector.decrypt(sampleTxId, { ...encrypted, authTag: tamperedTag })).toThrow(
        CryptoOperationError,
      );

      // Wrong IV length
      expect(() => protector.decrypt(sampleTxId, { ...encrypted, iv: new Uint8Array(10) })).toThrow(
        CryptoOperationError,
      );
    });

    it('never discloses sentinel secret in error properties or stringification', () => {
      const protector = new LoginTransactionSecretsProtector(validKey, validKeyVersion);
      const encrypted = protector.encrypt(sampleTxId, {
        pkceVerifier: sentinelSecret,
        nonce: sentinelNonce,
      });

      try {
        protector.decrypt('wrong-tx', encrypted);
        expect.unreachable();
      } catch (err) {
        expect(err).toBeInstanceOf(CryptoOperationError);
        const errStr = String(err);
        const json = JSON.stringify(err);
        expect(errStr).not.toContain(sentinelSecret);
        expect(errStr).not.toContain(sentinelNonce);
        expect(json).not.toContain(sentinelSecret);
        expect(json).not.toContain(sentinelNonce);
      }
    });
  });
});
