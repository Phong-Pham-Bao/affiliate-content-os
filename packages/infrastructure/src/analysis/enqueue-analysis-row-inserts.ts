import type pg from 'pg';
import type { EnqueueAnalysisAtomicParams } from '@affiliate-content-os/application';
import { DatabaseError } from '../database/errors.js';

export async function insertEnqueueEntities(
  client: pg.PoolClient,
  params: EnqueueAnalysisAtomicParams,
): Promise<void> {
  // 1. Insert operation
  const opIns = await client.query(
    `INSERT INTO operations (
       id, workspace_id, operation_type, resource_type, resource_id,
       status, requested_by_user_id, created_at, updated_at, version
     )
     VALUES ($1, $2, $3, $4, $5, 'queued', $6, NOW(), NOW(), 1)`,
    [
      params.operation.id,
      params.operation.workspaceId,
      params.operation.operationType,
      params.operation.resourceType,
      params.operation.resourceId,
      params.operation.requestedByUserId,
    ],
  );
  if (opIns.rowCount !== 1) {
    throw new DatabaseError(`Failed to insert operation ${params.operation.id}`);
  }

  // 2. Insert ai_run
  const runIns = await client.query(
    `INSERT INTO ai_runs (
       id, workspace_id, operation_id, purpose, provider, model,
       prompt_template, prompt_version, input_schema_version, output_schema_version,
       input_hash, status, requested_by_user_id, created_at, updated_at, version
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'queued', $12, NOW(), NOW(), 1)`,
    [
      params.aiRun.id,
      params.aiRun.workspaceId,
      params.aiRun.operationId,
      params.aiRun.purpose,
      params.aiRun.provider,
      params.aiRun.model,
      params.aiRun.promptTemplate,
      params.aiRun.promptVersion,
      params.aiRun.inputSchemaVersion,
      params.aiRun.outputSchemaVersion,
      Buffer.from(params.aiRun.inputHash),
      params.aiRun.requestedByUserId,
    ],
  );
  if (runIns.rowCount !== 1) {
    throw new DatabaseError(`Failed to insert AI run ${params.aiRun.id}`);
  }

  // 3. Insert job_executions structurally linked to operation_id and ai_run_id
  const jobIns = await client.query(
    `INSERT INTO job_executions (
       id, workspace_id, operation_id, ai_run_id, job_type, deduplication_key, status,
       attempt, max_attempts, next_attempt_at, payload_json, reserved_spend_microunits,
       created_at, updated_at, version
     )
     VALUES ($1, $2, $3, $4, $5, $6, 'queued', 0, 3, NOW(), $7, $8, NOW(), NOW(), 1)`,
    [
      params.job.id,
      params.job.workspaceId,
      params.job.operationId,
      params.job.aiRunId,
      params.job.jobType,
      params.job.deduplicationKey,
      JSON.stringify(params.job.payloadJson),
      params.job.reservedSpendMicrounits,
    ],
  );
  if (jobIns.rowCount !== 1) {
    throw new DatabaseError(`Failed to insert job execution ${params.job.id}`);
  }

  // 4. Insert outbox_events
  const outboxIns = await client.query(
    `INSERT INTO outbox_events (
       id, workspace_id, event_type, aggregate_type, aggregate_id,
       aggregate_version, payload_json, occurred_at, available_at, delivery_count, created_at
     )
     VALUES ($1, $2, $3, $4, $5, 1, $6, NOW(), NOW(), 0, NOW())`,
    [
      params.outboxEvent.id,
      params.outboxEvent.workspaceId,
      params.outboxEvent.eventType,
      params.outboxEvent.aggregateType,
      params.outboxEvent.aggregateId,
      JSON.stringify(params.outboxEvent.payloadJson),
    ],
  );
  if (outboxIns.rowCount !== 1) {
    throw new DatabaseError(`Failed to insert outbox event ${params.outboxEvent.id}`);
  }

  // 5. Insert idempotency_keys
  const idempKeyId = params.outboxEvent.id;
  const idempIns = await client.query(
    `INSERT INTO idempotency_keys (
       id, workspace_id, principal_id, route_key, key_hash, request_hash,
       status_code, response_json, resource_type, resource_id, expires_at, created_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'operation', $9, NOW() + INTERVAL '24 hours', NOW())`,
    [
      idempKeyId,
      params.operation.workspaceId,
      params.idempotency.principalId,
      params.idempotency.routeKey,
      Buffer.from(params.idempotency.keyHash),
      Buffer.from(params.idempotency.requestHash),
      params.idempotency.statusCode,
      JSON.stringify(params.idempotency.responseJson),
      params.idempotency.resourceId,
    ],
  );
  if (idempIns.rowCount !== 1) {
    throw new DatabaseError(
      `Failed to insert idempotency key for operation ${params.operation.id}`,
    );
  }

  // 6. Insert audit_events
  await client.query(
    `INSERT INTO audit_events (
       id, workspace_id, actor_type, actor_user_id, action, resource_type,
       resource_id, result, reason_code, changes_json, occurred_at, created_at
     )
     VALUES ($1, $2, 'user', $3, $4, $5, $6, 'succeeded', null, $7, NOW(), NOW())`,
    [
      params.auditEvent.id,
      params.auditEvent.workspaceId,
      params.auditEvent.actorUserId,
      params.auditEvent.action,
      params.auditEvent.resourceType,
      params.auditEvent.resourceId,
      JSON.stringify(params.auditEvent.changesJson),
    ],
  );
}
