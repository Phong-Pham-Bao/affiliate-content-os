import type pg from 'pg';
import { generateUuidV7 } from '@affiliate-content-os/application';
import type {
  WorkforcePlanningSettlementParams,
  WorkforceSuccessOutcome,
} from './workforce-planning-settlement-types.js';

export async function persistContentArtifactAndRevision(
  client: pg.PoolClient,
  params: WorkforcePlanningSettlementParams,
  outcome: WorkforceSuccessOutcome,
): Promise<{ artifactId: string; revisionNumber: number }> {
  // 1. Check or insert content_artifacts
  const existingArtRes = await client.query(
    `SELECT id, current_revision_number FROM content_artifacts
     WHERE workspace_id = $1 AND work_order_id = $2 AND work_item_id = $3
     FOR UPDATE`,
    [params.workspaceId, params.workOrderId, params.workItemId],
  );

  let artifactId: string;
  let revisionNumber: number;

  if (existingArtRes.rowCount === 0 || !existingArtRes.rows[0]) {
    artifactId = generateUuidV7();
    revisionNumber = 1;
    await client.query(
      `INSERT INTO content_artifacts (
         id, workspace_id, product_id, work_order_id, work_item_id,
         assignment_id, author_role_key, artifact_type, lifecycle_status,
         current_revision_number, created_at, updated_at, version
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'review_required', 1, NOW(), NOW(), 1)`,
      [
        artifactId,
        params.workspaceId,
        params.productId,
        params.workOrderId,
        params.workItemId,
        params.assignmentId,
        params.authorRoleKey,
        params.artifactType,
      ],
    );
  } else {
    artifactId = existingArtRes.rows[0].id;
    revisionNumber = Number(existingArtRes.rows[0].current_revision_number) + 1;
    await client.query(
      `UPDATE content_artifacts
       SET current_revision_number = $1, lifecycle_status = 'review_required',
           updated_at = NOW(), version = version + 1
       WHERE id = $2`,
      [revisionNumber, artifactId],
    );
  }

  // 2. Insert immutable content_artifact_revisions
  const revisionId = generateUuidV7();
  await client.query(
    `INSERT INTO content_artifact_revisions (
       id, workspace_id, artifact_id, revision_number, content_json,
       content_hash, schema_version, prompt_template, prompt_version,
       provider, model, token_input, token_output, cost_microunits,
       cost_currency, latency_ms, author_role_key, created_at
     ) VALUES (
       $1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, NOW()
     )`,
    [
      revisionId,
      params.workspaceId,
      artifactId,
      revisionNumber,
      JSON.stringify(outcome.contentJson),
      Buffer.from(outcome.contentHash),
      outcome.schemaVersion,
      outcome.promptTemplate,
      outcome.promptVersion,
      outcome.provider,
      outcome.model,
      outcome.usage.tokenInput ?? null,
      outcome.usage.tokenOutput ?? null,
      outcome.usage.costMicrounits ?? null,
      outcome.usage.costCurrency ?? 'USD',
      outcome.usage.latencyMs ?? null,
      params.authorRoleKey,
    ],
  );

  // 3. Insert immutable artifact_evidence_refs
  for (const ref of outcome.evidenceReferences) {
    const refId = generateUuidV7();
    await client.query(
      `INSERT INTO artifact_evidence_refs (
         id, workspace_id, artifact_id, revision_number, source_kind, source_id, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [refId, params.workspaceId, artifactId, revisionNumber, ref.sourceKind, ref.sourceId],
    );
  }

  return { artifactId, revisionNumber };
}
