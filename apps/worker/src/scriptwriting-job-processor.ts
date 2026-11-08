import crypto from 'node:crypto';
import type { DatabasePool } from '@affiliate-content-os/infrastructure/database';
import type { AIGatewayPort, AIScriptVideoInput } from '@affiliate-content-os/application';
import {
  validateSingleVideoScript,
  type ContentBrief,
  type JobExecutionSnapshot,
  type SafeFailureCategory,
  type SingleVideoScript,
} from '@affiliate-content-os/domain';
import { settleScriptUnitAtomic } from '@affiliate-content-os/infrastructure/workforce';
import {
  crossCheckScriptwritingPayload,
  parseAndValidateScriptwritingPayload,
  type ValidatedScriptwritingPayload,
} from './scriptwriting-payload-validator.js';
import { failScriptwritingSafely } from './scriptwriting-fail-safely.js';

export interface ScriptwritingJobProcessorDependencies {
  readonly workerId: string;
  readonly gatewayPort: AIGatewayPort;
  readonly pool: DatabasePool;
}

export async function processScriptwritingJob(
  job: JobExecutionSnapshot,
  deps: ScriptwritingJobProcessorDependencies,
): Promise<void> {
  const client = await deps.pool.connect();
  try {
    let payload: ValidatedScriptwritingPayload;
    try {
      payload = parseAndValidateScriptwritingPayload(job.payloadJson);
      crossCheckScriptwritingPayload(payload, job);
    } catch (err) {
      await failScriptwritingSafely(
        client,
        job,
        deps.workerId,
        'INVALID_JOB_PAYLOAD',
        'internal_error',
        err instanceof Error ? err.message : 'Invalid scriptwriting payload',
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
      linkageRes.rows[0].operation_type !== 'scriptwriting' ||
      linkageRes.rows[0].purpose !== 'scriptwriting'
    ) {
      await failScriptwritingSafely(
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

    const unitRes = await client.query(
      `SELECT id, video_number, brief_hash
       FROM script_generation_units
       WHERE job_id = $1 AND workspace_id = $2`,
      [job.id, payload.workspaceId],
    );

    if (
      unitRes.rowCount === 0 ||
      unitRes.rows[0].video_number !== payload.videoNumber ||
      Buffer.from(unitRes.rows[0].brief_hash).toString('hex') !== payload.briefHash
    ) {
      await failScriptwritingSafely(
        client,
        job,
        deps.workerId,
        'INVALID_UNIT_LINKAGE',
        'internal_error',
        'Script generation unit linkage validation failed',
        payload,
      );
      return;
    }

    const briefRes = await client.query(
      `SELECT brief_json, brief_hash
       FROM content_briefs
       WHERE workspace_id = $1 AND work_order_id = $2
       ORDER BY brief_version DESC
       LIMIT 1`,
      [payload.workspaceId, payload.workOrderId],
    );

    if (
      briefRes.rowCount === 0 ||
      Buffer.from(briefRes.rows[0].brief_hash).toString('hex') !== payload.briefHash
    ) {
      await failScriptwritingSafely(
        client,
        job,
        deps.workerId,
        'AUTHORITATIVE_CONTEXT_FAILED',
        'invalid_evidence',
        'Content brief not found or brief hash mismatch',
        payload,
      );
      return;
    }

    const brief = briefRes.rows[0].brief_json as ContentBrief;
    const input: AIScriptVideoInput = {
      workspaceId: payload.workspaceId,
      productId: payload.productId,
      workOrderId: payload.workOrderId,
      videoNumber: payload.videoNumber,
      targetVariantCount: payload.targetVariantCount,
      brief,
      changeInstruction: payload.changeInstruction ?? null,
    };

    const repairFeedback =
      job.repairAttempt > 0
        ? { errorCategory: job.lastErrorCategory ?? 'invalid_output' }
        : undefined;

    const gwRes = await deps.gatewayPort.executeScriptVideo(input, repairFeedback);

    let validatedScript: SingleVideoScript | null = null;
    let valErrMsg: string | null = null;

    if (gwRes.success && gwRes.content) {
      try {
        validatedScript = validateSingleVideoScript(gwRes.content, payload.videoNumber);
        const validFacts = new Set(brief.eligibleFactIds.map((id) => id.toLowerCase()));
        const validAnalyses = new Set(brief.eligibleAnalysisIds.map((id) => id.toLowerCase()));

        for (const ref of validatedScript.video.evidenceReferences ?? []) {
          const lower = ref.sourceId.toLowerCase();
          if (ref.sourceKind === 'product_fact' && !validFacts.has(lower)) {
            throw new Error(`Evidence reference fact not eligible: ${ref.sourceId}`);
          }
          if (ref.sourceKind === 'analysis' && !validAnalyses.has(lower)) {
            throw new Error(`Evidence reference analysis not eligible: ${ref.sourceId}`);
          }
        }
      } catch (err) {
        valErrMsg = err instanceof Error ? err.message : 'Validation failed';
      }
    }

    await client.query('BEGIN');
    try {
      if (validatedScript && !valErrMsg) {
        const hash = new Uint8Array(
          crypto.createHash('sha256').update(JSON.stringify(validatedScript), 'utf8').digest(),
        );

        await settleScriptUnitAtomic(client, {
          workspaceId: payload.workspaceId,
          productId: payload.productId,
          workOrderId: payload.workOrderId,
          workItemId: payload.workItemId,
          assignmentId: payload.assignmentId,
          jobId: job.id,
          jobVersion: job.version,
          operationId: payload.operationId,
          aiRunId: payload.aiRunId,
          workerId: deps.workerId,
          videoNumber: payload.videoNumber,
          changeRequestId: payload.changeRequestId ?? null,
          reservedMicrounits: payload.reservedMicrounits,
          outcome: {
            kind: 'success',
            contentJson: validatedScript,
            contentHash: hash,
            schemaVersion: 1,
            promptTemplate: gwRes.provenance.promptTemplate,
            promptVersion: gwRes.provenance.promptVersion,
            provider: gwRes.provenance.provider,
            model: gwRes.provenance.model,
            usage: gwRes.usage,
            evidenceReferences: validatedScript.video.evidenceReferences ?? [],
          },
        });
      } else {
        const isTransient = Boolean(gwRes.isTransient);
        const errCat: SafeFailureCategory =
          gwRes.errorCategory ?? (valErrMsg ? 'invalid_output' : 'internal_error');
        const errMsg = valErrMsg ?? gwRes.errorMessage ?? 'Script execution failed';

        if (isTransient && job.attempt < job.maxAttempts) {
          const backoffSec = Math.min(30, 2 ** job.attempt * 5);
          await settleScriptUnitAtomic(client, {
            workspaceId: payload.workspaceId,
            productId: payload.productId,
            workOrderId: payload.workOrderId,
            workItemId: payload.workItemId,
            assignmentId: payload.assignmentId,
            jobId: job.id,
            jobVersion: job.version,
            operationId: payload.operationId,
            aiRunId: payload.aiRunId,
            workerId: deps.workerId,
            videoNumber: payload.videoNumber,
            changeRequestId: payload.changeRequestId ?? null,
            reservedMicrounits: payload.reservedMicrounits,
            outcome: {
              kind: 'transient_failure',
              errorCategory: errCat,
              errorMessage: errMsg,
              nextAttemptAt: new Date(Date.now() + backoffSec * 1000),
            },
          });
        } else if (errCat === 'invalid_output' && job.repairAttempt < job.maxRepairAttempts) {
          await settleScriptUnitAtomic(client, {
            workspaceId: payload.workspaceId,
            productId: payload.productId,
            workOrderId: payload.workOrderId,
            workItemId: payload.workItemId,
            assignmentId: payload.assignmentId,
            jobId: job.id,
            jobVersion: job.version,
            operationId: payload.operationId,
            aiRunId: payload.aiRunId,
            workerId: deps.workerId,
            videoNumber: payload.videoNumber,
            changeRequestId: payload.changeRequestId ?? null,
            reservedMicrounits: payload.reservedMicrounits,
            outcome: {
              kind: 'repair',
              errorCategory: errCat,
              errorMessage: errMsg,
              repairDelaySeconds: 1,
            },
          });
        } else {
          await settleScriptUnitAtomic(client, {
            workspaceId: payload.workspaceId,
            productId: payload.productId,
            workOrderId: payload.workOrderId,
            workItemId: payload.workItemId,
            assignmentId: payload.assignmentId,
            jobId: job.id,
            jobVersion: job.version,
            operationId: payload.operationId,
            aiRunId: payload.aiRunId,
            workerId: deps.workerId,
            videoNumber: payload.videoNumber,
            changeRequestId: payload.changeRequestId ?? null,
            reservedMicrounits: payload.reservedMicrounits,
            outcome: {
              kind: 'terminal_failure',
              errorCategory: errCat,
              errorCode:
                job.repairAttempt >= job.maxRepairAttempts && errCat === 'invalid_output'
                  ? 'INVALID_OUTPUT_REPAIR_EXHAUSTED'
                  : 'SCRIPTWRITING_FAILED',
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
