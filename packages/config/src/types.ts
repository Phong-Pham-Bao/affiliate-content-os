export const ALLOWED_NODE_ENVS = ['development', 'test', 'production'] as const;
export type NodeEnv = (typeof ALLOWED_NODE_ENVS)[number];

export const ALLOWED_LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const;
export type LogLevel = (typeof ALLOWED_LOG_LEVELS)[number];

export const DEFAULT_LOG_LEVEL: LogLevel = 'info';

export interface AppConfig {
  readonly nodeEnv: NodeEnv;
  readonly logLevel: LogLevel;
  readonly appBaseUrl?: string;
}

export interface RedactedConfigMetadata {
  readonly nodeEnv: NodeEnv;
  readonly logLevel: LogLevel;
  readonly hasAppBaseUrl: boolean;
  readonly appBaseUrlOrigin?: string;
}

export type RawEnvironment = Record<string, string | undefined>;
