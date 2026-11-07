import crypto from 'node:crypto';
import type pg from 'pg';
import {
  JobLeaseExpiredError,
  type PersistExecutionOutcome,
  type PersistExecutionResultAtomicParams,
  type PersistExecutionTransactionResult,
} from '@affiliate-content-os/application';
import type { SafeFailureCategory } from '@affiliate-content-os/domain';
import { DatabaseError } from '../database/errors.js';
import { insertAnalysisWithConcurrencySafeRevision } from './persist-analysis-helper.js';

export async function executePersistExecutionTransaction(
  client: pg.PoolClient,
  params: PersistExecutionResultAtomicParams,
): Promise<PersistExecutionTransactionResult> {
  // 1. Lock job execution row and perform structural linkage + fencing checks
  const jobRes = await client.query(
    `SELECT id, workspace_id, operation_id, ai_run_id, status, version,
            attempt, max_attempts, repair_attempt, max_repair_attempts,
            lease_owner, lease_expires_at,
            CURRENT_TIMESTAMP AS tx_now
     FROM job_executions
     WHERE id = $1 AND workspace_id = $2
     FOR UPDATE`,
    [params.jobId, params.workspaceId],
  );

  if (jobRes.rows.length === 0) {
    throw new DatabaseError(`Job execution not found: ${params.jobId}`);
  }

  const jobRow = jobRes.rows[0];

  // Structural linkage verification
  if (jobRow.operation_id !== params.operationId || jobRow.ai_run_id !== params.aiRunId) {
    throw new JobLeaseExpiredError(params.jobId);
  }

  // Idempotent terminal redelivery check: only no-op when exact same linkage is terminal
  if (jobRow.status === 'succeeded' || jobRow.status === 'failed') {
    const opCheck = await client.query(
      `SELECT status FROM operations WHERE id = $1 AND workspace_id = $2`,
      [params.operationId, params.workspaceId],
    );
    if (
      opCheck.rows.length > 0 &&
      (opCheck.rows[0].status === 'succeeded' || opCheck.rows[0].status === 'failed')
    ) {
      return jobRow.status === 'succeeded'
        ? { outcome: 'succeeded' }
        : {
            outcome: 'failed',
            errorCategory: (jobRow.last_error_category as SafeFailureCategory) ?? 'internal_error',
          };
    }
    throw new DatabaseError(`Inconsistent terminal state for job ${params.jobId}`);
  }

  // Fencing checks: must be running, owned by worker, non-expired lease, version match
  if (jobRow.status !== 'running') {
    throw new DatabaseError(
      `Job ${params.jobId} is not in running status (current: ${jobRow.status})`,
    );
  }

  if (jobRow.lease_owner !== params.workerId) {
    throw new JobLeaseExpiredError(params.jobId);
  }

  if (Number(jobRow.version) !== params.jobVersion) {
    throw new JobLeaseExpiredError(params.jobId);
  }

  const txNow = new Date(jobRow.tx_now).getTime();
  const leaseExpiresAt = jobRow.lease_expires_at ? new Date(jobRow.lease_expires_at).getTime() : 0;
  if (leaseExpiresAt <= txNow) {
    throw new JobLeaseExpiredError(params.jobId);
  }

  // 2. Lock operation and ai_run rows FOR UPDATE
  const opRes = await client.query(
    `SELECT id, status, version, resource_id, requested_by_user_id
     FROM operations WHERE id = $1 AND workspace_id = $2 FOR UPDATE`,
    [params.operationId, params.workspaceId],
  );
  if (opRes.rows.length === 0) {
    throw new DatabaseError(`Operation not found: ${params.operationId}`);
  }
  const opRow = opRes.rows[0];
  if (params.outcome.kind === 'success') {
    if (opRow.resource_id !== params.outcome.analysis.productId) {
      throw new JobLeaseExpiredError(params.jobId);
    }
    if (opRow.requested_by_user_id !== params.outcome.analysis.createdByUserId) {
      throw new JobLeaseExpiredError(params.jobId);
    }
  } else if ('auditEvent' in params.outcome) {
    const auditActor = params.outcome.auditEvent.actorUserId;
    if (auditActor && params.outcome.auditEvent.actorType !== 'system') {
      if (opRow.requested_by_user_id !== auditActor) {
        throw new JobLeaseExpiredError(params.jobId);
      }
    }
  }
  if (opRow.status === 'succeeded' || opRow.status === 'failed' || opRow.status === 'canceled') {
    throw new DatabaseError(
      `Operation ${params.operationId} is already terminal (${opRow.status})`,
    );
  }

  const runRes = await client.query(
    `SELECT id, status, version FROM ai_runs WHERE id = $1 AND workspace_id = $2 FOR UPDATE`,
    [params.aiRunId, params.workspaceId],
  );
  if (runRes.rows.length === 0) {
    throw new DatabaseError(`AI run not found: ${params.aiRunId}`);
  }
  const runRow = runRes.rows[0];
  if (runRow.status === 'succeeded' || runRow.status === 'failed' || runRow.status === 'canceled') {
    throw new DatabaseError(`AI run ${params.aiRunId} is already terminal (${runRow.status})`);
  }

  // 3. Dispatch outcome atomically
  const { outcome } = params;

  if (outcome.kind === 'success') {
    return handleSuccessOutcome(client, params, outcome, opRow.requested_by_user_id);
  }

  if (outcome.kind === 'retry') {
    // Check retry bounds
    if (Number(jobRow.attempt) < Number(jobRow.max_attempts)) {
      return handleRetryOutcome(client, params, outcome);
    }
    // Attempts exhausted: down-convert to terminal failure
    return handleTerminalFailure(
      client,
      params,
      {
        kind: 'terminal_failure',
        errorCategory: outcome.errorCategory,
        errorCode: 'JOB_RETRY_EXHAUSTED',
        errorMessage:
          'The AI provider service was temporarily unavailable and retry attempts were exhausted',
        reservedMicrounits: outcome.reservedMicrounits,
        actualSpendMicrounits: 0,
        auditEvent: {
          id: crypto.randomUUID(),
          workspaceId: params.workspaceId,
          actorUserId: opRow.requested_by_user_id,
          action: 'ai_analysis.failed',
          resourceType: 'operation',
          resourceId: params.operationId,
          result: 'failed',
          changesJson: {
            error_category: outcome.errorCategory,
            reason: 'Retry attempts exhausted',
          },
        },
      },
      opRow.requested_by_user_id,
    );
  }

  if (outcome.kind === 'repair') {
    // Check repair bounds: max exactly 1 repair attempt
    if (Number(jobRow.repair_attempt) < Number(jobRow.max_repair_attempts)) {
      return handleRepairOutcome(client, params, outcome);
    }
    // Repair exhausted: down-convert to terminal failure
    return handleTerminalFailure(
      client,
      params,
      {
        kind: 'terminal_failure',
        errorCategory: 'invalid_output',
        errorCode: 'INVALID_OUTPUT_REPAIR_EXHAUSTED',
        errorMessage: 'AI structured output repair failed schema validation',
        reservedMicrounits: outcome.reservedMicrounits,
        actualSpendMicrounits: 0,
        auditEvent: {
          id: crypto.randomUUID(),
          workspaceId: params.workspaceId,
          actorUserId: opRow.requested_by_user_id,
          action: 'ai_analysis.failed',
          resourceType: 'operation',
          resourceId: params.operationId,
          result: 'failed',
          changesJson: {
            error_category: 'invalid_output',
            reason: 'Structured output repair exhausted',
          },
        },
      },
      opRow.requested_by_user_id,
    );
  }

  return handleTerminalFailure(client, params, outcome, opRow.requested_by_user_id);
}

