import type { JobExecutionSnapshot } from '@affiliate-content-os/domain';

export interface ValidatedCompliancePayload {
  readonly workspaceId: string;
  readonly productId: string;
  readonly workOrderId: string;
  readonly contextPackageId?: string | null | undefined;
  readonly artifactId: string;
  readonly revisionNumber: number;
  readonly contentHashHex: string;
  readonly policyVersion: string;
  readonly operationId: string;
  readonly aiRunId: string;
  readonly evaluationId: string;
  readonly workItemId?: string | null | undefined;
  readonly assignmentId?: string | null | undefined;
  readonly reservedMicrounits?: number | undefined;
}

export function parseAndValidateCompliancePayload(
  payloadJson: unknown,
): ValidatedCompliancePayload {
  if (!payloadJson || typeof payloadJson !== 'object') {
    throw new Error('Compliance job payload must be a non-null object');
  }

  const p = payloadJson as Record<string, unknown>;

  if (typeof p.workspaceId !== 'string' || !p.workspaceId) {
    throw new Error('Missing or invalid workspaceId in compliance payload');
  }
  if (typeof p.productId !== 'string' || !p.productId) {
    throw new Error('Missing or invalid productId in compliance payload');
  }
  if (typeof p.workOrderId !== 'string' || !p.workOrderId) {
    throw new Error('Missing or invalid workOrderId in compliance payload');
  }
  if (typeof p.artifactId !== 'string' || !p.artifactId) {
    throw new Error('Missing or invalid artifactId in compliance payload');
  }
  if (typeof p.revisionNumber !== 'number' || p.revisionNumber < 1) {
    throw new Error('Missing or invalid revisionNumber in compliance payload');
  }
  if (typeof p.policyVersion !== 'string' || !p.policyVersion) {
    throw new Error('Missing or invalid policyVersion in compliance payload');
  }
  if (typeof p.operationId !== 'string' || !p.operationId) {
    throw new Error('Missing or invalid operationId in compliance payload');
  }
  if (typeof p.aiRunId !== 'string' || !p.aiRunId) {
    throw new Error('Missing or invalid aiRunId in compliance payload');
  }
  if (typeof p.evaluationId !== 'string' || !p.evaluationId) {
    throw new Error('Missing or invalid evaluationId in compliance payload');
  }
  if (typeof p.contentHashHex !== 'string' || !/^[0-9a-f]{64}$/i.test(p.contentHashHex)) {
    throw new Error(
      'Missing or invalid contentHashHex in compliance payload (must be 64-hex string)',
    );
  }

  return {
    workspaceId: p.workspaceId,
    productId: p.productId,
    workOrderId: p.workOrderId,
    contextPackageId: typeof p.contextPackageId === 'string' ? p.contextPackageId : null,
    artifactId: p.artifactId,
    revisionNumber: p.revisionNumber,
    contentHashHex: p.contentHashHex.toLowerCase(),
    policyVersion: p.policyVersion,
    operationId: p.operationId,
    aiRunId: p.aiRunId,
    evaluationId: p.evaluationId,
    workItemId: typeof p.workItemId === 'string' ? p.workItemId : null,
    assignmentId: typeof p.assignmentId === 'string' ? p.assignmentId : null,
    reservedMicrounits: typeof p.reservedMicrounits === 'number' ? p.reservedMicrounits : undefined,
  };
}

export function crossCheckCompliancePayload(
  payload: ValidatedCompliancePayload,
  job: JobExecutionSnapshot,
): void {
  if (payload.workspaceId !== job.workspaceId) {
    throw new Error('Workspace mismatch between payload and job execution');
  }
  if (payload.operationId !== job.operationId) {
    throw new Error('Operation mismatch between payload and job execution');
  }
  if (payload.aiRunId !== job.aiRunId) {
    throw new Error('AI run mismatch between payload and job execution');
  }
  if (
    payload.reservedMicrounits !== undefined &&
    payload.reservedMicrounits !== job.reservedSpendMicrounits
  ) {
    throw new Error('Reserved microunits mismatch between payload and job execution');
  }
}
