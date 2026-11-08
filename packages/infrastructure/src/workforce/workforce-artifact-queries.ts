import type pg from 'pg';
import type {
  ContentArtifactDetailDTO,
  ContentArtifactSummaryDTO,
  WorkOrderActivityDTO,
} from '@affiliate-content-os/application';
import {
  mapArtifactEvidenceRefRowToDTO,
  mapContentArtifactRevisionRowToDTO,
  mapContentArtifactRowToSummaryDTO,
  mapWorkOrderActivityRowToDTO,
} from './workforce-artifact-mappers.js';

export async function queryWorkOrderArtifacts(
  pool: pg.Pool,
  workspaceId: string,
  workOrderId: string,
): Promise<readonly ContentArtifactSummaryDTO[]> {
  const res = await pool.query(
    `SELECT * FROM content_artifacts
     WHERE workspace_id = $1 AND work_order_id = $2
     ORDER BY created_at ASC, id ASC`,
    [workspaceId, workOrderId],
  );
  return Object.freeze(res.rows.map(mapContentArtifactRowToSummaryDTO));
}

export async function queryArtifactById(
  pool: pg.Pool,
  workspaceId: string,
  artifactId: string,
): Promise<ContentArtifactDetailDTO | null> {
  const artifactRes = await pool.query(
    `SELECT * FROM content_artifacts WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, artifactId],
  );
  if (artifactRes.rowCount === 0) return null;

  const artifactRow = artifactRes.rows[0];
  const artifact = mapContentArtifactRowToSummaryDTO(artifactRow);
  const revNumber = Number(artifactRow.current_revision_number ?? 1);

  const revRes = await pool.query(
    `SELECT * FROM content_artifact_revisions
     WHERE workspace_id = $1 AND artifact_id = $2 AND revision_number = $3`,
    [workspaceId, artifactId, revNumber],
  );
  if (revRes.rowCount === 0) {
    return null;
  }

  const evRes = await pool.query(
    `SELECT * FROM artifact_evidence_refs
     WHERE workspace_id = $1 AND artifact_id = $2 AND revision_number = $3
     ORDER BY created_at ASC, id ASC`,
    [workspaceId, artifactId, revNumber],
  );
  const evidenceReferences = Object.freeze(evRes.rows.map(mapArtifactEvidenceRefRowToDTO));
  const latestRevision = mapContentArtifactRevisionRowToDTO(revRes.rows[0]);

  return Object.freeze({ artifact, latestRevision, evidenceReferences });
}

export async function queryWorkOrderActivities(
  pool: pg.Pool,
  workspaceId: string,
  workOrderId: string,
): Promise<readonly WorkOrderActivityDTO[]> {
  const res = await pool.query(
    `SELECT * FROM audit_events
     WHERE workspace_id = $1
       AND (
         (resource_type = 'work_order' AND resource_id = $2)
         OR (resource_type = 'operation' AND resource_id IN (
           SELECT id FROM operations WHERE workspace_id = $1 AND work_order_id = $2
         ))
         OR (resource_type = 'content_artifact' AND resource_id IN (
           SELECT id FROM content_artifacts WHERE workspace_id = $1 AND work_order_id = $2
         ))
         OR (changes_json->>'workOrderId' = $2::text)
       )
     ORDER BY created_at DESC
     LIMIT 50`,
    [workspaceId, workOrderId],
  );
  return Object.freeze(res.rows.map((row) => mapWorkOrderActivityRowToDTO(row)));
}
