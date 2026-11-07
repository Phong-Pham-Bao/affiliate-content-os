import { DomainValidationError } from '../errors.js';
import type { ProductFactSnapshot } from '../catalog/types.js';
import type { AnalysisSnapshot } from './analysis-types.js';
import type { NicheAnalysisContent } from './niche-analysis-types.js';
import type { ProductAnalysisContent } from './product-analysis-types.js';

export type EvidenceViolationCode =
  | 'UNKNOWN_FACT_ID'
  | 'UNCONFIRMED_FACT_EVIDENCE'
  | 'PROHIBITED_CLAIM_USED'
  | 'CONTEXT_ONLY_FACT_USED'
  | 'UNKNOWN_SOURCE_ANALYSIS_ID'
  | 'SOURCE_ANALYSIS_NOT_ACCEPTED'
  | 'SOURCE_ANALYSIS_MISMATCH'
  | 'SOURCE_ANALYSIS_WORKSPACE_MISMATCH'
  | 'SOURCE_ANALYSIS_PRODUCT_MISMATCH'
  | 'SOURCE_ANALYSIS_NOT_IN_CONTEXT'
  | 'MISSING_REQUIRED_EVIDENCE';

export interface EvidenceViolation {
  readonly factId: string;
  readonly referenceId?: string;
  readonly field: string;
  readonly code: EvidenceViolationCode;
  readonly message: string;
}

export interface EvidenceValidationResult {
  readonly valid: boolean;
  readonly violations: readonly EvidenceViolation[];
}

function checkFactReferences(
  factIds: readonly string[] | undefined,
  fieldPath: string,
  factMap: Map<string, ProductFactSnapshot>,
  violations: EvidenceViolation[],
): void {
  if (!factIds || factIds.length === 0) return;

  for (let i = 0; i < factIds.length; i++) {
    const factId = factIds[i];
    if (!factId) continue;
    const fact = factMap.get(factId);
    const fullPath = `${fieldPath}[${i}]`;

    if (!fact) {
      violations.push({
        factId,
        referenceId: factId,
        field: fullPath,
        code: 'UNKNOWN_FACT_ID',
        message: `Fact ID "${factId}" does not exist in confirmed fact set`,
      });
      continue;
    }

    if (fact.confidence !== 'confirmed') {
      violations.push({
        factId,
        referenceId: factId,
        field: fullPath,
        code: 'UNCONFIRMED_FACT_EVIDENCE',
        message: `Fact ID "${factId}" has confidence "${fact.confidence}" but only confirmed facts can ground affirmative claims`,
      });
    }

    if (fact.claimUsage === 'prohibited') {
      violations.push({
        factId,
        referenceId: factId,
        field: fullPath,
        code: 'PROHIBITED_CLAIM_USED',
        message: `Fact ID "${factId}" is marked prohibited and cannot be used as affirmative evidence`,
      });
    } else if (fact.claimUsage === 'context_only') {
      violations.push({
        factId,
        referenceId: factId,
        field: fullPath,
        code: 'CONTEXT_ONLY_FACT_USED',
        message: `Fact ID "${factId}" is marked context_only and cannot be used as affirmative evidence`,
      });
    }
  }
}

