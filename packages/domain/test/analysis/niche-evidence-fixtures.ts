import {
  parseAnalysisId,
  parseAIRunId,
  parseIsoTimestamp,
  parseProductFactId,
  parseProductFactSetId,
  parseProductId,
  parseUserId,
  parseWorkspaceId,
  type AnalysisSnapshot,
  type NicheAnalysisContent,
  type ProductFactSnapshot,
} from '../../src/index.js';

export const wsId = parseWorkspaceId('018f6c5b-21a4-789a-8def-000000000001');
export const prodId = parseProductId('018f6c5b-21a4-789a-8def-000000000002');
export const factSetId = parseProductFactSetId('018f6c5b-21a4-789a-8def-000000000003');
export const fact1Id = parseProductFactId('018f6c5b-21a4-789a-8def-000000000010');
export const fact2ProhibitedId = parseProductFactId('018f6c5b-21a4-789a-8def-000000000011');
export const fact3UnconfirmedId = parseProductFactId('018f6c5b-21a4-789a-8def-000000000012');
export const fact4ContextOnlyId = parseProductFactId('018f6c5b-21a4-789a-8def-000000000013');
export const acceptedSourceAnalysisId = parseAnalysisId('018f6c5b-21a4-789a-8def-000000000020');
export const rejectedSourceAnalysisId = parseAnalysisId('018f6c5b-21a4-789a-8def-000000000021');

export const facts: ProductFactSnapshot[] = [
  {
    id: fact1Id,
    workspaceId: wsId,
    productId: prodId,
    factSetId,
    factKey: 'price.msrp',
    valueText: '$99',
    sourceType: 'user',
    sourceUrl: null,
    sourceExcerpt: null,
    confidence: 'confirmed',
    claimUsage: 'allowed',
    createdAt: parseIsoTimestamp('2026-11-06T00:00:00.000Z'),
  },
  {
    id: fact2ProhibitedId,
    workspaceId: wsId,
    productId: prodId,
    factSetId,
    factKey: 'claims.medical',
    valueText: 'Cures carpal tunnel',
    sourceType: 'user',
    sourceUrl: null,
    sourceExcerpt: null,
    confidence: 'confirmed',
    claimUsage: 'prohibited',
    createdAt: parseIsoTimestamp('2026-11-06T00:00:00.000Z'),
  },
  {
    id: fact3UnconfirmedId,
    workspaceId: wsId,
    productId: prodId,
    factSetId,
    factKey: 'specs.battery',
    valueText: '100 hours',
    sourceType: 'user',
    sourceUrl: null,
    sourceExcerpt: null,
    confidence: 'suggested',
    claimUsage: 'allowed',
    createdAt: parseIsoTimestamp('2026-11-06T00:00:00.000Z'),
  },
  {
    id: fact4ContextOnlyId,
    workspaceId: wsId,
    productId: prodId,
    factSetId,
    factKey: 'history.origin',
    valueText: 'Designed in 2020',
    sourceType: 'user',
    sourceUrl: null,
    sourceExcerpt: null,
    confidence: 'confirmed',
    claimUsage: 'context_only',
    createdAt: parseIsoTimestamp('2026-11-06T00:00:00.000Z'),
  },
];

export const sourceAnalyses: AnalysisSnapshot[] = [
  {
    id: acceptedSourceAnalysisId,
    workspaceId: wsId,
    productId: prodId,
    analysisType: 'product',
    revisionNumber: 1,
    factSetId,
    aiRunId: parseAIRunId('018f6c5b-21a4-789a-8def-000000000099'),
    contentJson: {},
    schemaVersion: 1,
    status: 'accepted',
    reviewedByUserId: parseUserId('018f6c5b-21a4-789a-8def-000000000088'),
    reviewedAt: parseIsoTimestamp('2026-11-06T01:00:00.000Z'),
    reviewReason: null,
    createdByUserId: parseUserId('018f6c5b-21a4-789a-8def-000000000088'),
    createdAt: parseIsoTimestamp('2026-11-06T00:00:00.000Z'),
    updatedAt: parseIsoTimestamp('2026-11-06T01:00:00.000Z'),
    version: 2,
  },
  {
    id: rejectedSourceAnalysisId,
    workspaceId: wsId,
    productId: prodId,
    analysisType: 'product',
    revisionNumber: 2,
    factSetId,
    aiRunId: parseAIRunId('018f6c5b-21a4-789a-8def-000000000098'),
    contentJson: {},
    schemaVersion: 1,
    status: 'rejected',
    reviewedByUserId: parseUserId('018f6c5b-21a4-789a-8def-000000000088'),
    reviewedAt: parseIsoTimestamp('2026-11-06T02:00:00.000Z'),
    reviewReason: 'bad output',
    createdByUserId: parseUserId('018f6c5b-21a4-789a-8def-000000000088'),
    createdAt: parseIsoTimestamp('2026-11-06T01:30:00.000Z'),
    updatedAt: parseIsoTimestamp('2026-11-06T02:00:00.000Z'),
    version: 2,
  },
];

export function createValidNicheContent(): NicheAnalysisContent {
  return {
    targetAudience: [{ segment: 'Ergonomic seekers' }],
    pains: [
      {
        painPoint: 'Wrist strain',
        severity: 'high',
        context: 'Typing all day',
        evidenceFactIds: [fact1Id],
        sourceAnalysisIds: [acceptedSourceAnalysisId],
      },
    ],
    intent: [{ queryOrTrigger: 'best ergonomic keyboard', intentType: 'commercial' }],
    themes: [
      {
        theme: 'Workplace wellness',
        description: 'Focus on ergonomic health',
        evidenceFactIds: [fact1Id],
      },
    ],
    competitivePositioning: [
      {
        competitorOrAlternative: 'Brand X',
        differentiator: 'Superior switches',
        takeaway: 'Premium feel',
        evidenceFactIds: [fact1Id],
        sourceAnalysisIds: [acceptedSourceAnalysisId],
      },
    ],
    seasonalityNotes: [{ period: 'Q4', trend: 'Holiday shopping', impact: 'High demand' }],
    risks: [
      {
        riskType: 'Pricing sensitivity',
        description: 'High cost may deter budget users',
        evidenceFactIds: [fact1Id],
      },
    ],
  };
}
