import type pg from 'pg';
import type {
  AIUsageSnapshot,
  DomainEvidenceReference,
  SafeFailureCategory,
  SingleVideoScript,
} from '@affiliate-content-os/domain';
import { DatabaseError } from '../database/errors.js';
import { assembleScriptPackageInitialAtomic } from './workforce-script-assembly.js';
import { assembleScriptPackageChangeRequestAtomic } from './workforce-change-request-assembly.js';

export type ScriptUnitOutcome =
  | {
      readonly kind: 'success';
      readonly contentJson: SingleVideoScript;
      readonly contentHash: Uint8Array;
      readonly schemaVersion: number;
      readonly promptTemplate: string;
      readonly promptVersion: string;
      readonly provider: string;
      readonly model: string;
      readonly usage: AIUsageSnapshot;
      readonly evidenceReferences: readonly DomainEvidenceReference[];
    }
  | {
      readonly kind: 'transient_failure';
      readonly errorCategory: SafeFailureCategory;
      readonly errorMessage: string;
      readonly nextAttemptAt: Date;
    }
  | {
      readonly kind: 'repair';
      readonly errorCategory: SafeFailureCategory;
      readonly errorMessage: string;
      readonly repairDelaySeconds: number;
    }
  | {
      readonly kind: 'terminal_failure';
      readonly errorCategory: SafeFailureCategory;
      readonly errorCode: string;
      readonly errorMessage: string;
    };

export interface SettleScriptUnitParams {
  readonly workspaceId: string;
  readonly productId: string;
  readonly workOrderId: string;
  readonly workItemId: string;
  readonly assignmentId: string;
  readonly jobId: string;
  readonly jobVersion: number;
  readonly operationId: string;
  readonly aiRunId: string;
  readonly workerId: string;
  readonly videoNumber: number;
  readonly changeRequestId: string | null;
  readonly reservedMicrounits: number;
  readonly outcome: ScriptUnitOutcome;
}

