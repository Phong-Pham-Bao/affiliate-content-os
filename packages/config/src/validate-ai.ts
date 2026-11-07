import { ConfigurationError, type ConfigurationIssue } from './errors.js';
import {
  ALLOWED_GEMINI_THINKING_LEVELS,
  DEFAULT_AI_ESTIMATED_RESERVATION_MICROUNITS,
  DEFAULT_GEMINI_MAX_OUTPUT_TOKENS,
  DEFAULT_GEMINI_MODEL,
  DEFAULT_GEMINI_THINKING_LEVEL,
  DEFAULT_GEMINI_TIMEOUT_MS,
  DEFAULT_WORKER_LEASE_DURATION_SECONDS,
  DEFAULT_WORKER_POLLING_INTERVAL_MS,
  type AIConfig,
  type GeminiThinkingLevel,
  type RawEnvironment,
} from './types.js';

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_REGEX = /[\x00-\x1F\x7F]/;

function parseBoundedInteger(
  value: string | undefined,
  field: string,
  min: number,
  max: number,
  defaultValue: number,
  issues: ConfigurationIssue[],
): number {
  if (value === undefined || value.trim() === '') {
    return defaultValue;
  }
  const parsed = Number(value.trim());
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    issues.push({
      field,
      message: `Must be a safe integer between ${min} and ${max}`,
    });
    return defaultValue;
  }
  return parsed;
}

export function loadAIConfig(rawEnv: RawEnvironment): AIConfig {
  const issues: ConfigurationIssue[] = [];
  const rawEnabled = rawEnv['AI_ENABLED'];
  let enabled = false;
  if (rawEnabled !== undefined && rawEnabled.trim() !== '') {
    const trimmed = rawEnabled.trim().toLowerCase();
    if (trimmed === 'true') {
      enabled = true;
    } else if (trimmed === 'false') {
      enabled = false;
    } else {
      issues.push({
        field: 'AI_ENABLED',
        message: 'Must be either "true" or "false"',
      });
    }
  }

  const rawKey = rawEnv['GEMINI_API_KEY'];
  let geminiApiKey: string | null = null;
  if (rawKey !== undefined && rawKey.trim() !== '') {
    const trimmed = rawKey.trim();
    if (CONTROL_CHARS_REGEX.test(trimmed) || trimmed.length > 256) {
      issues.push({
        field: 'GEMINI_API_KEY',
        message: 'Must be a valid API key string without control characters (max 256 chars)',
      });
    } else {
      geminiApiKey = trimmed;
    }
  } else if (enabled) {
    issues.push({
      field: 'GEMINI_API_KEY',
      message: 'GEMINI_API_KEY is required when AI_ENABLED is true',
    });
  }

  const rawModel = rawEnv['GEMINI_MODEL'];
  let geminiModel = DEFAULT_GEMINI_MODEL;
  if (rawModel !== undefined && rawModel.trim() !== '') {
    const trimmed = rawModel.trim();
    if (trimmed !== DEFAULT_GEMINI_MODEL) {
      issues.push({
        field: 'GEMINI_MODEL',
        message: `GEMINI_MODEL must be exactly "${DEFAULT_GEMINI_MODEL}"`,
      });
    } else {
      geminiModel = trimmed;
    }
  }

  const rawLevel = rawEnv['GEMINI_THINKING_LEVEL'];
  let geminiThinkingLevel: GeminiThinkingLevel = DEFAULT_GEMINI_THINKING_LEVEL;
  if (rawLevel !== undefined && rawLevel.trim() !== '') {
    const trimmed = rawLevel.trim().toLowerCase();
    if ((ALLOWED_GEMINI_THINKING_LEVELS as readonly string[]).includes(trimmed)) {
      geminiThinkingLevel = trimmed as GeminiThinkingLevel;
    } else {
      issues.push({
        field: 'GEMINI_THINKING_LEVEL',
        message: `Must be one of: ${ALLOWED_GEMINI_THINKING_LEVELS.join(', ')}`,
      });
    }
  }

  const geminiTimeoutMs = parseBoundedInteger(
    rawEnv['GEMINI_TIMEOUT_MS'],
    'GEMINI_TIMEOUT_MS',
    1000,
    300000,
    DEFAULT_GEMINI_TIMEOUT_MS,
    issues,
  );

  const geminiMaxOutputTokens = parseBoundedInteger(
    rawEnv['GEMINI_MAX_OUTPUT_TOKENS'],
    'GEMINI_MAX_OUTPUT_TOKENS',
    512,
    65536,
    DEFAULT_GEMINI_MAX_OUTPUT_TOKENS,
    issues,
  );

  const workerPollingIntervalMs = parseBoundedInteger(
    rawEnv['WORKER_POLLING_INTERVAL_MS'],
    'WORKER_POLLING_INTERVAL_MS',
    100,
    60000,
    DEFAULT_WORKER_POLLING_INTERVAL_MS,
    issues,
  );

  const workerLeaseDurationSeconds = parseBoundedInteger(
    rawEnv['WORKER_LEASE_DURATION_SECONDS'],
    'WORKER_LEASE_DURATION_SECONDS',
    5,
    3600,
    DEFAULT_WORKER_LEASE_DURATION_SECONDS,
    issues,
  );

  const estimatedCostMicrounits = parseBoundedInteger(
    rawEnv['AI_ESTIMATED_RESERVATION_MICROUNITS'],
    'AI_ESTIMATED_RESERVATION_MICROUNITS',
    1,
    100_000_000,
    DEFAULT_AI_ESTIMATED_RESERVATION_MICROUNITS,
    issues,
  );

  if (issues.length > 0) {
    throw new ConfigurationError(issues);
  }

  return Object.freeze({
    enabled,
    geminiApiKey,
    geminiModel,
    geminiThinkingLevel,
    geminiTimeoutMs,
    geminiMaxOutputTokens,
    workerPollingIntervalMs,
    workerLeaseDurationSeconds,
    estimatedCostMicrounits,
  });
}
