import type {
  CatalogPersistencePort,
  ClockPort,
  IdGeneratorPort,
  WorkspaceAuthorizationPort,
} from '@affiliate-content-os/application';
import type { AuthDependencies } from '../auth/types.js';

export interface CatalogRouteDependencies {
  readonly auth: AuthDependencies;
  readonly catalogPersistence: CatalogPersistencePort;
  readonly workspaceAuthorization: WorkspaceAuthorizationPort;
  readonly clock?: ClockPort | undefined;
  readonly idGenerator?: IdGeneratorPort | undefined;
}
