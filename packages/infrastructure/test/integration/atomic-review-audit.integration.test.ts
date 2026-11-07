import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  parseAIRunId,
  parseAnalysisId,
  parseIsoTimestamp,
  parseOperationId,
  parseProductFactSetId,
  parseProductId,
  parseUserId,
  parseWorkspaceId,
} from '@affiliate-content-os/domain';
import { setupIsolatedTestDatabase, type TestDatabaseContext } from './helpers/setup.js';
import { PostgresAnalysisAdapter } from '../../src/analysis/postgres-analysis-adapter.js';
import { ReviewConflictError } from '@affiliate-content-os/application';

describe('atomic-review-audit.integration', () => {
  let context: TestDatabaseContext;
  let pool: pg.Pool;
  let adapter: PostgresAnalysisAdapter;

  const wsId = parseWorkspaceId('018f6c5b-21a4-789a-8def-000000000001');
  const userId = parseUserId('018f6c5b-21a4-789a-8def-000000000002');
  const reviewerId = parseUserId('018f6c5b-21a4-789a-8def-000000000003');
  const prodId = parseProductId('018f6c5b-21a4-789a-8def-000000000004');
  const factSetId = parseProductFactSetId('018f6c5b-21a4-789a-8def-000000000005');
  const opId = parseOperationId('018f6c5b-21a4-789a-8def-000000000006');
  const runId = parseAIRunId('018f6c5b-21a4-789a-8def-000000000007');

  beforeAll(async () => {
    context = await setupIsolatedTestDatabase();
    pool = new pg.Pool({ connectionString: context.dbUrl });
    adapter = new PostgresAnalysisAdapter(pool);

    await pool.query(
      `INSERT INTO users (id, identity_provider, identity_subject, email, display_name, status, created_at, updated_at, version)
       VALUES ($1, 'google', 'sub-rev1', 'rev1@example.com', 'User 1', 'active', NOW(), NOW(), 1),
              ($2, 'google', 'sub-rev2', 'rev2@example.com', 'User 2', 'active', NOW(), NOW(), 1)`,
      [userId, reviewerId],
    );

    await pool.query(
      `INSERT INTO workspaces (id, name, slug, timezone, status, created_at, updated_at, version)
       VALUES ($1, 'Review WS', 'review-ws', 'UTC', 'active', NOW(), NOW(), 1)`,
      [wsId],
    );

    await pool.query(
      `INSERT INTO products (
         id, workspace_id, name, merchant_name, canonical_url, canonical_url_hash,
         category, description, status, current_fact_set_id, created_at, updated_at, version
       ) VALUES ($1, $2, 'Review Prod', 'Merchant', 'https://example.com/rp', $3, 'Cat', 'Desc', 'active', null, NOW(), NOW(), 1)`,
      [prodId, wsId, Buffer.alloc(32, 1)],
    );

    await pool.query(
      `INSERT INTO product_fact_sets (
         id, workspace_id, product_id, revision_number, status, created_by_user_id,
         confirmed_by_user_id, confirmed_at, created_at, updated_at, version
       ) VALUES ($1, $2, $3, 1, 'confirmed', $4, $4, NOW(), NOW(), NOW(), 1)`,
      [factSetId, wsId, prodId, userId],
    );

    await pool.query(
      `INSERT INTO operations (
         id, workspace_id, operation_type, resource_type, resource_id,
         status, result_location, started_at, completed_at, requested_by_user_id, created_at, updated_at, version
       ) VALUES ($1, $2, 'product_analysis', 'product', $3, 'succeeded', '/res', NOW(), NOW(), $4, NOW(), NOW(), 1)`,
      [opId, wsId, prodId, userId],
    );

    await pool.query(
      `INSERT INTO ai_runs (
         id, workspace_id, operation_id, purpose, provider, model,
         prompt_template, prompt_version, input_schema_version, output_schema_version,
         input_hash, output_hash, status, requested_by_user_id, started_at, completed_at, created_at, updated_at, version
       ) VALUES ($1, $2, $3, 'product_analysis', 'google', 'gemini-2.5-flash', 'tmpl', '1.0', 1, 1, $4, $5, 'succeeded', $6, NOW(), NOW(), NOW(), NOW(), 1)`,
      [runId, wsId, opId, Buffer.alloc(32, 2), Buffer.alloc(32, 3), userId],
    );
  });

  afterAll(async () => {
    if (pool) await pool.end();
    await context?.cleanup();
  });

  async function seedAnalysis(
    analysisId: string,
    revision: number,
    status: 'generated' | 'accepted' | 'rejected' = 'generated',
  ) {
    await pool.query(
      `INSERT INTO analyses (
         id, workspace_id, product_id, analysis_type, revision_number,
         fact_set_id, ai_run_id, content_json, schema_version, status,
         created_by_user_id, created_at, updated_at, version
       ) VALUES ($1, $2, $3, 'product', $4, $5, $6, '{}', 1, $7, $8, NOW(), NOW(), 1)`,
      [analysisId, wsId, prodId, revision, factSetId, runId, status, userId],
    );
  }

  it('atomically updates analysis to accepted and inserts audit event', async () => {
    const analysisId = parseAnalysisId('018f6c5b-21a4-789a-8def-111111111111');
    const auditId = '018f6c5b-21a4-789a-8def-111111111112';
    await seedAnalysis(analysisId, 1);

    const result = await adapter.reviewAnalysisAtomic({
      workspaceId: wsId,
      analysisId,
      decision: 'accepted',
      reviewReason: 'Meets criteria',
      expectedVersion: 1,
      reviewedByUserId: reviewerId,
      reviewedAt: parseIsoTimestamp(new Date().toISOString()),
      auditEvent: {
        id: auditId,
        workspaceId: wsId,
        actorUserId: reviewerId,
        action: 'analysis.reviewed',
        resourceType: 'analysis',
        resourceId: analysisId,
        result: 'succeeded',
        changesJson: { status: 'accepted' },
      },
    });

    expect(result.status).toBe('accepted');
    expect(result.reviewReason).toBe('Meets criteria');
    expect(result.reviewedByUserId).toBe(reviewerId);
    expect(result.version).toBe(2);

    // Verify audit event exists
    const auditRow = await pool.query('SELECT * FROM audit_events WHERE id = $1', [auditId]);
    expect(auditRow.rows).toHaveLength(1);
    expect(auditRow.rows[0].action).toBe('analysis.reviewed');
    expect(auditRow.rows[0].actor_user_id).toBe(reviewerId);
  });

  it('idempotent replay: repeating the exact same decision with original expectedVersion returns current snapshot without duplicate audit', async () => {
    const analysisId = parseAnalysisId('018f6c5b-21a4-789a-8def-111111111111');
    const auditId = '018f6c5b-21a4-789a-8def-111111111113';

    const replay = await adapter.reviewAnalysisAtomic({
      workspaceId: wsId,
      analysisId,
      decision: 'accepted',
      reviewReason: 'Meets criteria',
      expectedVersion: 1, // original expectedVersion repeated
      reviewedByUserId: reviewerId,
      reviewedAt: parseIsoTimestamp(new Date().toISOString()),
      auditEvent: {
        id: auditId,
        workspaceId: wsId,
        actorUserId: reviewerId,
        action: 'analysis.reviewed',
        resourceType: 'analysis',
        resourceId: analysisId,
        result: 'succeeded',
        changesJson: { status: 'accepted' },
      },
    });

    expect(replay.status).toBe('accepted');
    expect(replay.version).toBe(2);

    // Verify no second audit event was inserted
    const auditRows = await pool.query('SELECT * FROM audit_events WHERE resource_id = $1', [
      analysisId,
    ]);
    expect(auditRows.rows).toHaveLength(1);
  });

  it('conflicting decision throws ReviewConflictError', async () => {
    const analysisId = parseAnalysisId('018f6c5b-21a4-789a-8def-111111111111');
    const auditId = '018f6c5b-21a4-789a-8def-111111111114';

    // Trying to reject an already accepted analysis
    await expect(
      adapter.reviewAnalysisAtomic({
        workspaceId: wsId,
        analysisId,
        decision: 'rejected',
        reviewReason: 'Changed mind',
        expectedVersion: 2,
        reviewedByUserId: reviewerId,
        reviewedAt: parseIsoTimestamp(new Date().toISOString()),
        auditEvent: {
          id: auditId,
          workspaceId: wsId,
          actorUserId: reviewerId,
          action: 'analysis.reviewed',
          resourceType: 'analysis',
          resourceId: analysisId,
          result: 'succeeded',
          changesJson: { status: 'rejected' },
        },
      }),
    ).rejects.toThrow(ReviewConflictError);
  });

  it('stale expected version throws ReviewConflictError', async () => {
    const analysisId = parseAnalysisId('018f6c5b-21a4-789a-8def-222222222222');
    const auditId = '018f6c5b-21a4-789a-8def-222222222223';
    await seedAnalysis(analysisId, 2);

    await expect(
      adapter.reviewAnalysisAtomic({
        workspaceId: wsId,
        analysisId,
        decision: 'rejected',
        reviewReason: 'Low quality',
        expectedVersion: 99, // Stale version
        reviewedByUserId: reviewerId,
        reviewedAt: parseIsoTimestamp(new Date().toISOString()),
        auditEvent: {
          id: auditId,
          workspaceId: wsId,
          actorUserId: reviewerId,
          action: 'analysis.reviewed',
          resourceType: 'analysis',
          resourceId: analysisId,
          result: 'succeeded',
          changesJson: { status: 'rejected' },
        },
      }),
    ).rejects.toThrow(ReviewConflictError);
  });

  it('atomic rollback if audit event violates constraints', async () => {
    const analysisId = parseAnalysisId('018f6c5b-21a4-789a-8def-333333333333');
    const auditId = '018f6c5b-21a4-789a-8def-333333333334';
    await seedAnalysis(analysisId, 3);

    // Invalid audit action format: contains invalid characters that violate audit_events_action_check
    await expect(
      adapter.reviewAnalysisAtomic({
        workspaceId: wsId,
        analysisId,
        decision: 'accepted',
        reviewReason: 'Valid',
        expectedVersion: 1,
        reviewedByUserId: reviewerId,
        reviewedAt: parseIsoTimestamp(new Date().toISOString()),
        auditEvent: {
          id: auditId,
          workspaceId: wsId,
          actorUserId: reviewerId,
          action: 'INVALID ACTION WITH SPACES!',
          resourceType: 'analysis',
          resourceId: analysisId,
          result: 'succeeded',
          changesJson: { status: 'accepted' },
        },
      }),
    ).rejects.toThrow();

    // Verify analysis was NOT updated to accepted
    const check = await pool.query('SELECT status, version FROM analyses WHERE id = $1', [
      analysisId,
    ]);
    expect(check.rows[0].status).toBe('generated');
    expect(Number(check.rows[0].version)).toBe(1);
  });
});
