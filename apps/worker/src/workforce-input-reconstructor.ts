import type { DatabasePoolClient } from '@affiliate-content-os/infrastructure/database';
import { mapProductFactRow } from '@affiliate-content-os/infrastructure/catalog';
import { mapAnalysisRow } from '@affiliate-content-os/infrastructure/analysis';
import type { AIPlanningRoleInput } from '@affiliate-content-os/application';
import {
  computeCanonicalContextHash,
  type AnalysisSnapshot,
  type ProductFactSnapshot,
} from '@affiliate-content-os/domain';
import type { ValidatedWorkforcePlanningPayload } from './workforce-payload-validator.js';

export interface ReconstructedWorkforceContext {
  readonly planningInput: AIPlanningRoleInput;
  readonly validFactIds: Set<string>;
  readonly validAnalysisIds: Set<string>;
  readonly assignmentId: string;
}

export async function reconstructWorkforceContext(
  client: DatabasePoolClient,
  payload: ValidatedWorkforcePlanningPayload,
): Promise<ReconstructedWorkforceContext> {
  // 1. Query work order directive text
  const woRes = await client.query(
    `SELECT directive_text, status FROM work_orders WHERE id = $1 AND workspace_id = $2`,
    [payload.workOrderId, payload.workspaceId],
  );
  if (woRes.rowCount === 0 || !woRes.rows[0]) {
    throw new Error(`Work order not found: ${payload.workOrderId}`);
  }
  const directiveText = String(woRes.rows[0].directive_text ?? '');

  // 2. Query assignment ID
  const assignRes = await client.query(
    `SELECT id FROM agent_assignments
     WHERE work_order_id = $1 AND work_item_id = $2`,
    [payload.workOrderId, payload.workItemId],
  );
  if (assignRes.rowCount === 0 || !assignRes.rows[0]) {
    throw new Error(`Agent assignment not found for work item: ${payload.workItemId}`);
  }
  const assignmentId = String(assignRes.rows[0].id);

  // 3. Query product
  const prodRes = await client.query(
    `SELECT name, merchant_name, category, description, audience_notes,
            allowed_claims_notes, prohibited_claims_notes, current_fact_set_id, status, version
     FROM products WHERE id = $1 AND workspace_id = $2`,
    [payload.productId, payload.workspaceId],
  );
  if (prodRes.rowCount === 0 || !prodRes.rows[0]) {
    throw new Error(`Product not found: ${payload.productId}`);
  }
  const prod = prodRes.rows[0];
  if (prod.status === 'archived' || prod.status !== 'active') {
    throw new Error('Product is archived or not active');
  }

  // 4. Query fact set & facts
  const factSetRes = await client.query(
    `SELECT id, status, version FROM product_fact_sets
     WHERE id = $1 AND product_id = $2 AND workspace_id = $3`,
    [prod.current_fact_set_id, payload.productId, payload.workspaceId],
  );
  if (
    factSetRes.rowCount === 0 ||
    !factSetRes.rows[0] ||
    factSetRes.rows[0].status !== 'confirmed'
  ) {
    throw new Error('Product fact set not confirmed');
  }

  const factsRes = await client.query(
    `SELECT *
     FROM product_facts
     WHERE fact_set_id = $1 AND workspace_id = $2`,
    [prod.current_fact_set_id, payload.workspaceId],
  );
  const facts: readonly ProductFactSnapshot[] = factsRes.rows.map(mapProductFactRow);
  const validFactIds = new Set<string>(facts.map((f) => f.id.toLowerCase()));

  // 5. Query context package analyses & loaded analyses
  const analysesRes = await client.query(
    `SELECT a.*
     FROM context_package_analyses cpa
     JOIN analyses a ON a.id = cpa.analysis_id AND a.workspace_id = cpa.workspace_id
     WHERE cpa.context_package_id = $1 AND cpa.workspace_id = $2`,
    [payload.contextPackageId, payload.workspaceId],
  );
  const acceptedAnalyses: readonly AnalysisSnapshot[] = analysesRes.rows.map(mapAnalysisRow);
  const validAnalysisIds = new Set<string>(acceptedAnalyses.map((a) => a.id.toLowerCase()));

  // 6. Verify context package hash matches locked sources
  const cpRes = await client.query(
    `SELECT context_hash, context_schema_version FROM context_packages WHERE id = $1 AND workspace_id = $2`,
    [payload.contextPackageId, payload.workspaceId],
  );
  if (cpRes.rowCount === 0 || !cpRes.rows[0]) {
    throw new Error('Context package not found');
  }

  const expectedHash = computeCanonicalContextHash({
    workspaceId: payload.workspaceId,
    productId: payload.productId,
    productVersion: Number(prod.version),
    factSetId: prod.current_fact_set_id,
    factSetVersion: Number(factSetRes.rows[0].version),
    analyses: acceptedAnalyses
      .map((a) => ({ analysisId: a.id, version: a.version }))
      .sort((a, b) => a.analysisId.localeCompare(b.analysisId)),
    schemaVersion: Number(cpRes.rows[0].context_schema_version),
  });

  const storedHash = Buffer.from(cpRes.rows[0].context_hash);
  if (!storedHash.equals(expectedHash)) {
    throw new Error('Context package hash mismatch: source entities have changed');
  }

  return {
    assignmentId,
    validFactIds,
    validAnalysisIds,
    planningInput: {
      workspaceId: payload.workspaceId,
      productId: payload.productId,
      productName: prod.name,
      merchantName: prod.merchant_name,
      category: prod.category,
      description: prod.description,
      audienceNotes: prod.audience_notes,
      allowedClaimsNotes: prod.allowed_claims_notes,
      prohibitedClaimsNotes: prod.prohibited_claims_notes,
      directiveText,
      facts,
      sourceAnalyses: acceptedAnalyses,
    },
  };
}
