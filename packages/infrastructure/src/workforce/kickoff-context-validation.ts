import crypto from 'node:crypto';
import type pg from 'pg';
import {
  ProductArchivedError,
  ProductNotFoundError,
  WorkforceAnalysisNotAcceptedError,
  WorkforceFactSetNotConfirmedError,
  WorkforceStaleContextError,
} from '@affiliate-content-os/application';
import { computeCanonicalContextHash } from '@affiliate-content-os/domain';
import { DatabaseError } from '../database/errors.js';
import type { KickoffPersistenceSnapshot } from './workforce-types.js';

export async function validateKickoffContext(
  client: pg.PoolClient,
  snapshot: KickoffPersistenceSnapshot,
): Promise<void> {
  // 1. Lock & revalidate product
  const prodCheck = await client.query(
    `SELECT id, workspace_id, status, current_fact_set_id, version
     FROM products
     WHERE workspace_id = $1 AND id = $2
     FOR UPDATE`,
    [snapshot.workOrder.workspaceId, snapshot.workOrder.productId],
  );

  if (prodCheck.rowCount === 0 || !prodCheck.rows[0]) {
    throw new ProductNotFoundError(snapshot.workOrder.productId);
  }
  const productRow = prodCheck.rows[0];
  if (productRow.status === 'archived' || productRow.status !== 'active') {
    throw new ProductArchivedError();
  }
  if (productRow.current_fact_set_id !== snapshot.contextPackage.factSetId) {
    throw new WorkforceFactSetNotConfirmedError(snapshot.contextPackage.factSetId);
  }
  const lockedProductVersion = Number(productRow.version);
  if (lockedProductVersion !== snapshot.contextPackage.productVersion) {
    throw new WorkforceStaleContextError(
      snapshot.contextPackage.productVersion,
      lockedProductVersion,
    );
  }

  // 2. Lock & revalidate fact set
  const factSetCheck = await client.query(
    `SELECT id, workspace_id, product_id, status, version
     FROM product_fact_sets
     WHERE workspace_id = $1 AND product_id = $2 AND id = $3
     FOR UPDATE`,
    [
      snapshot.workOrder.workspaceId,
      snapshot.workOrder.productId,
      snapshot.contextPackage.factSetId,
    ],
  );

  if (
    factSetCheck.rowCount === 0 ||
    !factSetCheck.rows[0] ||
    factSetCheck.rows[0].status !== 'confirmed'
  ) {
    throw new WorkforceFactSetNotConfirmedError(snapshot.contextPackage.factSetId);
  }
  const factSetRow = factSetCheck.rows[0];
  const lockedFactSetVersion = Number(factSetRow.version);
  if (lockedFactSetVersion !== snapshot.contextPackage.factSetVersion) {
    throw new WorkforceStaleContextError(
      snapshot.contextPackage.factSetVersion,
      lockedFactSetVersion,
    );
  }

  // 3. Lock & revalidate source analyses
  const lockedAnalyses: { analysisId: string; version: number }[] = [];
  for (const expectedAnalysis of snapshot.contextPackage.sourceAnalyses) {
    const analysisCheck = await client.query(
      `SELECT id, workspace_id, product_id, status, version
       FROM analyses
       WHERE workspace_id = $1 AND id = $2
       FOR UPDATE`,
      [snapshot.workOrder.workspaceId, expectedAnalysis.id],
    );

    if (
      analysisCheck.rowCount === 0 ||
      !analysisCheck.rows[0] ||
      analysisCheck.rows[0].status !== 'accepted' ||
      analysisCheck.rows[0].product_id !== snapshot.workOrder.productId ||
      analysisCheck.rows[0].workspace_id !== snapshot.workOrder.workspaceId
    ) {
      throw new WorkforceAnalysisNotAcceptedError(expectedAnalysis.id);
    }

    const analysisRow = analysisCheck.rows[0];
    const lockedAnalysisVersion = Number(analysisRow.version);
    if (lockedAnalysisVersion !== expectedAnalysis.version) {
      throw new WorkforceStaleContextError(expectedAnalysis.version, lockedAnalysisVersion);
    }
    lockedAnalyses.push({ analysisId: expectedAnalysis.id, version: lockedAnalysisVersion });
  }

  // 4. Recompute and verify canonical SHA-256 context hash
  const canonicalHash = computeCanonicalContextHash({
    workspaceId: snapshot.workOrder.workspaceId,
    productId: snapshot.workOrder.productId,
    productVersion: lockedProductVersion,
    factSetId: snapshot.contextPackage.factSetId,
    factSetVersion: lockedFactSetVersion,
    analyses: lockedAnalyses,
    schemaVersion: snapshot.contextPackage.contextSchemaVersion,
  });

  if (
    canonicalHash.byteLength !== snapshot.contextPackage.contextHash.byteLength ||
    !crypto.timingSafeEqual(canonicalHash, snapshot.contextPackage.contextHash)
  ) {
    throw new WorkforceStaleContextError(
      snapshot.contextPackage.productVersion,
      lockedProductVersion,
    );
  }

  // 5. Verify active role definitions
  const activeRolesRes = await client.query(
    `SELECT count(*) AS count FROM agent_role_definitions WHERE is_active = TRUE`,
  );
  const activeCount = Number(activeRolesRes.rows[0]?.count ?? 0);
  if (activeCount < 6) {
    throw new DatabaseError('Required AI agent role definitions are missing or inactive');
  }
}