async function handleSuccessOutcome(
  client: pg.PoolClient,
  params: PersistExecutionResultAtomicParams,
  outcome: Extract<PersistExecutionOutcome, { kind: 'success' }>,
  requesterUserId?: string,
): Promise<PersistExecutionTransactionResult> {
  // Concurrency-safe analysis insert
  await insertAnalysisWithConcurrencySafeRevision(client, params.workspaceId, outcome.analysis);

  // Update operations
  const opUpdate = await client.query(
    `UPDATE operations
     SET status = 'succeeded',
         progress_percent = 100,
         result_location = $1,
         error_category = NULL,
         error_code = NULL,
         error_message = NULL,
         started_at = COALESCE(started_at, NOW()),
         completed_at = NOW(),
         updated_at = NOW(),
         version = version + 1
     WHERE workspace_id = $2 AND id = $3 AND status IN ('queued', 'running')`,
    [outcome.resultLocation, params.workspaceId, params.operationId],
  );
  if (opUpdate.rowCount !== 1) {
    throw new DatabaseError(`Failed to update operation ${params.operationId} to succeeded`);
  }

  // Update ai_runs
  const runUpdate = await client.query(
    `UPDATE ai_runs
     SET status = 'succeeded',
         output_hash = $1,
         token_input = $2,
         token_output = $3,
         cost_microunits = $4,
         cost_currency = $5,
         latency_ms = $6,
         safety_result = $7,
         error_category = NULL,
         started_at = COALESCE(started_at, NOW()),
         completed_at = NOW(),
         updated_at = NOW(),
         version = version + 1
     WHERE workspace_id = $8 AND id = $9 AND status IN ('queued', 'running')`,
    [
      Buffer.from(outcome.outputHash),
      outcome.usage?.tokenInput ?? null,
      outcome.usage?.tokenOutput ?? null,
      outcome.usage?.costMicrounits ?? null,
      outcome.usage?.costCurrency ?? null,
      outcome.usage?.latencyMs ?? null,
      outcome.safetyResult ?? null,
      params.workspaceId,
      params.aiRunId,
    ],
  );
  if (runUpdate.rowCount !== 1) {
    throw new DatabaseError(`Failed to update AI run ${params.aiRunId} to succeeded`);
  }

  // Update job_executions
  const jobUpdate = await client.query(
    `UPDATE job_executions
     SET status = 'succeeded',
         completed_at = NOW(),
         last_error_category = NULL,
         lease_owner = NULL,
         lease_expires_at = NULL,
         updated_at = NOW(),
         version = version + 1
     WHERE id = $1 AND version = $2 AND status = 'running' AND lease_owner = $3`,
    [params.jobId, params.jobVersion, params.workerId],
  );
  if (jobUpdate.rowCount !== 1) {
    throw new DatabaseError(`Failed to update job execution ${params.jobId} to succeeded`);
  }

  // Settle policy budget: enforce non-negative and verify row count
  await settleBudgetPolicy(
    client,
    params.workspaceId,
    outcome.reservedMicrounits,
    outcome.actualSpendMicrounits,
  );

  // Insert audit event
  await insertAuditEvent(client, outcome.auditEvent, requesterUserId);

  return { outcome: 'succeeded' };
}

