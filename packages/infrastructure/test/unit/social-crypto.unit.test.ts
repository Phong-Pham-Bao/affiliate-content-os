import { describe, expect, it } from 'vitest';
import { SocialCredentialEncryptionError } from '@affiliate-content-os/application';
import { LocalSocialCredentialProtector } from '../../src/social/index.js';

describe('LocalSocialCredentialProtector', () => {
  const validKey = 'MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDE';
  const keyVersion = 'v1';
  const workspaceId = '018f3a2c-4e5b-7c8d-9e0f-1a2b3c4d5e6f';
  const socialAccountId = '018f3a2c-4e5b-7c8d-9e0f-2a3b4c5d6e7f';
  const platform = 'threads' as const;

  it('rejects invalid key format or wrong byte length', () => {
    expect(() => new LocalSocialCredentialProtector('too-short', keyVersion)).toThrow(
      SocialCredentialEncryptionError,
    );
    expect(() => new LocalSocialCredentialProtector(validKey, 'invalid version!')).toThrow(
      SocialCredentialEncryptionError,
    );
  });

  it('encrypts and decrypts credentials successfully (round-trip)', () => {
    const protector = new LocalSocialCredentialProtector(validKey, keyVersion);

    const encrypted = protector.encrypt({
      workspaceId,
      socialAccountId,
      platform,
      accessToken: 'th_access_token_secret_12345',
      refreshToken: 'th_refresh_token_secret_67890',
    });

    expect(encrypted.accessTokenCiphertext.length).toBeGreaterThan(0);
    expect(encrypted.accessTokenIv).toHaveLength(12);
    expect(encrypted.accessTokenAuthTag).toHaveLength(16);
    expect(encrypted.refreshTokenCiphertext).not.toBeNull();
    expect(encrypted.refreshTokenIv).toHaveLength(12);
    expect(encrypted.refreshTokenAuthTag).toHaveLength(16);
    expect(encrypted.keyVersion).toBe(keyVersion);

    const decrypted = protector.decrypt({
      workspaceId,
      socialAccountId,
      platform,
      credentials: encrypted,
    });

    expect(decrypted.accessToken).toBe('th_access_token_secret_12345');
    expect(decrypted.refreshToken).toBe('th_refresh_token_secret_67890');
  });

  it('generates distinct IVs on successive encryptions (nonce uniqueness)', () => {
    const protector = new LocalSocialCredentialProtector(validKey, keyVersion);

    const enc1 = protector.encrypt({
      workspaceId,
      socialAccountId,
      platform,
      accessToken: 'token-abc',
    });
    const enc2 = protector.encrypt({
      workspaceId,
      socialAccountId,
      platform,
      accessToken: 'token-abc',
    });

    expect(enc1.accessTokenIv).not.toEqual(enc2.accessTokenIv);
    expect(enc1.accessTokenCiphertext).not.toEqual(enc2.accessTokenCiphertext);
  });

  it('fails decryption if AAD is swapped (wrong workspaceId)', () => {
    const protector = new LocalSocialCredentialProtector(validKey, keyVersion);

    const encrypted = protector.encrypt({
      workspaceId,
      socialAccountId,
      platform,
      accessToken: 'token-abc',
    });

    expect(() =>
      protector.decrypt({
        workspaceId: '018f3a2c-4e5b-7c8d-9e0f-999999999999', // cross-tenant tamper
        socialAccountId,
        platform,
        credentials: encrypted,
      }),
    ).toThrow(SocialCredentialEncryptionError);
  });

  it('fails decryption if AAD is swapped (wrong platform)', () => {
    const protector = new LocalSocialCredentialProtector(validKey, keyVersion);

    const encrypted = protector.encrypt({
      workspaceId,
      socialAccountId,
      platform: 'threads',
      accessToken: 'token-abc',
    });

    expect(() =>
      protector.decrypt({
        workspaceId,
        socialAccountId,
        platform: 'tiktok', // platform tamper
        credentials: encrypted,
      }),
    ).toThrow(SocialCredentialEncryptionError);
  });

  it('fails decryption if ciphertext is tampered with', () => {
    const protector = new LocalSocialCredentialProtector(validKey, keyVersion);

    const encrypted = protector.encrypt({
      workspaceId,
      socialAccountId,
      platform,
      accessToken: 'token-abc',
    });

    const tamperedCiphertext = new Uint8Array(encrypted.accessTokenCiphertext);
    tamperedCiphertext[0] = tamperedCiphertext[0]! ^ 0xff;

    expect(() =>
      protector.decrypt({
        workspaceId,
        socialAccountId,
        platform,
        credentials: {
          ...encrypted,
          accessTokenCiphertext: tamperedCiphertext,
        },
      }),
    ).toThrow(SocialCredentialEncryptionError);
  });

  it('fails decryption if wrong key version is supplied', () => {
    const protector = new LocalSocialCredentialProtector(validKey, keyVersion);

    const encrypted = protector.encrypt({
      workspaceId,
      socialAccountId,
      platform,
      accessToken: 'token-abc',
    });

    expect(() =>
      protector.decrypt({
        workspaceId,
        socialAccountId,
        platform,
        credentials: {
          ...encrypted,
          keyVersion: 'v2',
        },
      }),
    ).toThrow(SocialCredentialEncryptionError);
  });

  describe('PKCE Verifier encryption', () => {
    const transactionId = '018f3a2c-4e5b-7c8d-9e0f-3a4b5c6d7e8f';
    const verifier = 'high-entropy-pkce-code-verifier-string-0123456789';

    it('encrypts and decrypts PKCE verifier successfully (round-trip)', () => {
      const protector = new LocalSocialCredentialProtector(validKey, keyVersion);

      const encrypted = protector.encryptOAuthVerifier({
        workspaceId,
        transactionId,
        platform,
        codeVerifier: verifier,
      });

      expect(encrypted.ciphertext.length).toBeGreaterThan(0);
      expect(encrypted.iv).toHaveLength(12);
      expect(encrypted.authTag).toHaveLength(16);
      expect(encrypted.keyVersion).toBe(keyVersion);

      const decrypted = protector.decryptOAuthVerifier({
        workspaceId,
        transactionId,
        platform,
        encryptedVerifier: encrypted,
      });

      expect(decrypted).toBe(verifier);
    });

    it('fails PKCE decryption if transactionId AAD is swapped', () => {
      const protector = new LocalSocialCredentialProtector(validKey, keyVersion);

      const encrypted = protector.encryptOAuthVerifier({
        workspaceId,
        transactionId,
        platform,
        codeVerifier: verifier,
      });

      expect(() =>
        protector.decryptOAuthVerifier({
          workspaceId,
          transactionId: '018f3a2c-4e5b-7c8d-9e0f-999999999999',
          platform,
          encryptedVerifier: encrypted,
        }),
      ).toThrow(SocialCredentialEncryptionError);
    });

    it('fails PKCE decryption if ciphertext or tag is tampered with', () => {
      const protector = new LocalSocialCredentialProtector(validKey, keyVersion);

      const encrypted = protector.encryptOAuthVerifier({
        workspaceId,
        transactionId,
        platform,
        codeVerifier: verifier,
      });

      const tampered = new Uint8Array(encrypted.ciphertext);
      tampered[0] = tampered[0]! ^ 0x01;

      expect(() =>
        protector.decryptOAuthVerifier({
          workspaceId,
          transactionId,
          platform,
          encryptedVerifier: {
            ...encrypted,
            ciphertext: tampered,
          },
        }),
      ).toThrow(SocialCredentialEncryptionError);
    });
  });
});
