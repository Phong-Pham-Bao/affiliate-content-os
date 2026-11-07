/**
 * JSON schemas passed to Gemini responseJsonSchema for structured outputs.
 * Must match domain validation rules exactly with unknown-field rejection.
 */

export const productAnalysisJsonSchema = {
  type: 'object',
  properties: {
    summary: {
      type: 'string',
      description: 'Comprehensive grounded summary of the product',
      minLength: 1,
      maxLength: 4096,
    },
    benefits: {
      type: 'array',
      description:
        'Key product benefits. Affirmative claims must cite eligible confirmed fact IDs.',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string', minLength: 1, maxLength: 256 },
          description: { type: 'string', minLength: 1, maxLength: 2048 },
          evidenceFactIds: {
            type: 'array',
            items: { type: 'string', minLength: 1, maxLength: 128 },
            description: 'Fact IDs from grounding context backing this claim (empty if none)',
          },
        },
        required: ['title', 'description', 'evidenceFactIds'],
        additionalProperties: false,
      },
      minItems: 0,
      maxItems: 30,
    },
    differentiators: {
      type: 'array',
      description: 'Key product differentiators',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string', minLength: 1, maxLength: 256 },
          description: { type: 'string', minLength: 1, maxLength: 2048 },
          evidenceFactIds: {
            type: 'array',
            items: { type: 'string', minLength: 1, maxLength: 128 },
          },
        },
        required: ['title', 'description', 'evidenceFactIds'],
        additionalProperties: false,
      },
      minItems: 0,
      maxItems: 30,
    },
    evidenceGaps: {
      type: 'array',
      description: 'Missing evidence or areas needing factual confirmation',
      items: {
        type: 'object',
        properties: {
          topic: { type: 'string', minLength: 1, maxLength: 256 },
          description: { type: 'string', minLength: 1, maxLength: 2048 },
        },
        required: ['topic', 'description'],
        additionalProperties: false,
      },
      minItems: 0,
      maxItems: 30,
    },
    claimRisks: {
      type: 'array',
      description: 'Identified compliance or claims risks',
      items: {
        type: 'object',
        properties: {
          claim: { type: 'string', minLength: 1, maxLength: 512 },
          riskLevel: { type: 'string', enum: ['low', 'medium', 'high'] },
          reason: { type: 'string', minLength: 1, maxLength: 2048 },
        },
        required: ['claim', 'riskLevel', 'reason'],
        additionalProperties: false,
      },
      minItems: 0,
      maxItems: 30,
    },
    objections: {
      type: 'array',
      description: 'Anticipated customer objections and evidence-based rebuttals',
      items: {
        type: 'object',
        properties: {
          objection: { type: 'string', minLength: 1, maxLength: 512 },
          counterArgument: { type: 'string', minLength: 1, maxLength: 2048 },
          evidenceFactIds: {
            type: 'array',
            items: { type: 'string', minLength: 1, maxLength: 128 },
          },
        },
        required: ['objection', 'counterArgument', 'evidenceFactIds'],
        additionalProperties: false,
      },
      minItems: 0,
      maxItems: 30,
    },
    contentAngles: {
      type: 'array',
      description: 'Recommended creative angles and hooks for content creation',
      items: {
        type: 'object',
        properties: {
          angle: { type: 'string', minLength: 1, maxLength: 256 },
          targetPersona: { type: 'string', minLength: 1, maxLength: 256 },
          hookText: { type: 'string', minLength: 1, maxLength: 1024 },
          recommendedPoints: {
            type: 'array',
            items: { type: 'string', minLength: 1, maxLength: 512 },
            minItems: 1,
            maxItems: 10,
          },
        },
        required: ['angle', 'targetPersona', 'hookText', 'recommendedPoints'],
        additionalProperties: false,
      },
      minItems: 0,
      maxItems: 20,
    },
  },
  required: [
    'summary',
    'benefits',
    'differentiators',
    'evidenceGaps',
    'claimRisks',
    'objections',
    'contentAngles',
  ],
  additionalProperties: false,
} as const;

