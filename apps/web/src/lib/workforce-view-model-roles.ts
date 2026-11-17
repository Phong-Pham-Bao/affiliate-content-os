import {
  CANONICAL_OFFICE_STATES,
  type AgentRoleKey,
  type AssignmentOfficeState,
  type WorkItemSummaryDTO,
  type WorkOrderDetailDTO,
} from '../types/workforce.js';
import type {
  BadgeVariant,
  EmployeeOperationalDetailsVM,
  EmployeePositionClass,
  NamedDependencyVM,
} from './workforce-view-model-types.js';
import { ORDERED_ROLES, type RoleMeta, ROLE_METADATA } from './workforce-role-definitions.js';

export { ORDERED_ROLES, type RoleMeta, ROLE_METADATA };

export function deriveOfficeState(
  rawState?: AssignmentOfficeState,
  itemStatus?: string,
): AssignmentOfficeState {
  if (rawState) {
    if (rawState === 'working') return 'running';
    if (rawState === 'waiting') return 'waiting_dependency';
    if (rawState === 'cancelled') return 'canceled';
    if ((CANONICAL_OFFICE_STATES as readonly string[]).includes(rawState)) {
      return rawState;
    }
    // Unknown office state falls back safely to non-success blocked
    return 'blocked';
  }
  if (!itemStatus) return 'idle';
  switch (itemStatus) {
    case 'in_progress':
    case 'running':
      return 'running';
    case 'waiting_dependency':
      return 'waiting_dependency';
    case 'completed':
      return 'completed';
    case 'failed':
      return 'failed';
    case 'cancelled':
    case 'canceled':
      return 'canceled';
    case 'queued':
      return 'queued';
    case 'ready':
    case 'preparing':
      return 'preparing';
    case 'review_required':
      return 'review_required';
    case 'blocked':
      return 'blocked';
    default:
      return 'idle';
  }
}

export function derivePositionClass(state: AssignmentOfficeState): EmployeePositionClass {
  switch (state) {
    case 'running':
    case 'queued':
    case 'preparing':
      return 'pos-desk';
    case 'waiting_dependency':
      return 'pos-dependency';
    case 'review_required':
      return 'pos-review';
    case 'completed':
      return 'pos-archive';
    case 'blocked':
    case 'failed':
    case 'canceled':
      return 'pos-attention';
    case 'idle':
    default:
      return 'pos-idle';
  }
}

export function deriveStatusLabelAndBadge(state: AssignmentOfficeState): {
  label: string;
  badge: BadgeVariant;
} {
  switch (state) {
    case 'completed':
      return { label: 'Completed', badge: 'success' };
    case 'running':
      return { label: 'Running', badge: 'primary' };
    case 'queued':
      return { label: 'Queued', badge: 'info' };
    case 'preparing':
      return { label: 'Preparing', badge: 'info' };
    case 'waiting_dependency':
      return { label: 'Waiting on Dependency', badge: 'warning' };
    case 'review_required':
      return { label: 'Review Required', badge: 'warning' };
    case 'blocked':
      return { label: 'Blocked', badge: 'danger' };
    case 'failed':
      return { label: 'Failed', badge: 'danger' };
    case 'canceled':
      return { label: 'Canceled', badge: 'secondary' };
    case 'idle':
    default:
      return { label: 'Idle', badge: 'secondary' };
  }
}

export function deriveOperationalDetails(
  item: WorkItemSummaryDTO | null,
  orderFailureCategory: string | null,
): EmployeeOperationalDetailsVM {
  const rawCode = item?.blockedReasonCode ?? null;
  const normCode = rawCode ? rawCode.toLowerCase().trim() : null;
  const normCat = orderFailureCategory ? orderFailureCategory.toLowerCase().trim() : null;

  const isBudget =
    normCode === 'budget_exhausted' ||
    normCode === 'insufficient_budget' ||
    normCat === 'budget_exhausted' ||
    normCat === 'insufficient_budget';

  const isRateLimit = normCode === 'rate_limited' || normCat === 'rate_limited';

  const isProvider =
    normCode === 'provider_unavailable' ||
    normCode === 'provider_outage' ||
    normCat === 'provider_unavailable' ||
    normCat === 'provider_outage';

  const isRetryWait = normCode === 'retry_wait';

  let actionableMessage: string | null = null;
  if (isBudget) {
    actionableMessage = 'Workspace monthly AI budget exhausted. Please adjust budget in settings.';
  } else if (isRateLimit) {
    actionableMessage = 'Provider rate limit reached. Durable worker is backing off safely.';
  } else if (isProvider) {
    actionableMessage = 'AI provider service temporarily unavailable. Will retry automatically.';
  } else if (isRetryWait) {
    actionableMessage = 'Transient error encountered. Awaiting scheduled retry attempt.';
  } else if (rawCode) {
    actionableMessage = `Blocked with reason code: ${rawCode}`;
  } else if (item?.status === 'failed') {
    actionableMessage = 'Execution encountered a terminal error.';
  }

  return {
    isRetryWait,
    isBudgetExhausted: isBudget,
    isRateLimited: isRateLimit,
    isProviderOutage: isProvider,
    blockedReasonCode: rawCode,
    failureCategory: orderFailureCategory,
    actionableMessage,
  };
}

export function resolveDependencies(
  roleKey: AgentRoleKey,
  item: WorkItemSummaryDTO | null,
  detail: WorkOrderDetailDTO | null,
): readonly NamedDependencyVM[] {
  if (!detail) return [];
  if (item) {
    const directDeps = detail.dependencies.filter((d) => d.workItemId === item.id);
    if (directDeps.length > 0) {
      return directDeps.map((d) => {
        const prereq = detail.workItems.find((w) => w.id === d.dependsOnWorkItemId);
        const prereqRole = prereq?.roleKey;
        const roleName = prereqRole ? ROLE_METADATA[prereqRole].title : 'Prerequisite Work Item';
        return {
          workItemId: d.dependsOnWorkItemId,
          roleKey: prereqRole,
          roleName,
          status: prereq?.status ?? 'pending',
        };
      });
    }
  }

  const defaultDeps = ROLE_METADATA[roleKey].defaultDependencies;
  return defaultDeps.map((depKey) => {
    const prereqItem = detail.workItems.find((w) => w.roleKey === depKey);
    return {
      workItemId: prereqItem?.id ?? '',
      roleKey: depKey,
      roleName: ROLE_METADATA[depKey].title,
      status: prereqItem?.status ?? 'waiting',
    };
  });
}
