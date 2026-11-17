import type pg from 'pg';
import {
  generateUuidV7,
  type EnqueueComplianceEvaluationParams,
  type EnqueueComplianceEvaluationResult,
} from '@affiliate-content-os/application';
import {
  CURRENT_COMPLIANCE_POLICY_VERSION,
  computeCompliancePolicyHash,
} from '@affiliate-content-os/domain';
import { queryComplianceEvaluation } from './workforce-compliance-queries.js';

export const COMPLIANCE_RESERVED_SPEND_MICROUNITS = 10_000;

export async function enqueueComplianceEvaluationTransaction(
  client: pg.PoolClient,
  params: EnqueueComplianceEvaluationParams,
): Promise<EnqueueComplianceEvaluationResult> {
  const {
    workspaceId,
    productId,
    workOrderId,
    artifactId,
    revisionNumber,
    actorUserId,
    policyVersion = CURRENT_COMPLIANCE_POLICY_VERSION,
  } = params;

  const policyHashHex = computeCompliancePolicyHash(policyVersion);
  const policyHash = Buffer.from(policyHashHex, 'hex');

  // 1. Idempotency check: see if evaluation already exists for this revision and policy
  const existingRes = await client.query(
    `SELECT id, job_id, operation_id
     FROM compliance_evaluations
     WHERE workspace_id = $1 AND artifact_id = $2 AND revision_number = $3 AND policy_version = $4
     FOR UPDATE`,
    [workspaceId, artifactId, revisionNumber, policyVersion],
  );

  if (existingRes.rowCount !== 0 && existingRes.rows[0]) {
    const existing = existingRes.rows[0];
    const existingDTO = await queryComplianceEvaluation(
      client,
      workspaceId,
      artifactId,
      revisionNumber,
    );
    return {
      evaluation: existingDTO!,
      jobId: existing.job_id,
      operationId: existing.operation_id,
    };
  }

  // 2. Fetch work_items row for compliance_review
  const itemRes = await client.query(
    `SELECT w.id AS item_id, a.id AS assignment_id
     FROM work_items w
     LEFT JOIN agent_assignments a
       ON a.work_item_id = w.id
      AND a.workspace_id = w.workspace_id
      AND a.work_order_id = w.work_order_id
     WHERE w.workspace_id = $1 AND w.work_order_id = $2 AND w.task_key = 'compliance_review'
     FOR UPDATE OF w`,
    [workspaceId, workOrderId],
  );

  const workItemId = itemRes.rows[0]?.item_id ?? null;
  const assignmentId = itemRes.rows[0]?.assignment_id ?? null;

  // 3. Budget reservation (reserve 10,000 microunits if available)
  let reservedSpend = COMPLIANCE_RESERVED_SPEND_MICROUNITS;
  const policyRes = await client.query(
    `SELECT monthly_budget_microunits, current_spend_microunits, reserved_spend_microunits
     FROM workspace_ai_policies
     WHERE workspace_id = $1
     FOR UPDATE`,
    [workspaceId],
  );

  if (policyRes.rowCount !== 0 && policyRes.rows[0]) {
    const pol = policyRes.rows[0];
    const budget = Number(pol.monthly_budget_microunits);
    const spend = Number(pol.current_spend_microunits);
    const currReserved = Number(pol.reserved_spend_microunits);

    if (spend + currReserved + reservedSpend <= budget) {
      await client.query(
        `UPDATE workspace_ai_policies
         SET reserved_spend_microunits = reserved_spend_microunits + $1,
             updated_at = NOW(),
             version = version + 1
         WHERE workspace_id = $2`,
        [reservedSpend, workspaceId],
      );
    } else {
      reservedSpend = 0; // Fall back to 0 reservation for deterministic preflight
    }
  } else {
    reservedSpend = 0;
  }

  // 4. Generate entity IDs
  const evalId = generateUuidV7();
  const opId = generateUuidV7();
  const aiRunId = generateUuidV7();
  const jobId = generateUuidV7();

  // 5. Insert operation
  await client.query(
    `INSERT INTO operations (
       id, workspace_id, operation_type, resource_type, resource_id,
       status, progress_percent, result_location, error_category, error_code, error_message,
       requested_by_user_id, started_at, completed_at, created_at, updated_at, version,
       work_order_id, work_item_id
     ) VALUES (
       $1, $2, 'compliance_review', 'product', $3,
       'queued', NULL, NULL, NULL, NULL, NULL,
       $4, NULL, NULL, NOW(), NOW(), 1,
       $5, $6
     )`,
    [opId, workspaceId, productId, actorUserId, workOrderId, workItemId],
  );

  // 6. Insert AI run
  await client.query(
    `INSERT INTO ai_runs (
       id, workspace_id, operation_id, purpose, provider, model,
       prompt_template, prompt_version, input_schema_version, output_schema_version,
       input_hash, output_hash, status, attempt, is_repair, token_input, token_output,
       cost_microunits, cost_currency, latency_ms, safety_result, error_category,
       requested_by_user_id, started_at, completed_at, created_at, updated_at, version,
       work_order_id, work_item_id
     ) VALUES (
       $1, $2, $3, 'compliance_review', 'google', 'gemini-3.8-flash',
       'compliance_advisory_v1', '1.0.0', 1, 1,
       $4, NULL, 'queued', 1, FALSE, NULL, NULL,
       NULL, NULL, NULL, NULL, NULL,
       $5, NULL, NULL, NOW(), NOW(), 1,
       $6, $7
     )`,
    [aiRunId, workspaceId, opId, policyHash, actorUserId, workOrderId, workItemId],
  );

  // 7. Insert job execution
  const dedupKey = `compliance_review:${workOrderId}:${artifactId}:${revisionNumber}:${policyVersion}`;
  const payload = {
    workspaceId,
    productId,
    workOrderId,
    artifactId,
    revisionNumber,
    policyVersion,
    operationId: opId,
    aiRunId,
    jobId,
    evaluationId: evalId,
    workItemId,
    assignmentId,
    reservedMicrounits: reservedSpend,
  };

  await client.query(
    `INSERT INTO job_executions (
       id, workspace_id, operation_id, ai_run_id, job_type, deduplication_key,
       status, attempt, max_attempts, repair_attempt, max_repair_attempts,
       lease_owner, lease_expires_at, next_attempt_at, started_at, completed_at,
       last_error_category, payload_json, correlation_id, reserved_spend_microunits,
       work_order_id, work_item_id, created_at, updated_at, version
     ) VALUES (
       $1, $2, $3, $4, 'compliance_review', $5,
       'queued', 0, 3, 0, 1,
       NULL, NULL, NOW(), NULL, NULL,
       NULL, $6::jsonb, NULL, $7,
       $8, $9, NOW(), NOW(), 1
     )`,
    [
      jobId,
      workspaceId,
      opId,
      aiRunId,
      dedupKey,
      JSON.stringify(payload),
      reservedSpend,
      workOrderId,
      workItemId,
    ],
  );

  // 8. Insert compliance evaluation
  await client.query(
    `INSERT INTO compliance_evaluations (
       id, workspace_id, product_id, work_order_id, artifact_id, revision_number,
       policy_version, policy_hash, status, result, blocking_count, warning_count,
       info_count, deterministic_passed, ai_advisory_status, evaluation_report_artifact_id,
       ai_run_id, job_id, operation_id, created_at, updated_at, version
     ) VALUES (
       $1, $2, $3, $4, $5, $6,
       $7, $8, 'queued', 'pending', 0, 0,
       0, FALSE, 'pending', NULL,
       $9, $10, $11, NOW(), NOW(), 1
     )`,
    [
      evalId,
      workspaceId,
      productId,
      workOrderId,
      artifactId,
      revisionNumber,
      policyVersion,
      policyHash,
      aiRunId,
      jobId,
      opId,
    ],
  );

  // 9. Update work item & assignment
  if (workItemId) {
    await client.query(
      `UPDATE work_items
       SET status = 'running', started_at = COALESCE(started_at, NOW()), updated_at = NOW(), version = version + 1
       WHERE id = $1 AND workspace_id = $2`,
      [workItemId, workspaceId],
    );
  }

  if (assignmentId) {
    await client.query(
      `UPDATE agent_assignments
       SET office_state = 'queued', waiting_on_work_item_id = NULL, updated_at = NOW(), version = version + 1
       WHERE id = $1 AND workspace_id = $2`,
      [assignmentId, workspaceId],
    );
  }

  const dto = await queryComplianceEvaluation(client, workspaceId, artifactId, revisionNumber);

  return {
    evaluation: dto!,
    jobId,
    operationId: opId,
  };
}
