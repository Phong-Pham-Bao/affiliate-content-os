import { createHash } from 'node:crypto';
import type pg from 'pg';
import {
  parseWorkspaceId,
  parseUserId,
  parseProductId,
  parseProductFactSetId,
  parseOperationId,
  parseAIRunId,
  parseAnalysisId,
  type WorkspaceId,
  type UserId,
  type ProductId,
  type ProductFactSetId,
  type AnalysisId,
} from '@affiliate-content-os/domain';
import {
  buildKickoffAtomicPayload,
  type BuildKickoffPayloadInput,
  type KickoffWorkOrderAtomicParams,
} from '@affiliate-content-os/application';

export interface WorkforceSeedContext {
  readonly wsId: WorkspaceId;
  readonly ws2Id: WorkspaceId;
  readonly userId: UserId;
  readonly viewerId: UserId;
  readonly prodId: ProductId;
  readonly factSetId: ProductFactSetId;
  readonly analysisId1: AnalysisId;
  readonly analysisId2: AnalysisId;
}

export const FIXTURE_IDS = {
  wsId: parseWorkspaceId('018f6c5b-21a4-789a-8def-000000000001'),
  ws2Id: parseWorkspaceId('018f6c5b-21a4-789a-8def-000000000002'),
  userId: parseUserId('018f6c5b-21a4-789a-8def-000000000003'),
  viewerId: parseUserId('018f6c5b-21a4-789a-8def-000000000004'),
  prodId: parseProductId('018f6c5b-21a4-789a-8def-000000000005'),
  prod2Id: parseProductId('018f6c5b-21a4-789a-8def-000000000006'),
  factSetId: parseProductFactSetId('018f6c5b-21a4-789a-8def-000000000007'),
  opId: parseOperationId('018f6c5b-21a4-789a-8def-000000000008'),
  runId: parseAIRunId('018f6c5b-21a4-789a-8def-000000000009'),
  analysisId1: parseAnalysisId('018f6c5b-21a4-789a-8def-00000000000a'),
  analysisId2: parseAnalysisId('018f6c5b-21a4-789a-8def-00000000000b'),
};

