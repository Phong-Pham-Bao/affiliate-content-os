import { DomainValidationError } from '../errors.js';
import { isValidUuidV7 } from '../ids.js';

declare const WorkOrderIdBrand: unique symbol;
export type WorkOrderId = string & { readonly [WorkOrderIdBrand]: typeof WorkOrderIdBrand };

declare const WorkItemIdBrand: unique symbol;
export type WorkItemId = string & { readonly [WorkItemIdBrand]: typeof WorkItemIdBrand };

declare const AgentRoleDefinitionIdBrand: unique symbol;
export type AgentRoleDefinitionId = string & {
  readonly [AgentRoleDefinitionIdBrand]: typeof AgentRoleDefinitionIdBrand;
};

declare const AgentAssignmentIdBrand: unique symbol;
export type AgentAssignmentId = string & {
  readonly [AgentAssignmentIdBrand]: typeof AgentAssignmentIdBrand;
};

declare const ContextPackageIdBrand: unique symbol;
export type ContextPackageId = string & {
  readonly [ContextPackageIdBrand]: typeof ContextPackageIdBrand;
};

declare const WorkItemDependencyIdBrand: unique symbol;
export type WorkItemDependencyId = string & {
  readonly [WorkItemDependencyIdBrand]: typeof WorkItemDependencyIdBrand;
};

function assertUuidV7(value: unknown, entityName: string, fieldName = 'id'): string {
  if (typeof value !== 'string') {
    throw new DomainValidationError(`Invalid ${entityName} ID: must be a string`, fieldName);
  }
  if (!isValidUuidV7(value)) {
    throw new DomainValidationError(
      `Invalid ${entityName} ID: must be a canonical lowercase UUIDv7 string`,
      fieldName,
    );
  }
  return value;
}

export function isWorkOrderId(value: unknown): value is WorkOrderId {
  return isValidUuidV7(value);
}

export function parseWorkOrderId(value: unknown, fieldName = 'workOrderId'): WorkOrderId {
  return assertUuidV7(value, 'work order', fieldName) as WorkOrderId;
}

export function isWorkItemId(value: unknown): value is WorkItemId {
  return isValidUuidV7(value);
}

export function parseWorkItemId(value: unknown, fieldName = 'workItemId'): WorkItemId {
  return assertUuidV7(value, 'work item', fieldName) as WorkItemId;
}

export function isAgentRoleDefinitionId(value: unknown): value is AgentRoleDefinitionId {
  return isValidUuidV7(value);
}

export function parseAgentRoleDefinitionId(
  value: unknown,
  fieldName = 'roleDefinitionId',
): AgentRoleDefinitionId {
  return assertUuidV7(value, 'agent role definition', fieldName) as AgentRoleDefinitionId;
}

export function isAgentAssignmentId(value: unknown): value is AgentAssignmentId {
  return isValidUuidV7(value);
}

export function parseAgentAssignmentId(
  value: unknown,
  fieldName = 'assignmentId',
): AgentAssignmentId {
  return assertUuidV7(value, 'agent assignment', fieldName) as AgentAssignmentId;
}

export function isContextPackageId(value: unknown): value is ContextPackageId {
  return isValidUuidV7(value);
}

export function parseContextPackageId(
  value: unknown,
  fieldName = 'contextPackageId',
): ContextPackageId {
  return assertUuidV7(value, 'context package', fieldName) as ContextPackageId;
}

export function isWorkItemDependencyId(value: unknown): value is WorkItemDependencyId {
  return isValidUuidV7(value);
}

export function parseWorkItemDependencyId(
  value: unknown,
  fieldName = 'dependencyId',
): WorkItemDependencyId {
  return assertUuidV7(value, 'work item dependency', fieldName) as WorkItemDependencyId;
}
