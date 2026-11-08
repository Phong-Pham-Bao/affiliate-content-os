import type pg from 'pg';
import type {
  ArtifactChangeRequestDTO,
  ContentArtifactDetailDTO,
  ContentArtifactLineageDTO,
  ContentArtifactRevisionDTO,
  ScriptGenerationUnitDTO,
} from '@affiliate-content-os/application';
import { mapSafeTimestamp } from '../catalog/mapper-helpers.js';

export async function getArtifactRevisionsQuery(
  client: pg.PoolClient,
  workspaceId: string,
  artifactId: string,
): Promise<readonly ContentArtifactRevisionDTO[]> {
  const res = await client.query(
    `SELECT id, workspace_id, artifact_id, revision_number, content_json,
            content_hash, schema_version, prompt_template, prompt_version,
            provider, model, token_input, token_output, cost_microunits,
            cost_currency, latency_ms, author_role_key, created_at
     FROM content_artifact_revisions
     WHERE workspace_id = $1 AND artifact_id = $2
     ORDER BY revision_number ASC`,
    [workspaceId, artifactId],
  );

  return res.rows.map((r) => ({
    id: r.id,
    workspaceId: r.workspace_id,
    artifactId: r.artifact_id,
    revisionNumber: r.revision_number,
    contentJson: r.content_json,
    contentHashHex: Buffer.from(r.content_hash).toString('hex'),
    schemaVersion: r.schema_version,
    promptTemplate: r.prompt_template,
    promptVersion: r.prompt_version,
    provider: r.provider,
    model: r.model,
    tokenInput: r.token_input,
    tokenOutput: r.token_output,
    costMicrounits: r.cost_microunits !== null ? Number(r.cost_microunits) : null,
    costCurrency: r.cost_currency,
    latencyMs: r.latency_ms,
    authorRoleKey: r.author_role_key,
    createdAt: mapSafeTimestamp(r.created_at, 'created_at'),
  }));
}

