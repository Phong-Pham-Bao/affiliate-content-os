import type {
  AgentRoleKey,
  AssignmentOfficeState,
  ContentArtifactSummaryDTO,
  WorkItemSummaryDTO,
  AgentAssignmentSummaryDTO,
  WorkOrderActivityDTO,
  WorkOrderStatus,
} from '../types/workforce.js';

export type OfficeStationKey =
  'strategy' | 'product' | 'insight' | 'creative' | 'content' | 'quality';

export type EmployeePositionClass =
  'pos-desk' | 'pos-dependency' | 'pos-review' | 'pos-archive' | 'pos-attention' | 'pos-idle';

export type BadgeVariant = 'secondary' | 'info' | 'primary' | 'warning' | 'success' | 'danger';

export interface NamedDependencyVM {
  readonly workItemId: string;
  readonly roleKey?: AgentRoleKey | undefined;
  readonly roleName: string;
  readonly status: string;
}

export interface EmployeeOperationalDetailsVM {
  readonly isRetryWait: boolean;
  readonly isBudgetExhausted: boolean;
  readonly isRateLimited: boolean;
  readonly isProviderOutage: boolean;
  readonly blockedReasonCode: string | null;
  readonly failureCategory: string | null;
  readonly actionableMessage: string | null;
}

export interface EmployeeVM {
  readonly roleKey: AgentRoleKey;
  readonly displayName: string;
  readonly department: string;
  readonly station: OfficeStationKey;
  readonly mandate: string;
  readonly officeState: AssignmentOfficeState;
  readonly positionClass: EmployeePositionClass;
  readonly statusLabel: string;
  readonly badgeVariant: BadgeVariant;
  readonly currentTask: string | null;
  readonly workItem: WorkItemSummaryDTO | null;
  readonly assignment: AgentAssignmentSummaryDTO | null;
  readonly namedDependencies: readonly NamedDependencyVM[];
  readonly latestReportCode: string | null;
  readonly deliverables: readonly ContentArtifactSummaryDTO[];
  readonly relevantActivities: readonly WorkOrderActivityDTO[];
  readonly timestamps: {
    readonly startedAt: string | null;
    readonly completedAt: string | null;
    readonly updatedAt: string | null;
  };
  readonly operationalDetails: EmployeeOperationalDetailsVM;
}

export interface WorkforceOverviewVM {
  readonly workOrderId: string | null;
  readonly status: WorkOrderStatus | 'no_order';
  readonly missionType: string | null;
  readonly isTerminal: boolean;
  readonly counts: {
    readonly totalRoles: number;
    readonly idle: number;
    readonly preparing: number;
    readonly queued: number;
    readonly running: number;
    readonly waitingDependency: number;
    readonly reviewRequired: number;
    readonly completed: number;
    readonly blocked: number;
    readonly failed: number;
    readonly canceled: number;
    readonly deliverablesCount: number;
  };
  readonly screenReaderSummary: string;
  readonly humanActionRequired: boolean;
  readonly canRetry: boolean;
  readonly canCancel: boolean;
}

export interface WorkforceViewModel {
  readonly employees: readonly EmployeeVM[];
  readonly overview: WorkforceOverviewVM;
  readonly isStale: boolean;
  readonly isRefreshing: boolean;
  readonly lastUpdatedAt: string | null;
  readonly pollingError: string | null;
  readonly observationWarning: string | null;
}
