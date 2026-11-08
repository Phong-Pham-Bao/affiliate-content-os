import type pg from 'pg';
import { generateUuidV7 } from '@affiliate-content-os/application';
import {
  computeContentBriefHash,
  parseProductId,
  parseWorkOrderId,
  parseWorkspaceId,
  validateAudienceInsightBoard,
  validateProductCampaignPlan,
  validateVideoSeriesPlan,
  type ContentBrief,
  type ProductCampaignPlan,
  type AudienceInsightBoard,
  type VideoSeriesPlan,
} from '@affiliate-content-os/domain';
import { DatabaseError } from '../database/errors.js';

export async function synthesizeAndPersistContentBrief(
  client: pg.PoolClient,
  workspaceId: string,
  workOrderId: string,
): Promise<{ readonly brief: ContentBrief; readonly briefHash: Uint8Array }> {
  // 1. Check existing brief
  const existingRes = await client.query(
    `SELECT brief_json, brief_hash
     FROM content_briefs
     WHERE workspace_id = $1 AND work_order_id = $2
     ORDER BY brief_version DESC
     LIMIT 1`,
    [workspaceId, workOrderId],
  );
  if (existingRes.rowCount && existingRes.rowCount > 0 && existingRes.rows[0]) {
    return {
      brief: existingRes.rows[0].brief_json as ContentBrief,
      briefHash: new Uint8Array(existingRes.rows[0].brief_hash),
    };
  }

  // 2. Fetch work order & product
  const woRes = await client.query(
    `SELECT w.id, w.product_id, w.directive_text, w.context_package_id,
            p.name AS product_name, p.merchant_name, p.category, p.description,
            ws.brand_voice, ws.default_disclosure AS disclosure_requirement
     FROM work_orders w
     JOIN products p ON p.id = w.product_id AND p.workspace_id = w.workspace_id
     JOIN workspaces ws ON ws.id = w.workspace_id
     WHERE w.workspace_id = $1 AND w.id = $2`,
    [workspaceId, workOrderId],
  );

  if (woRes.rowCount === 0 || !woRes.rows[0]) {
    throw new DatabaseError(`Work order ${workOrderId} not found for brief synthesis`);
  }
  const wo = woRes.rows[0];

  // 3. Fetch planning artifact revisions
  const artRes = await client.query(
    `SELECT a.artifact_type, r.id AS rev_id, r.revision_number, r.content_json
     FROM content_artifacts a
     JOIN content_artifact_revisions r
       ON r.artifact_id = a.id
      AND r.revision_number = a.current_revision_number
      AND r.workspace_id = a.workspace_id
     WHERE a.workspace_id = $1 AND a.work_order_id = $2
       AND a.artifact_type IN ('product_campaign_plan', 'audience_insight_board', 'video_series_plan')`,
    [workspaceId, workOrderId],
  );

  let campaignPlan: ProductCampaignPlan | null = null;
  let campaignRev = { id: '', num: 0 };
  let audienceBoard: AudienceInsightBoard | null = null;
  let audienceRev = { id: '', num: 0 };
  let seriesPlan: VideoSeriesPlan | null = null;
  let seriesRev = { id: '', num: 0 };

  for (const row of artRes.rows) {
    if (row.artifact_type === 'product_campaign_plan') {
      campaignPlan = validateProductCampaignPlan(row.content_json);
      campaignRev = { id: row.rev_id, num: row.revision_number };
    } else if (row.artifact_type === 'audience_insight_board') {
      audienceBoard = validateAudienceInsightBoard(row.content_json);
      audienceRev = { id: row.rev_id, num: row.revision_number };
    } else if (row.artifact_type === 'video_series_plan') {
      seriesPlan = validateVideoSeriesPlan(row.content_json);
      seriesRev = { id: row.rev_id, num: row.revision_number };
    }
  }

  if (!campaignPlan || !audienceBoard || !seriesPlan) {
    throw new DatabaseError(
      `Cannot synthesize content brief: missing planning artifacts for work order ${workOrderId}`,
    );
  }

  // 4. Fetch eligible fact and analysis IDs
  const factsRes = await client.query(
    `SELECT f.id
     FROM product_facts f
     JOIN context_packages cp ON cp.fact_set_id = f.fact_set_id AND cp.workspace_id = f.workspace_id
     WHERE cp.workspace_id = $1 AND cp.id = $2
       AND f.confidence = 'confirmed' AND f.claim_usage = 'allowed'`,
    [workspaceId, wo.context_package_id],
  );
  const eligibleFactIds = factsRes.rows.map((r) => r.id);

  const analysesRes = await client.query(
    `SELECT cpa.analysis_id
     FROM context_package_analyses cpa
     JOIN analyses a ON a.id = cpa.analysis_id AND a.workspace_id = cpa.workspace_id
     WHERE cpa.workspace_id = $1 AND cpa.context_package_id = $2
       AND a.status = 'accepted'`,
    [workspaceId, wo.context_package_id],
  );
  const eligibleAnalysisIds = analysesRes.rows.map((r) => r.analysis_id);

  const brief: ContentBrief = {
    schemaVersion: 1,
    workspaceId: parseWorkspaceId(workspaceId),
    productId: parseProductId(wo.product_id),
    workOrderId: parseWorkOrderId(workOrderId),
    briefVersion: 1,
    directiveText: wo.directive_text,
    brandVoice: wo.brand_voice ?? null,
    disclosureRequirement: wo.disclosure_requirement ?? null,
    productSummary: {
      productName: wo.product_name,
      merchantName: wo.merchant_name,
      category: wo.category,
      description: wo.description,
    },
    planningRevisions: {
      productCampaignPlanRevisionId: campaignRev.id,
      productCampaignPlanRevisionNumber: campaignRev.num,
      audienceInsightBoardRevisionId: audienceRev.id,
      audienceInsightBoardRevisionNumber: audienceRev.num,
      videoSeriesPlanRevisionId: seriesRev.id,
      videoSeriesPlanRevisionNumber: seriesRev.num,
    },
    campaignPlan,
    audienceBoard,
    seriesPlan,
    eligibleFactIds: Object.freeze(eligibleFactIds),
    eligibleAnalysisIds: Object.freeze(eligibleAnalysisIds),
    createdAt: new Date().toISOString(),
  };

  const briefHash = computeContentBriefHash(brief);
  const briefId = generateUuidV7();

  await client.query(
    `INSERT INTO content_briefs (
       id, workspace_id, product_id, work_order_id, brief_version,
       brief_hash, brief_json, created_at
     ) VALUES ($1, $2, $3, $4, 1, $5, $6::jsonb, NOW())
     ON CONFLICT (workspace_id, work_order_id, brief_version) DO NOTHING`,
    [
      briefId,
      workspaceId,
      wo.product_id,
      workOrderId,
      Buffer.from(briefHash),
      JSON.stringify(brief),
    ],
  );

  return { brief, briefHash };
}
