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
import type { RetryPlanningItemParam } from './ports.js';
import type {
  RetryWorkOrderPlanningCommand,
  RetryWorkOrderPlanningResultDTO,
  WorkforceDependencies,
} from './types.js';

const PLANNING_RETRY_ROLES: readonly {
  readonly taskKey: 'product_strategy' | 'audience_strategy' | 'creative_direction';
  readonly roleKey: 'product_strategist' | 'audience_strategist' | 'creative_director';
  readonly promptTemplate: string;
}[] = [
  {
    taskKey: 'product_strategy',
    roleKey: 'product_strategist',
    promptTemplate: 'product_strategy_v1',
  },
  {
    taskKey: 'audience_strategy',
    roleKey: 'audience_strategist',
    promptTemplate: 'audience_strategy_v1',
  },
  {
    taskKey: 'creative_direction',
    roleKey: 'creative_director',
    promptTemplate: 'creative_direction_v1',
  },
];

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

  const retryItems: RetryPlanningItemParam[] = PLANNING_RETRY_ROLES.map((role) => ({
    workItemId: parseWorkItemId(genId()),
    operationId: genId(),
    aiRunId: genId(),
    jobId: genId(),
    outboxId: genId(),
    taskKey: role.taskKey,
    roleKey: role.roleKey,
    promptTemplate: role.promptTemplate,
    reservedMicrounits: 50000,
  }));

  const auditEventId = parseAuditEventId(genId());

  const result = await deps.workforcePersistence.retryWorkOrderPlanningAtomic({
    workspaceId: wsId,
    workOrderId: orderId,
    actorUserId: actorId,
    retryItems,
    totalEstimatedCostMicrounits: 150000,
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
