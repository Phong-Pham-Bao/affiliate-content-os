import {
  computeCanonicalContextHash,
  CREATIVE_OFFICE_V1_SPEC,
  dateToIsoTimestamp,
  GRAPH_TEMPLATE_CREATIVE_OFFICE_V1,
  GRAPH_VERSION_CREATIVE_OFFICE_V1,
  parseAgentAssignmentId,
  parseAgentRoleDefinitionId,
  parseAnalysisId,
  parseAuditEventId,
  parseContextPackageId,
  parseIdempotencyKeyId,
  parseWorkItemDependencyId,
  parseWorkItemId,
  parseWorkOrderId,
  SEEDED_ROLE_DEFINITIONS,
  validateAcyclicGraph,
  type AgentRoleKey,
  type AnalysisId,
  type ProductId,
  type UserId,
  type WorkItemId,
  type WorkOrderMissionType,
  type WorkspaceId,
} from '@affiliate-content-os/domain';
import type {
  KickoffAtomicAssignmentParam,
  KickoffAtomicDependencyParam,
  KickoffAtomicWorkItemParam,
  KickoffWorkOrderAtomicParams,
} from './ports.js';

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

  // 1. Context package ID and canonical hash
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

  // 2. Work order ID
  const workOrderId = parseWorkOrderId(generateId());

  // 3. Map role key to role definition ID from seeded definitions
  const roleIdMap = new Map<AgentRoleKey, ReturnType<typeof parseAgentRoleDefinitionId>>();
  for (const roleDef of SEEDED_ROLE_DEFINITIONS) {
    roleIdMap.set(roleDef.roleKey, roleDef.id);
  }

  // 4. Build work items from approved template
  const taskKeyToItemId = new Map<string, WorkItemId>();
  const workItems: KickoffAtomicWorkItemParam[] = [];

  for (const spec of CREATIVE_OFFICE_V1_SPEC) {
    const itemId = parseWorkItemId(generateId());
    taskKeyToItemId.set(spec.taskKey, itemId);
    const roleDefId = roleIdMap.get(spec.roleKey)!;

    workItems.push({
      id: itemId,
      workspaceId: wsId,
      workOrderId,
      roleDefinitionId: roleDefId,
      taskKey: spec.taskKey,
      expectedArtifactType: spec.expectedArtifactType,
      status: spec.initialStatus,
    });
  }

  // 5. Build and validate dependencies
  const dependencies: KickoffAtomicDependencyParam[] = [];
  const edgeValidationInputs: { fromId: string; toId: string }[] = [];

  for (const spec of CREATIVE_OFFICE_V1_SPEC) {
    const targetItemId = taskKeyToItemId.get(spec.taskKey)!;
    for (const prereqTaskKey of spec.dependsOnTaskKeys) {
      const sourceItemId = taskKeyToItemId.get(prereqTaskKey)!;
      dependencies.push({
        id: parseWorkItemDependencyId(generateId()),
        workspaceId: wsId,
        workOrderId,
        workItemId: targetItemId,
        dependsOnWorkItemId: sourceItemId,
      });
      edgeValidationInputs.push({
        fromId: targetItemId,
        toId: sourceItemId,
      });
    }
  }

  // Acyclic validation
  validateAcyclicGraph(Array.from(taskKeyToItemId.values()), edgeValidationInputs);

  // 6. Build assignments for all 6 roles
  const assignments: KickoffAtomicAssignmentParam[] = [];

  // Chief of Staff has no work item and begins in preparing
  const cosRoleId = roleIdMap.get('chief_of_staff')!;
  assignments.push({
    id: parseAgentAssignmentId(generateId()),
    workspaceId: wsId,
    workOrderId,
    roleDefinitionId: cosRoleId,
    workItemId: null,
    officeState: 'preparing',
    waitingOnWorkItemId: null,
  });

  // Other 5 roles are assigned to their work item and begin in preparing
  for (const spec of CREATIVE_OFFICE_V1_SPEC) {
    const roleDefId = roleIdMap.get(spec.roleKey)!;
    const workItemId = taskKeyToItemId.get(spec.taskKey)!;
    assignments.push({
      id: parseAgentAssignmentId(generateId()),
      workspaceId: wsId,
      workOrderId,
      roleDefinitionId: roleDefId,
      workItemId,
      officeState: 'preparing',
      waitingOnWorkItemId: null,
    });
  }

  // 7. Audit event (strictly safe fields, no directive or content)
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
    initialStatus: 'preparing',
  };

  const responseSummary = Object.freeze({
    id: workOrderId,
    workspaceId: wsId,
    productId: prodId,
    contextPackageId,
    missionType: input.missionType,
    graphTemplate: GRAPH_TEMPLATE_CREATIVE_OFFICE_V1,
    graphVersion: GRAPH_VERSION_CREATIVE_OFFICE_V1,
    status: 'preparing' as const,
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
      status: 'preparing' as const,
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
    workItems: Object.freeze(workItems.map((item) => Object.freeze({ ...item }))),
    assignments: Object.freeze(assignments.map((a) => Object.freeze({ ...a }))),
    dependencies: Object.freeze(dependencies.map((d) => Object.freeze({ ...d }))),
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