function checkSourceAnalysisReferences(
  analysisIds: readonly string[] | undefined,
  fieldPath: string,
  analysisMap: Map<string, AnalysisSnapshot>,
  violations: EvidenceViolation[],
  contextSet?: Set<string>,
  targetWorkspaceId?: string,
  targetProductId?: string,
): void {
  if (!analysisIds || analysisIds.length === 0) return;

  for (let i = 0; i < analysisIds.length; i++) {
    const analysisId = analysisIds[i];
    if (!analysisId) continue;
    const fullPath = `${fieldPath}[${i}]`;

    if (contextSet && !contextSet.has(analysisId)) {
      violations.push({
        factId: analysisId,
        referenceId: analysisId,
        field: fullPath,
        code: 'SOURCE_ANALYSIS_NOT_IN_CONTEXT',
        message: `Source analysis ID "${analysisId}" is not in the requested source analyses context`,
      });
      continue;
    }

    const analysis = analysisMap.get(analysisId);
    if (!analysis) {
      violations.push({
        factId: analysisId,
        referenceId: analysisId,
        field: fullPath,
        code: 'UNKNOWN_SOURCE_ANALYSIS_ID',
        message: `Source analysis ID "${analysisId}" does not exist in accepted source analyses`,
      });
      continue;
    }

    if (targetWorkspaceId && analysis.workspaceId !== targetWorkspaceId) {
      violations.push({
        factId: analysisId,
        referenceId: analysisId,
        field: fullPath,
        code: 'SOURCE_ANALYSIS_WORKSPACE_MISMATCH',
        message: `Source analysis "${analysisId}" belongs to different workspace`,
      });
    }

    if (targetProductId && analysis.productId !== targetProductId) {
      violations.push({
        factId: analysisId,
        referenceId: analysisId,
        field: fullPath,
        code: 'SOURCE_ANALYSIS_PRODUCT_MISMATCH',
        message: `Source analysis "${analysisId}" belongs to different product`,
      });
    }

    if (analysis.status !== 'accepted') {
      violations.push({
        factId: analysisId,
        referenceId: analysisId,
        field: fullPath,
        code: 'SOURCE_ANALYSIS_NOT_ACCEPTED',
        message: `Source analysis ID "${analysisId}" has status "${analysis.status}" but only accepted analyses may be referenced`,
      });
    }
  }
}

export function validateAnalysisEvidence(
  content: ProductAnalysisContent,
  facts: readonly ProductFactSnapshot[],
): EvidenceValidationResult {
  const factMap = new Map<string, ProductFactSnapshot>();
  for (const fact of facts) {
    factMap.set(fact.id, fact);
  }

  const violations: EvidenceViolation[] = [];

  content.benefits.forEach((item, idx) => {
    if (!item.evidenceFactIds || item.evidenceFactIds.length === 0) {
      violations.push({
        factId: '',
        field: `benefits[${idx}].evidenceFactIds`,
        code: 'MISSING_REQUIRED_EVIDENCE',
        message: `Benefit "${item.title}" must reference at least one confirmed fact as evidence`,
      });
    } else {
      checkFactReferences(
        item.evidenceFactIds,
        `benefits[${idx}].evidenceFactIds`,
        factMap,
        violations,
      );
    }
  });

  content.differentiators.forEach((item, idx) => {
    if (!item.evidenceFactIds || item.evidenceFactIds.length === 0) {
      violations.push({
        factId: '',
        field: `differentiators[${idx}].evidenceFactIds`,
        code: 'MISSING_REQUIRED_EVIDENCE',
        message: `Differentiator "${item.title}" must reference at least one confirmed fact as evidence`,
      });
    } else {
      checkFactReferences(
        item.evidenceFactIds,
        `differentiators[${idx}].evidenceFactIds`,
        factMap,
        violations,
      );
    }
  });

  content.objections.forEach((item, idx) => {
    if (!item.evidenceFactIds || item.evidenceFactIds.length === 0) {
      violations.push({
        factId: '',
        field: `objections[${idx}].evidenceFactIds`,
        code: 'MISSING_REQUIRED_EVIDENCE',
        message: `Objection counterargument "${item.counterArgument}" must reference at least one confirmed fact as evidence`,
      });
    } else {
      checkFactReferences(
        item.evidenceFactIds,
        `objections[${idx}].evidenceFactIds`,
        factMap,
        violations,
      );
    }
  });

  return {
    valid: violations.length === 0,
    violations: Object.freeze(violations),
  };
}