export async function getArtifactRevisionByNumberQuery(
  client: pg.PoolClient,
  workspaceId: string,
  artifactId: string,
  revisionNumber: number,
): Promise<ContentArtifactDetailDTO | null> {
  const artRes = await client.query(
    `SELECT id, workspace_id, product_id, work_order_id, work_item_id,
            assignment_id, author_role_key, artifact_type, lifecycle_status,
            current_revision_number, created_at, updated_at, version
     FROM content_artifacts
     WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, artifactId],
  );
  if (artRes.rowCount === 0 || !artRes.rows[0]) {
    return null;
  }
  const artRow = artRes.rows[0];

  const revRes = await client.query(
    `SELECT id, workspace_id, artifact_id, revision_number, content_json,
            content_hash, schema_version, prompt_template, prompt_version,
            provider, model, token_input, token_output, cost_microunits,
            cost_currency, latency_ms, author_role_key, created_at
     FROM content_artifact_revisions
     WHERE workspace_id = $1 AND artifact_id = $2 AND revision_number = $3`,
    [workspaceId, artifactId, revisionNumber],
  );
  if (revRes.rowCount === 0 || !revRes.rows[0]) {
    return null;
  }
  const revRow = revRes.rows[0];

  const evRes = await client.query(
    `SELECT id, source_kind, source_id, created_at
     FROM artifact_evidence_refs
     WHERE workspace_id = $1 AND artifact_id = $2 AND revision_number = $3
     ORDER BY created_at ASC`,
    [workspaceId, artifactId, revisionNumber],
  );

  const lineageRes = await client.query(
    `SELECT id, artifact_id, revision_number, parent_revision_number,
            lineage_type, change_request_id, content_brief_hash,
            content_brief_version, planning_revision_ids_json,
            source_script_unit_ids_json, metadata_json, created_at
     FROM content_artifact_lineage
     WHERE workspace_id = $1 AND artifact_id = $2 AND revision_number = $3`,
    [workspaceId, artifactId, revisionNumber],
  );

  let lineage: ContentArtifactLineageDTO | null = null;
  if (lineageRes.rowCount && lineageRes.rowCount > 0 && lineageRes.rows[0]) {
    const l = lineageRes.rows[0];
    lineage = {
      id: l.id,
      artifactId: l.artifact_id,
      revisionNumber: l.revision_number,
      parentRevisionNumber: l.parent_revision_number,
      lineageType: l.lineage_type,
      changeRequestId: l.change_request_id,
      contentBriefHashHex: Buffer.from(l.content_brief_hash).toString('hex'),
      contentBriefVersion: l.content_brief_version,
      planningRevisionIds: l.planning_revision_ids_json,
      sourceScriptUnitIds: l.source_script_unit_ids_json,
      metadata: l.metadata_json,
      createdAt: mapSafeTimestamp(l.created_at, 'created_at'),
    };
  }

  return {
    artifact: {
      id: artRow.id,
      workspaceId: artRow.workspace_id,
      productId: artRow.product_id,
      workOrderId: artRow.work_order_id,
      workItemId: artRow.work_item_id,
      assignmentId: artRow.assignment_id,
      authorRoleKey: artRow.author_role_key,
      artifactType: artRow.artifact_type,
      lifecycleStatus: artRow.lifecycle_status,
      currentRevisionNumber: artRow.current_revision_number,
      createdAt: mapSafeTimestamp(artRow.created_at, 'created_at'),
      updatedAt: mapSafeTimestamp(artRow.updated_at, 'updated_at'),
      version: Number(artRow.version),
    },
    latestRevision: {
      id: revRow.id,
      workspaceId: revRow.workspace_id,
      artifactId: revRow.artifact_id,
      revisionNumber: revRow.revision_number,
      contentJson: revRow.content_json,
      contentHashHex: Buffer.from(revRow.content_hash).toString('hex'),
      schemaVersion: revRow.schema_version,
      promptTemplate: revRow.prompt_template,
      promptVersion: revRow.prompt_version,
      provider: revRow.provider,
      model: revRow.model,
      tokenInput: revRow.token_input,
      tokenOutput: revRow.token_output,
      costMicrounits: revRow.cost_microunits !== null ? Number(revRow.cost_microunits) : null,
      costCurrency: revRow.cost_currency,
      latencyMs: revRow.latency_ms,
      authorRoleKey: revRow.author_role_key,
      createdAt: mapSafeTimestamp(revRow.created_at, 'created_at'),
    },
    evidenceReferences: evRes.rows.map((e) => ({
      id: e.id,
      sourceKind: e.source_kind,
      sourceId: e.source_id,
      createdAt: mapSafeTimestamp(e.created_at, 'created_at'),
    })),
    lineage,
  };
}

export async function getChangeRequestByIdQuery(
  client: pg.PoolClient,
  workspaceId: string,
  artifactId: string,
  changeRequestId: string,
): Promise<ArtifactChangeRequestDTO | null> {
  const res = await client.query(
    `SELECT id, artifact_id, base_revision_number, base_content_hash,
            requested_by_user_id, instruction_text, selected_video_numbers,
            target_variant_count, status, resulting_revision_number,
            failure_reason, failure_code, created_at, updated_at, version
     FROM artifact_change_requests
     WHERE workspace_id = $1 AND artifact_id = $2 AND id = $3`,
    [workspaceId, artifactId, changeRequestId],
  );
  if (res.rowCount === 0 || !res.rows[0]) {
    return null;
  }
  const r = res.rows[0];
  return {
    id: r.id,
    artifactId: r.artifact_id,
    baseRevisionNumber: r.base_revision_number,
    baseContentHashHex: Buffer.from(r.base_content_hash).toString('hex'),
    requestedByUserId: r.requested_by_user_id,
    instructionText: r.instruction_text,
    selectedVideoNumbers: r.selected_video_numbers,
    targetVariantCount: r.target_variant_count,
    status: r.status,
    resultingRevisionNumber: r.resulting_revision_number,
    failureReason: r.failure_reason,
    failureCode: r.failure_code ? String(r.failure_code) : null,
    createdAt: mapSafeTimestamp(r.created_at, 'created_at'),
    updatedAt: mapSafeTimestamp(r.updated_at, 'updated_at'),
    version: Number(r.version),
  };
}

export async function listScriptUnitsQuery(
  client: pg.PoolClient,
  workspaceId: string,
  workOrderId: string,
  changeRequestId?: string | null,
): Promise<readonly ScriptGenerationUnitDTO[]> {
  const query = changeRequestId
    ? `SELECT id, work_order_id, work_item_id, video_number, target_variant_count,
              status, error_category, error_message, created_at, updated_at
       FROM script_generation_units
       WHERE workspace_id = $1 AND work_order_id = $2 AND change_request_id = $3
       ORDER BY video_number ASC`
    : `SELECT id, work_order_id, work_item_id, video_number, target_variant_count,
              status, error_category, error_message, created_at, updated_at
       FROM script_generation_units
       WHERE workspace_id = $1 AND work_order_id = $2 AND change_request_id IS NULL
       ORDER BY video_number ASC`;

  const params = changeRequestId
    ? [workspaceId, workOrderId, changeRequestId]
    : [workspaceId, workOrderId];
  const res = await client.query(query, params);

  return res.rows.map((r) => ({
    id: r.id,
    workOrderId: r.work_order_id,
    workItemId: r.work_item_id,
    videoNumber: r.video_number,
    targetVariantCount: r.target_variant_count,
    status: r.status,
    errorCategory: r.error_category,
    errorMessage: r.error_message,
    createdAt: mapSafeTimestamp(r.created_at, 'created_at'),
    updatedAt: mapSafeTimestamp(r.updated_at, 'updated_at'),
  }));
}
