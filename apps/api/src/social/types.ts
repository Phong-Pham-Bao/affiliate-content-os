import type { SocialConfig } from '@affiliate-content-os/config';
import type { SocialPlatform } from '@affiliate-content-os/domain';
import type {
  ClockPort,
  IdGeneratorPort,
  IdempotencyStorePort,
  SocialAuthAdapter,
  SocialCredentialProtectorPort,
  SocialPersistencePort,
  WorkspaceAuthorizationPort,
} from '@affiliate-content-os/application';
import type { AuthDependencies } from '../auth/types.js';

export interface SocialRouteDependencies {
  readonly auth: AuthDependencies;
  readonly socialConfig: SocialConfig;
  readonly socialPersistence: SocialPersistencePort;
  readonly credentialProtector?: SocialCredentialProtectorPort | undefined;
  readonly authAdapters: ReadonlyMap<SocialPlatform, SocialAuthAdapter>;
  readonly workspaceAuthorization: WorkspaceAuthorizationPort;
  readonly idempotencyStore?: IdempotencyStorePort | undefined;
  readonly clock?: ClockPort | undefined;
  readonly idGenerator?: IdGeneratorPort | undefined;
}
