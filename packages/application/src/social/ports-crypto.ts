import type { SocialPlatform } from '@affiliate-content-os/domain';

export interface EncryptedSocialCredentials {
  readonly accessTokenCiphertext: Uint8Array;
  readonly accessTokenIv: Uint8Array;
  readonly accessTokenAuthTag: Uint8Array;
  readonly refreshTokenCiphertext: Uint8Array | null;
  readonly refreshTokenIv: Uint8Array | null;
  readonly refreshTokenAuthTag: Uint8Array | null;
  readonly keyVersion: string;
}

export interface EncryptedOAuthVerifier {
  readonly ciphertext: Uint8Array;
  readonly iv: Uint8Array;
  readonly authTag: Uint8Array;
  readonly keyVersion: string;
}

export interface DecryptedSocialCredentials {
  readonly accessToken: string;
  readonly refreshToken: string | null;
}

export interface SocialCredentialProtectorPort {
  encrypt(params: {
    readonly workspaceId: string;
    readonly socialAccountId: string;
    readonly platform: SocialPlatform;
    readonly accessToken: string;
    readonly refreshToken?: string | null | undefined;
  }): EncryptedSocialCredentials;
  decrypt(params: {
    readonly workspaceId: string;
    readonly socialAccountId: string;
    readonly platform: SocialPlatform;
    readonly credentials: EncryptedSocialCredentials;
  }): DecryptedSocialCredentials;
  encryptOAuthVerifier(params: {
    readonly workspaceId: string;
    readonly transactionId: string;
    readonly platform: SocialPlatform;
    readonly codeVerifier: string;
  }): EncryptedOAuthVerifier;
  decryptOAuthVerifier(params: {
    readonly workspaceId: string;
    readonly transactionId: string;
    readonly platform: SocialPlatform;
    readonly encryptedVerifier: EncryptedOAuthVerifier;
  }): string;
}