async function handleRetryOutcome(
  client: pg.PoolClient,
  params: PersistExecutionResultAtomicParams,
  outcome: Extract<PersistExecutionOutcome, { kind: 'retry' }>,
): Promise<PersistExecutionTransactionResult> {
  const jobUpdate = await client.query(
    `UPDATE job_executions
     SET status = 'retry_wait',
         next_attempt_at = NOW() + ($1 || ' seconds')::INTERVAL,
         last_error_category = $2,
         lease_owner = NULL,
         lease_expires_at = NULL,
         updated_at = NOW(),
         version = version + 1
     WHERE id = $3 AND version = $4 AND status = 'running' AND lease_owner = $5`,
    [
      outcome.retryDelaySeconds,
      outcome.errorCategory,
      params.jobId,
      params.jobVersion,
      params.workerId,
    ],
  );
  if (jobUpdate.rowCount !== 1) {
    throw new DatabaseError(`Failed to schedule retry for job ${params.jobId}`);
  }

  return { outcome: 'retried', delaySeconds: outcome.retryDelaySeconds };
}

async function handleRepairOutcome(
  client: pg.PoolClient,
  params: PersistExecutionResultAtomicParams,
  outcome: Extract<PersistExecutionOutcome, { kind: 'repair' }>,
): Promise<PersistExecutionTransactionResult> {
  const jobUpdate = await client.query(
    `UPDATE job_executions
     SET status = 'retry_wait',
         repair_attempt = repair_attempt + 1,
         next_attempt_at = NOW() + ($1 || ' seconds')::INTERVAL,
         last_error_category = 'invalid_output',
         lease_owner = NULL,
         lease_expires_at = NULL,
         updated_at = NOW(),
         version = version + 1
     WHERE id = $2 AND version = $3 AND status = 'running' AND lease_owner = $4 AND repair_attempt < max_repair_attempts`,
    [outcome.repairDelaySeconds, params.jobId, params.jobVersion, params.workerId],
  );
  if (jobUpdate.rowCount !== 1) {
    throw new DatabaseError(`Failed to schedule repair for job ${params.jobId}`);
  }

  // Record repair flag on AI run within same logical run history
  const runUpdate = await client.query(
    `UPDATE ai_runs
     SET is_repair = TRUE,
         updated_at = NOW(),
         version = version + 1
     WHERE id = $1 AND workspace_id = $2`,
    [params.aiRunId, params.workspaceId],
  );
  if (runUpdate.rowCount !== 1) {
    throw new DatabaseError(`Failed to update AI run repair flag for ${params.aiRunId}`);
  }

  return { outcome: 'repaired', delaySeconds: outcome.repairDelaySeconds };
}

