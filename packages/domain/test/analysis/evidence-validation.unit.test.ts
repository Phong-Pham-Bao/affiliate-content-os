import { describe, expect, it } from 'vitest';
import {
  assertAnalysisEvidenceValid,
  type ProductFactSnapshot,
  validateAnalysisEvidence,
  DomainValidationError,
  parseIsoTimestamp,
  parseProductFactId,
  parseProductFactSetId,
  parseProductId,
  parseWorkspaceId,
} from '../../src/index.js';

describe('evidence validation', () => {
  const confirmedAllowedFact: ProductFactSnapshot = {
    id: parseProductFactId('018f6c5b-21a4-789a-8def-000000000001'),
    workspaceId: parseWorkspaceId('018f6c5b-21a4-789a-8def-000000000010'),
    productId: parseProductId('018f6c5b-21a4-789a-8def-000000000020'),
    factSetId: parseProductFactSetId('018f6c5b-21a4-789a-8def-000000000030'),
    factKey: 'switch.type',
    valueText: 'Hot-swappable mechanical switches',
    sourceType: 'merchant_page',
    sourceUrl: 'https://example.com/specs',
    sourceExcerpt: 'Specs page',
    confidence: 'confirmed',
    claimUsage: 'allowed',
    createdAt: parseIsoTimestamp('2026-11-06T00:00:00.000Z'),
  };

  const prohibitedFact: ProductFactSnapshot = {
    ...confirmedAllowedFact,
    id: parseProductFactId('018f6c5b-21a4-789a-8def-000000000002'),
    factKey: 'medical.cure',
    valueText: 'Cures all arthritis',
    confidence: 'confirmed',
    claimUsage: 'prohibited',
  };

  const uncertainFact: ProductFactSnapshot = {
    ...confirmedAllowedFact,
    id: parseProductFactId('018f6c5b-21a4-789a-8def-000000000003'),
    factKey: 'battery.hours',
    valueText: 'Up to 200 hours',
    confidence: 'uncertain',
    claimUsage: 'allowed',
  };

  const contextOnlyFact: ProductFactSnapshot = {
    ...confirmedAllowedFact,
    id: parseProductFactId('018f6c5b-21a4-789a-8def-000000000004'),
    factKey: 'internal.sku',
    valueText: 'SKU-999',
    confidence: 'confirmed',
    claimUsage: 'context_only',
  };

  const baseContent = {
    summary: 'Keyboard summary',
    benefits: [
      {
        title: 'Tactile typing',
        description: 'Smooth keypress',
        evidenceFactIds: [confirmedAllowedFact.id],
      },
    ],
    differentiators: [
      {
        title: 'Ergonomics',
        description: 'Split angle',
        evidenceFactIds: [confirmedAllowedFact.id],
      },
    ],
    evidenceGaps: [],
    claimRisks: [],
    objections: [],
    contentAngles: [
      {
        angle: 'Coder gear',
        targetPersona: 'Dev',
        hookText: 'Upgrade',
        recommendedPoints: ['P1'],
      },
    ],
  };

  it('passes when affirmative evidence references confirmed allowed fact', () => {
    const result = validateAnalysisEvidence(baseContent, [confirmedAllowedFact]);
    expect(result.valid).toBe(true);
    expect(result.violations).toHaveLength(0);
    expect(() => assertAnalysisEvidenceValid(baseContent, [confirmedAllowedFact])).not.toThrow();
  });

  it('fails with UNKNOWN_FACT_ID when referencing unknown fact ID', () => {
    const content = {
      ...baseContent,
      benefits: [
        {
          title: 'Tactile typing',
          description: 'Smooth keypress',
          evidenceFactIds: ['018f6c5b-21a4-789a-8def-999999999999'],
        },
      ],
    };
    const result = validateAnalysisEvidence(content, [confirmedAllowedFact]);
    expect(result.valid).toBe(false);
    expect(result.violations[0]?.code).toBe('UNKNOWN_FACT_ID');
    expect(() => assertAnalysisEvidenceValid(content, [confirmedAllowedFact])).toThrow(
      DomainValidationError,
    );
  });

  it('fails with PROHIBITED_CLAIM_USED when referencing prohibited fact', () => {
    const content = {
      ...baseContent,
      benefits: [
        {
          title: 'Health claim',
          description: 'Medical cure',
          evidenceFactIds: [prohibitedFact.id],
        },
      ],
    };
    const result = validateAnalysisEvidence(content, [confirmedAllowedFact, prohibitedFact]);
    expect(result.valid).toBe(false);
    expect(result.violations[0]?.code).toBe('PROHIBITED_CLAIM_USED');
  });

  it('fails with UNCONFIRMED_FACT_EVIDENCE when referencing uncertain fact', () => {
    const content = {
      ...baseContent,
      benefits: [
        {
          title: 'Long battery',
          description: 'Runs forever',
          evidenceFactIds: [uncertainFact.id],
        },
      ],
    };
    const result = validateAnalysisEvidence(content, [confirmedAllowedFact, uncertainFact]);
    expect(result.valid).toBe(false);
    expect(result.violations[0]?.code).toBe('UNCONFIRMED_FACT_EVIDENCE');
  });

  it('fails with CONTEXT_ONLY_FACT_USED when referencing context_only fact', () => {
    const content = {
      ...baseContent,
      benefits: [
        {
          title: 'Internal detail',
          description: 'SKU info',
          evidenceFactIds: [contextOnlyFact.id],
        },
      ],
    };
    const result = validateAnalysisEvidence(content, [confirmedAllowedFact, contextOnlyFact]);
    expect(result.valid).toBe(false);
    expect(result.violations[0]?.code).toBe('CONTEXT_ONLY_FACT_USED');
  });
});
