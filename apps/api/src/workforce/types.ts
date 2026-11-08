import type {
  AnalysisPersistencePort,
  CatalogPersistencePort,
  ClockPort,
  IdGeneratorPort,
  WorkforcePersistencePort,
  WorkspaceAuthorizationPort,
} from '@affiliate-content-os/application';
import type { AuthDependencies } from '../auth/index.js';

export interface WorkforceRouteDependencies {
  readonly auth: AuthDependencies;
  readonly workforcePersistence: WorkforcePersistencePort;
  readonly workspaceAuthorization: WorkspaceAuthorizationPort;
  readonly catalogPersistence: CatalogPersistencePort;
  readonly analysisPersistence: AnalysisPersistencePort;
  readonly idGenerator?: IdGeneratorPort | undefined;
  readonly clock?: ClockPort | undefined;
}
