export const ALLOWED_NODE_ENVS = ['development', 'test', 'production'] as const;
export type NodeEnv = (typeof ALLOWED_NODE_ENVS)[number];

export const ALLOWED_LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const;
export type LogLevel = (typeof ALLOWED_LOG_LEVELS)[number];

export const DEFAULT_LOG_LEVEL: LogLevel = 'info';
export const DEFAULT_API_HOST = '127.0.0.1';
export const DEFAULT_API_PORT = 3001;

export const ALLOWED_DATABASE_SSL_MODES = ['disable', 'verify-full'] as const;
export type DatabaseSslMode = (typeof ALLOWED_DATABASE_SSL_MODES)[number];

export const DEFAULT_DATABASE_POOL_MAX = 10;
export const DEFAULT_DATABASE_CONNECTION_TIMEOUT_MS = 5000;
export const DEFAULT_DATABASE_IDLE_TIMEOUT_MS = 30000;
export const DEFAULT_DATABASE_STATEMENT_TIMEOUT_MS = 15000;
export const DEFAULT_DATABASE_SSL_MODE: DatabaseSslMode = 'disable';
export const TEST_DATABASE_DISPOSABLE_SENTINEL =
  'YES_I_UNDERSTAND_TEST_DATABASES_WILL_BE_DROPPED' as const;

export const DEFAULT_AUTH_TRANSACTION_TTL_SECONDS = 600;
export const DEFAULT_AUTH_SESSION_IDLE_TTL_SECONDS = 1800;
export const DEFAULT_AUTH_SESSION_ABSOLUTE_TTL_SECONDS = 28800;
export const DEFAULT_AUTH_SESSION_ROTATION_SECONDS = 900;
export const DEFAULT_AUTH_SESSION_ROTATION_GRACE_SECONDS = 30;
export const DEFAULT_AUTH_SESSION_TOUCH_INTERVAL_SECONDS = 300;

export interface AppConfig {
  readonly nodeEnv: NodeEnv;
  readonly logLevel: LogLevel;
  readonly appBaseUrl?: string;
  readonly apiHost: string;
  readonly apiPort: number;
}

export interface DatabaseConfig {
  readonly databaseUrl: string;
  readonly poolMax: number;
  readonly connectionTimeoutMs: number;
  readonly idleTimeoutMs: number;
  readonly statementTimeoutMs: number;
  readonly sslMode: DatabaseSslMode;
  readonly sslCaFile?: string;
}

export interface MigrationConfig {
  readonly migrationDatabaseUrl: string;
  readonly connectionTimeoutMs: number;
  readonly statementTimeoutMs: number;
  readonly sslMode: DatabaseSslMode;
  readonly sslCaFile?: string;
}

export interface TestAdminDatabaseConfig {
  readonly testDatabaseAdminUrl: string;
  readonly testDatabaseDisposable: typeof TEST_DATABASE_DISPOSABLE_SENTINEL;
  readonly connectionTimeoutMs: number;
  readonly statementTimeoutMs: number;
  readonly sslMode: DatabaseSslMode;
  readonly sslCaFile?: string;
}

export interface RedactedConfigMetadata {
  readonly nodeEnv: NodeEnv;
  readonly logLevel: LogLevel;
  readonly hasAppBaseUrl: boolean;
  readonly appBaseUrlOrigin?: string;
  readonly apiHost: string;
  readonly apiPort: number;
}

export interface RedactedDatabaseMetadata {
  readonly hasDatabaseUrl: boolean;
  readonly poolMax: number;
  readonly connectionTimeoutMs: number;
  readonly idleTimeoutMs: number;
  readonly statementTimeoutMs: number;
  readonly sslMode: DatabaseSslMode;
  readonly hasSslCaFile: boolean;
}

export interface AuthConfig {
  readonly enabled: boolean;
  readonly issuer: string | null;
  readonly clientId: string | null;
  readonly clientSecret: string | null;
  readonly redirectUri: string | null;
  readonly transactionEncryptionKeyBase64Url: string | null;
  readonly transactionKeyVersion: string | null;
  readonly transactionTtlSeconds: number;
  readonly sessionIdleTtlSeconds: number;
  readonly sessionAbsoluteTtlSeconds: number;
  readonly sessionRotationSeconds: number;
  readonly sessionRotationGraceSeconds: number;
  readonly sessionTouchIntervalSeconds: number;
  readonly cookieSecure: boolean;
}

export interface RedactedAuthConfigMetadata {
  readonly enabled: boolean;
  readonly hasIssuer: boolean;
  readonly hasClientId: boolean;
  readonly hasClientSecret: boolean;
  readonly hasRedirectUri: boolean;
  readonly hasTransactionEncryptionKey: boolean;
  readonly transactionKeyVersion: string | null;
  readonly transactionTtlSeconds: number;
  readonly sessionIdleTtlSeconds: number;
  readonly sessionAbsoluteTtlSeconds: number;
  readonly sessionRotationSeconds: number;
  readonly sessionRotationGraceSeconds: number;
  readonly sessionTouchIntervalSeconds: number;
  readonly cookieSecure: boolean;
}

export type RawEnvironment = Record<string, string | undefined>;