export async function settleScriptUnitAtomic(
  client: pg.PoolClient,
  params: SettleScriptUnitParams,
): Promise<void> {
  const {
    workspaceId,
    productId,
    workOrderId,
    workItemId,
    assignmentId,
    jobId,
    jobVersion,
    operationId,
    aiRunId,
    workerId,
    videoNumber,
    reservedMicrounits,
    outcome,
    changeRequestId,
  } = params;

  if (outcome.kind === 'success') {
    // 1. Lease fencing on job_executions FIRST before any durable side effect or budget settlement
    const jobRes = await client.query(
      `UPDATE job_executions
       SET status = 'succeeded', completed_at = NOW(), lease_owner = NULL,
           lease_expires_at = NULL, last_error_category = NULL, reserved_spend_microunits = 0,
           updated_at = NOW(), version = version + 1
       WHERE id = $1 AND workspace_id = $2 AND version = $3 AND status = 'running' AND lease_owner = $4`,
      [jobId, workspaceId, jobVersion, workerId],
    );
    if (jobRes.rowCount !== 1) {
      throw new DatabaseError(
        `Lease fencing conflict on job ${jobId}: stale lease, wrong status, or wrong owner`,
      );
    }

    const actualCost = outcome.usage.costMicrounits ?? 0;
    if (actualCost < 0 || !Number.isSafeInteger(actualCost) || actualCost > reservedMicrounits) {
      throw new DatabaseError(
        `Invalid actualCost ${actualCost} for reserved ${reservedMicrounits}`,
      );
    }

    // 2. Settle budget atomically (prevent negative reserved spend, exactly 1 row)
    const policyRes = await client.query(
      `UPDATE workspace_ai_policies
       SET current_spend_microunits = current_spend_microunits + $1,
           reserved_spend_microunits = reserved_spend_microunits - $2,
           updated_at = NOW(),
           version = version + 1
       WHERE workspace_id = $3 AND reserved_spend_microunits >= $2`,
      [actualCost, reservedMicrounits, workspaceId],
    );
    if (policyRes.rowCount !== 1) {
      throw new DatabaseError(
        `Failed to settle workspace AI policy reservation: insufficient reserved spend in workspace ${workspaceId}`,
      );
    }

    // 3. Update operation & ai_run with exact provider provenance
    const resultLocation = `/workspaces/${workspaceId}/products/${productId}/script-units/video-${videoNumber}`;
    const opRes = await client.query(
      `UPDATE operations
       SET status = 'succeeded',
           progress_percent = 100,
           result_location = $1,
           started_at = COALESCE(started_at, NOW()),
           completed_at = NOW(),
           error_category = NULL,
           error_code = NULL,
           error_message = NULL,
           updated_at = NOW(),
           version = version + 1
       WHERE id = $2 AND workspace_id = $3 AND status IN ('queued', 'running', 'pending')`,
      [resultLocation, operationId, workspaceId],
    );
    if (opRes.rowCount !== 1) {
      throw new DatabaseError(`Failed to update operation ${operationId} to succeeded`);
    }

    const runRes = await client.query(
      `UPDATE ai_runs
       SET status = 'succeeded',
           provider = $1,
           model = $2,
           prompt_template = $3,
           prompt_version = $4,
           output_hash = $5,
           token_input = $6,
           token_output = $7,
           cost_microunits = $8,
           cost_currency = $9,
           latency_ms = $10,
           started_at = COALESCE(started_at, NOW()),
           completed_at = NOW(),
           error_category = NULL,
           updated_at = NOW(),
           version = version + 1
       WHERE id = $11 AND workspace_id = $12 AND status IN ('queued', 'running')`,
      [
        outcome.provider,
        outcome.model,
        outcome.promptTemplate,
        outcome.promptVersion,
        Buffer.from(outcome.contentHash),
        outcome.usage.tokenInput ?? null,
        outcome.usage.tokenOutput ?? null,
        actualCost,
        outcome.usage.costCurrency ?? 'USD',
        outcome.usage.latencyMs ?? null,
        aiRunId,
        workspaceId,
      ],
    );
    if (runRes.rowCount !== 1) {
      throw new DatabaseError(`Failed to update ai_run ${aiRunId} to succeeded`);
    }

    // 4. Update script_generation_units
    const unitRes = await client.query(
      `UPDATE script_generation_units
       SET status = 'succeeded', output_json = $1::jsonb, content_hash = $2,
           updated_at = NOW(), version = version + 1
       WHERE job_id = $3 AND workspace_id = $4 AND status IN ('queued', 'running', 'retry_wait')`,
      [JSON.stringify(outcome.contentJson), Buffer.from(outcome.contentHash), jobId, workspaceId],
    );
    if (unitRes.rowCount !== 1) {
      throw new DatabaseError(
        `Failed to update script_generation_unit for job ${jobId} to succeeded`,
      );
    }

    // 5. Attempt assembly
    if (changeRequestId) {
      await assembleScriptPackageChangeRequestAtomic(client, { workspaceId, changeRequestId });
    } else {
      try {
        await assembleScriptPackageInitialAtomic(client, {
          workspaceId,
          productId,
          workOrderId,
          workItemId,
          assignmentId,
        });
      } catch (asmErr) {
        if (asmErr instanceof Error && asmErr.message.includes('Authoritative context drift')) {
          await client.query(
            `UPDATE work_items
             SET status = 'failed', completed_at = NOW(), updated_at = NOW(), version = version + 1
             WHERE id = $1 AND workspace_id = $2 AND status IN ('queued', 'running', 'pending')`,
            [workItemId, workspaceId],
          );
          await client.query(
            `UPDATE agent_assignments
             SET office_state = 'failed', updated_at = NOW(), version = version + 1
             WHERE id = $1 AND workspace_id = $2 AND office_state = 'running'`,
            [assignmentId, workspaceId],
          );
          await client.query(
            `UPDATE work_orders
             SET status = 'failed', completed_at = NOW(), failure_category = 'invalid_evidence',
                 failure_reason = 'Authoritative context drift: planning revisions changed after content brief synthesis',
                 updated_at = NOW(), version = version + 1
             WHERE id = $1 AND workspace_id = $2 AND status = 'in_progress'`,
            [workOrderId, workspaceId],
          );
          return;
        }
        throw asmErr;
      }
    }
  } else if (outcome.kind === 'transient_failure') {
    // Lease fencing on job_executions FIRST
    const jobRes = await client.query(
      `UPDATE job_executions
       SET status = 'retry_wait', next_attempt_at = $1,
           lease_owner = NULL, lease_expires_at = NULL, last_error_category = $2,
           updated_at = NOW(), version = version + 1
       WHERE id = $3 AND workspace_id = $4 AND version = $5 AND status = 'running' AND lease_owner = $6`,
      [outcome.nextAttemptAt, outcome.errorCategory, jobId, workspaceId, jobVersion, workerId],
    );
    if (jobRes.rowCount !== 1) {
      throw new DatabaseError(
        `Lease fencing conflict on job ${jobId}: stale lease, wrong status, or wrong owner`,
      );
    }

    const unitRes = await client.query(
      `UPDATE script_generation_units
       SET status = 'retry_wait', error_category = $1, error_message = $2, updated_at = NOW(), version = version + 1
       WHERE job_id = $3 AND workspace_id = $4 AND status IN ('queued', 'running', 'retry_wait')`,
      [outcome.errorCategory, outcome.errorMessage, jobId, workspaceId],
    );
    if (unitRes.rowCount !== 1) {
      throw new DatabaseError(
        `Failed to update script_generation_unit for job ${jobId} to retry_wait`,
      );
    }
  } else if (outcome.kind === 'repair') {
    // Lease fencing on job_executions FIRST
    const jobRes = await client.query(
      `UPDATE job_executions
       SET status = 'queued', repair_attempt = repair_attempt + 1,
           next_attempt_at = NOW() + ($1 || ' seconds')::interval,
           lease_owner = NULL, lease_expires_at = NULL, last_error_category = $2,
           updated_at = NOW(), version = version + 1
       WHERE id = $3 AND workspace_id = $4 AND version = $5 AND status = 'running' AND lease_owner = $6`,
      [outcome.repairDelaySeconds, outcome.errorCategory, jobId, workspaceId, jobVersion, workerId],
    );
    if (jobRes.rowCount !== 1) {
      throw new DatabaseError(
        `Lease fencing conflict on job ${jobId}: stale lease, wrong status, or wrong owner`,
      );
    }

    const unitRes = await client.query(
      `UPDATE script_generation_units
       SET status = 'queued', error_category = $1, error_message = $2, updated_at = NOW(), version = version + 1
       WHERE job_id = $3 AND workspace_id = $4 AND status IN ('queued', 'running', 'retry_wait')`,
      [outcome.errorCategory, outcome.errorMessage, jobId, workspaceId],
    );
    if (unitRes.rowCount !== 1) {
      throw new DatabaseError(
        `Failed to update script_generation_unit for job ${jobId} to queued (repair)`,
      );
    }
  } else {
    // terminal_failure
    // 1. Lease fencing on job_executions FIRST before ANY budget release or side effect
    const jobRes = await client.query(
      `UPDATE job_executions
       SET status = 'failed', completed_at = NOW(), lease_owner = NULL,
           lease_expires_at = NULL, reserved_spend_microunits = 0, last_error_category = $1,
           updated_at = NOW(), version = version + 1
       WHERE id = $2 AND workspace_id = $3 AND version = $4 AND status = 'running' AND lease_owner = $5`,
      [outcome.errorCategory, jobId, workspaceId, jobVersion, workerId],
    );
    if (jobRes.rowCount !== 1) {
      throw new DatabaseError(
        `Lease fencing conflict on job ${jobId}: stale lease, wrong status, or wrong owner`,
      );
    }

    // 2. Release budget atomically (prevent negative reserved spend, exactly 1 row)
    const policyRes = await client.query(
      `UPDATE workspace_ai_policies
       SET reserved_spend_microunits = reserved_spend_microunits - $1,
           updated_at = NOW(), version = version + 1
       WHERE workspace_id = $2 AND reserved_spend_microunits >= $1`,
      [reservedMicrounits, workspaceId],
    );
    if (policyRes.rowCount !== 1) {
      throw new DatabaseError(
        `Failed to release workspace AI policy reservation: insufficient reserved spend in workspace ${workspaceId}`,
      );
    }

    // 3. Update operations
    const opRes = await client.query(
      `UPDATE operations
       SET status = 'failed', started_at = COALESCE(started_at, NOW()), completed_at = NOW(), error_category = $1, error_code = $2,
           error_message = $3, updated_at = NOW(), version = version + 1
       WHERE id = $4 AND workspace_id = $5 AND status IN ('queued', 'running', 'pending')`,
      [outcome.errorCategory, outcome.errorCode, outcome.errorMessage, operationId, workspaceId],
    );
    if (opRes.rowCount !== 1) {
      throw new DatabaseError(`Failed to update operation ${operationId} to failed`);
    }

    // 4. Update ai_runs
    const runRes = await client.query(
      `UPDATE ai_runs
       SET status = 'failed', started_at = COALESCE(started_at, NOW()), completed_at = NOW(), error_category = $1, updated_at = NOW(), version = version + 1
       WHERE id = $2 AND workspace_id = $3 AND status IN ('queued', 'running')`,
      [outcome.errorCategory, aiRunId, workspaceId],
    );
    if (runRes.rowCount !== 1) {
      throw new DatabaseError(`Failed to update ai_run ${aiRunId} to failed`);
    }

    // 5. Update script_generation_units
    const unitRes = await client.query(
      `UPDATE script_generation_units
       SET status = 'failed', error_category = $1, error_message = $2, updated_at = NOW(), version = version + 1
       WHERE job_id = $3 AND workspace_id = $4 AND status IN ('queued', 'running', 'retry_wait')`,
      [outcome.errorCategory, outcome.errorMessage, jobId, workspaceId],
    );
    if (unitRes.rowCount !== 1) {
      throw new DatabaseError(`Failed to update script_generation_unit for job ${jobId} to failed`);
    }

    // 6. Update change request OR work order
    if (changeRequestId) {
      const crCode =
        outcome.errorCategory === 'provider_timeout'
          ? 'timeout'
          : outcome.errorCode === 'AUTHORITATIVE_CONTEXT_DRIFT'
            ? 'context_drift'
            : 'provider_failure';
      await client.query(
        `UPDATE artifact_change_requests
         SET status = 'failed', failure_code = $1, failure_reason = $2, updated_at = NOW(), version = version + 1
         WHERE id = $3 AND workspace_id = $4 AND status = 'in_progress'`,
        [crCode, outcome.errorMessage, changeRequestId, workspaceId],
      );

      await client.query(
        `UPDATE agent_assignments aa
         SET office_state = 'failed', updated_at = NOW(), version = aa.version + 1
         FROM agent_role_definitions rd
         WHERE aa.role_definition_id = rd.id
           AND aa.workspace_id = $1
           AND aa.work_order_id = $2
           AND rd.role_key = 'scriptwriter'
           AND aa.office_state = 'running'`,
        [workspaceId, workOrderId],
      );
    } else {
      await client.query(
        `UPDATE work_items
         SET status = 'failed', completed_at = NOW(), updated_at = NOW(), version = version + 1
         WHERE id = $1 AND workspace_id = $2 AND status IN ('queued', 'running', 'pending')`,
        [workItemId, workspaceId],
      );

      await client.query(
        `UPDATE agent_assignments
         SET office_state = 'failed', updated_at = NOW(), version = version + 1
         WHERE id = $1 AND workspace_id = $2`,
        [assignmentId, workspaceId],
      );

      await client.query(
        `UPDATE work_orders
         SET status = 'failed', failure_category = $1, updated_at = NOW(), version = version + 1
         WHERE id = $2 AND workspace_id = $3 AND status = 'in_progress'`,
        [outcome.errorCategory, workOrderId, workspaceId],
      );
    }
  }
}
