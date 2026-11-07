import { loadAIConfig } from '@affiliate-content-os/config';
import {
  parseIsoTimestamp,
  parseProductFactId,
  parseProductFactSetId,
  parseProductId,
  parseWorkspaceId,
  type ProductFactSnapshot,
} from '@affiliate-content-os/domain';

export function makeMockConfig() {
  return loadAIConfig({
    AI_ENABLED: 'true',
    GEMINI_API_KEY: 'mock-key',
    GEMINI_MODEL: 'gemini-3.8-flash',
    GEMINI_THINKING_LEVEL: 'high',
    GEMINI_TIMEOUT_MS: '30000',
  });
}

export const mockFact: ProductFactSnapshot = {
  id: parseProductFactId('019318b2-5f33-722e-a5df-036f007b89f3'),
  workspaceId: parseWorkspaceId('019318b2-5f33-722e-a5df-036f007b89f0'),
  productId: parseProductId('019318b2-5f33-722e-a5df-036f007b89f1'),
  factSetId: parseProductFactSetId('019318b2-5f33-722e-a5df-036f007b89f2'),
  factKey: 'weight',
  valueText: '150g',
  sourceType: 'user',
  sourceUrl: null,
  sourceExcerpt: null,
  confidence: 'confirmed',
  claimUsage: 'allowed',
  createdAt: parseIsoTimestamp('2026-11-07T00:00:00.000Z'),
};
