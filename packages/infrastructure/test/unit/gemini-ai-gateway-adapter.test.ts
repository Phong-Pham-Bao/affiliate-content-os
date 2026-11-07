import { describe, expect, it } from 'vitest';
import { GeminiAIGatewayAdapter, type GeminiClientLike } from '../../src/analysis/index.js';
import { makeMockConfig, mockFact } from './gemini-ai-gateway-adapter-fixtures.js';

describe('GeminiAIGatewayAdapter', () => {
  it('forwards the caller AbortSignal through the official SDK field', async () => {
    const controller = new AbortController();
    let captured: unknown;
    const mockClient: GeminiClientLike = {
      models: {
        generateContent: async (params) => {
          captured = params;
          return { text: '{}' };
        },
      },
    };
    const adapter = new GeminiAIGatewayAdapter({ config: makeMockConfig(), client: mockClient });

    await adapter.executeProductAnalysis(
      {
        workspaceId: mockFact.workspaceId,
        productId: mockFact.productId,
        productName: 'Widget Pro',
        merchantName: 'Acme Corp',
        category: 'Ergonomics',
        description: 'A great widget',
        facts: [mockFact],
      },
      undefined,
      { signal: controller.signal },
    );

    expect((captured as { config?: { abortSignal?: AbortSignal } }).config?.abortSignal).toBe(
      controller.signal,
    );
    expect(
      (captured as { config?: { httpOptions?: { retryOptions?: { attempts?: number } } } }).config
        ?.httpOptions?.retryOptions?.attempts,
    ).toBe(1);
  });

  it('successfully generates and parses product analysis', async () => {
    const validProductJson = {
      summary: 'High performance ergonomic widget',
      benefits: [
        { title: 'Lightweight', description: 'Weighs only 150g', evidenceFactIds: [mockFact.id] },
      ],
      differentiators: [{ title: 'Ergonomic', description: 'Designed for comfort' }],
      evidenceGaps: [],
      claimRisks: [],
      objections: [],
      contentAngles: [
        {
          angle: 'Comfort',
          targetPersona: 'Remote workers',
          hookText: 'Work in comfort',
          recommendedPoints: ['Lightweight'],
        },
      ],
    };

    const mockClient: GeminiClientLike = {
      models: {
        generateContent: async () => ({
          text: JSON.stringify(validProductJson),
          usageMetadata: {
            promptTokenCount: 120,
            candidatesTokenCount: 350,
          },
        }),
      },
    };

    const adapter = new GeminiAIGatewayAdapter({ config: makeMockConfig(), client: mockClient });
    const result = await adapter.executeProductAnalysis({
      workspaceId: mockFact.workspaceId,
      productId: mockFact.productId,
      productName: 'Widget Pro',
      merchantName: 'Acme Corp',
      category: 'Ergonomics',
      description: 'A great widget',
      facts: [mockFact],
    });

    expect(result.success).toBe(true);
    expect(result.content).toBeDefined();
    if (result.success && result.content) {
      expect(result.content.summary).toBe('High performance ergonomic widget');
      expect(result.usage.tokenInput).toBe(120);
      expect(result.usage.tokenOutput).toBe(350);
      expect(result.provenance.provider).toBe('google');
      expect(result.provenance.model).toBe('gemini-3.8-flash');
      expect(result.rawOutputHash).toBeDefined();
    }
  });

  it('rejects oversized output payload (>2MB)', async () => {
    const hugeText = 'A'.repeat(2 * 1024 * 1024 + 10);
    const mockClient: GeminiClientLike = {
      models: {
        generateContent: async () => ({ text: hugeText }),
      },
    };

    const adapter = new GeminiAIGatewayAdapter({ config: makeMockConfig(), client: mockClient });
    const result = await adapter.executeProductAnalysis({
      workspaceId: mockFact.workspaceId,
      productId: mockFact.productId,
      productName: 'Widget Pro',
      merchantName: 'Acme Corp',
      category: 'Ergonomics',
      description: 'A great widget',
      facts: [mockFact],
    });

    expect(result.success).toBe(false);
    expect(result.errorCategory).toBe('invalid_output');
    expect(result.isTransient).toBe(false);
  });

  it('handles safety block finish reason as permanent error', async () => {
    const mockClient: GeminiClientLike = {
      models: {
        generateContent: async () => ({
          candidates: [{ finishReason: 'SAFETY' }],
        }),
      },
    };

    const adapter = new GeminiAIGatewayAdapter({ config: makeMockConfig(), client: mockClient });
    const result = await adapter.executeProductAnalysis({
      workspaceId: mockFact.workspaceId,
      productId: mockFact.productId,
      productName: 'Widget Pro',
      merchantName: 'Acme Corp',
      category: 'Ergonomics',
      description: 'A great widget',
      facts: [mockFact],
    });

    expect(result.success).toBe(false);
    expect(result.errorCategory).toBe('invalid_output');
    expect(result.safetyResult).toBe('SAFETY');
    expect(result.isTransient).toBe(false);
  });

  it('classifies network timeout errors as transient', async () => {
    const mockClient: GeminiClientLike = {
      models: {
        generateContent: async () => {
          const err = new Error('Request aborted due to timeout');
          err.name = 'AbortError';
          throw err;
        },
      },
    };

    const adapter = new GeminiAIGatewayAdapter({ config: makeMockConfig(), client: mockClient });
    const result = await adapter.executeProductAnalysis({
      workspaceId: mockFact.workspaceId,
      productId: mockFact.productId,
      productName: 'TimeoutProduct',
      merchantName: 'Acme',
      category: 'Electronics',
      description: 'Desc',
      facts: [],
    });

    expect(result.success).toBe(false);
    expect(result.errorCategory).toBe('provider_timeout');
    expect(result.isTransient).toBe(true);
  });

  it('classifies 429 rate limit errors as transient', async () => {
    const mockClient: GeminiClientLike = {
      models: {
        generateContent: async () => {
          const err = new Error('Resource has been exhausted (e.g. check quota).');
          Object.assign(err, { status: 429 });
          throw err;
        },
      },
    };

    const adapter = new GeminiAIGatewayAdapter({ config: makeMockConfig(), client: mockClient });
    const result = await adapter.executeProductAnalysis({
      workspaceId: mockFact.workspaceId,
      productId: mockFact.productId,
      productName: 'RateLimitedProduct',
      merchantName: 'Acme',
      category: 'Electronics',
      description: 'Desc',
      facts: [],
    });

    expect(result.success).toBe(false);
    expect(result.errorCategory).toBe('rate_limited');
    expect(result.isTransient).toBe(true);
  });

  it('passes repair prompt on repair attempt', async () => {
    let capturedPrompt = '';
    const mockClient: GeminiClientLike = {
      models: {
        generateContent: async (params: unknown) => {
          const p = params as { contents?: string };
          capturedPrompt = p.contents ?? '';
          return {
            text: JSON.stringify({
              summary: 'Repaired summary',
              benefits: [],
              differentiators: [],
              evidenceGaps: [],
              claimRisks: [],
              objections: [],
              contentAngles: [],
            }),
          };
        },
      },
    };

    const adapter = new GeminiAIGatewayAdapter({ config: makeMockConfig(), client: mockClient });
    await adapter.executeProductAnalysis(
      {
        workspaceId: mockFact.workspaceId,
        productId: mockFact.productId,
        productName: 'Widget',
        merchantName: 'Acme',
        category: 'Electronics',
        description: 'Desc',
        facts: [mockFact],
      },
      { errorCategory: 'invalid_output', errorPath: 'benefits.0.evidenceFactIds' },
    );

    expect(capturedPrompt).toContain('REPAIR INSTRUCTION (ATTEMPT 2)');
    expect(capturedPrompt).toContain('benefits.0.evidenceFactIds');
  });
});
