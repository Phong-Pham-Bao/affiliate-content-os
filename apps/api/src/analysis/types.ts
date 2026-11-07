import type {
  AnalysisPersistencePort,
  AIRunPersistencePort,
  CatalogPersistencePort,
  ClockPort,
  EnqueueAnalysisTransactionPort,
  IdGeneratorPort,
  OperationPersistencePort,
  PersistExecutionResultTransactionPort,
  WorkspaceAIPolicyPort,
  WorkspaceAuthorizationPort,
} from '@affiliate-content-os/application';
import type { AIModelConfiguration } from '@affiliate-content-os/domain';
import type { AuthDependencies } from '../auth/types.js';

export interface AnalysisRouteDependencies {
  readonly auth: AuthDependencies;
  readonly workspaceAuthorization: WorkspaceAuthorizationPort;
  readonly catalogPersistence: CatalogPersistencePort;
  readonly analysisPersistence: AnalysisPersistencePort;
  readonly aiRunPersistence: AIRunPersistencePort;
  readonly operationPersistence: OperationPersistencePort;
  readonly enqueueTxPort: EnqueueAnalysisTransactionPort;
  readonly persistTxPort?: PersistExecutionResultTransactionPort | undefined;
  readonly aiPolicyPort?: WorkspaceAIPolicyPort | undefined;
  readonly aiModelConfig?: AIModelConfiguration | undefined;
  readonly clock?: ClockPort | undefined;
  readonly idGenerator?: IdGeneratorPort | undefined;
}
