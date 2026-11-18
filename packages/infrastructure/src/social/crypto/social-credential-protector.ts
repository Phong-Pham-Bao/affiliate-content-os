import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { SocialPlatform } from '@affiliate-content-os/domain';
import {
  SocialCredentialEncryptionError,
  type DecryptedSocialCredentials,
  type EncryptedOAuthVerifier,
  type EncryptedSocialCredentials,
  type SocialCredentialProtectorPort,
} from '@affiliate-content-os/application';
import { buildCredentialAad, buildVerifierAad } from './social-credential-protector-aad.js';

export { buildCredentialAad, buildVerifierAad } from './social-credential-protector-aad.js';

export class LocalSocialCredentialProtector implements SocialCredentialProtectorPort {
  private readonly keyBytes: Buffer;
  private readonly keyVersion: string;

  constructor(keyBase64Url: string, keyVersion: string) {
    if (typeof keyVersion !== 'string' || !/^[A-Za-z0-9._-]{1,64}$/.test(keyVersion)) {
      throw new SocialCredentialEncryptionError('Invalid key version format.');
    }
    try {
      const buf = Buffer.from(keyBase64Url, 'base64url');
      if (buf.length !== 32 || buf.toString('base64url') !== keyBase64Url) {
        throw new SocialCredentialEncryptionError(
          'Invalid encryption key: must be 32 bytes base64url.',
        );
      }
      this.keyBytes = buf;
      this.keyVersion = keyVersion;
    } catch (err) {
      if (err instanceof SocialCredentialEncryptionError) throw err;
      throw new SocialCredentialEncryptionError('Failed to parse encryption key.');
    }
  }

  public encrypt(params: {
    readonly workspaceId: string;
    readonly socialAccountId: string;
    readonly platform: SocialPlatform;
    readonly accessToken: string;
    readonly refreshToken?: string | null | undefined;
  }): EncryptedSocialCredentials {
    if (!params.accessToken || typeof params.accessToken !== 'string') {
      throw new SocialCredentialEncryptionError('Missing access token for encryption.');
    }

    try {
      // 1. Encrypt access token
      const accessIv = randomBytes(12);
      const accessCipher = createCipheriv('aes-256-gcm', this.keyBytes, accessIv);
      const accessAad = buildCredentialAad(
        params.workspaceId,
        params.socialAccountId,
        params.platform,
        'access_token',
        this.keyVersion,
      );
      accessCipher.setAAD(accessAad);

      const accessCiphertext = Buffer.concat([
        accessCipher.update(params.accessToken, 'utf8'),
        accessCipher.final(),
      ]);
      const accessAuthTag = accessCipher.getAuthTag();

      // 2. Encrypt refresh token if present
      let refreshTokenCiphertext: Uint8Array | null = null;
      let refreshTokenIv: Uint8Array | null = null;
      let refreshTokenAuthTag: Uint8Array | null = null;

      if (params.refreshToken && typeof params.refreshToken === 'string') {
        const rIv = randomBytes(12);
        const refreshCipher = createCipheriv('aes-256-gcm', this.keyBytes, rIv);
        const refreshAad = buildCredentialAad(
          params.workspaceId,
          params.socialAccountId,
          params.platform,
          'refresh_token',
          this.keyVersion,
        );
        refreshCipher.setAAD(refreshAad);

        const rCiphertext = Buffer.concat([
          refreshCipher.update(params.refreshToken, 'utf8'),
          refreshCipher.final(),
        ]);
        const rAuthTag = refreshCipher.getAuthTag();

        refreshTokenCiphertext = new Uint8Array(
          rCiphertext.buffer,
          rCiphertext.byteOffset,
          rCiphertext.byteLength,
        );
        refreshTokenIv = new Uint8Array(rIv.buffer, rIv.byteOffset, rIv.byteLength);
        refreshTokenAuthTag = new Uint8Array(
          rAuthTag.buffer,
          rAuthTag.byteOffset,
          rAuthTag.byteLength,
        );
      }

      return {
        accessTokenCiphertext: new Uint8Array(
          accessCiphertext.buffer,
          accessCiphertext.byteOffset,
          accessCiphertext.byteLength,
        ),
        accessTokenIv: new Uint8Array(accessIv.buffer, accessIv.byteOffset, accessIv.byteLength),
        accessTokenAuthTag: new Uint8Array(
          accessAuthTag.buffer,
          accessAuthTag.byteOffset,
          accessAuthTag.byteLength,
        ),
        refreshTokenCiphertext,
        refreshTokenIv,
        refreshTokenAuthTag,
        keyVersion: this.keyVersion,
      };
    } catch (err) {
      if (err instanceof SocialCredentialEncryptionError) throw err;
      throw new SocialCredentialEncryptionError('Encryption operation failed.');
    }
  }

