import {
  parseIsoTimestamp,
  parseProductFactId,
  parseProductFactSetId,
  parseProductId,
  parseWorkspaceId,
  validateAnalysisEvidence,
  validateProductAnalysisContent,
  type ProductFactSnapshot,
} from '@affiliate-content-os/domain';
import { loadAIConfig } from '@affiliate-content-os/config';
import { GeminiAIGatewayAdapter } from '../src/analysis/index.js';

if (process.env['RUN_LIVE_GEMINI_SMOKE'] !== 'YES') {
  throw new Error('Live Gemini smoke is disabled. Set RUN_LIVE_GEMINI_SMOKE=YES explicitly.');
}

const config = loadAIConfig(process.env);
if (!config.enabled || !config.geminiApiKey) {
  throw new Error('Live Gemini smoke requires AI_ENABLED=true and GEMINI_API_KEY.');
}

const workspaceId = parseWorkspaceId('019318b2-5f33-722e-a5df-036f007b89f0');
const productId = parseProductId('019318b2-5f33-722e-a5df-036f007b89f1');
const factSetId = parseProductFactSetId('019318b2-5f33-722e-a5df-036f007b89f2');
const createdAt = parseIsoTimestamp('2026-11-07T00:00:00.000Z');
const facts: readonly ProductFactSnapshot[] = [
  {
    id: parseProductFactId('019318b2-5f33-722e-a5df-036f007b89f3'),
    workspaceId,
    productId,
    factSetId,
    factKey: 'weight',
    valueText: '150 grams',
    sourceType: 'user',
    sourceUrl: null,
    sourceExcerpt: null,
    confidence: 'confirmed',
    claimUsage: 'allowed',
    createdAt,
  },
  {
    id: parseProductFactId('019318b2-5f33-722e-a5df-036f007b89f4'),
    workspaceId,
    productId,
    factSetId,
    factKey: 'connectivity',
    valueText: 'Bluetooth 5.3 and USB-C wired mode',
    sourceType: 'user',
    sourceUrl: null,
    sourceExcerpt: null,
    confidence: 'confirmed',
    claimUsage: 'allowed',
    createdAt,
  },
];

const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), config.geminiTimeoutMs);

try {
  const adapter = new GeminiAIGatewayAdapter({ config });
  const result = await adapter.executeProductAnalysis(
    {
      workspaceId,
      productId,
      productName: 'Portable Wireless Keyboard',
      merchantName: 'Local Smoke Merchant',
      category: 'Computer Accessories',
      description:
        'A compact keyboard used only for a non-destructive provider contract smoke test.',
      facts,
    },
    undefined,
    { signal: controller.signal },
  );

  if (!result.success || !result.content) {
    console.error(
      JSON.stringify({
        ok: false,
        category: result.errorCategory ?? 'unknown',
        transient: result.isTransient ?? false,
        provider: result.provenance.provider,
        model: result.provenance.model,
      }),
    );
    process.exitCode = 1;
  } else {
    const content = validateProductAnalysisContent(result.content);
    const evidence = validateAnalysisEvidence(content, facts);
    if (!evidence.valid) {
      throw new Error('Gemini returned content that failed deterministic evidence validation.');
    }

    console.log(
      JSON.stringify({
        ok: true,
        provider: result.provenance.provider,
        model: result.provenance.model,
        promptTemplate: result.provenance.promptTemplate,
        evidenceValidated: true,
        tokenInput: result.usage.tokenInput,
        tokenOutput: result.usage.tokenOutput,
        latencyMs: result.usage.latencyMs,
      }),
    );
  }
} finally {
  clearTimeout(timeout);
}
