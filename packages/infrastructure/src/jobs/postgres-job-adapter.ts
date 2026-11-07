import crypto from 'node:crypto';
import type pg from 'pg';
import type { ClaimJobParams, DurableJobQueuePort } from '@affiliate-content-os/application';
import type { JobExecutionSnapshot } from '@affiliate-content-os/domain';
import { mapJobExecutionRow } from '../analysis/analysis-mappers.js';
import { DatabaseError } from '../database/errors.js';

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_REGEX = /[\x00-\x1F\x7F]/;

function validateWorkerId(workerId: unknown): string {
  if (typeof workerId !== 'string') throw new DatabaseError('workerId must be a string');
  const trimmed = workerId.trim();
  if (trimmed.length < 1 || trimmed.length > 128 || CONTROL_CHARS_REGEX.test(trimmed)) {
    throw new DatabaseError('workerId must be 1-128 characters without control characters');
  }
  return trimmed;
}

function validateLeaseDuration(duration: unknown): number {
  if (
    typeof duration !== 'number' ||
    !Number.isSafeInteger(duration) ||
    duration < 5 ||
    duration > 3600
  ) {
    throw new DatabaseError('leaseDurationSeconds must be a safe integer between 5 and 3600');
  }
  return duration;
}

export class PostgresJobAdapter implements DurableJobQueuePort {
  constructor(private readonly pool: pg.Pool) {}

  public async claimNextJob(params: ClaimJobParams): Promise<JobExecutionSnapshot | null> {
    const validWorkerId = validateWorkerId(params.workerId);
    const validLeaseDuration = validateLeaseDuration(params.leaseDurationSeconds);

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Atomically sweep and terminalize any expired exhausted jobs (attempt >= max_attempts)
      const exhaustedRes = await client.query(
        `SELECT id, workspace_id, operation_id, ai_run_id, version, reserved_spend_microunits
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
        const reservedMicrounits =
          Number.isSafeInteger(rawReserved) && rawReserved >= 0 ? rawReserved : 0;

        // Fail job execution
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
           WHERE id = $1`,
          [row.id],
        );

        // Fail linked operation
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
           WHERE id = $1 AND workspace_id = $2 AND status IN ('queued', 'running')`,
          [row.operation_id, row.workspace_id],
        );

        // Fail linked ai_run
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

        // Release policy reservation safely with exact accounting
        if (Number.isSafeInteger(reservedMicrounits) && reservedMicrounits > 0) {
          await client.query(
            `UPDATE workspace_ai_policies
             SET reserved_spend_microunits = reserved_spend_microunits - $1,
                 updated_at = NOW(),
                 version = version + 1
             WHERE workspace_id = $2 AND reserved_spend_microunits >= $1`,
            [reservedMicrounits, row.workspace_id],
          );
        }

        // Record terminal audit event with system actor
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

      // 2. Candidate claim query: never claim/reclaim when attempt >= max_attempts
      const claimSql = `
        WITH candidate AS (
          SELECT id, workspace_id, operation_id, ai_run_id
          FROM job_executions
          WHERE ((status IN ('queued', 'retry_wait') AND attempt < max_attempts)
             OR (status = 'running' AND lease_expires_at < NOW() AND attempt < max_attempts))
            AND next_attempt_at <= NOW()
          ORDER BY next_attempt_at ASC, id ASC
          LIMIT 1
          FOR UPDATE SKIP LOCKED
        )
        UPDATE job_executions j
        SET status = 'running',
            lease_owner = $1,
            lease_expires_at = NOW() + ($2 || ' seconds')::INTERVAL,
            attempt = j.attempt + 1,
            started_at = COALESCE(j.started_at, NOW()),
            updated_at = NOW(),
            version = j.version + 1
        FROM candidate
        WHERE j.id = candidate.id
        RETURNING j.*;
      `;

      const res = await client.query(claimSql, [validWorkerId, validLeaseDuration]);

      if (res.rows.length === 0) {
        await client.query('COMMIT');
        return null;
      }

      const claimedJob = res.rows[0];

      // 3. Consistently transition operation and ai_run from 'queued' to 'running'
      await client.query(
        `UPDATE operations
         SET status = 'running',
             started_at = COALESCE(started_at, NOW()),
             updated_at = NOW(),
             version = version + 1
         WHERE id = $1 AND workspace_id = $2 AND status = 'queued'`,
        [claimedJob.operation_id, claimedJob.workspace_id],
      );

      await client.query(
        `UPDATE ai_runs
         SET status = 'running',
             started_at = COALESCE(started_at, NOW()),
             updated_at = NOW(),
             version = version + 1
         WHERE id = $1 AND workspace_id = $2 AND status = 'queued'`,
        [claimedJob.ai_run_id, claimedJob.workspace_id],
      );

      await client.query('COMMIT');
      return mapJobExecutionRow(claimedJob);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}