  public decrypt(params: {
    readonly workspaceId: string;
    readonly socialAccountId: string;
    readonly platform: SocialPlatform;
    readonly credentials: EncryptedSocialCredentials;
  }): DecryptedSocialCredentials {
    if (params.credentials.keyVersion !== this.keyVersion) {
      throw new SocialCredentialEncryptionError(
        `Unknown key version: ${params.credentials.keyVersion}. Expected ${this.keyVersion}.`,
      );
    }

    try {
      const accessIv = Buffer.from(params.credentials.accessTokenIv);
      const accessAuthTag = Buffer.from(params.credentials.accessTokenAuthTag);
      const accessCiphertext = Buffer.from(params.credentials.accessTokenCiphertext);

      const accessDecipher = createDecipheriv('aes-256-gcm', this.keyBytes, accessIv);
      const accessAad = buildCredentialAad(
        params.workspaceId,
        params.socialAccountId,
        params.platform,
        'access_token',
        this.keyVersion,
      );
      accessDecipher.setAAD(accessAad);
      accessDecipher.setAuthTag(accessAuthTag);

      const decryptedAccess = Buffer.concat([
        accessDecipher.update(accessCiphertext),
        accessDecipher.final(),
      ]).toString('utf8');

      let decryptedRefresh: string | null = null;
      if (
        params.credentials.refreshTokenCiphertext &&
        params.credentials.refreshTokenIv &&
        params.credentials.refreshTokenAuthTag
      ) {
        const rIv = Buffer.from(params.credentials.refreshTokenIv);
        const rAuthTag = Buffer.from(params.credentials.refreshTokenAuthTag);
        const rCiphertext = Buffer.from(params.credentials.refreshTokenCiphertext);

        const refreshDecipher = createDecipheriv('aes-256-gcm', this.keyBytes, rIv);
        const refreshAad = buildCredentialAad(
          params.workspaceId,
          params.socialAccountId,
          params.platform,
          'refresh_token',
          this.keyVersion,
        );
        refreshDecipher.setAAD(refreshAad);
        refreshDecipher.setAuthTag(rAuthTag);

        decryptedRefresh = Buffer.concat([
          refreshDecipher.update(rCiphertext),
          refreshDecipher.final(),
        ]).toString('utf8');
      }

      return {
        accessToken: decryptedAccess,
        refreshToken: decryptedRefresh,
      };
    } catch (err) {
      if (err instanceof SocialCredentialEncryptionError) throw err;
      throw new SocialCredentialEncryptionError(
        'Decryption operation failed or authentication tag mismatch.',
      );
    }
  }

  public encryptOAuthVerifier(params: {
    readonly workspaceId: string;
    readonly transactionId: string;
    readonly platform: SocialPlatform;
    readonly codeVerifier: string;
  }): EncryptedOAuthVerifier {
    if (!params.codeVerifier || typeof params.codeVerifier !== 'string') {
      throw new SocialCredentialEncryptionError('Missing code verifier for PKCE encryption.');
    }
    try {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', this.keyBytes, iv);
      const aad = buildVerifierAad(
        params.workspaceId,
        params.transactionId,
        params.platform,
        this.keyVersion,
      );
      cipher.setAAD(aad);
      const ciphertext = Buffer.concat([
        cipher.update(params.codeVerifier, 'utf8'),
        cipher.final(),
      ]);
      const authTag = cipher.getAuthTag();

      return {
        ciphertext: new Uint8Array(ciphertext.buffer, ciphertext.byteOffset, ciphertext.byteLength),
        iv: new Uint8Array(iv.buffer, iv.byteOffset, iv.byteLength),
        authTag: new Uint8Array(authTag.buffer, authTag.byteOffset, authTag.byteLength),
        keyVersion: this.keyVersion,
      };
    } catch (err) {
      if (err instanceof SocialCredentialEncryptionError) throw err;
      throw new SocialCredentialEncryptionError('Failed to encrypt PKCE verifier.');
    }
  }

  public decryptOAuthVerifier(params: {
    readonly workspaceId: string;
    readonly transactionId: string;
    readonly platform: SocialPlatform;
    readonly encryptedVerifier: EncryptedOAuthVerifier;
  }): string {
    if (params.encryptedVerifier.keyVersion !== this.keyVersion) {
      throw new SocialCredentialEncryptionError(
        `Unknown key version for PKCE verifier: ${params.encryptedVerifier.keyVersion}. Expected ${this.keyVersion}.`,
      );
    }
    try {
      const iv = Buffer.from(params.encryptedVerifier.iv);
      const authTag = Buffer.from(params.encryptedVerifier.authTag);
      const ciphertext = Buffer.from(params.encryptedVerifier.ciphertext);

      const decipher = createDecipheriv('aes-256-gcm', this.keyBytes, iv);
      const aad = buildVerifierAad(
        params.workspaceId,
        params.transactionId,
        params.platform,
        this.keyVersion,
      );
      decipher.setAAD(aad);
      decipher.setAuthTag(authTag);

      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    } catch (err) {
      if (err instanceof SocialCredentialEncryptionError) throw err;
      throw new SocialCredentialEncryptionError(
        'PKCE verifier decryption failed or authentication tag mismatch.',
      );
    }
  }
}
