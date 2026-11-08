import {
  parseAuditEventId,
  parseUserId,
  parseWorkItemId,
  parseWorkOrderId,
  parseWorkspaceId,
} from '@affiliate-content-os/domain';
import { generateUuidV7 } from '../id-generator.js';
import { authorizeWorkspaceAction } from '../authorize-workspace-action.js';
import { ValidationError } from '../errors.js';
import {
  ESTIMATED_COST_PER_PLANNING_CALL_MICROUNITS,
  PLANNING_ROLE_CONFIG,
  TOTAL_PLANNING_RESERVED_MICROUNITS,
} from './build-kickoff-graph.js';
import type { RetryPlanningItemParam } from './ports.js';
import type {
  RetryWorkOrderPlanningCommand,
  RetryWorkOrderPlanningResultDTO,
  WorkforceDependencies,
} from './types.js';

export async function retryWorkOrderPlanning(
  command: RetryWorkOrderPlanningCommand,
  deps: WorkforceDependencies,
): Promise<RetryWorkOrderPlanningResultDTO> {
  if (typeof command !== 'object' || command === null) {
    throw new ValidationError('Command must be an object', 'command');
  }

  const wsId = parseWorkspaceId(command.workspaceId);
  const orderId = parseWorkOrderId(command.workOrderId);
  const actorId = parseUserId(command.actorUserId);

  await authorizeWorkspaceAction(
    { workspaceId: wsId, userId: actorId, capability: 'catalog.manage' },
    { authorization: deps.workspaceAuthorization },
  );

  const genId = () => deps.idGenerator?.generateId?.() ?? generateUuidV7();

  const retryItems: RetryPlanningItemParam[] = PLANNING_ROLE_CONFIG.map((role) => ({
    workItemId: parseWorkItemId(genId()),
    operationId: genId(),
    aiRunId: genId(),
    jobId: genId(),
    outboxId: genId(),
    taskKey: role.taskKey,
    roleKey: role.roleKey,
    promptTemplate: role.promptTemplate,
    reservedMicrounits: ESTIMATED_COST_PER_PLANNING_CALL_MICROUNITS,
  }));

  const auditEventId = parseAuditEventId(genId());

  const result = await deps.workforcePersistence.retryWorkOrderPlanningAtomic({
    workspaceId: wsId,
    workOrderId: orderId,
    actorUserId: actorId,
    retryItems,
    totalEstimatedCostMicrounits: TOTAL_PLANNING_RESERVED_MICROUNITS,
    auditEvent: {
      id: auditEventId,
      workspaceId: wsId,
      actorUserId: actorId,
      action: 'work_order.planning_retried',
      resourceType: 'work_order',
      resourceId: orderId,
      changesJson: { retriedBy: actorId },
    },
  });

  return {
    workOrder: result.workOrder,
    retriedItemIds: result.retriedItemIds.map((id: unknown) => String(id)),
    replayed: result.cached,
  };
}
