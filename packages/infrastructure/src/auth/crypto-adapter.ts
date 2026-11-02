import type {
  AuthCryptoPort,
  EncryptedSecretsDTO,
  LoginSecretsPayloadDTO,
} from '@affiliate-content-os/application';
import {
  generateSecureRandomBytes,
  LoginTransactionSecretsProtector,
  sha256,
  toCanonicalBase64Url,
} from './crypto.js';

export class InfrastructureAuthCryptoAdapter implements AuthCryptoPort {
  private readonly protector: LoginTransactionSecretsProtector;

  constructor(encryptionKeyBase64Url: string, keyVersion: string) {
    this.protector = new LoginTransactionSecretsProtector(encryptionKeyBase64Url, keyVersion);
  }

  generateRandomToken(): string {
    return toCanonicalBase64Url(generateSecureRandomBytes(32));
  }

  hashToken(token: string): Uint8Array {
    return sha256(token);
  }

  generateState(): { readonly raw: string; readonly hash: Uint8Array } {
    const raw = toCanonicalBase64Url(generateSecureRandomBytes(32));
    const hash = sha256(raw);
    return { raw, hash };
  }

  generateBrowserBinding(): { readonly raw: string; readonly hash: Uint8Array } {
    const raw = toCanonicalBase64Url(generateSecureRandomBytes(32));
    const hash = sha256(raw);
    return { raw, hash };
  }

  generateNonce(): string {
    return toCanonicalBase64Url(generateSecureRandomBytes(32));
  }

  generatePkce(): { readonly verifier: string; readonly challenge: string } {
    const verifier = toCanonicalBase64Url(generateSecureRandomBytes(32));
    const challenge = toCanonicalBase64Url(sha256(verifier));
    return { verifier, challenge };
  }

  encryptSecrets(txId: string, payload: LoginSecretsPayloadDTO): EncryptedSecretsDTO {
    return this.protector.encrypt(txId, payload);
  }

  decryptSecrets(txId: string, encrypted: EncryptedSecretsDTO): LoginSecretsPayloadDTO {
    return this.protector.decrypt(txId, encrypted);
  }
}

export function createAuthCryptoAdapter(
  encryptionKeyBase64Url: string,
  keyVersion: string,
): AuthCryptoPort {
  return new InfrastructureAuthCryptoAdapter(encryptionKeyBase64Url, keyVersion);
}
