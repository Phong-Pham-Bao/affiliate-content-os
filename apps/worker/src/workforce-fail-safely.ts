import type { DatabasePoolClient } from '@affiliate-content-os/infrastructure/database';
import type { JobExecutionSnapshot } from '@affiliate-content-os/domain';
import { settleWorkforcePlanningJobAtomic } from '@affiliate-content-os/infrastructure/workforce';
import type { ValidatedWorkforcePlanningPayload } from './workforce-payload-validator.js';

export async function failSafely(
  client: DatabasePoolClient,
  job: JobExecutionSnapshot,
  workerId: string,
  errorCode: string,
  errorCategory: string,
  errorMessage: string,
  payload?: ValidatedWorkforcePlanningPayload,
): Promise<void> {
  await client.query('BEGIN');
  try {
    await settleWorkforcePlanningJobAtomic(client, {
      workspaceId: payload?.workspaceId ?? job.workspaceId,
      productId:
        payload?.productId ??
        (typeof job.payloadJson['productId'] === 'string' ? job.payloadJson['productId'] : ''),
      workOrderId:
        payload?.workOrderId ??
        (typeof job.payloadJson['workOrderId'] === 'string' ? job.payloadJson['workOrderId'] : ''),
      workItemId:
        payload?.workItemId ??
        (typeof job.payloadJson['workItemId'] === 'string' ? job.payloadJson['workItemId'] : ''),
      assignmentId: '',
      authorRoleKey:
        payload?.roleKey ??
        (typeof job.payloadJson['roleKey'] === 'string' ? job.payloadJson['roleKey'] : ''),
      artifactType: '',
      jobId: job.id,
      jobVersion: job.version,
      operationId: job.operationId,
      aiRunId: job.aiRunId,
      workerId,
      reservedMicrounits: payload?.reservedMicrounits ?? job.reservedSpendMicrounits,
      outcome: { kind: 'terminal_failure', errorCategory, errorCode, errorMessage },
    });
    await client.query('COMMIT');
  } catch {
    await client.query('ROLLBACK');
  }
}
