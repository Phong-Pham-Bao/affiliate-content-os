import crypto from 'node:crypto';
import { MessageChannel } from 'node:worker_threads';
import { ConfigurationError, type AppConfig, type AIConfig } from '@affiliate-content-os/config';
import type { Database, DatabasePool } from '@affiliate-content-os/infrastructure/database';
import {
  PostgresAnalysisAdapter,
  GeminiAIGatewayAdapter,
} from '@affiliate-content-os/infrastructure/analysis';
import { PostgresJobAdapter } from '@affiliate-content-os/infrastructure/jobs';
import { PostgresCatalogAdapter } from '@affiliate-content-os/infrastructure/catalog';
import type {
  AIGatewayPort,
  AIRunPersistencePort,
  AnalysisPersistencePort,
  CatalogPersistencePort,
  DurableJobQueuePort,
  PersistExecutionResultTransactionPort,
  OperationPersistencePort,
} from '@affiliate-content-os/application';
import { processJobExecution } from './job-processor.js';

export interface WorkerRuntimeHandle {
  readonly ref: () => void;
  readonly close: () => void;
}

export interface WorkerDependencies {
  readonly config: AppConfig;
  readonly aiConfig?: AIConfig | undefined;
  readonly signal: AbortSignal;
  readonly database?: Database | undefined;
  readonly pool?: DatabasePool | undefined;
  readonly workerId?: string | undefined;
  readonly gatewayPort?: AIGatewayPort | undefined;
  readonly jobAdapter?: DurableJobQueuePort | undefined;
  readonly catalogPort?: CatalogPersistencePort | undefined;
  readonly analysisPort?: AnalysisPersistencePort | undefined;
  readonly aiRunPort?: AIRunPersistencePort | undefined;
  readonly operationPort?: OperationPersistencePort | undefined;
  readonly persistTxPort?: PersistExecutionResultTransactionPort | undefined;
  readonly onStarted?: (() => void) | undefined;
  readonly runtimeHandle?: WorkerRuntimeHandle | undefined;
  readonly once?: boolean | undefined;
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      resolve();
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function waitInIdleHandle(deps: WorkerDependencies): Promise<void> {
  return new Promise<void>((resolve) => {
    let defaultChannel: MessageChannel | undefined;
    const handle = deps.runtimeHandle ?? {
      ref: () => defaultChannel?.port1.ref(),
      close: () => {
        defaultChannel?.port1.close();
        defaultChannel?.port2.close();
      },
    };
    if (!deps.runtimeHandle) defaultChannel = new MessageChannel();
    handle.ref();

    const onAbort = () => {
      deps.signal.removeEventListener('abort', onAbort);
      try {
        handle.close();
      } finally {
        resolve();
      }
    };
    deps.signal.addEventListener('abort', onAbort, { once: true });
  });
}

export async function runWorker(deps: WorkerDependencies): Promise<void> {
  if (deps.signal.aborted) return;

  if (deps.aiConfig?.enabled && !deps.gatewayPort && !deps.aiConfig.geminiApiKey) {
    throw new ConfigurationError([
      {
        field: 'GEMINI_API_KEY',
        message: 'Worker cannot start: AI is enabled but GEMINI_API_KEY is missing',
      },
    ]);
  }

  deps.onStarted?.();

  const workerId = deps.workerId ?? `worker-${crypto.randomUUID()}`;
  const leaseDurationSeconds = deps.aiConfig?.workerLeaseDurationSeconds ?? 30;
  const pollingIntervalMs = deps.aiConfig?.workerPollingIntervalMs ?? 2000;

  const pool = deps.pool ?? deps.database?.pool;
  const jobAdapter = deps.jobAdapter ?? (pool ? new PostgresJobAdapter(pool) : undefined);
  const catalogPort =
    deps.catalogPort ?? (deps.database ? new PostgresCatalogAdapter(deps.database) : undefined);
  const analysisAdapter = pool ? new PostgresAnalysisAdapter(pool) : undefined;
  const analysisPort: AnalysisPersistencePort | undefined = deps.analysisPort ?? analysisAdapter;
  const aiRunPort: AIRunPersistencePort | undefined = deps.aiRunPort ?? analysisAdapter;
  const operationPort: OperationPersistencePort | undefined = deps.operationPort ?? analysisAdapter;
  const persistTxPort: PersistExecutionResultTransactionPort | undefined =
    deps.persistTxPort ?? analysisAdapter;

  let gatewayPort = deps.gatewayPort;
  if (!gatewayPort && deps.aiConfig?.enabled && deps.aiConfig.geminiApiKey) {
    gatewayPort = new GeminiAIGatewayAdapter({ config: deps.aiConfig });
  }

  if (
    !jobAdapter ||
    !catalogPort ||
    !analysisPort ||
    !aiRunPort ||
    !operationPort ||
    !persistTxPort ||
    !deps.aiConfig?.enabled ||
    !gatewayPort
  ) {
    return waitInIdleHandle(deps);
  }

  while (!deps.signal.aborted) {
    let claimedJob: Awaited<ReturnType<typeof jobAdapter.claimNextJob>>;
    try {
      claimedJob = await jobAdapter.claimNextJob({ workerId, leaseDurationSeconds });
    } catch {
      if (deps.signal.aborted) break;
      await delay(Math.min(pollingIntervalMs, 5000), deps.signal);
      continue;
    }

    if (claimedJob) {
      try {
        await processJobExecution(claimedJob, {
          workerId,
          gatewayPort,
          catalogPort,
          analysisPort,
          aiRunPort,
          operationPort,
          persistTxPort,
          pool,
        });
      } catch {
        if (claimedJob.jobType !== 'workforce_planning') {
          await persistTxPort.persistExecutionResultAtomic({
            workspaceId: claimedJob.workspaceId,
            operationId: claimedJob.operationId,
            aiRunId: claimedJob.aiRunId,
            jobId: claimedJob.id,
            jobVersion: claimedJob.version,
            workerId,
            outcome: {
              kind: 'terminal_failure',
              errorCategory: 'internal_error',
              errorCode: 'UNHANDLED_PROCESS_FAILURE',
              errorMessage: 'An unexpected process error occurred during job execution',
              reservedMicrounits: claimedJob.reservedSpendMicrounits,
              actualSpendMicrounits: 0,
              auditEvent: {
                id: crypto.randomUUID(),
                workspaceId: claimedJob.workspaceId,
                actorUserId: null,
                actorType: 'system',
                action: 'ai_analysis.failed',
                resourceType: 'operation',
                resourceId: claimedJob.operationId,
                result: 'failed',
                changesJson: { error_code: 'UNHANDLED_PROCESS_FAILURE' },
              },
            },
          });
        }
      }
      if (deps.once) break;
      continue;
    }

    if (deps.once) break;
    await delay(pollingIntervalMs, deps.signal);
  }
}
