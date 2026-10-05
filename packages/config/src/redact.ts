import type { AppConfig, RedactedConfigMetadata } from './types.js';

/**
 * Returns redacted configuration metadata suitable for startup diagnostics and logging.
 * Never leaks raw environment values, credentials, URL paths, queries, or fragments.
 */
export function getRedactedConfigMetadata(config: AppConfig): RedactedConfigMetadata {
  let appBaseUrlOrigin: string | undefined;

  if (config.appBaseUrl) {
    try {
      const parsed = new URL(config.appBaseUrl);
      appBaseUrlOrigin = parsed.origin;
    } catch {
      // Should not occur on validated config, but safe fallback
      appBaseUrlOrigin = undefined;
    }
  }

  const result: RedactedConfigMetadata = {
    nodeEnv: config.nodeEnv,
    logLevel: config.logLevel,
    hasAppBaseUrl: Boolean(config.appBaseUrl),
    ...(appBaseUrlOrigin ? { appBaseUrlOrigin } : {}),
  };

  return Object.freeze(result);
}
