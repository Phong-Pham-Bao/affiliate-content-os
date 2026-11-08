import crypto from 'node:crypto';
import type pg from 'pg';
import { DatabaseError } from '../database/errors.js';

export async function sweepExhaustedJobs(client: pg.PoolClient): Promise<void> {
  const exhaustedRes = await client.query(
    `SELECT id, workspace_id, operation_id, ai_run_id, version, reserved_spend_microunits,
            job_type, work_order_id, work_item_id
     FROM job_executions
     WHERE (
       (status = 'running' AND lease_expires_at < NOW() AND attempt >= max_attempts)
       OR (status IN ('queued', 'retry_wait') AND attempt >= max_attempts)
     )
     ORDER BY next_attempt_at ASC, id ASC
     LIMIT 10
     FOR UPDATE SKIP LOCKED`,
  );

  for (const row of exhaustedRes.rows) {
    const rawReserved = Number(row.reserved_spend_microunits ?? 0);
    if (!Number.isSafeInteger(rawReserved) || rawReserved < 0) {
      throw new DatabaseError(
        `Failed to sweep exhausted job ${row.id}: reserved_spend_microunits must be a non-negative safe integer`,
      );
    }
    const reservedMicrounits = rawReserved;

    await client.query(
      `UPDATE job_executions
       SET status = 'failed',
           started_at = COALESCE(started_at, NOW()),
           completed_at = NOW(),
           last_error_category = 'provider_timeout',
           lease_owner = NULL,
           lease_expires_at = NULL,
           updated_at = NOW(),
           version = version + 1
       WHERE id = $1 AND workspace_id = $2`,
      [row.id, row.workspace_id],
    );

    await client.query(
      `UPDATE operations
       SET status = 'failed',
           error_category = 'provider_timeout',
           error_code = 'JOB_LEASE_EXPIRED_EXHAUSTED',
           error_message = 'Job execution attempts exhausted after worker timeout',
           started_at = COALESCE(started_at, NOW()),
           completed_at = NOW(),
           updated_at = NOW(),
           version = version + 1
       WHERE id = $1 AND workspace_id = $2 AND status IN ('queued', 'running', 'pending')`,
      [row.operation_id, row.workspace_id],
    );

    await client.query(
      `UPDATE ai_runs
       SET status = 'failed',
           error_category = 'provider_timeout',
           started_at = COALESCE(started_at, NOW()),
           completed_at = NOW(),
           updated_at = NOW(),
           version = version + 1
       WHERE id = $1 AND workspace_id = $2 AND status IN ('queued', 'running')`,
      [row.ai_run_id, row.workspace_id],
    );

    if (reservedMicrounits > 0) {
      const policyRes = await client.query(
        `UPDATE workspace_ai_policies
         SET reserved_spend_microunits = reserved_spend_microunits - $1,
             updated_at = NOW(),
             version = version + 1
         WHERE workspace_id = $2 AND reserved_spend_microunits >= $1`,
        [reservedMicrounits, row.workspace_id],
      );

      if (policyRes.rowCount !== 1) {
        throw new DatabaseError(
          `Failed to release reserved budget for exhausted job ${row.id}: exact reservation release could not occur (insufficient or missing policy reservation)`,
        );
      }
    }

    let isChangeRequestJob = false;
    if (row.job_type === 'scriptwriting') {
      const crCheck = await client.query<{ change_request_id: string | null }>(
        `UPDATE script_generation_units
         SET status = 'failed',
             error_category = 'provider_timeout',
             error_message = 'Job execution attempts exhausted after worker timeout',
             updated_at = NOW(),
             version = version + 1
         WHERE job_id = $1 AND workspace_id = $2
         RETURNING change_request_id`,
        [row.id, row.workspace_id],
      );

      if (crCheck.rowCount && crCheck.rowCount > 0 && crCheck.rows[0]?.change_request_id) {
        isChangeRequestJob = true;
        await client.query(
          `UPDATE artifact_change_requests
           SET status = 'failed',
               failure_code = 'timeout',
               failure_reason = 'Script unit execution exhausted',
               updated_at = NOW(),
               version = version + 1
           WHERE id = $1 AND workspace_id = $2 AND status = 'in_progress'`,
          [crCheck.rows[0].change_request_id, row.workspace_id],
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
          [row.workspace_id, row.work_order_id],
        );
      }
    }

    if (
      !isChangeRequestJob &&
      (row.job_type === 'workforce_planning' || row.job_type === 'scriptwriting') &&
      row.work_item_id &&
      row.work_order_id
    ) {
      await client.query(
        `UPDATE work_items
         SET status = 'failed',
             completed_at = NOW(),
             updated_at = NOW(),
             version = version + 1
         WHERE id = $1 AND workspace_id = $2 AND work_order_id = $3 AND status IN ('queued', 'running')`,
        [row.work_item_id, row.workspace_id, row.work_order_id],
      );

      await client.query(
        `UPDATE agent_assignments
         SET office_state = 'failed',
             updated_at = NOW(),
             version = version + 1
         WHERE work_item_id = $1 AND workspace_id = $2 AND work_order_id = $3`,
        [row.work_item_id, row.workspace_id, row.work_order_id],
      );

      await client.query(
        `UPDATE work_orders
         SET status = 'failed',
             failure_category = 'provider_timeout',
             completed_at = NOW(),
             updated_at = NOW(),
             version = version + 1
         WHERE id = $1 AND workspace_id = $2 AND status = 'in_progress'`,
        [row.work_order_id, row.workspace_id],
      );

      const auditEventId = crypto.randomUUID();
      await client.query(
        `INSERT INTO audit_events (
           id, workspace_id, actor_type, actor_user_id, action, resource_type,
           resource_id, result, reason_code, changes_json, occurred_at, created_at
         )
         VALUES ($1, $2, 'system', NULL, 'artifact.failed', 'work_item', $3, 'failed', 'job_lease_expired_exhausted', $4, NOW(), NOW())`,
        [
          auditEventId,
          row.workspace_id,
          row.work_item_id,
          JSON.stringify({
            error_category: 'provider_timeout',
            reason: 'Worker lease expired and attempts exhausted',
            workOrderId: row.work_order_id,
          }),
        ],
      );
    } else {
      const auditEventId = crypto.randomUUID();
      await client.query(
        `INSERT INTO audit_events (
           id, workspace_id, actor_type, actor_user_id, action, resource_type,
           resource_id, result, reason_code, changes_json, occurred_at, created_at
         )
         VALUES ($1, $2, 'system', NULL, 'ai_analysis.failed', 'operation', $3, 'failed', 'job_lease_expired_exhausted', $4, NOW(), NOW())`,
        [
          auditEventId,
          row.workspace_id,
          row.operation_id,
          JSON.stringify({
            error_category: 'provider_timeout',
            reason: 'Worker lease expired and attempts exhausted',
          }),
        ],
      );
    }
  }
}
