import { describe, expect, it } from 'vitest';
import {
  DomainValidationError,
  isArtifactEvidenceRefId,
  isContentArtifactId,
  isContentArtifactRevisionId,
  parseArtifactEvidenceRefId,
  parseContentArtifactId,
  parseContentArtifactRevisionId,
  validateAudienceInsightBoard,
  validateProductCampaignPlan,
  validateVideoSeriesPlan,
  type AudienceInsightBoard,
  type ProductCampaignPlan,
  type VideoSeriesPlan,
} from '../../src/index.js';

describe('Artifact IDs', () => {
  const validUuidV7 = '018f6c5b-21a4-789a-8def-000000000001';

  it('validates and parses ContentArtifactId', () => {
    expect(isContentArtifactId(validUuidV7)).toBe(true);
    expect(parseContentArtifactId(validUuidV7)).toBe(validUuidV7);
    expect(() => parseContentArtifactId('invalid-uuid')).toThrow(DomainValidationError);
  });

  it('validates and parses ContentArtifactRevisionId', () => {
    expect(isContentArtifactRevisionId(validUuidV7)).toBe(true);
    expect(parseContentArtifactRevisionId(validUuidV7)).toBe(validUuidV7);
    expect(() => parseContentArtifactRevisionId('invalid-uuid')).toThrow(DomainValidationError);
  });

  it('validates and parses ArtifactEvidenceRefId', () => {
    expect(isArtifactEvidenceRefId(validUuidV7)).toBe(true);
    expect(parseArtifactEvidenceRefId(validUuidV7)).toBe(validUuidV7);
    expect(() => parseArtifactEvidenceRefId(123)).toThrow(DomainValidationError);
  });
});

describe('ProductCampaignPlan Contract', () => {
  const factId = '018f6c5b-21a4-789a-8def-000000000010';
  const analysisId = '018f6c5b-21a4-789a-8def-000000000020';

  const validPlan: ProductCampaignPlan = {
    schemaVersion: 1,
    summary: 'Comprehensive launch campaign plan focused on productivity benefits.',
    positioningStatement: 'The premier all-in-one content commerce platform for modern teams.',
    campaignGoals: ['Increase qualified leads by 25%', 'Drive high-conversion trials'],
    coreBenefits: [
      {
        benefit: 'Automated workflow execution eliminates 80% of repetitive content drafting.',
        evidenceRefs: [factId],
      },
    ],
    targetObjections: [
      {
        objection: 'Higher initial learning curve for content staff.',
        counterAngle:
          'Turnkey templates and structured employee roles reduce onboarding to minutes.',
        evidenceRefs: [analysisId],
      },
    ],
    complianceConstraints: [
      'No unsupported earnings claims allowed.',
      'Mandatory affiliate disclosure.',
    ],
    creativeHypotheses: [
      {
        hypothesis: 'Framing around saving weekend hours resonates stronger with solopreneurs.',
        rationale: 'Audience analysis shows high burnout among independent creators.',
      },
    ],
    evidenceReferences: [
      { sourceKind: 'product_fact', sourceId: factId },
      { sourceKind: 'analysis', sourceId: analysisId },
    ],
  };

  it('accepts a valid product campaign plan', () => {
    const validated = validateProductCampaignPlan(validPlan);
    expect(validated.schemaVersion).toBe(1);
    expect(validated.summary).toBe(validPlan.summary);
    expect(validated.coreBenefits).toHaveLength(1);
    expect(validated.evidenceReferences).toHaveLength(2);
  });

  it('rejects missing or wrong schemaVersion', () => {
    expect(() => validateProductCampaignPlan({ ...validPlan, schemaVersion: 2 })).toThrow(
      DomainValidationError,
    );
  });

  it('rejects HTML tags in text fields', () => {
    expect(() =>
      validateProductCampaignPlan({
        ...validPlan,
        summary: 'Contains <script>alert("hack")</script> dangerous markup',
      }),
    ).toThrow(/HTML markup/);
  });

  it('rejects control characters in text fields', () => {
    expect(() =>
      validateProductCampaignPlan({
        ...validPlan,
        positioningStatement: 'Invalid\x00control char',
      }),
    ).toThrow(/control characters/);
  });

  it('rejects empty arrays for coreBenefits or targetObjections', () => {
    expect(() => validateProductCampaignPlan({ ...validPlan, coreBenefits: [] })).toThrow(
      DomainValidationError,
    );
    expect(() => validateProductCampaignPlan({ ...validPlan, targetObjections: [] })).toThrow(
      DomainValidationError,
    );
  });

  it('rejects invalid UUID in evidence references', () => {
    expect(() =>
      validateProductCampaignPlan({
        ...validPlan,
        evidenceReferences: [{ sourceKind: 'product_fact', sourceId: 'not-a-uuid' }],
      }),
    ).toThrow(/valid UUID/);
  });
});

