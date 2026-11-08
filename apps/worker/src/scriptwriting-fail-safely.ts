import type { DatabasePoolClient } from '@affiliate-content-os/infrastructure/database';
import type { JobExecutionSnapshot, SafeFailureCategory } from '@affiliate-content-os/domain';
import { settleScriptUnitAtomic } from '@affiliate-content-os/infrastructure/workforce';
import type { ValidatedScriptwritingPayload } from './scriptwriting-payload-validator.js';

export async function failScriptwritingSafely(
  client: DatabasePoolClient,
  job: JobExecutionSnapshot,
  workerId: string,
  errorCode: string,
  errorCategory: SafeFailureCategory,
  errorMessage: string,
  payload?: ValidatedScriptwritingPayload,
): Promise<void> {
  await client.query('BEGIN');
  try {
    const rawPayload = job.payloadJson;
    await settleScriptUnitAtomic(client, {
      workspaceId: payload?.workspaceId ?? job.workspaceId,
      productId:
        payload?.productId ??
        (typeof rawPayload['productId'] === 'string' ? rawPayload['productId'] : ''),
      workOrderId:
        payload?.workOrderId ??
        (typeof rawPayload['workOrderId'] === 'string' ? rawPayload['workOrderId'] : ''),
      workItemId:
        payload?.workItemId ??
        (typeof rawPayload['workItemId'] === 'string' ? rawPayload['workItemId'] : ''),
      assignmentId:
        payload?.assignmentId ??
        (typeof rawPayload['assignmentId'] === 'string' ? rawPayload['assignmentId'] : ''),
      jobId: job.id,
      jobVersion: job.version,
      operationId: job.operationId,
      aiRunId: job.aiRunId,
      workerId,
      videoNumber:
        payload?.videoNumber ??
        (typeof rawPayload['videoNumber'] === 'number' ? rawPayload['videoNumber'] : 1),
      changeRequestId:
        payload?.changeRequestId ??
        (typeof rawPayload['changeRequestId'] === 'string' ? rawPayload['changeRequestId'] : null),
      reservedMicrounits: payload?.reservedMicrounits ?? job.reservedSpendMicrounits,
      outcome: { kind: 'terminal_failure', errorCategory, errorCode, errorMessage },
    });
    await client.query('COMMIT');
  } catch {
    await client.query('ROLLBACK');
  }
}
