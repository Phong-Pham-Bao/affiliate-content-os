import type {
  ContentArtifactSummaryDTO,
  WorkOrderDetailDTO,
  WorkOrderActivityDTO,
} from '../types/workforce.js';
import type {
  EmployeeVM,
  WorkforceOverviewVM,
  WorkforceViewModel,
} from './workforce-view-model-types.js';
import {
  ORDERED_ROLES,
  ROLE_METADATA,
  deriveOfficeState,
  deriveOperationalDetails,
  derivePositionClass,
  deriveStatusLabelAndBadge,
  resolveDependencies,
} from './workforce-view-model-roles.js';

export * from './workforce-view-model-types.js';
export * from './workforce-view-model-roles.js';

export function mapWorkforceViewModel(input: {
  readonly detail: WorkOrderDetailDTO | null;
  readonly artifacts: readonly ContentArtifactSummaryDTO[];
  readonly activities: readonly WorkOrderActivityDTO[];
  readonly isStale?: boolean;
  readonly isRefreshing?: boolean;
  readonly lastUpdatedAt?: string | null;
  readonly pollingError?: string | null;
  readonly canManage?: boolean;
}): WorkforceViewModel {
  const {
    detail,
    artifacts,
    activities,
    isStale = false,
    isRefreshing = false,
    lastUpdatedAt = null,
    pollingError = null,
    canManage = true,
  } = input;

  const employees: EmployeeVM[] = ORDERED_ROLES.map((roleKey) => {
    const meta = ROLE_METADATA[roleKey];
    const assignment = detail?.assignments.find((a) => a.roleKey === roleKey) ?? null;
    const workItem = detail?.workItems.find((w) => w.roleKey === roleKey) ?? null;
    const officeState = deriveOfficeState(assignment?.officeState, workItem?.status);
    const positionClass = derivePositionClass(officeState);
    const { label: statusLabel, badge: badgeVariant } = deriveStatusLabelAndBadge(officeState);
    const operationalDetails = deriveOperationalDetails(
      workItem,
      detail?.workOrder.failureCategory ?? null,
    );
    const namedDependencies = resolveDependencies(roleKey, workItem, detail);
    const deliverables = artifacts.filter((a) => a.authorRoleKey === roleKey);
    const relevantActivities = activities.filter(
      (act) =>
        act.resourceId === workItem?.id ||
        act.resourceId === assignment?.id ||
        act.resourceType === roleKey,
    );

    return {
      roleKey,
      displayName: meta.title,
      department: meta.department,
      station: meta.station,
      mandate: meta.mandate,
      officeState,
      positionClass,
      statusLabel,
      badgeVariant,
      currentTask: workItem ? `${meta.title} (${workItem.taskKey})` : null,
      workItem,
      assignment,
      namedDependencies,
      latestReportCode: assignment?.latestReportCode ?? null,
      deliverables,
      relevantActivities,
      timestamps: {
        startedAt: workItem?.startedAt ?? null,
        completedAt: workItem?.completedAt ?? null,
        updatedAt: workItem?.updatedAt ?? assignment?.updatedAt ?? null,
      },
      operationalDetails,
    };
  });

  const counts = {
    totalRoles: 6,
    idle: employees.filter((e) => e.officeState === 'idle').length,
    preparing: employees.filter((e) => e.officeState === 'preparing').length,
    queued: employees.filter((e) => e.officeState === 'queued').length,
    running: employees.filter((e) => e.officeState === 'running').length,
    waitingDependency: employees.filter((e) => e.officeState === 'waiting_dependency').length,
    reviewRequired: employees.filter((e) => e.officeState === 'review_required').length,
    completed: employees.filter((e) => e.officeState === 'completed').length,
    blocked: employees.filter((e) => e.officeState === 'blocked').length,
    failed: employees.filter((e) => e.officeState === 'failed').length,
    canceled: employees.filter((e) => e.officeState === 'canceled').length,
    deliverablesCount: artifacts.length,
  };

  const isTerminal = detail
    ? detail.workOrder.status === 'completed' ||
      detail.workOrder.status === 'failed' ||
      detail.workOrder.status === 'cancelled'
    : false;

  const humanActionRequired =
    counts.reviewRequired > 0 || artifacts.some((a) => a.lifecycleStatus === 'review_required');
  const hasFailures = counts.failed > 0 || detail?.workOrder.status === 'failed';
  const canRetry = canManage && Boolean(detail) && (hasFailures || counts.blocked > 0);
  const canCancel = canManage && Boolean(detail) && !isTerminal;

  let screenReaderSummary: string;
  if (!detail) {
    screenReaderSummary = 'AI Workforce: No active mission assigned.';
  } else if (counts.completed === 6) {
    screenReaderSummary =
      'AI Workforce: All 6 roles completed deliverables. Ready for human review and approval.';
  } else if (hasFailures) {
    screenReaderSummary = `AI Workforce: Mission alert. ${counts.failed} failed, ${counts.completed} completed. Manual review or retry required.`;
  } else {
    const parts: string[] = [];
    if (counts.completed > 0) parts.push(`${counts.completed} completed`);
    if (counts.reviewRequired > 0) parts.push(`${counts.reviewRequired} review required`);
    if (counts.running > 0) parts.push(`${counts.running} running`);
    if (counts.waitingDependency > 0) parts.push(`${counts.waitingDependency} waiting`);
    if (counts.queued > 0) parts.push(`${counts.queued} queued`);
    screenReaderSummary = `AI Workforce status: ${parts.join(', ')}.`;
  }

  const overview: WorkforceOverviewVM = {
    workOrderId: detail?.workOrder.id ?? null,
    status: detail?.workOrder.status ?? 'no_order',
    missionType: detail?.workOrder.missionType ?? null,
    isTerminal,
    counts,
    screenReaderSummary,
    humanActionRequired,
    canRetry,
    canCancel,
  };

  return {
    employees,
    overview,
    isStale,
    isRefreshing,
    lastUpdatedAt,
    pollingError,
  };
}
