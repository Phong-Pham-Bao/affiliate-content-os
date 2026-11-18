import type { SocialPlatform } from '@affiliate-content-os/domain';

export function buildCredentialAad(
  workspaceId: string,
  socialAccountId: string,
  platform: SocialPlatform,
  purpose: 'access_token' | 'refresh_token',
  keyVersion: string,
): Buffer {
  return Buffer.from(
    `acos:social-credential:v1:${workspaceId}:${socialAccountId}:${platform}:${purpose}:${keyVersion}`,
    'utf8',
  );
}

export function buildVerifierAad(
  workspaceId: string,
  transactionId: string,
  platform: SocialPlatform,
  keyVersion: string,
): Buffer {
  return Buffer.from(
    `acos:oauth-pkce-verifier:v1:${workspaceId}:${transactionId}:${platform}:${keyVersion}`,
    'utf8',
  );
}
