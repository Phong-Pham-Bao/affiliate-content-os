import 'server-only';
import { loadConfig, type AppConfig, type RawEnvironment } from '@affiliate-content-os/config';

/**
 * Server-only bootstrap boundary for the web process shell.
 * Accepts an explicitly supplied environment record derived from process.env at process entry.
 * Never executed in client browser components.
 */
export function bootstrapWebServer(rawEnv: RawEnvironment = process.env): AppConfig {
  return loadConfig(rawEnv);
}
