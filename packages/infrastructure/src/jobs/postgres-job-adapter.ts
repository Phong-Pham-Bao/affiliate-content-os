import type pg from 'pg';
import type { ClaimJobParams, DurableJobQueuePort } from '@affiliate-content-os/application';
import type { JobExecutionSnapshot } from '@affiliate-content-os/domain';
import { mapJobExecutionRow } from '../analysis/analysis-mappers.js';
import { DatabaseError } from '../database/errors.js';
import { sweepExhaustedJobs } from './postgres-job-exhausted-sweep.js';

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
      // 1. Atomically sweep and terminalize any expired exhausted jobs
      await client.query('BEGIN');
      await sweepExhaustedJobs(client);
      await client.query('COMMIT');

      const excludedWorkspaceIds: string[] = [];
      const MAX_CLAIM_ATTEMPTS = 10;

      for (let attempt = 0; attempt < MAX_CLAIM_ATTEMPTS; attempt++) {
        await client.query('BEGIN');

        // 2. Select next candidate job, excluding saturated workforce workspaces
        const candidateRes = await client.query(
          `SELECT j.id, j.workspace_id, j.operation_id, j.ai_run_id, j.job_type, j.work_order_id, j.work_item_id
           FROM job_executions j
           WHERE ((j.status IN ('queued', 'retry_wait') AND j.attempt < j.max_attempts)
              OR (j.status = 'running' AND j.lease_expires_at < NOW() AND j.attempt < j.max_attempts))
             AND j.next_attempt_at <= NOW()
             AND (
               j.job_type <> 'workforce_planning'
               OR j.workspace_id <> ALL($1::uuid[])
             )
           ORDER BY j.next_attempt_at ASC, j.id ASC
           LIMIT 1
           FOR UPDATE OF j SKIP LOCKED`,
          [excludedWorkspaceIds],
        );

        if (candidateRes.rowCount === 0 || !candidateRes.rows[0]) {
          await client.query('COMMIT');
          return null;
        }

        const candidate = candidateRes.rows[0];

        if (candidate.job_type === 'workforce_planning') {
          // 3. Serialize workspace capacity decision atomically in PostgreSQL
          await client.query(
            `SELECT pg_advisory_xact_lock(hashtext('workforce_planning_workspace'), hashtext($1::text))`,
            [candidate.workspace_id],
          );

          const countRes = await client.query(
            `SELECT COUNT(*) AS running_count
             FROM job_executions
             WHERE workspace_id = $1
               AND job_type = 'workforce_planning'
               AND status = 'running'
               AND lease_expires_at > NOW()
               AND id <> $2`,
            [candidate.workspace_id, candidate.id],
          );

          if (Number(countRes.rows[0]?.running_count ?? 0) >= 3) {
            await client.query('ROLLBACK');
            excludedWorkspaceIds.push(candidate.workspace_id);
            continue;
          }
        }

        // 4. Atomically claim the candidate job
        const updateRes = await client.query(
          `UPDATE job_executions
           SET status = 'running',
               lease_owner = $1,
               lease_expires_at = NOW() + ($2 || ' seconds')::INTERVAL,
               attempt = attempt + 1,
               started_at = COALESCE(started_at, NOW()),
               updated_at = NOW(),
               version = version + 1
           WHERE id = $3
           RETURNING *`,
          [validWorkerId, validLeaseDuration, candidate.id],
        );

        const claimedJob = updateRes.rows[0];

        // 5. Consistently transition operation and ai_run from 'queued' to 'running'
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

        if (claimedJob.job_type === 'workforce_planning' && claimedJob.work_item_id) {
          await client.query(
            `UPDATE work_items
             SET status = 'running',
                 started_at = COALESCE(started_at, NOW()),
                 updated_at = NOW(),
                 version = version + 1
             WHERE id = $1 AND workspace_id = $2 AND status = 'queued'`,
            [claimedJob.work_item_id, claimedJob.workspace_id],
          );

          await client.query(
            `UPDATE agent_assignments
             SET office_state = 'running',
                 updated_at = NOW(),
                 version = version + 1
             WHERE work_item_id = $1 AND workspace_id = $2 AND office_state = 'preparing'`,
            [claimedJob.work_item_id, claimedJob.workspace_id],
          );
        }

        await client.query('COMMIT');
        return mapJobExecutionRow(claimedJob);
      }

      return null;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }
}
