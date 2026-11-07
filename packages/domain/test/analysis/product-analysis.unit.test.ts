import { describe, expect, it } from 'vitest';
import { DomainValidationError, validateProductAnalysisContent } from '../../src/index.js';

describe('product-analysis validation', () => {
  const validProductContent = {
    summary: 'A high-efficiency ergonomic mechanical keyboard for programmers.',
    benefits: [
      {
        title: 'Ergonomic split design',
        description: 'Reduces wrist fatigue during marathon coding sessions.',
        evidenceFactIds: ['018f6c5b-21a4-789a-8def-000000000001'],
      },
    ],
    differentiators: [
      {
        title: 'Hot-swappable tactile switches',
        description: 'Custom lubed switches with zero solder required.',
        evidenceFactIds: ['018f6c5b-21a4-789a-8def-000000000001'],
      },
    ],
    evidenceGaps: [
      {
        topic: 'Battery lifespan',
        description: 'Wireless battery performance under RGB load is unverified.',
      },
    ],
    claimRisks: [
      {
        claim: 'Eliminates all repetitive strain injury',
        riskLevel: 'high' as const,
        reason: 'Medical claims require clinical backing and disclaimer.',
      },
    ],
    objections: [
      {
        objection: 'High price point compared to standard keyboards',
        counterArgument: 'Aerospace aluminum build quality provides 10-year durability.',
        evidenceFactIds: ['018f6c5b-21a4-789a-8def-000000000001'],
      },
    ],
    contentAngles: [
      {
        angle: 'Developer ergonomics overhaul',
        targetPersona: 'Senior Software Engineers',
        hookText: 'Your wrists will thank you after your next 8-hour sprint.',
        recommendedPoints: ['Focus on posture', 'Mechanical tactile feedback'],
      },
    ],
  };

  it('validates a correct product analysis object', () => {
    const validated = validateProductAnalysisContent(validProductContent);
    expect(validated.summary).toBe(validProductContent.summary);
    expect(validated.benefits).toHaveLength(1);
    expect(validated.differentiators).toHaveLength(1);
    expect(validated.evidenceGaps).toHaveLength(1);
    expect(validated.claimRisks).toHaveLength(1);
    expect(validated.objections).toHaveLength(1);
    expect(validated.contentAngles).toHaveLength(1);
  });

  it('rejects missing or empty summary', () => {
    expect(() => validateProductAnalysisContent({ ...validProductContent, summary: '' })).toThrow(
      DomainValidationError,
    );
  });

  it('rejects empty benefits array', () => {
    expect(() => validateProductAnalysisContent({ ...validProductContent, benefits: [] })).toThrow(
      DomainValidationError,
    );
  });

  it('rejects invalid claim risk level', () => {
    expect(() =>
      validateProductAnalysisContent({
        ...validProductContent,
        claimRisks: [
          {
            claim: 'Some claim',
            riskLevel: 'critical',
            reason: 'Unknown level',
          },
        ],
      }),
    ).toThrow(DomainValidationError);
  });

  it('rejects proxy objects', () => {
    const proxy = new Proxy(validProductContent, {
      get(target, prop) {
        return Reflect.get(target, prop);
      },
    });
    expect(() => validateProductAnalysisContent(proxy)).toThrow(DomainValidationError);
  });

  it('rejects coercion hooks on summary', () => {
    const hostile = {
      ...validProductContent,
      summary: {
        valueOf() {
          return 'coerced';
        },
      },
    };
    expect(() => validateProductAnalysisContent(hostile)).toThrow(DomainValidationError);
  });

  it('rejects control characters in titles and angles', () => {
    expect(() =>
      validateProductAnalysisContent({
        ...validProductContent,
        contentAngles: [
          {
            angle: 'Angle\x00with\x1Fcontrols',
            targetPersona: 'Dev',
            hookText: 'Hook',
            recommendedPoints: ['Point'],
          },
        ],
      }),
    ).toThrow(DomainValidationError);
  });
});
