import type pg from 'pg';
import { SCRIPT_UNIT_COST_MICROUNITS } from './workforce-scriptwriting-kickoff.js';

export async function retryFailedScriptUnits(
  client: pg.PoolClient,
  workspaceId: string,
  workOrderId: string,
): Promise<number> {
  const failedUnitsRes = await client.query(
    `SELECT u.id, u.video_number, u.job_id, u.operation_id, u.ai_run_id,
            u.work_item_id, w.id AS order_id
     FROM script_generation_units u
     JOIN work_orders w ON w.id = u.work_order_id AND w.workspace_id = u.workspace_id
     WHERE u.workspace_id = $1 AND u.work_order_id = $2
       AND u.status IN ('failed', 'retry_wait')
     FOR UPDATE OF u`,
    [workspaceId, workOrderId],
  );

  if (failedUnitsRes.rowCount === 0) {
    return 0;
  }

  const count = failedUnitsRes.rowCount ?? 0;
  const totalReservation = count * SCRIPT_UNIT_COST_MICROUNITS;

  // Reserve budget
  await client.query(
    `UPDATE workspace_ai_policies
     SET reserved_spend_microunits = reserved_spend_microunits + $1,
         updated_at = NOW(),
         version = version + 1
     WHERE workspace_id = $2`,
    [totalReservation, workspaceId],
  );

  let workItemId = '';
  for (const row of failedUnitsRes.rows) {
    workItemId = row.work_item_id;

    await client.query(
      `UPDATE job_executions
       SET status = 'queued', attempt = 0, repair_attempt = 0,
           lease_owner = NULL, lease_expires_at = NULL, next_attempt_at = NOW(),
           reserved_spend_microunits = $1, last_error_category = NULL,
           updated_at = NOW(), version = version + 1
       WHERE id = $2 AND workspace_id = $3`,
      [SCRIPT_UNIT_COST_MICROUNITS, row.job_id, workspaceId],
    );

    await client.query(
      `UPDATE operations
       SET status = 'queued', error_category = NULL, error_code = NULL, error_message = NULL,
           completed_at = NULL, updated_at = NOW(), version = version + 1
       WHERE id = $1 AND workspace_id = $2`,
      [row.operation_id, workspaceId],
    );

    await client.query(
      `UPDATE ai_runs
       SET status = 'queued', attempt = 1, error_category = NULL,
           completed_at = NULL, updated_at = NOW(), version = version + 1
       WHERE id = $1 AND workspace_id = $2`,
      [row.ai_run_id, workspaceId],
    );

    await client.query(
      `UPDATE script_generation_units
       SET status = 'queued', error_category = NULL, error_message = NULL,
           updated_at = NOW(), version = version + 1
       WHERE id = $1 AND workspace_id = $2`,
      [row.id, workspaceId],
    );
  }

  if (workItemId) {
    await client.query(
      `UPDATE work_items
       SET status = 'running', completed_at = NULL, updated_at = NOW(), version = version + 1
       WHERE id = $1 AND workspace_id = $2`,
      [workItemId, workspaceId],
    );

    await client.query(
      `UPDATE agent_assignments
       SET office_state = 'running', updated_at = NOW(), version = version + 1
       WHERE work_item_id = $1 AND workspace_id = $2`,
      [workItemId, workspaceId],
    );
  }

  return count;
}
