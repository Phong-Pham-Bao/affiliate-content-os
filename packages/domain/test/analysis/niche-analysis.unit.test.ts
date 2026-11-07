import { describe, expect, it } from 'vitest';
import { DomainValidationError, validateNicheAnalysisContent } from '../../src/index.js';

describe('niche-analysis validation', () => {
  const validNicheContent = {
    targetAudience: [
      {
        segment: 'Home Office Developers',
        demographics: 'Ages 25-45, tech professionals',
        psychographics: 'Values ergonomic setups and productivity optimization',
      },
    ],
    pains: [
      {
        painPoint: 'Carpal tunnel strain from flat laptop keyboards',
        severity: 'high' as const,
        context: 'Long typing sessions on standard scissor switches',
      },
    ],
    intent: [
      {
        queryOrTrigger: 'best ergonomic mechanical keyboard for mac',
        intentType: 'commercial' as const,
        notes: 'High purchase intent with preference for wireless models',
      },
    ],
    themes: [
      {
        theme: 'Workplace ergonomics',
        description: 'Preventative health measures for desk workers',
        relevanceScore: 0.95,
      },
    ],
    competitivePositioning: [
      {
        competitorOrAlternative: 'Generic membrane keyboards',
        differentiator: 'Durable mechanical switches and tenting geometry',
        takeaway: 'Higher upfront cost offset by multi-year health benefits',
      },
    ],
    seasonalityNotes: [
      {
        period: 'Q4 Black Friday & New Year',
        trend: 'Desk setup upgrades and New Year health resolutions',
        impact: 'High conversion window for premium home office gear',
      },
    ],
    risks: [
      {
        riskType: 'Learning curve',
        description: 'Split layout requires 1-2 weeks muscle memory adaptation',
        mitigation: 'Provide training guide and transition typing layout tips',
      },
    ],
  };

  it('validates a complete niche analysis object', () => {
    const validated = validateNicheAnalysisContent(validNicheContent);
    expect(validated.targetAudience).toHaveLength(1);
    expect(validated.pains).toHaveLength(1);
    expect(validated.intent).toHaveLength(1);
    expect(validated.themes).toHaveLength(1);
    expect(validated.competitivePositioning).toHaveLength(1);
    expect(validated.seasonalityNotes).toHaveLength(1);
    expect(validated.risks).toHaveLength(1);
  });

  it('rejects invalid intent type', () => {
    expect(() =>
      validateNicheAnalysisContent({
        ...validNicheContent,
        intent: [
          {
            queryOrTrigger: 'query',
            intentType: 'accidental',
          },
        ],
      }),
    ).toThrow(DomainValidationError);
  });

  it('rejects out-of-range relevance score', () => {
    expect(() =>
      validateNicheAnalysisContent({
        ...validNicheContent,
        themes: [
          {
            theme: 'theme',
            description: 'desc',
            relevanceScore: 1.5,
          },
        ],
      }),
    ).toThrow(DomainValidationError);
  });

  it('rejects proxy objects', () => {
    const proxy = new Proxy(validNicheContent, {
      get(target, prop) {
        return Reflect.get(target, prop);
      },
    });
    expect(() => validateNicheAnalysisContent(proxy)).toThrow(DomainValidationError);
  });
});
