# Sprint 3 AI Workforce Operations Runbook

This runbook provides actionable operational procedures for running, monitoring, diagnosing, and maintaining the Sprint 3 AI Creative Workforce platform in local and deployment environments.

---

## 1. Local Startup Sequence

Ensure local prerequisites are installed: Node.js 22+, pnpm 10+, and Docker Engine.

```bash
# 1. Start core infrastructure (PostgreSQL on localhost:5432)
pnpm infra:up

# 2. Validate and apply forward-only database migrations
pnpm db:migrate
pnpm db:migrate:validate

# 3. Start local development processes (API server, web frontend, background worker)
pnpm dev
```

For running individual services:
- **API Server**: `pnpm --filter @affiliate-content-os/api dev` (port 3001)
- **Web App**: `pnpm --filter @affiliate-content-os/web dev` (port 3000)
- **Worker Process**: `pnpm --filter @affiliate-content-os/worker dev`

---

## 2. Service Health Checks

| Service | Endpoint | Success Criteria | Unhealthy Action |
| --- | --- | --- | --- |
| **API Server Liveness** | `GET /health/live` | `200 OK`, `{"status":"ok"}` | Restart process container |
| **API Database Readiness** | `GET /health/ready` | `200 OK`, `{"database":"connected"}` | Verify DB pool & network |
| **Web Application** | `GET /` | `200 OK`, HTML app shell | Check Next.js server logs |
| **Background Worker** | Heartbeat log / DB lease table | Active lease updates in `work_order_jobs` | Inspect dead worker leases |

---

## 3. Worker & Gemini Provider Outage Handling

### 3.1 Durable Lease Recovery
- Every background work item is claimed using an atomic database lease (`claimed_at`, `lease_expires_at`).
- If a worker crashes or encounters an unhandled exit, the lease will naturally expire.
- The reaper job runs periodically to identify expired leases and transition stuck jobs back to `queued` or mark them `failed` with code `WORKER_LEASE_EXPIRED`.

### 3.2 Gemini Provider Outage & Transient Errors
- All Gemini calls pass through the internal provider gateway with bounded exponential backoff and jitter.
- Transient errors (`PROVIDER_RATE_LIMIT`, `PROVIDER_UNAVAILABLE`, `503 Service Unavailable`, `429 Too Many Requests`) are retried up to configured max attempts.
- When transient retries are exhausted, the job transitions to `failed` with an actionable failure code:
  - `PROVIDER_RATE_LIMIT`: Rate limit exceeded on Google AI Gemini API.
  - `PROVIDER_UNAVAILABLE`: Gemini upstream service unreachable or returning 5xx.
  - `BUDGET_EXHAUSTED`: Monthly token or spend limit reached.

---

## 4. Stuck / Expired Job Reaping

To manually inspect or trigger job recovery:
1. Query jobs with expired leases:
   ```sql
   SELECT id, work_order_id, role_key, status, lease_expires_at
   FROM work_order_jobs
   WHERE status = 'running' AND lease_expires_at < NOW();
   ```
2. The orchestrator reaper service automatically frees expired leases. If manual intervention is required, run the recovery command or trigger a work order retry from the UI/API.

---

## 5. Budget Exhaustion, Rate Limiting & Stale UI

### 5.1 Budget Exhaustion (`BUDGET_EXHAUSTED`)
- When a workspace reaches its configured monthly budget (`monthlyBudgetMicrounits`), the policy engine fences further job enqueuing.
- Running jobs fail safely with `BUDGET_EXHAUSTED`.
- The UI displays an honest warning banner and disables automated kickoff until an owner increases the budget.

### 5.2 Honest Polling & Stale Observation
- Web client polling (`pollWorkOrderUntilTerminal`) runs with bounded backoff and a hard deadline (default 15 minutes).
- If polling errors occur or network connectivity drops, the client sets `isStale: true` and preserves the last known valid state.
- The UI exposes an explicit `Manual Refresh` button so operators can pull fresh state without timer-driven fake progress.

---

## 6. Safe Logging Policy

To prevent secret leakage and sensitive data exposure:
- **Never Log**:
  - Raw Gemini API keys (`GEMINI_API_KEY`).
  - Raw system or user prompts containing confidential affiliate/merchant terms.
  - Authorization tokens, session cookies, or passwords.
  - Full raw provider response bodies containing unredacted PII.
- **Always Log**:
  - Work order ID, work item ID, role key, and assignment ID.
  - Normalized error codes (`PROVIDER_RATE_LIMIT`, `BUDGET_EXHAUSTED`, `LEASE_EXPIRED`).
  - Execution duration, token count, and retry attempt counters.

---

## 7. Database Backup, Restore & Forward-Only Migration Policy

### 7.1 Database Backup & Recovery
- Take automated logical dumps using `pg_dump`:
  ```bash
  pg_dump -Fc -h localhost -U postgres -d affiliate_content_os > backup_$(date +%Y%m%d_%H%M%S).dump
  ```
- Restore procedure:
  ```bash
  pg_restore -c -h localhost -U postgres -d affiliate_content_os backup_YYYYMMDD_HHMMSS.dump
  ```

### 7.2 Forward-Only Migrations
- The platform enforces forward-only migrations. **Rollback scripts are strictly prohibited.**
- Every migration must be idempotent and non-destructive.
- In case of a migration issue, issue a forward-fix migration that corrects the schema or data in place.
- Validate migrations before deployment:
  ```bash
  pnpm db:migrate:validate
  ```
