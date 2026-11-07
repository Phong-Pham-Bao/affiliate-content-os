import crypto from 'node:crypto';
import type pg from 'pg';
import type { CreateAnalysisRecordParams } from '@affiliate-content-os/application';
import type { WorkspaceId } from '@affiliate-content-os/domain';
import { DatabaseError } from '../database/errors.js';

export async function insertAnalysisWithConcurrencySafeRevision(
  client: pg.PoolClient,
  workspaceId: WorkspaceId,
  analysis: CreateAnalysisRecordParams,
): Promise<number> {
  // Lock parent product row for serialized revision allocation
  const prodLock = await client.query(
    `SELECT id FROM products WHERE workspace_id = $1 AND id = $2 FOR UPDATE`,
    [workspaceId, analysis.productId],
  );
  if (prodLock.rows.length === 0) {
    throw new DatabaseError(`Parent product not found: ${analysis.productId}`);
  }

  const revRes = await client.query(
    `SELECT COALESCE(MAX(revision_number), 0) + 1 AS next_rev
     FROM analyses
     WHERE workspace_id = $1 AND product_id = $2 AND analysis_type = $3`,
    [workspaceId, analysis.productId, analysis.analysisType],
  );
  const nextRevision = Number(revRes.rows[0]?.next_rev ?? 1);

  const insRes = await client.query(
    `INSERT INTO analyses (
       id, workspace_id, product_id, analysis_type, revision_number,
       fact_set_id, ai_run_id, content_json, schema_version, status,
       created_by_user_id, created_at, updated_at, version
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'generated', $10, NOW(), NOW(), 1)`,
    [
      analysis.id,
      analysis.workspaceId,
      analysis.productId,
      analysis.analysisType,
      nextRevision,
      analysis.factSetId,
      analysis.aiRunId,
      JSON.stringify(analysis.contentJson),
      analysis.schemaVersion,
      analysis.createdByUserId,
    ],
  );
  if (insRes.rowCount !== 1) {
    throw new DatabaseError(`Failed to insert analysis ${analysis.id}`);
  }

  // Insert typed subjects with verified row counts and explicit IDs
  for (const subj of analysis.subjects) {
    const subjId = crypto.randomUUID();
    const subjRes = await client.query(
      `INSERT INTO analysis_subjects (
         id, workspace_id, analysis_id, subject_type, role,
         subject_product_id, subject_fact_set_id, subject_analysis_id, created_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
      [
        subjId,
        workspaceId,
        analysis.id,
        subj.subjectType,
        subj.role,
        subj.subjectProductId ?? null,
        subj.subjectFactSetId ?? null,
        subj.subjectAnalysisId ?? null,
      ],
    );
    if (subjRes.rowCount !== 1) {
      throw new DatabaseError(`Failed to insert analysis subject for analysis ${analysis.id}`);
    }
  }

  return nextRevision;
}
