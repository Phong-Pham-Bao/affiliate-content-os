import {
  parseAnalysisId,
  parseAuditEventId,
  validateAnalysisEvidence,
  validateNicheAnalysisContent,
  validateNicheAnalysisEvidence,
  validateProductAnalysisContent,
  type AnalysisSnapshot,
  type ProductFactSnapshot,
} from '@affiliate-content-os/domain';
import { generateUuidV7 } from '../id-generator.js';
import {
  buildFailureExecutionParams,
  buildRepairExecutionParams,
  buildRetryExecutionParams,
  buildSuccessExecutionParams,
} from './persist-ai-execution-helpers.js';
import type { PersistExecutionTransactionResult } from './transaction-ports.js';
import type {
  PersistAIExecutionResultCommand,
  PersistAIExecutionResultDependencies,
} from './types.js';

export { type PersistAIExecutionResultCommand, type PersistAIExecutionResultDependencies };

export async function persistAIExecutionResult(
  command: PersistAIExecutionResultCommand,
  deps: PersistAIExecutionResultDependencies,
): Promise<PersistExecutionTransactionResult> {
  const genId = () => deps.idGenerator?.generateId?.() ?? generateUuidV7();
  const auditEventId = parseAuditEventId(genId());

  // 1. Gateway error path: handle classified transient failures vs terminal errors
  if (!command.gatewayResult.success || !command.gatewayResult.content) {
    const errorCat = command.gatewayResult.errorCategory ?? 'provider_unavailable';
    const isTransient =
      command.gatewayResult.isTransient ??
      (errorCat === 'provider_unavailable' ||
        errorCat === 'provider_timeout' ||
        errorCat === 'rate_limited');

    // Bounded retry with exponential backoff for transient provider failures (including rate_limited)
    if (
      isTransient &&
      (errorCat === 'provider_unavailable' ||
        errorCat === 'provider_timeout' ||
        errorCat === 'rate_limited')
    ) {
      const delaySeconds = Math.min(60, Math.max(5, Math.pow(2, command.attemptCount) * 5));
      const retryParams = buildRetryExecutionParams(command, errorCat, delaySeconds);
      return deps.persistTxPort.persistExecutionResultAtomic(retryParams);
    }

    // Terminal non-transient failure
    const failureParams = buildFailureExecutionParams(command, auditEventId, errorCat);
    return deps.persistTxPort.persistExecutionResultAtomic(failureParams);
  }

  // 2. Verify persisted AI run provenance matches gateway result exactly
  const aiRun = await deps.aiRunPort.getAIRunById(command.workspaceId, command.aiRunId);
  const expectedTemplate =
    command.analysisType === 'product' ? 'product_analysis_v1' : 'niche_analysis_v1';
  const prov = command.gatewayResult.provenance;
  const isProvenanceMatch =
    aiRun != null &&
    prov !== undefined &&
    prov.provider === aiRun.provider &&
    prov.model === aiRun.model &&
    prov.promptTemplate === aiRun.promptTemplate &&
    prov.promptTemplate === expectedTemplate &&
    prov.promptVersion === aiRun.promptVersion &&
    prov.inputSchemaVersion === aiRun.inputSchemaVersion &&
    prov.outputSchemaVersion === aiRun.outputSchemaVersion;

  if (!isProvenanceMatch) {
    const failureParams = buildFailureExecutionParams(
      command,
      auditEventId,
      'internal_error',
      'AI_RUN_PROVENANCE_MISMATCH',
      'AI run provenance does not match gateway result or expected template',
    );
    return deps.persistTxPort.persistExecutionResultAtomic(failureParams);
  }

  // 3. Validate structured output
  let validatedContent: unknown;
  try {
    if (command.analysisType === 'product') {
      validatedContent = validateProductAnalysisContent(command.gatewayResult.content);
    } else {
      validatedContent = validateNicheAnalysisContent(command.gatewayResult.content);
    }
  } catch {
    const repairAttempt = command.repairAttemptCount ?? 0;
    // Exactly one repair attempt for invalid output
    if (repairAttempt === 0) {
      const repairParams = buildRepairExecutionParams(command, 5);
      return deps.persistTxPort.persistExecutionResultAtomic(repairParams);
    }

    // Second invalid output is terminal
    const failureParams = buildFailureExecutionParams(
      command,
      auditEventId,
      'invalid_output',
      'INVALID_STRUCTURED_OUTPUT',
      'Invalid AI structured output',
    );
    return deps.persistTxPort.persistExecutionResultAtomic(failureParams);
  }

  // 3. Always load authoritative grounding facts from DB (never trust caller snapshots)
  const factSetWithFacts = await deps.catalogPort.findFactSetById({
    workspaceId: command.workspaceId,
    productId: command.productId,
    factSetId: command.factSetId,
  });
  if (!factSetWithFacts || factSetWithFacts.factSet.status !== 'confirmed') {
    const failureParams = buildFailureExecutionParams(
      command,
      auditEventId,
      'invalid_evidence',
      'FACT_SET_NOT_CONFIRMED',
      'Grounding fact set not found or not confirmed',
    );
    return deps.persistTxPort.persistExecutionResultAtomic(failureParams);
  }
  const authoritativeFacts: readonly ProductFactSnapshot[] = factSetWithFacts.facts;

  // 4. Validate evidence
  if (command.analysisType === 'product') {
    const evidenceCheck = validateAnalysisEvidence(
      validatedContent as import('@affiliate-content-os/domain').ProductAnalysisContent,
      authoritativeFacts,
    );
    if (!evidenceCheck.valid) {
      const failureParams = buildFailureExecutionParams(
        command,
        auditEventId,
        'invalid_evidence',
        'INVALID_EVIDENCE_REFERENCE',
        'Affirmative claim referenced invalid or unconfirmed fact',
      );
      return deps.persistTxPort.persistExecutionResultAtomic(failureParams);
    }
  } else if (command.analysisType === 'niche') {
    // Always load every requested source analysis from authoritative storage
    const authoritativeSourceAnalyses: AnalysisSnapshot[] = [];
    if (command.sourceAnalysisIds && command.sourceAnalysisIds.length > 0) {
      for (const srcId of command.sourceAnalysisIds) {
        const found = await deps.analysisPort.getAnalysisById(
          command.workspaceId,
          parseAnalysisId(srcId),
        );
        // Must exist, belong to same workspace & product, and be accepted. No silent skip!
        if (!found || found.productId !== command.productId || found.status !== 'accepted') {
          const failureParams = buildFailureExecutionParams(
            command,
            auditEventId,
            'invalid_evidence',
            'INVALID_SOURCE_ANALYSIS',
            'Requested source analysis is missing, belongs to a different product, or is not accepted',
          );
          return deps.persistTxPort.persistExecutionResultAtomic(failureParams);
        }
        authoritativeSourceAnalyses.push(found);
      }
    }

    const evidenceCheck = validateNicheAnalysisEvidence(
      validatedContent as import('@affiliate-content-os/domain').NicheAnalysisContent,
      authoritativeFacts,
      authoritativeSourceAnalyses,
      command.workspaceId,
      command.productId,
      command.sourceAnalysisIds,
    );
    if (!evidenceCheck.valid) {
      const failureParams = buildFailureExecutionParams(
        command,
        auditEventId,
        'invalid_evidence',
        'INVALID_EVIDENCE_REFERENCE',
        'Niche analysis referenced invalid fact or unaccepted source analysis',
      );
      return deps.persistTxPort.persistExecutionResultAtomic(failureParams);
    }
  }

  // 5. Success path
  const analysisId = parseAnalysisId(genId());
  const successParams = buildSuccessExecutionParams(
    command,
    auditEventId,
    analysisId,
    validatedContent,
  );
  return deps.persistTxPort.persistExecutionResultAtomic(successParams);
}