export const nicheAnalysisJsonSchema = {
  type: 'object',
  properties: {
    targetAudience: {
      type: 'array',
      description: 'Target audience segments and personas',
      items: {
        type: 'object',
        properties: {
          segment: { type: 'string', minLength: 1, maxLength: 256 },
          demographics: { type: 'string', maxLength: 512 },
          psychographics: { type: 'string', maxLength: 1024 },
        },
        required: ['segment', 'demographics', 'psychographics'],
        additionalProperties: false,
      },
      minItems: 0,
      maxItems: 20,
    },
    pains: {
      type: 'array',
      description: 'Customer pain points and severity',
      items: {
        type: 'object',
        properties: {
          painPoint: { type: 'string', minLength: 1, maxLength: 512 },
          severity: { type: 'string', enum: ['low', 'medium', 'high'] },
          context: { type: 'string', minLength: 1, maxLength: 2048 },
          evidenceFactIds: {
            type: 'array',
            items: { type: 'string', minLength: 1, maxLength: 128 },
          },
          sourceAnalysisIds: {
            type: 'array',
            items: { type: 'string', minLength: 1, maxLength: 128 },
          },
        },
        required: ['painPoint', 'severity', 'context', 'evidenceFactIds', 'sourceAnalysisIds'],
        additionalProperties: false,
      },
      minItems: 0,
      maxItems: 30,
    },
    intent: {
      type: 'array',
      description: 'Search and buyer intent triggers',
      items: {
        type: 'object',
        properties: {
          queryOrTrigger: { type: 'string', minLength: 1, maxLength: 512 },
          intentType: { type: 'string', enum: ['informational', 'commercial', 'transactional'] },
          notes: { type: 'string', maxLength: 1024 },
        },
        required: ['queryOrTrigger', 'intentType', 'notes'],
        additionalProperties: false,
      },
      minItems: 0,
      maxItems: 30,
    },
    themes: {
      type: 'array',
      description: 'Core editorial and narrative themes',
      items: {
        type: 'object',
        properties: {
          theme: { type: 'string', minLength: 1, maxLength: 256 },
          description: { type: 'string', minLength: 1, maxLength: 2048 },
          relevanceScore: { type: 'number', minimum: 0, maximum: 100 },
          evidenceFactIds: {
            type: 'array',
            items: { type: 'string', minLength: 1, maxLength: 128 },
          },
          sourceAnalysisIds: {
            type: 'array',
            items: { type: 'string', minLength: 1, maxLength: 128 },
          },
        },
        required: [
          'theme',
          'description',
          'relevanceScore',
          'evidenceFactIds',
          'sourceAnalysisIds',
        ],
        additionalProperties: false,
      },
      minItems: 0,
      maxItems: 30,
    },
    competitivePositioning: {
      type: 'array',
      description: 'Competitive differentiators against alternatives',
      items: {
        type: 'object',
        properties: {
          competitorOrAlternative: { type: 'string', minLength: 1, maxLength: 256 },
          differentiator: { type: 'string', minLength: 1, maxLength: 2048 },
          takeaway: { type: 'string', minLength: 1, maxLength: 2048 },
          evidenceFactIds: {
            type: 'array',
            items: { type: 'string', minLength: 1, maxLength: 128 },
          },
          sourceAnalysisIds: {
            type: 'array',
            items: { type: 'string', minLength: 1, maxLength: 128 },
          },
        },
        required: [
          'competitorOrAlternative',
          'differentiator',
          'takeaway',
          'evidenceFactIds',
          'sourceAnalysisIds',
        ],
        additionalProperties: false,
      },
      minItems: 0,
      maxItems: 30,
    },
    seasonalityNotes: {
      type: 'array',
      description: 'Seasonal demand trends and timing impacts',
      items: {
        type: 'object',
        properties: {
          period: { type: 'string', minLength: 1, maxLength: 128 },
          trend: { type: 'string', minLength: 1, maxLength: 512 },
          impact: { type: 'string', minLength: 1, maxLength: 1024 },
        },
        required: ['period', 'trend', 'impact'],
        additionalProperties: false,
      },
      minItems: 0,
      maxItems: 20,
    },
    risks: {
      type: 'array',
      description: 'Market or audience risks and mitigations',
      items: {
        type: 'object',
        properties: {
          riskType: { type: 'string', minLength: 1, maxLength: 256 },
          description: { type: 'string', minLength: 1, maxLength: 2048 },
          mitigation: { type: 'string', maxLength: 2048 },
          evidenceFactIds: {
            type: 'array',
            items: { type: 'string', minLength: 1, maxLength: 128 },
          },
          sourceAnalysisIds: {
            type: 'array',
            items: { type: 'string', minLength: 1, maxLength: 128 },
          },
        },
        required: ['riskType', 'description', 'mitigation', 'evidenceFactIds', 'sourceAnalysisIds'],
        additionalProperties: false,
      },
      minItems: 0,
      maxItems: 30,
    },
  },
  required: [
    'targetAudience',
    'pains',
    'intent',
    'themes',
    'competitivePositioning',
    'seasonalityNotes',
    'risks',
  ],
  additionalProperties: false,
} as const;
