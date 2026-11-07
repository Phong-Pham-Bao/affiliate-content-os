import { describe, expect, it } from 'vitest';
import {
  ConfigurationError,
  DEFAULT_AI_ESTIMATED_RESERVATION_MICROUNITS,
  DEFAULT_GEMINI_MAX_OUTPUT_TOKENS,
  DEFAULT_GEMINI_MODEL,
  DEFAULT_GEMINI_THINKING_LEVEL,
  DEFAULT_GEMINI_TIMEOUT_MS,
  DEFAULT_WORKER_LEASE_DURATION_SECONDS,
  DEFAULT_WORKER_POLLING_INTERVAL_MS,
  getRedactedAIMetadata,
  loadAIConfig,
} from '../src/index.js';

describe('AI configuration validation', () => {
  it('loads defaults when environment is empty', () => {
    const config = loadAIConfig({});
    expect(config.enabled).toBe(false);
    expect(config.geminiApiKey).toBeNull();
    expect(config.geminiModel).toBe(DEFAULT_GEMINI_MODEL);
    expect(config.geminiThinkingLevel).toBe(DEFAULT_GEMINI_THINKING_LEVEL);
    expect(config.geminiTimeoutMs).toBe(DEFAULT_GEMINI_TIMEOUT_MS);
    expect(config.geminiMaxOutputTokens).toBe(DEFAULT_GEMINI_MAX_OUTPUT_TOKENS);
    expect(config.workerPollingIntervalMs).toBe(DEFAULT_WORKER_POLLING_INTERVAL_MS);
    expect(config.workerLeaseDurationSeconds).toBe(DEFAULT_WORKER_LEASE_DURATION_SECONDS);
    expect(config.estimatedCostMicrounits).toBe(DEFAULT_AI_ESTIMATED_RESERVATION_MICROUNITS);
  });

  it('fails closed in any environment when AI enabled but GEMINI_API_KEY is missing', () => {
    expect(() => {
      loadAIConfig({
        NODE_ENV: 'development',
        AI_ENABLED: 'true',
      });
    }).toThrowError(ConfigurationError);
    expect(() => {
      loadAIConfig({
        NODE_ENV: 'test',
        AI_ENABLED: 'true',
      });
    }).toThrowError(ConfigurationError);
    expect(() => {
      loadAIConfig({
        NODE_ENV: 'production',
        AI_ENABLED: 'true',
      });
    }).toThrowError(ConfigurationError);
  });

  it('rejects model other than gemini-3.8-flash', () => {
    expect(() => {
      loadAIConfig({
        GEMINI_MODEL: 'gemini-1.5-pro',
      });
    }).toThrowError(ConfigurationError);
  });

  it('allows valid API key and custom settings when enabled', () => {
    const config = loadAIConfig({
      NODE_ENV: 'production',
      AI_ENABLED: 'true',
      GEMINI_API_KEY: 'test-key-1234567890',
      GEMINI_MODEL: 'gemini-3.8-flash',
      GEMINI_THINKING_LEVEL: 'medium',
      GEMINI_TIMEOUT_MS: '45000',
      GEMINI_MAX_OUTPUT_TOKENS: '4096',
      WORKER_POLLING_INTERVAL_MS: '1000',
      WORKER_LEASE_DURATION_SECONDS: '60',
      AI_ESTIMATED_RESERVATION_MICROUNITS: '100000',
    });

    expect(config.enabled).toBe(true);
    expect(config.geminiApiKey).toBe('test-key-1234567890');
    expect(config.geminiModel).toBe('gemini-3.8-flash');
    expect(config.geminiThinkingLevel).toBe('medium');
    expect(config.geminiTimeoutMs).toBe(45000);
    expect(config.geminiMaxOutputTokens).toBe(4096);
    expect(config.workerPollingIntervalMs).toBe(1000);
    expect(config.workerLeaseDurationSeconds).toBe(60);
    expect(config.estimatedCostMicrounits).toBe(100000);
  });

  it('redacts sensitive information in metadata', () => {
    const config = loadAIConfig({
      NODE_ENV: 'development',
      AI_ENABLED: 'true',
      GEMINI_API_KEY: 'super-secret-key',
    });

    const redacted = getRedactedAIMetadata(config);
    expect(redacted.enabled).toBe(true);
    expect(redacted.hasGeminiApiKey).toBe(true);
    expect('geminiApiKey' in (redacted as unknown as Record<string, unknown>)).toBe(false);
  });

  it('rejects invalid thinking level', () => {
    expect(() => {
      loadAIConfig({
        AI_ENABLED: 'true',
        GEMINI_API_KEY: 'test-key',
        GEMINI_THINKING_LEVEL: 'ultra',
      });
    }).toThrowError(ConfigurationError);
  });

  it('rejects out-of-bounds timeout', () => {
    expect(() => {
      loadAIConfig({
        GEMINI_TIMEOUT_MS: '500',
      });
    }).toThrowError(ConfigurationError);
  });
});
