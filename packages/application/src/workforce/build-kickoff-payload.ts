import {
  computeCanonicalContextHash,
  dateToIsoTimestamp,
  GRAPH_TEMPLATE_CREATIVE_OFFICE_V1,
  GRAPH_VERSION_CREATIVE_OFFICE_V1,
  parseAnalysisId,
  parseAuditEventId,
  parseContextPackageId,
  parseIdempotencyKeyId,
  parseWorkOrderId,
  type AnalysisId,
  type ProductId,
  type UserId,
  type WorkOrderMissionType,
  type WorkspaceId,
} from '@affiliate-content-os/domain';
import {
  buildKickoffGraph,
  TOTAL_PLANNING_CALLS,
  TOTAL_PLANNING_RESERVED_MICROUNITS,
} from './build-kickoff-graph.js';
import type { KickoffWorkOrderAtomicParams } from './ports.js';

export interface BuildKickoffPayloadInput {
  readonly wsId: WorkspaceId;
  readonly prodId: ProductId;
  readonly factSetId: string;
  readonly actorId: UserId;
  readonly missionType: WorkOrderMissionType;
  readonly directiveText: string;
  readonly priority: number;
  readonly productVersion: number;
  readonly factSetVersion: number;
  readonly sourceAnalyses: readonly {
    readonly id: AnalysisId;
    readonly version: number;
  }[];
  readonly keyHash: Uint8Array;
  readonly requestHash: Uint8Array;
  readonly routeKey: string;
  readonly generateId: () => string;
}

export function buildKickoffAtomicPayload(
  input: BuildKickoffPayloadInput,
): KickoffWorkOrderAtomicParams {
  const { wsId, prodId, factSetId, actorId, generateId } = input;

  // Normalize source analyses (deduplicate and sort deterministically)
  const uniqueAnalysesMap = new Map<string, number>();
  for (const a of input.sourceAnalyses) {
    uniqueAnalysesMap.set(a.id, a.version);
  }
  const normalizedSourceAnalyses = Object.freeze(
    Array.from(uniqueAnalysesMap.entries())
      .map(([id, version]) =>
        Object.freeze({
          id: parseAnalysisId(id),
          version,
        }),
      )
      .sort((a, b) => a.id.localeCompare(b.id)),
  );

  const contextPackageId = parseContextPackageId(generateId());
  const contextHash = computeCanonicalContextHash({
    workspaceId: wsId,
    productId: prodId,
    productVersion: input.productVersion,
    factSetId,
    factSetVersion: input.factSetVersion,
    analyses: normalizedSourceAnalyses.map((a) => ({
      analysisId: a.id,
      version: a.version,
    })),
    schemaVersion: 1,
  });

  const workOrderId = parseWorkOrderId(generateId());
  const graph = buildKickoffGraph(wsId, workOrderId, generateId);

  const auditEventId = parseAuditEventId(generateId());
  const auditChanges = {
    workOrderId,
    contextPackageId,
    productId: prodId,
    missionType: input.missionType,
    graphTemplate: GRAPH_TEMPLATE_CREATIVE_OFFICE_V1,
    graphVersion: GRAPH_VERSION_CREATIVE_OFFICE_V1,
    roleCount: 6,
    workItemCount: 5,
    dependencyCount: 4,
    initialStatus: 'in_progress',
    planningJobCount: TOTAL_PLANNING_CALLS,
    reservedSpendMicrounits: TOTAL_PLANNING_RESERVED_MICROUNITS,
  };

  const responseSummary = Object.freeze({
    id: workOrderId,
    workspaceId: wsId,
    productId: prodId,
    contextPackageId,
    missionType: input.missionType,
    graphTemplate: GRAPH_TEMPLATE_CREATIVE_OFFICE_V1,
    graphVersion: GRAPH_VERSION_CREATIVE_OFFICE_V1,
    status: 'in_progress' as const,
    priority: input.priority,
    createdByUserId: actorId,
    failureCategory: null,
    completedAt: null,
    version: 1,
  });

  const copiedKeyHash = new Uint8Array(input.keyHash);
  const copiedRequestHash = new Uint8Array(input.requestHash);
  const copiedContextHash = new Uint8Array(contextHash);

  return Object.freeze({
    workOrder: Object.freeze({
      id: workOrderId,
      workspaceId: wsId,
      productId: prodId,
      contextPackageId,
      missionType: input.missionType,
      directiveText: input.directiveText,
      graphTemplate: GRAPH_TEMPLATE_CREATIVE_OFFICE_V1,
      graphVersion: GRAPH_VERSION_CREATIVE_OFFICE_V1,
      status: 'in_progress' as const,
      priority: input.priority,
      createdByUserId: actorId,
    }),
    contextPackage: Object.freeze({
      id: contextPackageId,
      workspaceId: wsId,
      productId: prodId,
      factSetId,
      contextSchemaVersion: 1,
      contextHash: copiedContextHash,
      createdByUserId: actorId,
      productVersion: input.productVersion,
      factSetVersion: input.factSetVersion,
      sourceAnalyses: normalizedSourceAnalyses,
    }),
    workItems: Object.freeze(graph.workItems.map((item) => Object.freeze({ ...item }))),
    assignments: Object.freeze(graph.assignments.map((a) => Object.freeze({ ...a }))),
    dependencies: Object.freeze(graph.dependencies.map((d) => Object.freeze({ ...d }))),
    planningJobs: Object.freeze(graph.planningJobs.map((j) => Object.freeze({ ...j }))),
    totalEstimatedCostMicrounits: TOTAL_PLANNING_RESERVED_MICROUNITS,
    idempotency: Object.freeze({
      id: parseIdempotencyKeyId(generateId()),
      keyHash: copiedKeyHash,
      requestHash: copiedRequestHash,
      principalId: actorId,
      routeKey: input.routeKey,
      statusCode: 201,
      responseJson: responseSummary,
      resourceId: workOrderId,
      createdAt: dateToIsoTimestamp(new Date()),
    }),
    auditEvent: Object.freeze({
      id: auditEventId,
      workspaceId: wsId,
      actorUserId: actorId,
      action: 'creative.work_order.created',
      resourceType: 'work_order',
      resourceId: workOrderId,
      changesJson: Object.freeze({ ...auditChanges }),
    }),
  });
}
