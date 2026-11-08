/**
 * JSON schemas passed to Gemini responseJsonSchema for workforce planning outputs.
 * Must match domain validation rules exactly with unknown-field rejection.
 */

export const productCampaignPlanJsonSchema = {
  type: 'object',
  properties: {
    schemaVersion: { type: 'integer', enum: [1] },
    summary: { type: 'string', minLength: 1, maxLength: 2000 },
    positioningStatement: { type: 'string', minLength: 1, maxLength: 1000 },
    campaignGoals: {
      type: 'array',
      items: { type: 'string', minLength: 1, maxLength: 500 },
      minItems: 1,
      maxItems: 10,
    },
    coreBenefits: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          benefit: { type: 'string', minLength: 1, maxLength: 500 },
          evidenceRefs: {
            type: 'array',
            items: { type: 'string' },
          },
        },
        required: ['benefit', 'evidenceRefs'],
        additionalProperties: false,
      },
      minItems: 1,
      maxItems: 10,
    },
    targetObjections: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          objection: { type: 'string', minLength: 1, maxLength: 500 },
          counterAngle: { type: 'string', minLength: 1, maxLength: 500 },
          evidenceRefs: {
            type: 'array',
            items: { type: 'string' },
          },
        },
        required: ['objection', 'counterAngle', 'evidenceRefs'],
        additionalProperties: false,
      },
      minItems: 1,
      maxItems: 10,
    },
    complianceConstraints: {
      type: 'array',
      items: { type: 'string', minLength: 1, maxLength: 500 },
      minItems: 1,
      maxItems: 10,
    },
    creativeHypotheses: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          hypothesis: { type: 'string', minLength: 1, maxLength: 500 },
          rationale: { type: 'string', minLength: 1, maxLength: 500 },
        },
        required: ['hypothesis', 'rationale'],
        additionalProperties: false,
      },
      minItems: 1,
      maxItems: 10,
    },
    evidenceReferences: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          sourceKind: { type: 'string', enum: ['product_fact', 'analysis'] },
          sourceId: { type: 'string' },
        },
        required: ['sourceKind', 'sourceId'],
        additionalProperties: false,
      },
      minItems: 1,
      maxItems: 50,
    },
  },
  required: [
    'schemaVersion',
    'summary',
    'positioningStatement',
    'campaignGoals',
    'coreBenefits',
    'targetObjections',
    'complianceConstraints',
    'creativeHypotheses',
    'evidenceReferences',
  ],
  additionalProperties: false,
};

export const audienceInsightBoardJsonSchema = {
  type: 'object',
  properties: {
    schemaVersion: { type: 'integer', enum: [1] },
    summary: { type: 'string', minLength: 1, maxLength: 2000 },
    audienceSegments: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          segmentName: { type: 'string', minLength: 1, maxLength: 256 },
          description: { type: 'string', minLength: 1, maxLength: 1000 },
          awarenessStage: {
            type: 'string',
            enum: ['unaware', 'problem_aware', 'solution_aware', 'product_aware', 'most_aware'],
          },
          corePains: {
            type: 'array',
            items: { type: 'string', minLength: 1, maxLength: 500 },
            minItems: 1,
            maxItems: 10,
          },
          desires: {
            type: 'array',
            items: { type: 'string', minLength: 1, maxLength: 500 },
            minItems: 1,
            maxItems: 10,
          },
          evidenceRefs: {
            type: 'array',
            items: { type: 'string' },
          },
        },
        required: [
          'segmentName',
          'description',
          'awarenessStage',
          'corePains',
          'desires',
          'evidenceRefs',
        ],
        additionalProperties: false,
      },
      minItems: 1,
      maxItems: 10,
    },
    contentAngles: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          angleName: { type: 'string', minLength: 1, maxLength: 256 },
          hookConcept: { type: 'string', minLength: 1, maxLength: 500 },
          targetSegment: { type: 'string', minLength: 1, maxLength: 256 },
          creativeHypothesis: { type: 'string', minLength: 1, maxLength: 500 },
        },
        required: ['angleName', 'hookConcept', 'targetSegment', 'creativeHypothesis'],
        additionalProperties: false,
      },
      minItems: 1,
      maxItems: 10,
    },
    evidenceReferences: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          sourceKind: { type: 'string', enum: ['product_fact', 'analysis'] },
          sourceId: { type: 'string' },
        },
        required: ['sourceKind', 'sourceId'],
        additionalProperties: false,
      },
      minItems: 1,
      maxItems: 50,
    },
  },
  required: ['schemaVersion', 'summary', 'audienceSegments', 'contentAngles', 'evidenceReferences'],
  additionalProperties: false,
};

export const videoSeriesPlanJsonSchema = {
  type: 'object',
  properties: {
    schemaVersion: { type: 'integer', enum: [1] },
    seriesTitle: { type: 'string', minLength: 1, maxLength: 256 },
    seriesNarrativeArc: { type: 'string', minLength: 1, maxLength: 2000 },
    episodes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          episodeNumber: { type: 'integer', enum: [1, 2, 3, 4, 5] },
          title: { type: 'string', minLength: 1, maxLength: 256 },
          purpose: { type: 'string', minLength: 1, maxLength: 500 },
          hook: { type: 'string', minLength: 1, maxLength: 500 },
          narrativeRole: { type: 'string', minLength: 1, maxLength: 500 },
          visualDirection: { type: 'string', minLength: 1, maxLength: 1000 },
          callToActionDirection: { type: 'string', minLength: 1, maxLength: 500 },
          evidenceRefs: {
            type: 'array',
            items: { type: 'string' },
          },
        },
        required: [
          'episodeNumber',
          'title',
          'purpose',
          'hook',
          'narrativeRole',
          'visualDirection',
          'callToActionDirection',
          'evidenceRefs',
        ],
        additionalProperties: false,
      },
      minItems: 5,
      maxItems: 5,
    },
    creativeDirection: {
      type: 'object',
      properties: {
        visualTone: { type: 'string', minLength: 1, maxLength: 500 },
        audioTone: { type: 'string', minLength: 1, maxLength: 500 },
        pacing: { type: 'string', minLength: 1, maxLength: 500 },
      },
      required: ['visualTone', 'audioTone', 'pacing'],
      additionalProperties: false,
    },
    evidenceReferences: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          sourceKind: { type: 'string', enum: ['product_fact', 'analysis'] },
          sourceId: { type: 'string' },
        },
        required: ['sourceKind', 'sourceId'],
        additionalProperties: false,
      },
      minItems: 1,
      maxItems: 50,
    },
  },
  required: [
    'schemaVersion',
    'seriesTitle',
    'seriesNarrativeArc',
    'episodes',
    'creativeDirection',
    'evidenceReferences',
  ],
  additionalProperties: false,
};
