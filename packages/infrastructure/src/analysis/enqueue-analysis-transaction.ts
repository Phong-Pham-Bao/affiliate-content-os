import type pg from 'pg';
import {
  AIBudgetExhaustedError,
  AIDisabledError,
  AIRateLimitExceededError,
  IdempotencyKeyReusedError,
  type EnqueueAnalysisAtomicParams,
  type EnqueueAnalysisTransactionResult,
} from '@affiliate-content-os/application';
import { parseOperationId } from '@affiliate-content-os/domain';
import { DatabaseError } from '../database/errors.js';
import { computeIdempotencyAdvisoryLockKey } from '../tenancy/postgres-idempotency-adapter.js';
import { insertEnqueueEntities } from './enqueue-analysis-row-inserts.js';
import { parseSafeBigIntNumber } from './job-policy-mappers.js';
import { validateSafeInteger } from './mapper-safety.js';

export async function executeEnqueueAnalysisTransaction(
  client: pg.PoolClient,
  params: EnqueueAnalysisAtomicParams,
): Promise<EnqueueAnalysisTransactionResult> {
  // 1. Serialize concurrent requests with same idempotency key using transaction-scoped advisory lock
  const lockKey = computeIdempotencyAdvisoryLockKey(
    params.idempotency.principalId,
    params.idempotency.routeKey,
    params.idempotency.keyHash,
  );
  await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [lockKey]);

  // 2. Check idempotency record
  const idempCheck = await client.query(
    `SELECT request_hash, response_json, resource_id
     FROM idempotency_keys
     WHERE workspace_id = $1 AND principal_id = $2 AND route_key = $3 AND key_hash = $4
     FOR UPDATE`,
    [
      params.operation.workspaceId,
      params.idempotency.principalId,
      params.idempotency.routeKey,
      params.idempotency.keyHash,
    ],
  );

  if (idempCheck.rows.length > 0) {
    const existing = idempCheck.rows[0];
    const existingReqHash = Buffer.isBuffer(existing.request_hash)
      ? new Uint8Array(existing.request_hash)
      : existing.request_hash;

    const matches =
      Buffer.compare(Buffer.from(existingReqHash), Buffer.from(params.idempotency.requestHash)) ===
      0;

    if (!matches) {
      throw new IdempotencyKeyReusedError();
    }

    const resp =
      typeof existing.response_json === 'string'
        ? JSON.parse(existing.response_json)
        : existing.response_json;

    return {
      operationId: parseOperationId(resp.operationId ?? existing.resource_id),
      cached: true,
    };
  }

  // 3. Budget & Rate-Limit Accounting using PostgreSQL transaction time and UTC calendar months
  const policyCheck = await client.query(
    `SELECT ai_enabled, monthly_budget_microunits, current_spend_microunits,
            reserved_spend_microunits, rate_limit_per_minute, budget_period_start,
            minute_window_start, minute_request_count, version,
            CURRENT_TIMESTAMP AS tx_now,
            date_trunc('month', CURRENT_TIMESTAMP AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AS current_month_start,
            date_trunc('month', budget_period_start AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AS recorded_month_start
     FROM workspace_ai_policies
     WHERE workspace_id = $1
     FOR UPDATE`,
    [params.operation.workspaceId],
  );

  if (policyCheck.rows.length === 0) {
    throw new AIDisabledError(params.operation.workspaceId);
  }

  const policy = policyCheck.rows[0];
  if (!policy.ai_enabled) {
    throw new AIDisabledError(params.operation.workspaceId);
  }

  const monthlyBudget = parseSafeBigIntNumber(
    policy.monthly_budget_microunits,
    'monthly_budget_microunits',
  );
  let currentSpend = parseSafeBigIntNumber(
    policy.current_spend_microunits,
    'current_spend_microunits',
  );
  const reservedSpend = parseSafeBigIntNumber(
    policy.reserved_spend_microunits,
    'reserved_spend_microunits',
  );
  const rateLimit = validateSafeInteger(
    policy.rate_limit_per_minute,
    'rate_limit_per_minute',
    1,
    100_000,
  );
  const estimated = validateSafeInteger(
    params.estimatedCostMicrounits,
    'estimatedCostMicrounits',
    1,
    10_000_000,
  );

  // Check numeric overflow
  if (
    currentSpend > Number.MAX_SAFE_INTEGER - reservedSpend ||
    currentSpend + reservedSpend > Number.MAX_SAFE_INTEGER - estimated
  ) {
    throw new DatabaseError('Integer overflow during AI budget computation');
  }

  const txNow = new Date(policy.tx_now);
  const currentMonthStart = new Date(policy.current_month_start);
  const recordedMonthStart = new Date(policy.recorded_month_start);

  let budgetPeriodStart = new Date(policy.budget_period_start);
  // Calendar month UTC rollover: if recorded month is before current month, rollover spend but preserve reservation
  if (recordedMonthStart.getTime() < currentMonthStart.getTime()) {
    budgetPeriodStart = currentMonthStart;
    currentSpend = 0;
  }

  let minuteWindowStart = new Date(policy.minute_window_start);
  let minuteRequestCount = validateSafeInteger(
    policy.minute_request_count,
    'minute_request_count',
    0,
    100_000,
  );

  // 1-minute rate limit window check
  const oneMinuteMs = 60 * 1000;
  if (txNow.getTime() - minuteWindowStart.getTime() >= oneMinuteMs) {
    minuteWindowStart = txNow;
    minuteRequestCount = 0;
  }

  // Check rate limit
  if (minuteRequestCount + 1 > rateLimit) {
    throw new AIRateLimitExceededError();
  }

  // Check monthly budget
  if (currentSpend + reservedSpend + estimated > monthlyBudget) {
    throw new AIBudgetExhaustedError();
  }

  // Atomically update policy with reservation, minute count, and rollover markers
  const policyUpdate = await client.query(
    `UPDATE workspace_ai_policies
     SET reserved_spend_microunits = reserved_spend_microunits + $1,
         current_spend_microunits = $2,
         minute_request_count = $3,
         budget_period_start = $4,
         minute_window_start = $5,
         updated_at = NOW(),
         version = version + 1
     WHERE workspace_id = $6`,
    [
      estimated,
      currentSpend,
      minuteRequestCount + 1,
      budgetPeriodStart.toISOString(),
      minuteWindowStart.toISOString(),
      params.operation.workspaceId,
    ],
  );
  if (policyUpdate.rowCount !== 1) {
    throw new DatabaseError(
      `Failed to update workspace AI policy for ${params.operation.workspaceId}`,
    );
  }

  // 4. Insert all enqueue entities with verified row counts
  await insertEnqueueEntities(client, params);

  return {
    operationId: params.operation.id,
    aiRunId: params.aiRun.id,
    jobId: params.job.id,
    cached: false,
  };
}
