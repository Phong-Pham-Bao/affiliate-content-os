import crypto from 'node:crypto';
import { MessageChannel } from 'node:worker_threads';
import {
  ConfigurationError,
  type AppConfig,
  type AIConfig,
  type SocialConfig,
} from '@affiliate-content-os/config';
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
  SocialAuthAdapter,
  SocialCredentialProtectorPort,
  SocialPersistencePort,
} from '@affiliate-content-os/application';
import {
  maintainDueSocialAccounts,
  processDueSocialAccountRevocations,
} from '@affiliate-content-os/application';
import type { SocialPlatform } from '@affiliate-content-os/domain';
import { processJobExecution } from './job-processor.js';

export interface WorkerRuntimeHandle {
  readonly ref: () => void;
  readonly close: () => void;
}

export interface WorkerDependencies {
  readonly config: AppConfig;
  readonly aiConfig?: AIConfig | undefined;
  readonly socialConfig?: SocialConfig | undefined;
  readonly socialPersistence?: SocialPersistencePort | undefined;
  readonly credentialProtector?: SocialCredentialProtectorPort | undefined;
  readonly socialAdapters?: ReadonlyMap<SocialPlatform, SocialAuthAdapter> | undefined;
  readonly socialMaintenanceEnabled?: boolean | undefined;
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

  const canRunAI = Boolean(
    jobAdapter &&
    catalogPort &&
    analysisPort &&
    aiRunPort &&
    operationPort &&
    persistTxPort &&
    deps.aiConfig?.enabled &&
    gatewayPort,
  );

  const isMaintenanceActive = Boolean(
    deps.socialMaintenanceEnabled ?? deps.socialConfig?.socialMaintenanceEnabled,
  );

  if (isMaintenanceActive) {
    if (
      !deps.socialConfig?.enabled ||
      !deps.socialPersistence ||
      !deps.credentialProtector ||
      !deps.socialAdapters ||
      deps.socialAdapters.size === 0
    ) {
      throw new ConfigurationError([
        {
          field: 'SOCIAL_MAINTENANCE_ENABLED',
          message:
            'Worker cannot start: social maintenance is enabled but social configuration or dependencies are missing or invalid',
        },
      ]);
    }
  }

  const canRunMaintenance = Boolean(
    isMaintenanceActive &&
    deps.socialConfig?.enabled &&
    !deps.socialConfig.socialKillSwitchActive &&
    !deps.socialConfig.threadsRefreshKillSwitchActive &&
    deps.socialPersistence &&
    deps.credentialProtector &&
    deps.socialAdapters,
  );

  if (!canRunAI && !canRunMaintenance) {
    return waitInIdleHandle(deps);
  }

  while (!deps.signal.aborted) {
    let hadWork = false;

    // 1. Social maintenance due accounts execution (if enabled and fail-closed checks pass)
    if (
      canRunMaintenance &&
      deps.socialPersistence &&
      deps.credentialProtector &&
      deps.socialAdapters
    ) {
      try {
        const maintResult = await maintainDueSocialAccounts(
          { workerId, maxBatchSize: 5 },
          {
            persistence: deps.socialPersistence,
            protector: deps.credentialProtector,
            adapters: deps.socialAdapters,
            enabled: true,
            socialKillSwitchActive: deps.socialConfig?.socialKillSwitchActive,
            threadsRefreshKillSwitchActive: deps.socialConfig?.threadsRefreshKillSwitchActive,
            appReviewStatus: deps.socialConfig?.threadsAppReviewStatus,
            threadsHttpTimeoutMs: deps.socialConfig?.threadsHttpTimeoutMs,
            clock: { now: () => new Date() },
          },
        );
        if (maintResult.processedCount > 0) {
          hadWork = true;
        }

        const revokeResult = await processDueSocialAccountRevocations(
          { workerId, maxBatchSize: 5 },
          {
            persistence: deps.socialPersistence,
            protector: deps.credentialProtector,
            adapters: deps.socialAdapters,
            enabled: true,
            socialKillSwitchActive: deps.socialConfig?.socialKillSwitchActive,
            clock: { now: () => new Date() },
          },
        );
        if (revokeResult.processedCount > 0) {
          hadWork = true;
        }
      } catch {
        // Individual maintenance errors handled within use case; worker continues loop
      }
    }

    // 2. AI analysis / workforce jobs execution
    if (
      canRunAI &&
      jobAdapter &&
      catalogPort &&
      analysisPort &&
      aiRunPort &&
      operationPort &&
      persistTxPort &&
      gatewayPort
    ) {
      let claimedJob: Awaited<ReturnType<typeof jobAdapter.claimNextJob>>;
      try {
        claimedJob = await jobAdapter.claimNextJob({ workerId, leaseDurationSeconds });
      } catch {
        if (deps.signal.aborted) break;
        await delay(Math.min(pollingIntervalMs, 5000), deps.signal);
        continue;
      }

      if (claimedJob) {
        hadWork = true;
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
      }
    }

    if (deps.once) break;
    if (!hadWork) {
      await delay(pollingIntervalMs, deps.signal);
    }
  }
}
