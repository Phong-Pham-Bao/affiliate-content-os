import type {
  ClockPort,
  IdGeneratorPort,
  UserDirectoryPort,
  WorkspaceAuthorizationPort,
  WorkspacePersistencePort,
} from '@affiliate-content-os/application';
import type { AuthDependencies } from '../auth/types.js';

export interface WorkspaceRouteDependencies {
  readonly auth: AuthDependencies;
  readonly workspacePersistence: WorkspacePersistencePort;
  readonly workspaceAuthorization: WorkspaceAuthorizationPort;
  readonly userDirectory: UserDirectoryPort;
  readonly clock?: ClockPort | undefined;
  readonly idGenerator?: IdGeneratorPort | undefined;
}