async function handleTerminalFailure(
  client: pg.PoolClient,
  params: PersistExecutionResultAtomicParams,
  outcome: Extract<PersistExecutionOutcome, { kind: 'terminal_failure' }>,
  requesterUserId?: string,
): Promise<PersistExecutionTransactionResult> {
  // Update job_executions
  const jobUpdate = await client.query(
    `UPDATE job_executions
     SET status = 'failed',
         completed_at = NOW(),
         last_error_category = $1,
         lease_owner = NULL,
         lease_expires_at = NULL,
         updated_at = NOW(),
         version = version + 1
     WHERE id = $2 AND version = $3 AND status = 'running' AND lease_owner = $4`,
    [outcome.errorCategory, params.jobId, params.jobVersion, params.workerId],
  );
  if (jobUpdate.rowCount !== 1) {
    throw new DatabaseError(`Failed to update job execution ${params.jobId} to failed`);
  }

  // Update operations with sanitized error codes and messages
  const opUpdate = await client.query(
    `UPDATE operations
     SET status = 'failed',
         error_category = $1,
         error_code = $2,
         error_message = $3,
         started_at = COALESCE(started_at, NOW()),
         completed_at = NOW(),
         updated_at = NOW(),
         version = version + 1
     WHERE workspace_id = $4 AND id = $5 AND status IN ('queued', 'running')`,
    [
      outcome.errorCategory,
      outcome.errorCode,
      outcome.errorMessage,
      params.workspaceId,
      params.operationId,
    ],
  );
  if (opUpdate.rowCount !== 1) {
    throw new DatabaseError(`Failed to update operation ${params.operationId} to failed`);
  }

  // Update ai_runs
  const runUpdate = await client.query(
    `UPDATE ai_runs
     SET status = 'failed',
         error_category = $1,
         token_input = $2,
         token_output = $3,
         cost_microunits = $4,
         cost_currency = $5,
         latency_ms = $6,
         started_at = COALESCE(started_at, NOW()),
         completed_at = NOW(),
         updated_at = NOW(),
         version = version + 1
     WHERE workspace_id = $7 AND id = $8 AND status IN ('queued', 'running')`,
    [
      outcome.errorCategory,
      outcome.usage?.tokenInput ?? null,
      outcome.usage?.tokenOutput ?? null,
      outcome.usage?.costMicrounits ?? null,
      outcome.usage?.costCurrency ?? null,
      outcome.usage?.latencyMs ?? null,
      params.workspaceId,
      params.aiRunId,
    ],
  );
  if (runUpdate.rowCount !== 1) {
    throw new DatabaseError(`Failed to update AI run ${params.aiRunId} to failed`);
  }

  // Release reservation and record spend safely
  await settleBudgetPolicy(
    client,
    params.workspaceId,
    outcome.reservedMicrounits,
    outcome.actualSpendMicrounits,
  );

  // Insert audit event
  await insertAuditEvent(client, outcome.auditEvent, requesterUserId);

  return { outcome: 'failed', errorCategory: outcome.errorCategory };
}

async function settleBudgetPolicy(
  client: pg.PoolClient,
  workspaceId: string,
  reservedMicrounits: number,
  actualSpendMicrounits: number,
): Promise<void> {
  if (reservedMicrounits < 0 || !Number.isSafeInteger(reservedMicrounits)) {
    throw new DatabaseError(`Invalid reserved microunits: ${reservedMicrounits}`);
  }
  if (actualSpendMicrounits < 0 || !Number.isSafeInteger(actualSpendMicrounits)) {
    throw new DatabaseError(`Invalid actual spend microunits: ${actualSpendMicrounits}`);
  }

  const policyRes = await client.query(
    `UPDATE workspace_ai_policies
     SET reserved_spend_microunits = reserved_spend_microunits - $1,
         current_spend_microunits = current_spend_microunits + $2,
         updated_at = NOW(),
         version = version + 1
     WHERE workspace_id = $3 AND reserved_spend_microunits >= $1`,
    [reservedMicrounits, actualSpendMicrounits, workspaceId],
  );

  if (policyRes.rowCount !== 1) {
    throw new DatabaseError(
      `Failed to settle AI budget policy for workspace ${workspaceId}: reservation accounting inconsistency`,
    );
  }
}

async function insertAuditEvent(
  client: pg.PoolClient,
  audit: {
    readonly id: string;
    readonly workspaceId: string;
    readonly actorUserId?: string | null | undefined;
    readonly actorType?: 'user' | 'system' | undefined;
    readonly action: string;
    readonly resourceType: string;
    readonly resourceId: string;
    readonly result: 'succeeded' | 'failed';
    readonly changesJson: Record<string, unknown>;
  },
  fallbackUserId?: string,
): Promise<void> {
  const actorType = audit.actorType ?? (audit.actorUserId ? 'user' : 'system');
  const actorUserId = actorType === 'system' ? null : (audit.actorUserId ?? fallbackUserId ?? null);

  const auditRes = await client.query(
    `INSERT INTO audit_events (
       id, workspace_id, actor_type, actor_user_id, action, resource_type,
       resource_id, result, reason_code, changes_json, occurred_at, created_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, null, $9, NOW(), NOW())`,
    [
      audit.id,
      audit.workspaceId,
      actorType,
      actorUserId,
      audit.action,
      audit.resourceType,
      audit.resourceId,
      audit.result,
      JSON.stringify(audit.changesJson),
    ],
  );
  if (auditRes.rowCount !== 1) {
    throw new DatabaseError(`Failed to insert audit event ${audit.id}`);
  }
}
