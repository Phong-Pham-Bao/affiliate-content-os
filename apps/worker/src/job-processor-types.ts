import type { DatabasePool } from '@affiliate-content-os/infrastructure/database';
import type {
  AIGatewayPort,
  AIAnalysisGatewayResult,
  AIRunPersistencePort,
  AnalysisPersistencePort,
  CatalogPersistencePort,
  ClockPort,
  PersistExecutionResultTransactionPort,
  OperationPersistencePort,
} from '@affiliate-content-os/application';

export interface JobProcessorDependencies {
  readonly workerId: string;
  readonly gatewayPort: AIGatewayPort;
  readonly catalogPort: CatalogPersistencePort;
  readonly analysisPort: AnalysisPersistencePort;
  readonly aiRunPort: AIRunPersistencePort;
  readonly operationPort: OperationPersistencePort;
  readonly persistTxPort: PersistExecutionResultTransactionPort;
  readonly clock?: ClockPort | undefined;
  readonly pool?: DatabasePool | undefined;
}

export type { AIAnalysisGatewayResult };
