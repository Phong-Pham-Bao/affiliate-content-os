import crypto from 'node:crypto';
import type { DatabasePool } from '@affiliate-content-os/infrastructure/database';
import type { AIGatewayPort } from '@affiliate-content-os/application';
import type { JobExecutionSnapshot } from '@affiliate-content-os/domain';
import { settleWorkforcePlanningJobAtomic } from '@affiliate-content-os/infrastructure/workforce';
import {
  crossCheckWorkforcePlanningPayload,
  parseAndValidateWorkforcePlanningPayload,
  type ValidatedWorkforcePlanningPayload,
} from './workforce-payload-validator.js';
import { reconstructWorkforceContext } from './workforce-input-reconstructor.js';
import { dispatchWorkforcePlanningGateway } from './workforce-gateway-dispatcher.js';
import {
  validateWorkforceArtifactOutput,
  type ValidatedArtifactOutput,
} from './workforce-output-validator.js';
import { failSafely } from './workforce-fail-safely.js';

export interface WorkforceJobProcessorDependencies {
  readonly workerId: string;
  readonly gatewayPort: AIGatewayPort;
  readonly pool: DatabasePool;
}

const ARTIFACT_TYPE_MAP = {
  product_strategy: 'product_campaign_plan',
  audience_strategy: 'audience_insight_board',
  creative_direction: 'video_series_plan',
} as const;

