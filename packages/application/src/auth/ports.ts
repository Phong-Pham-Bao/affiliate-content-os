import type { UserSnapshot } from '@affiliate-content-os/domain';

export interface EncryptedSecretsDTO {
  readonly ciphertext: Uint8Array;
  readonly iv: Uint8Array;
  readonly authTag: Uint8Array;
  readonly keyVersion: string;
}

export interface LoginSecretsPayloadDTO {
  readonly pkceVerifier: string;
  readonly nonce: string;
}

export interface ConsumedLoginTransactionDTO {
  readonly id: string;
  readonly keyVersion: string;
  readonly returnTo: string;
  readonly encryptedSecrets: EncryptedSecretsDTO;
  readonly createdAt: string;
  readonly expiresAt: string;
}

export interface SessionSnapshotDTO {
  readonly id: string;
  readonly userId: string;
  readonly currentTokenHash: Uint8Array | null;
  readonly previousTokenHash: Uint8Array | null;
  readonly previousTokenValidUntil: string | null;
  readonly createdAt: string;
  readonly lastSeenAt: string;
  readonly idleExpiresAt: string;
  readonly absoluteExpiresAt: string;
  readonly rotatedAt: string;
  readonly revokedAt: string | null;
  readonly revocationReason: string | null;
  readonly version: number;
}

export interface WorkspaceSummaryItemDTO {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly timezone: string;
  readonly role: 'owner' | 'editor' | 'viewer';
}

export interface ActiveWorkspaceSummariesDTO {
  readonly items: readonly WorkspaceSummaryItemDTO[];
  readonly hasMore: boolean;
}

export interface VerifiedOidcClaimsDTO {
  readonly issuer: string;
  readonly subject: string;
  readonly email: string | null;
  readonly displayName: string | null;
}

export interface AuthCryptoPort {
  generateRandomToken(): string;
  hashToken(token: string): Uint8Array;
  generateState(): { readonly raw: string; readonly hash: Uint8Array };
  generateBrowserBinding(): { readonly raw: string; readonly hash: Uint8Array };
  generateNonce(): string;
  generatePkce(): { readonly verifier: string; readonly challenge: string };
  encryptSecrets(txId: string, payload: LoginSecretsPayloadDTO): EncryptedSecretsDTO;
  decryptSecrets(txId: string, encrypted: EncryptedSecretsDTO): LoginSecretsPayloadDTO;
}

export interface LoginTransactionStorePort {
  createPendingTransaction(params: {
    readonly id: string;
    readonly stateHash: Uint8Array;
    readonly browserBindingHash: Uint8Array;
    readonly encryptedSecrets: EncryptedSecretsDTO;
    readonly returnTo: string;
    readonly createdAt: string;
    readonly expiresAt: string;
  }): Promise<void>;

  consumePendingTransaction(params: {
    readonly stateHash: Uint8Array;
    readonly browserBindingHash: Uint8Array;
    readonly now: string;
  }): Promise<ConsumedLoginTransactionDTO | null>;
}

export interface SessionStorePort {
  createSession(params: {
    readonly id: string;
    readonly userId: string;
    readonly currentTokenHash: Uint8Array;
    readonly createdAt: string;
    readonly lastSeenAt: string;
    readonly idleExpiresAt: string;
    readonly absoluteExpiresAt: string;
    readonly rotatedAt: string;
  }): Promise<void>;

  findCandidateSessions(params: {
    readonly tokenHash: Uint8Array;
    readonly now: string;
  }): Promise<readonly SessionSnapshotDTO[]>;

  findUserById?(userId: string): Promise<UserSnapshot | null>;

  rotateSession(params: {
    readonly sessionId: string;
    readonly currentVersion: number;
    readonly newCurrentHash: Uint8Array;
    readonly oldCurrentHash: Uint8Array;
    readonly graceValidUntil: string;
    readonly rotatedAt: string;
    readonly lastSeenAt: string;
    readonly idleExpiresAt: string;
  }): Promise<void>;

  touchSession(params: {
    readonly sessionId: string;
    readonly currentVersion: number;
    readonly lastSeenAt: string;
    readonly idleExpiresAt: string;
  }): Promise<void>;

  revokeSession(params: {
    readonly sessionId: string;
    readonly currentVersion: number;
    readonly revokedAt: string;
    readonly reason: string;
  }): Promise<void>;

  revokeMatchingSessionsByTokenHash(params: {
    readonly tokenHash: Uint8Array;
    readonly revokedAt: string;
    readonly reason: string;
  }): Promise<void>;

  withTransaction<T>(fn: (txStore: SessionStorePort) => Promise<T>): Promise<T>;
}

export interface OidcProtocolPort {
  buildAuthorizationUrl(params: {
    readonly state: string;
    readonly nonce: string;
    readonly codeChallenge: string;
  }): string;

  exchangeCodeAndValidateIdToken(params: {
    readonly code: string;
    readonly pkceVerifier: string;
    readonly nonce: string;
  }): Promise<VerifiedOidcClaimsDTO>;
}

export interface WorkspaceSummaryPort {
  listActiveWorkspaceSummaries(userId: string): Promise<ActiveWorkspaceSummariesDTO>;
}
