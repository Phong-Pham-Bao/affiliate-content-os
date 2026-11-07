import { describe, expect, it } from 'vitest';
import {
  assertNicheAnalysisEvidenceValid,
  validateNicheAnalysisEvidence,
  DomainValidationError,
} from '../../src/index.js';
import {
  createValidNicheContent,
  fact2ProhibitedId,
  fact3UnconfirmedId,
  fact4ContextOnlyId,
  facts,
  rejectedSourceAnalysisId,
  sourceAnalyses,
} from './niche-evidence-fixtures.js';

describe('niche analysis evidence validation adversarial tests', () => {
  it('passes validation when all cited facts and source analyses are eligible', () => {
    const content = createValidNicheContent();
    const result = validateNicheAnalysisEvidence(content, facts, sourceAnalyses);
    expect(result.valid).toBe(true);
    expect(result.violations).toHaveLength(0);
    expect(() => assertNicheAnalysisEvidenceValid(content, facts, sourceAnalyses)).not.toThrow();
  });

  it('detects unknown fact reference in pains', () => {
    const content = createValidNicheContent();
    const pains = content.pains as unknown as Array<{ evidenceFactIds?: unknown[] }>;
    pains[0]!.evidenceFactIds = ['018f6c5b-21a4-789a-8def-999999999999'];
    const result = validateNicheAnalysisEvidence(content, facts, sourceAnalyses);
    expect(result.valid).toBe(false);
    expect(result.violations.some((v) => v.code === 'UNKNOWN_FACT_ID')).toBe(true);
    expect(() => assertNicheAnalysisEvidenceValid(content, facts, sourceAnalyses)).toThrow(
      DomainValidationError,
    );
  });

  it('detects prohibited claim used in competitive positioning', () => {
    const content = createValidNicheContent();
    const comp = content.competitivePositioning as unknown as Array<{
      evidenceFactIds?: unknown[];
    }>;
    comp[0]!.evidenceFactIds = [fact2ProhibitedId];
    const result = validateNicheAnalysisEvidence(content, facts, sourceAnalyses);
    expect(result.valid).toBe(false);
    expect(result.violations.some((v) => v.code === 'PROHIBITED_CLAIM_USED')).toBe(true);
  });

  it('detects unconfirmed fact used in risks', () => {
    const content = createValidNicheContent();
    const risks = content.risks as unknown as Array<{ evidenceFactIds?: unknown[] }>;
    risks[0]!.evidenceFactIds = [fact3UnconfirmedId];
    const result = validateNicheAnalysisEvidence(content, facts, sourceAnalyses);
    expect(result.valid).toBe(false);
    expect(result.violations.some((v) => v.code === 'UNCONFIRMED_FACT_EVIDENCE')).toBe(true);
  });

  it('detects context_only fact used in themes', () => {
    const content = createValidNicheContent();
    const themes = content.themes as unknown as Array<{ evidenceFactIds?: unknown[] }>;
    themes[0]!.evidenceFactIds = [fact4ContextOnlyId];
    const result = validateNicheAnalysisEvidence(content, facts, sourceAnalyses);
    expect(result.valid).toBe(false);
    expect(result.violations.some((v) => v.code === 'CONTEXT_ONLY_FACT_USED')).toBe(true);
  });

  it('detects unknown source analysis ID in pains', () => {
    const content = createValidNicheContent();
    const pains = content.pains as unknown as Array<{ sourceAnalysisIds?: unknown[] }>;
    pains[0]!.sourceAnalysisIds = ['018f6c5b-21a4-789a-8def-888888888888'];
    const result = validateNicheAnalysisEvidence(content, facts, sourceAnalyses);
    expect(result.valid).toBe(false);
    expect(result.violations.some((v) => v.code === 'UNKNOWN_SOURCE_ANALYSIS_ID')).toBe(true);
  });

  it('detects rejected source analysis ID in competitive positioning', () => {
    const content = createValidNicheContent();
    const comp = content.competitivePositioning as unknown as Array<{
      sourceAnalysisIds?: unknown[];
    }>;
    comp[0]!.sourceAnalysisIds = [rejectedSourceAnalysisId];
    const result = validateNicheAnalysisEvidence(content, facts, sourceAnalyses);
    expect(result.valid).toBe(false);
    expect(result.violations.some((v) => v.code === 'SOURCE_ANALYSIS_NOT_ACCEPTED')).toBe(true);
  });
});
