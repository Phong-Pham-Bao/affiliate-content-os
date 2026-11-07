import { createHash } from 'node:crypto';
import {
  isWorkOrderMissionType,
  parseAnalysisId,
  parseProductId,
  parseUserId,
  parseWorkspaceId,
  validateDirectiveText,
  validateWorkOrderPriority,
  type AnalysisId,
  type WorkOrderMissionType,
} from '@affiliate-content-os/domain';
import { authorizeWorkspaceAction } from '../authorize-workspace-action.js';
import { ProductArchivedError, ProductNotFoundError } from '../catalog/errors.js';
import { ValidationError } from '../errors.js';
import { generateUuidV7 } from '../id-generator.js';
import { buildKickoffAtomicPayload } from './build-kickoff-payload.js';
import { WorkforceAnalysisNotAcceptedError, WorkforceFactSetNotConfirmedError } from './errors.js';
import type {
  KickoffWorkOrderCommand,
  KickoffWorkOrderResult,
  WorkforceDependencies,
} from './types.js';

const IDEMPOTENCY_KEY_REGEX = /^[\x21-\x7E]+$/;

export async function kickoffWorkOrder(
  rawCommand: KickoffWorkOrderCommand,
  deps: WorkforceDependencies,
): Promise<KickoffWorkOrderResult> {
  // 1. Validation of IDs, mission type, directive, priority, idempotency key
  if (typeof rawCommand !== 'object' || rawCommand === null) {
    throw new ValidationError('Command must be an object', 'command');
  }

  const wsId = parseWorkspaceId(rawCommand.workspaceId);
  const prodId = parseProductId(rawCommand.productId);
  const actorId = parseUserId(rawCommand.actorUserId);

  if (!isWorkOrderMissionType(rawCommand.missionType)) {
    throw new ValidationError(`Invalid missionType: ${rawCommand.missionType}`, 'missionType');
  }
  const missionType: WorkOrderMissionType = rawCommand.missionType;

  const directiveText = validateDirectiveText(rawCommand.directiveText);
  const priority = validateWorkOrderPriority(rawCommand.priority);

  const rawKey = rawCommand.idempotencyKey;
  if (
    typeof rawKey !== 'string' ||
    rawKey.length < 1 ||
    rawKey.length > 128 ||
    !IDEMPOTENCY_KEY_REGEX.test(rawKey)
  ) {
    throw new ValidationError(
      'Invalid Idempotency-Key: must be 1-128 ASCII printable characters',
      'idempotencyKey',
    );
  }

  let normalizedAnalysisIds: readonly AnalysisId[] = [];
  if (rawCommand.acceptedAnalysisIds !== undefined && rawCommand.acceptedAnalysisIds !== null) {
    if (!Array.isArray(rawCommand.acceptedAnalysisIds)) {
      throw new ValidationError('acceptedAnalysisIds must be an array', 'acceptedAnalysisIds');
    }
    if (rawCommand.acceptedAnalysisIds.length > 20) {
      throw new ValidationError(
        'acceptedAnalysisIds cannot exceed 20 items',
        'acceptedAnalysisIds',
      );
    }
    const validated = rawCommand.acceptedAnalysisIds.map((id, idx) => {
      try {
        return parseAnalysisId(id, `acceptedAnalysisIds[${idx}]`);
      } catch {
        throw new ValidationError(
          `Invalid analysis ID at index ${idx}`,
          `acceptedAnalysisIds[${idx}]`,
        );
      }
    });
    normalizedAnalysisIds = Object.freeze([...new Set(validated)].sort());
  }

  // 2. Authorization: require active member with catalog.manage capability
  await authorizeWorkspaceAction(
    {
      workspaceId: wsId,
      userId: actorId,
      capability: 'catalog.manage',
    },
    { authorization: deps.workspaceAuthorization },
  );

  // 3. Load product and confirmed fact set
  const product = await deps.catalogQuery.findProductById({
    workspaceId: wsId,
    productId: prodId,
  });
  if (!product) {
    throw new ProductNotFoundError(rawCommand.productId);
  }
  if (product.status === 'archived') {
    throw new ProductArchivedError();
  }
  if (!product.currentFactSetId) {
    throw new WorkforceFactSetNotConfirmedError('missing_current_fact_set');
  }

  const factSet = await deps.catalogQuery.findFactSetById({
    workspaceId: wsId,
    productId: prodId,
    factSetId: product.currentFactSetId,
  });
  if (!factSet || factSet.status !== 'confirmed') {
    throw new WorkforceFactSetNotConfirmedError(product.currentFactSetId);
  }

  // 4. Load source analyses
  const loadedAnalyses: { id: AnalysisId; version: number }[] = [];
  for (const analysisId of normalizedAnalysisIds) {
    const analysis = await deps.analysisQuery.getAnalysisById(wsId, analysisId);
    if (!analysis || analysis.productId !== prodId || analysis.status !== 'accepted') {
      throw new WorkforceAnalysisNotAcceptedError(analysisId);
    }
    loadedAnalyses.push({ id: analysis.id, version: analysis.version });
  }

  // 5. Canonical hashes for idempotency
  const keyHash = new Uint8Array(createHash('sha256').update(rawKey, 'utf8').digest());

  const canonicalPayload = JSON.stringify({
    acceptedAnalysisIds: normalizedAnalysisIds,
    directiveText,
    missionType,
    priority,
    productId: prodId,
    workspaceId: wsId,
  });
  const requestHash = new Uint8Array(
    createHash('sha256').update(canonicalPayload, 'utf8').digest(),
  );

  const routeKey = `POST /api/v1/workspaces/${wsId}/products/${prodId}/work-orders`;
  const generateId = () => deps.idGenerator?.generateId?.() ?? generateUuidV7();

  // 6. Build atomic kickoff payload
  const atomicParams = buildKickoffAtomicPayload({
    wsId,
    prodId,
    factSetId: product.currentFactSetId,
    actorId,
    missionType,
    directiveText,
    priority,
    productVersion: product.version,
    factSetVersion: factSet.version,
    sourceAnalyses: loadedAnalyses,
    keyHash,
    requestHash,
    routeKey,
    generateId,
  });

  // 7. Execute atomic transaction
  const result = await deps.workforcePersistence.kickoffWorkOrderAtomic(atomicParams);

  return Object.freeze({
    workOrder: Object.freeze({ ...result.workOrder }),
    replayed: result.cached,
  });
}