export function validateNicheAnalysisEvidence(
  content: NicheAnalysisContent,
  facts: readonly ProductFactSnapshot[],
  sourceAnalyses: readonly AnalysisSnapshot[] = [],
  targetWorkspaceId?: string,
  targetProductId?: string,
  contextSourceIds?: readonly string[],
): EvidenceValidationResult {
  const factMap = new Map<string, ProductFactSnapshot>();
  for (const fact of facts) {
    factMap.set(fact.id, fact);
  }

  const analysisMap = new Map<string, AnalysisSnapshot>();
  for (const a of sourceAnalyses) {
    analysisMap.set(a.id, a);
  }

  const violations: EvidenceViolation[] = [];
  const contextSet = contextSourceIds ? new Set(contextSourceIds) : undefined;

  content.pains.forEach((item, idx) => {
    const count = (item.evidenceFactIds?.length ?? 0) + (item.sourceAnalysisIds?.length ?? 0);
    if (count === 0) {
      violations.push({
        factId: '',
        field: `pains[${idx}]`,
        code: 'MISSING_REQUIRED_EVIDENCE',
        message: `Pain item "${item.painPoint}" must reference at least one fact or source analysis`,
      });
    } else {
      checkFactReferences(
        item.evidenceFactIds,
        `pains[${idx}].evidenceFactIds`,
        factMap,
        violations,
      );
      checkSourceAnalysisReferences(
        item.sourceAnalysisIds,
        `pains[${idx}].sourceAnalysisIds`,
        analysisMap,
        violations,
        contextSet,
        targetWorkspaceId,
        targetProductId,
      );
    }
  });

  content.themes.forEach((item, idx) => {
    const count = (item.evidenceFactIds?.length ?? 0) + (item.sourceAnalysisIds?.length ?? 0);
    if (count === 0) {
      violations.push({
        factId: '',
        field: `themes[${idx}]`,
        code: 'MISSING_REQUIRED_EVIDENCE',
        message: `Theme item "${item.theme}" must reference at least one fact or source analysis`,
      });
    } else {
      checkFactReferences(
        item.evidenceFactIds,
        `themes[${idx}].evidenceFactIds`,
        factMap,
        violations,
      );
      checkSourceAnalysisReferences(
        item.sourceAnalysisIds,
        `themes[${idx}].sourceAnalysisIds`,
        analysisMap,
        violations,
        contextSet,
        targetWorkspaceId,
        targetProductId,
      );
    }
  });

  content.competitivePositioning.forEach((item, idx) => {
    const count = (item.evidenceFactIds?.length ?? 0) + (item.sourceAnalysisIds?.length ?? 0);
    if (count === 0) {
      violations.push({
        factId: '',
        field: `competitivePositioning[${idx}]`,
        code: 'MISSING_REQUIRED_EVIDENCE',
        message: `Competitive positioning item "${item.competitorOrAlternative}" must reference at least one fact or source analysis`,
      });
    } else {
      checkFactReferences(
        item.evidenceFactIds,
        `competitivePositioning[${idx}].evidenceFactIds`,
        factMap,
        violations,
      );
      checkSourceAnalysisReferences(
        item.sourceAnalysisIds,
        `competitivePositioning[${idx}].sourceAnalysisIds`,
        analysisMap,
        violations,
        contextSet,
        targetWorkspaceId,
        targetProductId,
      );
    }
  });

  content.risks.forEach((item, idx) => {
    checkFactReferences(item.evidenceFactIds, `risks[${idx}].evidenceFactIds`, factMap, violations);
    checkSourceAnalysisReferences(
      item.sourceAnalysisIds,
      `risks[${idx}].sourceAnalysisIds`,
      analysisMap,
      violations,
      contextSet,
      targetWorkspaceId,
      targetProductId,
    );
  });

  return {
    valid: violations.length === 0,
    violations: Object.freeze(violations),
  };
}

export function assertAnalysisEvidenceValid(
  content: ProductAnalysisContent,
  facts: readonly ProductFactSnapshot[],
): void {
  const result = validateAnalysisEvidence(content, facts);
  if (!result.valid) {
    const first = result.violations[0];
    if (first) {
      throw new DomainValidationError(
        `Evidence validation failed: ${first.message} (${first.field})`,
        first.field,
      );
    }
  }
}

export function assertNicheAnalysisEvidenceValid(
  content: NicheAnalysisContent,
  facts: readonly ProductFactSnapshot[],
  sourceAnalyses: readonly AnalysisSnapshot[] = [],
  targetWorkspaceId?: string,
  targetProductId?: string,
  contextSourceIds?: readonly string[],
): void {
  const result = validateNicheAnalysisEvidence(
    content,
    facts,
    sourceAnalyses,
    targetWorkspaceId,
    targetProductId,
    contextSourceIds,
  );
  if (!result.valid) {
    const first = result.violations[0];
    if (first) {
      throw new DomainValidationError(
        `Evidence validation failed: ${first.message} (${first.field})`,
        first.field,
      );
    }
  }
}
