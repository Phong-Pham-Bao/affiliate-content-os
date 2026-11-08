import type pg from 'pg';
import {
  AIBudgetExhaustedError,
  AIDisabledError,
  AIRateLimitExceededError,
} from '@affiliate-content-os/application';
import { DatabaseError } from '../database/errors.js';
import { parseSafeBigIntNumber } from '../analysis/job-policy-mappers.js';
import { validateSafeInteger } from '../analysis/mapper-safety.js';
import type { KickoffPersistenceSnapshot } from './workforce-types.js';

export async function reserveKickoffBudget(
  client: pg.PoolClient,
  snapshot: KickoffPersistenceSnapshot,
): Promise<void> {
  const wsId = snapshot.workOrder.workspaceId;
  const callsCount = snapshot.planningJobs.length;
  const estimatedCost = snapshot.totalEstimatedCostMicrounits;

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
    [wsId],
  );

  if (policyCheck.rows.length === 0) {
    throw new AIDisabledError(wsId);
  }

  const policy = policyCheck.rows[0];
  if (!policy.ai_enabled) {
    throw new AIDisabledError(wsId);
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
  const estimated = validateSafeInteger(estimatedCost, 'estimatedCostMicrounits', 0, 10_000_000);

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

  const oneMinuteMs = 60 * 1000;
  if (txNow.getTime() - minuteWindowStart.getTime() >= oneMinuteMs) {
    minuteWindowStart = txNow;
    minuteRequestCount = 0;
  }

  // Check rate limit for callsCount
  if (minuteRequestCount + callsCount > rateLimit) {
    throw new AIRateLimitExceededError();
  }

  // Check monthly budget
  if (currentSpend + reservedSpend + estimated > monthlyBudget) {
    throw new AIBudgetExhaustedError();
  }

  // Atomically update policy with reservation, minute count, and rollover markers
  await client.query(
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
      minuteRequestCount + callsCount,
      budgetPeriodStart,
      minuteWindowStart,
      wsId,
    ],
  );
}