describe('AudienceInsightBoard Contract', () => {
  const factId = '018f6c5b-21a4-789a-8def-000000000010';

  const validBoard: AudienceInsightBoard = {
    schemaVersion: 1,
    summary: 'Audience research reveals strong appetite among digital creators.',
    audienceSegments: [
      {
        segmentName: 'Solo Creators',
        description: 'Independent operators managing content and affiliate links alone.',
        awarenessStage: 'problem_aware',
        corePains: ['Time shortage', 'Inconsistent publication schedule'],
        desires: ['Predictable workflow', 'Higher conversion rates'],
        evidenceRefs: [factId],
      },
    ],
    contentAngles: [
      {
        angleName: 'Behind the Scenes Efficiency',
        hookConcept: 'How I manage 5 product channels in 2 hours a day',
        targetSegment: 'Solo Creators',
        creativeHypothesis: 'Authentic creator routine hooks outperform polished corporate demos.',
      },
    ],
    evidenceReferences: [{ sourceKind: 'product_fact', sourceId: factId }],
  };

  it('accepts a valid audience insight board', () => {
    const validated = validateAudienceInsightBoard(validBoard);
    expect(validated.schemaVersion).toBe(1);
    expect(validated.audienceSegments[0]?.awarenessStage).toBe('problem_aware');
  });

  it('rejects invalid awarenessStage', () => {
    const invalid = {
      ...validBoard,
      audienceSegments: [
        {
          ...validBoard.audienceSegments[0]!,
          awarenessStage: 'ultra_aware' as unknown as 'problem_aware',
        },
      ],
    };
    expect(() => validateAudienceInsightBoard(invalid)).toThrow(DomainValidationError);
  });
});

describe('VideoSeriesPlan Contract', () => {
  const factId = '018f6c5b-21a4-789a-8def-000000000010';

  const validSeries: VideoSeriesPlan = {
    schemaVersion: 1,
    seriesTitle: 'From Zero to Grounded Commerce in 5 Days',
    seriesNarrativeArc:
      'Progression from exposing common creator pitfalls to showcasing systematic evidence-based success.',
    episodes: [
      {
        episodeNumber: 1,
        title: 'The Hidden Trap of Unverified Claims',
        purpose: 'Establish urgency around trust and credibility.',
        hook: 'Ever wonder why your affiliate links get ignored?',
        narrativeRole: 'Problem discovery and reality check.',
        visualDirection: 'Split screen comparing rejected pitches with verified fact cards.',
        callToActionDirection: 'Follow for episode 2: how facts drive conversion.',
        evidenceRefs: [factId],
      },
      {
        episodeNumber: 2,
        title: 'Building Your Evidence Vault',
        purpose: 'Showcase fact confirmation workflow.',
        hook: 'Stop guessing specs. Here is the 3-step fact check.',
        narrativeRole: 'Solution demonstration.',
        visualDirection: 'Screen recording walkthrough with highlighting callouts.',
        callToActionDirection: 'Save this post for your next campaign.',
        evidenceRefs: [factId],
      },
      {
        episodeNumber: 3,
        title: 'Meet Your AI Workforce',
        purpose: 'Demonstrate specialized role collaboration.',
        hook: 'What if you had 5 specialists preparing your next launch right now?',
        narrativeRole: 'Team leverage and authority.',
        visualDirection: 'Desk by desk virtual office camera pan.',
        callToActionDirection: 'Comment TEAM to see the roster.',
        evidenceRefs: [factId],
      },
      {
        episodeNumber: 4,
        title: 'Objection Busting on Autopilot',
        purpose: 'Directly address creator hesitations.',
        hook: 'Too complicated? Here is how a novice set it up in 5 minutes.',
        narrativeRole: 'Overcoming resistance.',
        visualDirection: 'Timer on screen with rapid feature activation.',
        callToActionDirection: 'Share with a creator friend.',
        evidenceRefs: [factId],
      },
      {
        episodeNumber: 5,
        title: 'The Launch Formula',
        purpose: 'Full series recap and call to action.',
        hook: '5 days, 5 videos, 1 complete campaign.',
        narrativeRole: 'Resolution and conversion push.',
        visualDirection: 'Upbeat montage of completed deliverables.',
        callToActionDirection: 'Click the link in bio to deploy your AI team today.',
        evidenceRefs: [factId],
      },
    ],
    creativeDirection: {
      visualTone: 'Clean, modern studio lighting with minimal tech aesthetic.',
      audioTone: 'Energetic electronic backdrop with crisp voiceover.',
      pacing: 'Fast-paced hook (0-3s), steady value delivery (4-45s), clear CTA (46-60s).',
    },
    evidenceReferences: [{ sourceKind: 'product_fact', sourceId: factId }],
  };

  it('accepts a valid 5-episode video series plan', () => {
    const validated = validateVideoSeriesPlan(validSeries);
    expect(validated.schemaVersion).toBe(1);
    expect(validated.episodes).toHaveLength(5);
    expect(validated.episodes[0]?.episodeNumber).toBe(1);
    expect(validated.episodes[4]?.episodeNumber).toBe(5);
  });

  it('rejects fewer or more than 5 episodes', () => {
    const fourEpisodes = {
      ...validSeries,
      episodes: validSeries.episodes.slice(0, 4),
    };
    expect(() => validateVideoSeriesPlan(fourEpisodes)).toThrow(/exactly 5 video ideas/);
  });

  it('rejects out of order episodeNumber', () => {
    const wrongOrderEpisodes = [
      validSeries.episodes[1]!,
      validSeries.episodes[0]!,
      validSeries.episodes[2]!,
      validSeries.episodes[3]!,
      validSeries.episodes[4]!,
    ];
    expect(() => validateVideoSeriesPlan({ ...validSeries, episodes: wrongOrderEpisodes })).toThrow(
      /episodeNumber must be 1/,
    );
  });
});
