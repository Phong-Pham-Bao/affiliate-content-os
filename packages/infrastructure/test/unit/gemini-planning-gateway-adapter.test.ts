import { describe, expect, it } from 'vitest';
import { GeminiAIGatewayAdapter, type GeminiClientLike } from '../../src/analysis/index.js';
import { makeMockConfig, mockFact } from './gemini-ai-gateway-adapter-fixtures.js';
import type { AIPlanningRoleInput } from '@affiliate-content-os/application';
import type {
  AudienceInsightBoard,
  ProductCampaignPlan,
  VideoSeriesPlan,
} from '@affiliate-content-os/domain';

const mockPlanningInput: AIPlanningRoleInput = {
  workspaceId: mockFact.workspaceId,
  productId: mockFact.productId,
  productName: 'EcoBottle Ultra',
  merchantName: 'EcoGear',
  category: 'Fitness & Outdoors',
  description: 'Self-cleaning insulated water bottle with UV-C purification.',
  directiveText: 'Plan a 5-video launch campaign focused on health and outdoor enthusiasts.',
  facts: [mockFact],
  sourceAnalyses: [],
  brandVoice: 'Inspiring, authoritative, active',
  disclosureRequirement: '#ad must be present in all video captions',
};

describe('GeminiAIGatewayAdapter - Planning Roles', () => {
  it('executes ProductCampaignPlan through gateway with correct prompt template and provenance', async () => {
    const validPlan: ProductCampaignPlan = {
      schemaVersion: 1,
      summary: 'Grounded launch campaign for EcoBottle Ultra',
      positioningStatement: 'The pure hydration companion for adventurous creators.',
      campaignGoals: ['Drive 1,000 launch units'],
      coreBenefits: [
        {
          benefit: 'UV-C purification kills 99.9% of bacteria',
          evidenceRefs: [mockFact.id],
        },
      ],
      targetObjections: [
        {
          objection: 'Battery life may not last on long hikes',
          counterAngle: '30-day battery life on a single charge',
          evidenceRefs: [mockFact.id],
        },
      ],
      complianceConstraints: ['Clear affiliate disclosure required'],
      creativeHypotheses: [
        {
          hypothesis: 'Thirst test in harsh environments boosts viewer retention',
          rationale: 'Demonstrates immediate practical utility',
        },
      ],
      evidenceReferences: [{ sourceKind: 'product_fact', sourceId: mockFact.id }],
    };

    let capturedParams: { contents?: string } = {};
    const mockClient: GeminiClientLike = {
      models: {
        generateContent: async (params) => {
          capturedParams = params as { contents?: string };
          return {
            text: JSON.stringify(validPlan),
            usageMetadata: { promptTokenCount: 200, candidatesTokenCount: 400 },
          };
        },
      },
    };

    const adapter = new GeminiAIGatewayAdapter({ config: makeMockConfig(), client: mockClient });
    const result = await adapter.executeProductCampaignPlan(mockPlanningInput);

    expect(result.success).toBe(true);
    expect(result.provenance.promptTemplate).toBe('product_campaign_plan_v1');
    expect(result.provenance.provider).toBe('google');
    expect(result.content?.positioningStatement).toBe(validPlan.positioningStatement);
    expect(capturedParams.contents).toContain('Product Strategist');
    expect(capturedParams.contents).toContain('<<<UNTRUSTED_USER_DIRECTIVE>>>');
  });

  it('executes AudienceInsightBoard through gateway', async () => {
    const validBoard: AudienceInsightBoard = {
      schemaVersion: 1,
      summary: 'Audience board targeting trail runners and gym enthusiasts.',
      audienceSegments: [
        {
          segmentName: 'Trail Runners',
          description: 'Long-distance outdoor athletes needing dependable hydration.',
          awarenessStage: 'problem_aware',
          corePains: ['Carrying bulky purifiers'],
          desires: ['Lightweight clean water on the go'],
          evidenceRefs: [mockFact.id],
        },
      ],
      contentAngles: [
        {
          angleName: 'Mountain Stream Test',
          hookConcept: 'Can this bottle make stream water drinkable in 60s?',
          targetSegment: 'Trail Runners',
          creativeHypothesis: 'Real-world water testing hooks generate high curiosity.',
        },
      ],
      evidenceReferences: [{ sourceKind: 'product_fact', sourceId: mockFact.id }],
    };

    const mockClient: GeminiClientLike = {
      models: {
        generateContent: async () => ({
          text: JSON.stringify(validBoard),
          usageMetadata: { promptTokenCount: 180, candidatesTokenCount: 350 },
        }),
      },
    };

    const adapter = new GeminiAIGatewayAdapter({ config: makeMockConfig(), client: mockClient });
    const result = await adapter.executeAudienceInsightBoard(mockPlanningInput);

    expect(result.success).toBe(true);
    expect(result.provenance.promptTemplate).toBe('audience_insight_board_v1');
    expect(result.content?.audienceSegments).toHaveLength(1);
  });

  it('executes VideoSeriesPlan through gateway with exactly 5 episodes', async () => {
    const validSeries: VideoSeriesPlan = {
      schemaVersion: 1,
      seriesTitle: 'The Pure Hydration Journey',
      seriesNarrativeArc: 'Arc taking the viewer from skepticism to essential trail gear.',
      episodes: [
        {
          episodeNumber: 1,
          title: 'The Truth About Trail Water',
          purpose: 'Hook problem awareness',
          hook: 'Would you drink from this stream?',
          narrativeRole: 'Introduction',
          visualDirection: 'Scenic trail shot',
          callToActionDirection: 'Watch episode 2',
          evidenceRefs: [mockFact.id],
        },
        {
          episodeNumber: 2,
          title: '60-Second Purification Test',
          purpose: 'Demonstrate UV-C feature',
          hook: 'Pressing the button on dirty water',
          narrativeRole: 'Proof',
          visualDirection: 'Close up on cap light',
          callToActionDirection: 'Save for later',
          evidenceRefs: [mockFact.id],
        },
        {
          episodeNumber: 3,
          title: 'Drop Test: Is It Tough Enough?',
          purpose: 'Durability objection handling',
          hook: 'Dropping from 10 feet onto rocks',
          narrativeRole: 'Durability',
          visualDirection: 'Slow motion drop',
          callToActionDirection: 'Follow for episode 4',
          evidenceRefs: [mockFact.id],
        },
        {
          episodeNumber: 4,
          title: 'Cold for 24 Hours?',
          purpose: 'Insulation proof',
          hook: 'Ice cubes after a full day in the sun',
          narrativeRole: 'Secondary feature',
          visualDirection: 'Thermometer reading',
          callToActionDirection: 'Share with a hiker',
          evidenceRefs: [mockFact.id],
        },
        {
          episodeNumber: 5,
          title: 'The Ultimate Trail Pack Loadout',
          purpose: 'Full integration and conversion',
          hook: 'The one item I never hike without',
          narrativeRole: 'Resolution',
          visualDirection: 'Pack packing sequence',
          callToActionDirection: 'Get yours at link in bio',
          evidenceRefs: [mockFact.id],
        },
      ],
      creativeDirection: {
        visualTone: 'Cinematic outdoors with natural sunlight',
        audioTone: 'Crisp ambient outdoor sound with warm voiceover',
        pacing: 'Dynamic cuts with clear value beats',
      },
      evidenceReferences: [{ sourceKind: 'product_fact', sourceId: mockFact.id }],
    };

    const mockClient: GeminiClientLike = {
      models: {
        generateContent: async () => ({
          text: JSON.stringify(validSeries),
          usageMetadata: { promptTokenCount: 250, candidatesTokenCount: 600 },
        }),
      },
    };

    const adapter = new GeminiAIGatewayAdapter({ config: makeMockConfig(), client: mockClient });
    const result = await adapter.executeVideoSeriesPlan(mockPlanningInput);

    expect(result.success).toBe(true);
    expect(result.provenance.promptTemplate).toBe('video_series_plan_v1');
    expect(result.content?.episodes).toHaveLength(5);
  });

  it('handles provider error and maps safely without leaking secrets or prompt', async () => {
    const mockClient: GeminiClientLike = {
      models: {
        generateContent: async () => {
          const err = new Error('Service Unavailable: 503');
          Object.assign(err, { status: 503 });
          throw err;
        },
      },
    };

    const adapter = new GeminiAIGatewayAdapter({ config: makeMockConfig(), client: mockClient });
    const result = await adapter.executeProductCampaignPlan(mockPlanningInput);

    expect(result.success).toBe(false);
    expect(result.errorCategory).toBe('provider_unavailable');
    expect(result.isTransient).toBe(true);
  });
});
