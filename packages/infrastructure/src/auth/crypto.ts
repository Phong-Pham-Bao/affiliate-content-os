import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

export interface EncryptedLoginSecrets {
  readonly ciphertext: Uint8Array;
  readonly iv: Uint8Array;
  readonly authTag: Uint8Array;
  readonly keyVersion: string;
}

export interface LoginSecretsPayload {
  readonly pkceVerifier: string;
  readonly nonce: string;
}

export class CryptoOperationError extends Error {
  public override readonly name = 'CryptoOperationError';
  constructor();
  constructor(..._args: unknown[]) {
    super('Cryptographic operation failed');
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export function generateSecureRandomBytes(byteCount: number): Uint8Array {
  if (!Number.isSafeInteger(byteCount) || byteCount <= 0 || byteCount > 1024) {
    throw new CryptoOperationError();
  }
  const buf = randomBytes(byteCount);
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

export function toCanonicalBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64url');
}

export function fromCanonicalBase64Url(
  base64urlStr: string,
  expectedByteLength?: number,
): Uint8Array {
  if (typeof base64urlStr !== 'string' || base64urlStr.includes('=')) {
    throw new CryptoOperationError();
  }
  const buf = Buffer.from(base64urlStr, 'base64url');
  if (expectedByteLength !== undefined && buf.length !== expectedByteLength) {
    throw new CryptoOperationError();
  }
  if (buf.toString('base64url') !== base64urlStr) {
    throw new CryptoOperationError();
  }
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

export function sha256(data: string | Uint8Array): Uint8Array {
  const hash = createHash('sha256');
  if (typeof data === 'string') {
    hash.update(data, 'utf8');
  } else {
    hash.update(Buffer.from(data.buffer, data.byteOffset, data.byteLength));
  }
  const digest = hash.digest();
  return new Uint8Array(digest.buffer, digest.byteOffset, digest.byteLength);
}

function buildAad(transactionId: string, keyVersion: string): Buffer {
  return Buffer.from(`acos:oidc-login:v1:${transactionId}:${keyVersion}`, 'utf8');
}

export class LoginTransactionSecretsProtector {
  private readonly keyBytes: Buffer;
  private readonly keyVersion: string;

  constructor(keyBase64Url: string, keyVersion: string) {
    if (typeof keyVersion !== 'string' || !/^[A-Za-z0-9._-]{1,64}$/.test(keyVersion)) {
      throw new CryptoOperationError();
    }
    const decoded = fromCanonicalBase64Url(keyBase64Url, 32);
    this.keyBytes = Buffer.from(decoded);
    this.keyVersion = keyVersion;
  }

  public encrypt(transactionId: string, payload: LoginSecretsPayload): EncryptedLoginSecrets {
    if (typeof transactionId !== 'string' || transactionId.trim() === '') {
      throw new CryptoOperationError();
    }
    if (
      typeof payload?.pkceVerifier !== 'string' ||
      payload.pkceVerifier.length === 0 ||
      typeof payload?.nonce !== 'string' ||
      payload.nonce.length === 0
    ) {
      throw new CryptoOperationError();
    }

    try {
      const plaintext = JSON.stringify({
        pkceVerifier: payload.pkceVerifier,
        nonce: payload.nonce,
      });

      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', this.keyBytes, iv);
      const aad = buildAad(transactionId, this.keyVersion);
      cipher.setAAD(aad);

      const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      const authTag = cipher.getAuthTag();

      return {
        ciphertext: new Uint8Array(ciphertext.buffer, ciphertext.byteOffset, ciphertext.byteLength),
        iv: new Uint8Array(iv.buffer, iv.byteOffset, iv.byteLength),
        authTag: new Uint8Array(authTag.buffer, authTag.byteOffset, authTag.byteLength),
        keyVersion: this.keyVersion,
      };
    } catch {
      throw new CryptoOperationError();
    }
  }

  public decrypt(transactionId: string, encrypted: EncryptedLoginSecrets): LoginSecretsPayload {
    if (encrypted.keyVersion !== this.keyVersion) {
      throw new CryptoOperationError();
    }
    if (encrypted.iv.length !== 12 || encrypted.authTag.length !== 16) {
      throw new CryptoOperationError();
    }

    try {
      const iv = Buffer.from(encrypted.iv.buffer, encrypted.iv.byteOffset, encrypted.iv.byteLength);
      const authTag = Buffer.from(
        encrypted.authTag.buffer,
        encrypted.authTag.byteOffset,
        encrypted.authTag.byteLength,
      );
      const ciphertext = Buffer.from(
        encrypted.ciphertext.buffer,
        encrypted.ciphertext.byteOffset,
        encrypted.ciphertext.byteLength,
      );

      const decipher = createDecipheriv('aes-256-gcm', this.keyBytes, iv);
      const aad = buildAad(transactionId, this.keyVersion);
      decipher.setAAD(aad);
      decipher.setAuthTag(authTag);

      const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      const parsed = JSON.parse(decrypted.toString('utf8'));

      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        typeof parsed.pkceVerifier !== 'string' ||
        typeof parsed.nonce !== 'string'
      ) {
        throw new CryptoOperationError();
      }

      return {
        pkceVerifier: parsed.pkceVerifier,
        nonce: parsed.nonce,
      };
    } catch {
      throw new CryptoOperationError();
    }
  }
}
