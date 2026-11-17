import type {
  AgentRoleKey,
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

export function isActivityForRole(
  act: WorkOrderActivityDTO,
  roleKey: AgentRoleKey,
  detail: WorkOrderDetailDTO | null,
  artifacts: readonly ContentArtifactSummaryDTO[],
): boolean {
  // Never associate by act.resourceType === roleKey because role names are not resource types!

  // 1. Content artifact activity
  if (act.resourceType === 'content_artifact' || act.action.startsWith('artifact.')) {
    const artId =
      act.resourceType === 'content_artifact'
        ? act.resourceId
        : (act.changesJson?.artifactId as string | undefined);
    if (artId) {
      const art = artifacts.find((a) => a.id === artId);
      if (art && art.authorRoleKey === roleKey) return true;
    }
    const wiId = act.changesJson?.workItemId as string | undefined;
    if (wiId && detail?.workItems.some((w) => w.id === wiId && w.roleKey === roleKey)) {
      return true;
    }
    if (act.changesJson?.roleKey === roleKey) return true;
    return false;
  }

  // 2. Work item activity
  if (act.resourceType === 'work_item') {
    if (detail?.workItems.some((w) => w.id === act.resourceId && w.roleKey === roleKey)) {
      return true;
    }
    const wiId = act.changesJson?.workItemId as string | undefined;
    if (wiId && detail?.workItems.some((w) => w.id === wiId && w.roleKey === roleKey)) {
      return true;
    }
    if (act.changesJson?.roleKey === roleKey) return true;
    return false;
  }

  // 3. Agent assignment activity
  if (act.resourceType === 'agent_assignment') {
    if (detail?.assignments.some((a) => a.id === act.resourceId && a.roleKey === roleKey)) {
      return true;
    }
    if (act.changesJson?.roleKey === roleKey) return true;
    return false;
  }

  // 4. Operation activity with explicit safe role association
  if (act.resourceType === 'operation') {
    if (act.changesJson?.roleKey === roleKey) return true;
    const wiId = act.changesJson?.workItemId as string | undefined;
    if (wiId && detail?.workItems.some((w) => w.id === wiId && w.roleKey === roleKey)) {
      return true;
    }
    return false;
  }

  // 5. Work order activity with explicit safe role association
  if (act.resourceType === 'work_order') {
    if (act.changesJson?.roleKey === roleKey) return true;
    const wiId = act.changesJson?.workItemId as string | undefined;
    if (wiId && detail?.workItems.some((w) => w.id === wiId && w.roleKey === roleKey)) {
      return true;
    }
    // Work-order-wide events with no safe role association remain OUT of employee trails
    return false;
  }

  return false;
}

export function isRetryEligible(detail: WorkOrderDetailDTO | null): boolean {
  if (!detail) return false;
  const woStatus = detail.workOrder.status;
  if (woStatus !== 'in_progress' && woStatus !== 'failed') {
    return false;
  }

  return detail.workItems.some((wi) => {
    if (wi.status !== 'failed') return false;
    const isPlanningTask =
      wi.taskKey === 'product_strategy' ||
      wi.taskKey === 'audience_strategy' ||
      wi.taskKey === 'creative_direction';
    const isScriptTask =
      wi.taskKey === 'scriptwriting' ||
      wi.taskKey === 'script_package' ||
      wi.roleKey === 'scriptwriter';
    return isPlanningTask || isScriptTask;
  });
}

export function mapWorkforceViewModel(input: {
  readonly detail: WorkOrderDetailDTO | null;
  readonly artifacts: readonly ContentArtifactSummaryDTO[];
  readonly activities: readonly WorkOrderActivityDTO[];
  readonly isStale?: boolean;
  readonly isRefreshing?: boolean;
  readonly lastUpdatedAt?: string | null;
  readonly pollingError?: string | null;
  readonly observationWarning?: string | null;
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
    observationWarning = null,
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
    const relevantActivities = activities.filter((act) =>
      isActivityForRole(act, roleKey, detail, artifacts),
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
      detail.workOrder.status === 'canceled' ||
      detail.workOrder.status === 'cancelled'
    : false;

  const humanActionRequired =
    counts.reviewRequired > 0 || artifacts.some((a) => a.lifecycleStatus === 'review_required');
  const canRetry = canManage && isRetryEligible(detail);
  const canCancel = canManage && Boolean(detail) && !isTerminal;

  const isCanceled =
    detail?.workOrder.status === 'canceled' || detail?.workOrder.status === 'cancelled';
  const isFailed = detail?.workOrder.status === 'failed';
  const isCompleted = detail?.workOrder.status === 'completed';

  let screenReaderSummary: string;
  if (!detail) {
    screenReaderSummary = 'AI Workforce: No active mission assigned.';
  } else if (isCanceled) {
    screenReaderSummary = 'AI Workforce: Mission was canceled.';
  } else if (isFailed) {
    if (canRetry) {
      screenReaderSummary = `AI Workforce: Mission failed. ${counts.failed} step(s) failed. Retry available for eligible steps.`;
    } else {
      screenReaderSummary = `AI Workforce: Mission failed. ${counts.failed} step(s) failed. Manual review required.`;
    }
  } else if (humanActionRequired) {
    screenReaderSummary =
      'AI Workforce: Deliverables produced. Human review and approval required.';
  } else if (isCompleted) {
    const allAccepted =
      artifacts.length > 0 && artifacts.every((a) => a.lifecycleStatus === 'accepted');
    if (allAccepted) {
      screenReaderSummary =
        'AI Workforce: All deliverables accepted. Mission completed and approved.';
    } else {
      screenReaderSummary = 'AI Workforce: Mission completed. No pending human reviews.';
    }
  } else {
    const parts: string[] = [];
    if (counts.completed > 0) parts.push(`${counts.completed} completed`);
    if (counts.running > 0) parts.push(`${counts.running} running`);
    if (counts.waitingDependency > 0) parts.push(`${counts.waitingDependency} waiting`);
    if (counts.queued > 0) parts.push(`${counts.queued} queued`);
    if (counts.preparing > 0) parts.push(`${counts.preparing} preparing`);
    if (parts.length === 0) parts.push('idle');
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
    observationWarning,
  };
}