export async function processWorkforcePlanningJob(
  job: JobExecutionSnapshot,
  deps: WorkforceJobProcessorDependencies,
): Promise<void> {
  const client = await deps.pool.connect();
  try {
    let payload: ValidatedWorkforcePlanningPayload;
    try {
      payload = parseAndValidateWorkforcePlanningPayload(job.payloadJson);
      crossCheckWorkforcePlanningPayload(payload, job);
    } catch (err) {
      await failSafely(
        client,
        job,
        deps.workerId,
        'INVALID_JOB_PAYLOAD',
        'internal_error',
        err instanceof Error ? err.message : 'Invalid workforce planning payload',
      );
      return;
    }

    const linkageRes = await client.query(
      `SELECT o.id AS op_id, o.resource_id, o.operation_type, o.work_order_id AS op_wo_id,
              r.id AS run_id, r.purpose, r.work_order_id AS run_wo_id
       FROM operations o
       JOIN ai_runs r ON r.operation_id = o.id AND r.workspace_id = o.workspace_id
       WHERE o.id = $1 AND r.id = $2 AND o.workspace_id = $3`,
      [payload.operationId, payload.aiRunId, payload.workspaceId],
    );

    if (
      linkageRes.rowCount === 0 ||
      linkageRes.rows[0].resource_id !== payload.productId ||
      linkageRes.rows[0].op_wo_id !== payload.workOrderId ||
      linkageRes.rows[0].run_wo_id !== payload.workOrderId ||
      linkageRes.rows[0].operation_type !== payload.taskKey ||
      linkageRes.rows[0].purpose !== payload.taskKey
    ) {
      await failSafely(
        client,
        job,
        deps.workerId,
        'INVALID_JOB_LINKAGE',
        'internal_error',
        'Operation or AI run linkage validation failed',
        payload,
      );
      return;
    }

    let ctx;
    try {
      ctx = await reconstructWorkforceContext(client, payload);
    } catch (err) {
      await failSafely(
        client,
        job,
        deps.workerId,
        'AUTHORITATIVE_CONTEXT_FAILED',
        'invalid_evidence',
        err instanceof Error ? err.message : 'Context reconstruction failed',
        payload,
      );
      return;
    }

    const repairFeedback =
      job.repairAttempt > 0
        ? { errorCategory: job.lastErrorCategory ?? 'invalid_output' }
        : undefined;

    const gwRes = await dispatchWorkforcePlanningGateway(
      deps.gatewayPort,
      payload.taskKey,
      ctx.planningInput,
      repairFeedback,
    );

    const artifactType = ARTIFACT_TYPE_MAP[payload.taskKey];
    let output: ValidatedArtifactOutput | null = null;
    let valErrMsg: string | null = null;

    if (gwRes.success && gwRes.content) {
      try {
        output = validateWorkforceArtifactOutput(
          payload.taskKey,
          gwRes.content,
          ctx.validFactIds,
          ctx.validAnalysisIds,
        );
      } catch (err) {
        valErrMsg = err instanceof Error ? err.message : 'Validation failed';
      }
    }

    await client.query('BEGIN');
    try {
      if (output && !valErrMsg) {
        const hash = new Uint8Array(
          crypto
            .createHash('sha256')
            .update(JSON.stringify(output.validatedContent), 'utf8')
            .digest(),
        );
        await settleWorkforcePlanningJobAtomic(client, {
          workspaceId: payload.workspaceId,
          productId: payload.productId,
          workOrderId: payload.workOrderId,
          workItemId: payload.workItemId,
          assignmentId: ctx.assignmentId,
          authorRoleKey: payload.roleKey,
          artifactType,
          jobId: job.id,
          jobVersion: job.version,
          operationId: payload.operationId,
          aiRunId: payload.aiRunId,
          workerId: deps.workerId,
          reservedMicrounits: payload.reservedMicrounits,
          outcome: {
            kind: 'success',
            contentJson: output.validatedContent,
            contentHash: hash,
            schemaVersion: 1,
            promptTemplate: gwRes.provenance.promptTemplate,
            promptVersion: gwRes.provenance.promptVersion,
            provider: gwRes.provenance.provider,
            model: gwRes.provenance.model,
            usage: gwRes.usage,
            evidenceReferences: output.evidenceRefs,
          },
        });
      } else {
        const isTransient = Boolean(gwRes.isTransient);
        const errCat = gwRes.errorCategory ?? (valErrMsg ? 'invalid_output' : 'internal_error');
        const errMsg = valErrMsg ?? gwRes.errorMessage ?? 'Execution failed';
        if (isTransient && job.attempt < job.maxAttempts) {
          const backoffSec = Math.min(30, 2 ** job.attempt * 5);
          await settleWorkforcePlanningJobAtomic(client, {
            workspaceId: payload.workspaceId,
            productId: payload.productId,
            workOrderId: payload.workOrderId,
            workItemId: payload.workItemId,
            assignmentId: ctx.assignmentId,
            authorRoleKey: payload.roleKey,
            artifactType,
            jobId: job.id,
            jobVersion: job.version,
            operationId: payload.operationId,
            aiRunId: payload.aiRunId,
            workerId: deps.workerId,
            reservedMicrounits: payload.reservedMicrounits,
            outcome: {
              kind: 'transient_failure',
              errorCategory: errCat,
              errorMessage: errMsg,
              nextAttemptAt: new Date(Date.now() + backoffSec * 1000),
            },
          });
        } else {
          await settleWorkforcePlanningJobAtomic(client, {
            workspaceId: payload.workspaceId,
            productId: payload.productId,
            workOrderId: payload.workOrderId,
            workItemId: payload.workItemId,
            assignmentId: ctx.assignmentId,
            authorRoleKey: payload.roleKey,
            artifactType,
            jobId: job.id,
            jobVersion: job.version,
            operationId: payload.operationId,
            aiRunId: payload.aiRunId,
            workerId: deps.workerId,
            reservedMicrounits: payload.reservedMicrounits,
            outcome: {
              kind: 'terminal_failure',
              errorCategory: errCat,
              errorCode: 'PLANNING_FAILED',
              errorMessage: errMsg,
            },
          });
        }
      }
      await client.query('COMMIT');
    } catch (settleErr) {
      await client.query('ROLLBACK');
      throw settleErr;
    }
  } finally {
    client.release();
  }
}
