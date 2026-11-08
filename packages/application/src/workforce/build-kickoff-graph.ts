import {
  CREATIVE_OFFICE_V1_SPEC,
  parseAgentAssignmentId,
  parseAgentRoleDefinitionId,
  parseWorkItemDependencyId,
  parseWorkItemId,
  SEEDED_ROLE_DEFINITIONS,
  validateAcyclicGraph,
  type AgentRoleKey,
  type WorkItemId,
  type WorkOrderId,
  type WorkspaceId,
} from '@affiliate-content-os/domain';
import type {
  KickoffAtomicAssignmentParam,
  KickoffAtomicDependencyParam,
  KickoffAtomicPlanningJobParam,
  KickoffAtomicWorkItemParam,
} from './ports.js';

export const PLANNING_ROLE_CONFIG = [
  {
    taskKey: 'product_strategy' as const,
    roleKey: 'product_strategist' as const,
    promptTemplate: 'product_campaign_plan_v1',
  },
  {
    taskKey: 'audience_strategy' as const,
    roleKey: 'audience_strategist' as const,
    promptTemplate: 'audience_insight_board_v1',
  },
  {
    taskKey: 'creative_direction' as const,
    roleKey: 'creative_director' as const,
    promptTemplate: 'video_series_plan_v1',
  },
] as const;

export const ESTIMATED_COST_PER_PLANNING_CALL_MICROUNITS = 50_000;
export const TOTAL_PLANNING_CALLS = 3;
export const TOTAL_PLANNING_RESERVED_MICROUNITS =
  ESTIMATED_COST_PER_PLANNING_CALL_MICROUNITS * TOTAL_PLANNING_CALLS;

export interface BuiltKickoffGraph {
  readonly workItems: readonly KickoffAtomicWorkItemParam[];
  readonly assignments: readonly KickoffAtomicAssignmentParam[];
  readonly dependencies: readonly KickoffAtomicDependencyParam[];
  readonly planningJobs: readonly KickoffAtomicPlanningJobParam[];
}

export function buildKickoffGraph(
  wsId: WorkspaceId,
  workOrderId: WorkOrderId,
  generateId: () => string,
): BuiltKickoffGraph {
  const roleIdMap = new Map<AgentRoleKey, ReturnType<typeof parseAgentRoleDefinitionId>>();
  for (const roleDef of SEEDED_ROLE_DEFINITIONS) {
    roleIdMap.set(roleDef.roleKey, roleDef.id);
  }

  const taskKeyToItemId = new Map<string, WorkItemId>();
  const workItems: KickoffAtomicWorkItemParam[] = [];

  for (const spec of CREATIVE_OFFICE_V1_SPEC) {
    const itemId = parseWorkItemId(generateId());
    taskKeyToItemId.set(spec.taskKey, itemId);
    const roleDefId = roleIdMap.get(spec.roleKey)!;
    const isPlanning = PLANNING_ROLE_CONFIG.some((p) => p.taskKey === spec.taskKey);

    workItems.push({
      id: itemId,
      workspaceId: wsId,
      workOrderId,
      roleDefinitionId: roleDefId,
      taskKey: spec.taskKey,
      expectedArtifactType: spec.expectedArtifactType,
      status: isPlanning ? 'queued' : 'waiting_dependency',
    });
  }

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
      edgeValidationInputs.push({ fromId: targetItemId, toId: sourceItemId });
    }
  }

  validateAcyclicGraph(Array.from(taskKeyToItemId.values()), edgeValidationInputs);

  const assignments: KickoffAtomicAssignmentParam[] = [];
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

  for (const spec of CREATIVE_OFFICE_V1_SPEC) {
    const roleDefId = roleIdMap.get(spec.roleKey)!;
    const workItemId = taskKeyToItemId.get(spec.taskKey)!;
    const isPlanning = PLANNING_ROLE_CONFIG.some((p) => p.taskKey === spec.taskKey);

    let waitingOnId: WorkItemId | null = null;
    if (!isPlanning) {
      const firstDep = spec.dependsOnTaskKeys[0];
      if (firstDep) {
        waitingOnId = taskKeyToItemId.get(firstDep) ?? null;
      }
    }

    assignments.push({
      id: parseAgentAssignmentId(generateId()),
      workspaceId: wsId,
      workOrderId,
      roleDefinitionId: roleDefId,
      workItemId,
      officeState: isPlanning ? 'queued' : 'waiting_dependency',
      waitingOnWorkItemId: waitingOnId,
    });
  }

  const planningJobs: KickoffAtomicPlanningJobParam[] = PLANNING_ROLE_CONFIG.map((cfg) => ({
    operationId: generateId(),
    aiRunId: generateId(),
    jobId: generateId(),
    outboxId: generateId(),
    workItemId: taskKeyToItemId.get(cfg.taskKey)!,
    taskKey: cfg.taskKey,
    roleKey: cfg.roleKey,
    promptTemplate: cfg.promptTemplate,
    reservedMicrounits: ESTIMATED_COST_PER_PLANNING_CALL_MICROUNITS,
  }));

  return {
    workItems,
    assignments,
    dependencies,
    planningJobs,
  };
}
