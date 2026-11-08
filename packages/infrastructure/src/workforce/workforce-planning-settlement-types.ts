import type { AIUsageSnapshot } from '@affiliate-content-os/domain';

export interface WorkforceSuccessOutcome {
  readonly kind: 'success';
  readonly contentJson: Record<string, unknown>;
  readonly contentHash: Uint8Array;
  readonly schemaVersion: number;
  readonly promptTemplate: string;
  readonly promptVersion: string;
  readonly provider: string;
  readonly model: string;
  readonly usage: AIUsageSnapshot;
  readonly evidenceReferences: readonly {
    readonly sourceKind: 'product_fact' | 'analysis';
    readonly sourceId: string;
  }[];
}

export interface WorkforceTransientFailureOutcome {
  readonly kind: 'transient_failure';
  readonly errorCategory: string;
  readonly errorCode?: string;
  readonly errorMessage: string;
  readonly nextAttemptAt: Date;
}

export interface WorkforceRepairOutcome {
  readonly kind: 'repair';
  readonly errorCategory: string;
  readonly errorMessage: string;
  readonly repairDelaySeconds: number;
}

export interface WorkforceTerminalFailureOutcome {
  readonly kind: 'terminal_failure';
  readonly errorCategory: string;
  readonly errorCode?: string;
  readonly errorMessage: string;
}

export interface WorkforcePlanningSettlementParams {
  readonly workspaceId: string;
  readonly productId: string;
  readonly workOrderId: string;
  readonly workItemId: string;
  readonly assignmentId: string;
  readonly authorRoleKey: string;
  readonly artifactType: string;
  readonly taskKey?: string | undefined;
  readonly jobId: string;
  readonly jobVersion: number;
  readonly operationId: string;
  readonly aiRunId: string;
  readonly workerId: string;
  readonly reservedMicrounits: number;
  readonly outcome:
    | WorkforceSuccessOutcome
    | WorkforceTransientFailureOutcome
    | WorkforceTerminalFailureOutcome
    | WorkforceRepairOutcome;
}
