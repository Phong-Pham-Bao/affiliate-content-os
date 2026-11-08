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
    videoNumber,
    reservedMicrounits,
    outcome,
    changeRequestId,
  } = params;

  if (outcome.kind === 'success') {
    const actualCost = outcome.usage.costMicrounits ?? 0;
    if (actualCost < 0 || !Number.isSafeInteger(actualCost) || actualCost > reservedMicrounits) {
      throw new DatabaseError(
        `Invalid actualCost ${actualCost} for reserved ${reservedMicrounits}`,
      );
    }
    // Settle budget
    await client.query(
      `UPDATE workspace_ai_policies
       SET current_spend_microunits = current_spend_microunits + $1,
           reserved_spend_microunits = reserved_spend_microunits - $2,
           updated_at = NOW(),
           version = version + 1
       WHERE workspace_id = $3`,
      [actualCost, reservedMicrounits, workspaceId],
    );

    // Update job
    const jobRes = await client.query(
      `UPDATE job_executions
       SET status = 'succeeded', completed_at = NOW(), lease_owner = NULL,
           lease_expires_at = NULL, last_error_category = NULL, reserved_spend_microunits = 0,
           updated_at = NOW(), version = version + 1
       WHERE id = $1 AND workspace_id = $2 AND version = $3`,
      [jobId, workspaceId, jobVersion],
    );
    if (jobRes.rowCount === 0) {
      throw new DatabaseError(`Lease fencing conflict on job ${jobId}`);
    }

    // Update operation & ai_run
    const resultLocation = `/workspaces/${workspaceId}/products/${productId}/script-units/video-${videoNumber}`;
    await client.query(
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
       WHERE id = $2 AND workspace_id = $3`,
      [resultLocation, operationId, workspaceId],
    );

    await client.query(
      `UPDATE ai_runs
       SET status = 'succeeded',
           output_hash = $1,
           token_input = $2,
           token_output = $3,
           cost_microunits = $4,
           cost_currency = $5,
           latency_ms = $6,
           started_at = COALESCE(started_at, NOW()),
           completed_at = NOW(),
           error_category = NULL,
           updated_at = NOW(),
           version = version + 1
       WHERE id = $7 AND workspace_id = $8`,
      [
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

    // Update script_generation_units
    await client.query(
      `UPDATE script_generation_units
       SET status = 'succeeded', output_json = $1::jsonb, content_hash = $2,
           updated_at = NOW(), version = version + 1
       WHERE job_id = $3 AND workspace_id = $4`,
      [JSON.stringify(outcome.contentJson), Buffer.from(outcome.contentHash), jobId, workspaceId],
    );

    // Attempt assembly
    if (changeRequestId) {
      await assembleScriptPackageChangeRequestAtomic(client, { workspaceId, changeRequestId });
    } else {
      await assembleScriptPackageInitialAtomic(client, {
        workspaceId,
        productId,
        workOrderId,
        workItemId,
        assignmentId,
      });
    }
  } else if (outcome.kind === 'transient_failure') {
    await client.query(
      `UPDATE job_executions
       SET status = 'retry_wait', attempt = attempt + 1, next_attempt_at = $1,
           lease_owner = NULL, lease_expires_at = NULL, last_error_category = $2,
           updated_at = NOW(), version = version + 1
       WHERE id = $3 AND workspace_id = $4 AND version = $5`,
      [outcome.nextAttemptAt, outcome.errorCategory, jobId, workspaceId, jobVersion],
    );

    await client.query(
      `UPDATE script_generation_units
       SET status = 'retry_wait', error_category = $1, error_message = $2, updated_at = NOW(), version = version + 1
       WHERE job_id = $3 AND workspace_id = $4`,
      [outcome.errorCategory, outcome.errorMessage, jobId, workspaceId],
    );
  } else if (outcome.kind === 'repair') {
    await client.query(
      `UPDATE job_executions
       SET status = 'queued', repair_attempt = repair_attempt + 1,
           next_attempt_at = NOW() + ($1 || ' seconds')::interval,
           lease_owner = NULL, lease_expires_at = NULL, last_error_category = $2,
           updated_at = NOW(), version = version + 1
       WHERE id = $3 AND workspace_id = $4 AND version = $5`,
      [outcome.repairDelaySeconds, outcome.errorCategory, jobId, workspaceId, jobVersion],
    );

    await client.query(
      `UPDATE script_generation_units
       SET status = 'queued', error_category = $1, error_message = $2, updated_at = NOW(), version = version + 1
       WHERE job_id = $3 AND workspace_id = $4`,
      [outcome.errorCategory, outcome.errorMessage, jobId, workspaceId],
    );
  } else {
    // terminal_failure
    await client.query(
      `UPDATE workspace_ai_policies
       SET reserved_spend_microunits = reserved_spend_microunits - $1,
           updated_at = NOW(), version = version + 1
       WHERE workspace_id = $2`,
      [reservedMicrounits, workspaceId],
    );

    await client.query(
      `UPDATE job_executions
       SET status = 'failed', completed_at = NOW(), lease_owner = NULL,
           lease_expires_at = NULL, reserved_spend_microunits = 0, last_error_category = $1,
           updated_at = NOW(), version = version + 1
       WHERE id = $2 AND workspace_id = $3 AND version = $4`,
      [outcome.errorCategory, jobId, workspaceId, jobVersion],
    );

    await client.query(
      `UPDATE operations
       SET status = 'failed', started_at = COALESCE(started_at, NOW()), completed_at = NOW(), error_category = $1, error_code = $2,
           error_message = $3, updated_at = NOW(), version = version + 1
       WHERE id = $4 AND workspace_id = $5`,
      [outcome.errorCategory, outcome.errorCode, outcome.errorMessage, operationId, workspaceId],
    );

    await client.query(
      `UPDATE ai_runs
       SET status = 'failed', started_at = COALESCE(started_at, NOW()), completed_at = NOW(), error_category = $1, updated_at = NOW(), version = version + 1
       WHERE id = $2 AND workspace_id = $3`,
      [outcome.errorCategory, aiRunId, workspaceId],
    );

    await client.query(
      `UPDATE script_generation_units
       SET status = 'failed', error_category = $1, error_message = $2, updated_at = NOW(), version = version + 1
       WHERE job_id = $3 AND workspace_id = $4`,
      [outcome.errorCategory, outcome.errorMessage, jobId, workspaceId],
    );

    if (changeRequestId) {
      await client.query(
        `UPDATE artifact_change_requests
         SET status = 'failed', failure_reason = $1, updated_at = NOW(), version = version + 1
         WHERE id = $2 AND workspace_id = $3`,
        [outcome.errorMessage, changeRequestId, workspaceId],
      );
    } else {
      await client.query(
        `UPDATE work_items
         SET status = 'failed', completed_at = NOW(), updated_at = NOW(), version = version + 1
         WHERE id = $1 AND workspace_id = $2`,
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