export async function seedWorkforceBaseData(pool: pg.Pool): Promise<WorkforceSeedContext> {
  const {
    wsId,
    ws2Id,
    userId,
    viewerId,
    prodId,
    factSetId,
    opId,
    runId,
    analysisId1,
    analysisId2,
  } = FIXTURE_IDS;

  // Users
  await pool.query(
    `INSERT INTO users (id, identity_provider, identity_subject, email, display_name, status, created_at, updated_at, version)
     VALUES ($1, 'google', 'sub-wf-user', 'wf-user@example.com', 'WF User', 'active', NOW(), NOW(), 1),
            ($2, 'google', 'sub-wf-viewer', 'wf-viewer@example.com', 'WF Viewer', 'active', NOW(), NOW(), 1)`,
    [userId, viewerId],
  );

  // Workspaces
  await pool.query(
    `INSERT INTO workspaces (id, name, slug, timezone, status, created_at, updated_at, version)
     VALUES ($1, 'WF Workspace 1', 'wf-ws-1', 'UTC', 'active', NOW(), NOW(), 1),
            ($2, 'WF Workspace 2', 'wf-ws-2', 'UTC', 'active', NOW(), NOW(), 1)`,
    [wsId, ws2Id],
  );

  // Memberships: userId is owner in wsId, viewerId is viewer in wsId
  await pool.query(
    `INSERT INTO workspace_memberships (id, workspace_id, user_id, role, status, joined_at, created_at, updated_at, version)
     VALUES ('018f6c5b-21a4-789a-8def-000000000010', $1, $2, 'owner', 'active', NOW(), NOW(), NOW(), 1),
            ('018f6c5b-21a4-789a-8def-000000000011', $1, $3, 'viewer', 'active', NOW(), NOW(), NOW(), 1)`,
    [wsId, userId, viewerId],
  );

  // Product in wsId
  await pool.query(
    `INSERT INTO products (
       id, workspace_id, name, merchant_name, canonical_url, canonical_url_hash,
       category, description, status, current_fact_set_id, created_at, updated_at, version
     ) VALUES ($1, $2, 'WF Product', 'Merchant', 'https://example.com/wf', $3, 'Cat', 'Desc', 'active', null, NOW(), NOW(), 1)`,
    [prodId, wsId, Buffer.alloc(32, 1)],
  );

  // Confirmed fact set in wsId
  await pool.query(
    `INSERT INTO product_fact_sets (
       id, workspace_id, product_id, revision_number, status, created_by_user_id,
       confirmed_by_user_id, confirmed_at, created_at, updated_at, version
     ) VALUES ($1, $2, $3, 1, 'confirmed', $4, $4, NOW(), NOW(), NOW(), 1)`,
    [factSetId, wsId, prodId, userId],
  );

  // Link product current_fact_set_id to confirmed fact set
  await pool.query(`UPDATE products SET current_fact_set_id = $1 WHERE id = $2`, [
    factSetId,
    prodId,
  ]);

  // Operation and AI run for analyses
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

  // Two accepted analyses in wsId pointing to factSetId
  await pool.query(
    `INSERT INTO analyses (
       id, workspace_id, product_id, analysis_type, revision_number,
       fact_set_id, ai_run_id, content_json, schema_version, status,
       reviewed_by_user_id, reviewed_at, review_reason, created_by_user_id, created_at, updated_at, version
     ) VALUES
       ($1, $2, $3, 'product', 1, $4, $5, '{}', 1, 'accepted', $6, NOW(), 'Approved', $6, NOW(), NOW(), 1),
       ($7, $2, $3, 'niche', 1, $4, $5, '{}', 1, 'accepted', $6, NOW(), 'Approved', $6, NOW(), NOW(), 1)`,
    [analysisId1, wsId, prodId, factSetId, runId, userId, analysisId2],
  );

  return {
    wsId,
    ws2Id,
    userId,
    viewerId,
    prodId,
    factSetId,
    analysisId1,
    analysisId2,
  };
}

let seq = 1;
function testUuid(): string {
  const hex = (seq++).toString(16).padStart(12, '0');
  return `018f6c5b-21a4-789a-8def-${hex}`;
}

export function createTestKickoffParams(
  overrides?: Partial<BuildKickoffPayloadInput>,
): KickoffWorkOrderAtomicParams {
  const wsId = overrides?.wsId ?? FIXTURE_IDS.wsId;
  const prodId = overrides?.prodId ?? FIXTURE_IDS.prodId;
  const factSetId = overrides?.factSetId ?? FIXTURE_IDS.factSetId;
  const actorId = overrides?.actorId ?? FIXTURE_IDS.userId;
  const missionType = overrides?.missionType ?? 'short_video_series';
  const directiveText = overrides?.directiveText ?? 'Create a high-impact TikTok video series';
  const priority = overrides?.priority ?? 50;
  const productVersion = overrides?.productVersion ?? 1;
  const factSetVersion = overrides?.factSetVersion ?? 1;
  const sourceAnalyses = overrides?.sourceAnalyses ?? [
    { id: FIXTURE_IDS.analysisId1, version: 1 },
    { id: FIXTURE_IDS.analysisId2, version: 1 },
  ];

  const key = `test-key-${seq++}`;
  const keyHash = new Uint8Array(createHash('sha256').update(key).digest());
  const requestHash = new Uint8Array(createHash('sha256').update(`req-${key}`).digest());
  const routeKey = `POST /api/v1/workspaces/${wsId}/products/${prodId}/work-orders`;

  return buildKickoffAtomicPayload({
    wsId,
    prodId,
    factSetId,
    actorId,
    missionType,
    directiveText,
    priority,
    productVersion,
    factSetVersion,
    sourceAnalyses,
    keyHash,
    requestHash,
    routeKey,
    generateId: overrides?.generateId ?? testUuid,
    ...overrides,
  });
}
