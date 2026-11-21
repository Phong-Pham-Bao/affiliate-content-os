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

export const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';
export const ALLOWED_GEMINI_THINKING_LEVELS = ['low', 'medium', 'high'] as const;
export type GeminiThinkingLevel = (typeof ALLOWED_GEMINI_THINKING_LEVELS)[number];
export const DEFAULT_GEMINI_THINKING_LEVEL: GeminiThinkingLevel = 'high';
export const DEFAULT_GEMINI_TIMEOUT_MS = 30000;
export const DEFAULT_GEMINI_MAX_OUTPUT_TOKENS = 8192;
export const DEFAULT_WORKER_POLLING_INTERVAL_MS = 2000;
export const DEFAULT_WORKER_LEASE_DURATION_SECONDS = 30;
export const DEFAULT_AI_ESTIMATED_RESERVATION_MICROUNITS = 50000;

export interface AIConfig {
  readonly enabled: boolean;
  readonly geminiApiKey: string | null;
  readonly geminiModel: string;
  readonly geminiThinkingLevel: GeminiThinkingLevel;
  readonly geminiTimeoutMs: number;
  readonly geminiMaxOutputTokens: number;
  readonly workerPollingIntervalMs: number;
  readonly workerLeaseDurationSeconds: number;
  readonly estimatedCostMicrounits: number;
}

export interface RedactedAIMetadata {
  readonly enabled: boolean;
  readonly hasGeminiApiKey: boolean;
  readonly geminiModel: string;
  readonly geminiThinkingLevel: GeminiThinkingLevel;
  readonly geminiTimeoutMs: number;
  readonly geminiMaxOutputTokens: number;
  readonly workerPollingIntervalMs: number;
  readonly workerLeaseDurationSeconds: number;
  readonly estimatedCostMicrounits: number;
}

export const DEFAULT_SOCIAL_TRANSACTION_TTL_SECONDS = 600;
export const DEFAULT_SOCIAL_CALLBACK_RESULT_TTL_SECONDS = 300;
export const ALLOWED_SOCIAL_KEY_PROVIDERS = ['local', 'kms'] as const;
export type SocialKeyProvider = (typeof ALLOWED_SOCIAL_KEY_PROVIDERS)[number];

export const DEFAULT_THREADS_AUTH_BASE_URL = 'https://www.threads.com';
export const DEFAULT_THREADS_API_BASE_URL = 'https://graph.threads.com';
export const DEFAULT_THREADS_API_VERSION = 'v1.0';
export const DEFAULT_META_GRAPH_BASE_URL = 'https://graph.facebook.com';
export const DEFAULT_META_GRAPH_VERSION = 'v21.0';
export const DEFAULT_THREADS_HTTP_TIMEOUT_MS = 10000;
export const DEFAULT_CAPABILITY_FRESHNESS_MAX_AGE_SECONDS = 7 * 24 * 3600;
export const ALLOWED_THREADS_APP_REVIEW_STATUSES = ['development', 'approved'] as const;
export type ThreadsAppReviewStatus = (typeof ALLOWED_THREADS_APP_REVIEW_STATUSES)[number];

export const DEFAULT_PUBLICATION_WORKER_POLLING_INTERVAL_MS = 2000;
export const DEFAULT_PUBLICATION_WORKER_LEASE_DURATION_SECONDS = 30;
export const DEFAULT_MIN_SCHEDULE_LEAD_TIME_SECONDS = 60;
export const DEFAULT_MAX_SCHEDULE_HORIZON_DAYS = 90;

export interface SocialConfig {
  readonly enabled: boolean;
  readonly fakeAdapterEnabled: boolean;
  readonly keyProvider: SocialKeyProvider;
  readonly credentialEncryptionKeyBase64Url: string | null;
  readonly credentialKeyVersion: string | null;
  readonly transactionTtlSeconds: number;
  readonly callbackResultTtlSeconds: number;
  readonly threadsRealAdapterEnabled: boolean;
  readonly threadsAppId: string | null;
  readonly threadsAppSecret: string | null;
  readonly threadsRedirectUri: string | null;
  readonly threadsAuthBaseUrl: string;
  readonly threadsApiBaseUrl: string;
  readonly threadsApiVersion: string;
  readonly metaGraphBaseUrl: string;
  readonly metaGraphVersion: string;
  readonly threadsAppAccessToken: string | null;
  readonly threadsAppReviewStatus: ThreadsAppReviewStatus;
  readonly threadsHttpTimeoutMs: number;
  readonly socialKillSwitchActive: boolean;
  readonly threadsConnectionKillSwitchActive: boolean;
  readonly threadsRefreshKillSwitchActive: boolean;
  readonly threadsPublishKillSwitchActive: boolean;
  readonly socialMaintenanceEnabled: boolean;
  readonly publicationWorkerPollingIntervalMs: number;
  readonly publicationWorkerLeaseDurationSeconds: number;
  readonly minScheduleLeadTimeSeconds: number;
  readonly maxScheduleHorizonDays: number;
}

export interface RedactedSocialConfigMetadata {
  readonly enabled: boolean;
  readonly fakeAdapterEnabled: boolean;
  readonly keyProvider: SocialKeyProvider;
  readonly hasCredentialEncryptionKey: boolean;
  readonly credentialKeyVersion: string | null;
  readonly transactionTtlSeconds: number;
  readonly callbackResultTtlSeconds: number;
  readonly threadsRealAdapterEnabled: boolean;
  readonly hasThreadsAppId: boolean;
  readonly hasThreadsAppSecret: boolean;
  readonly hasThreadsRedirectUri: boolean;
  readonly threadsAuthBaseUrl: string;
  readonly threadsApiBaseUrl: string;
  readonly threadsApiVersion: string;
  readonly metaGraphBaseUrl: string;
  readonly metaGraphVersion: string;
  readonly hasThreadsAppAccessToken: boolean;
  readonly threadsAppReviewStatus: ThreadsAppReviewStatus;
  readonly threadsHttpTimeoutMs: number;
  readonly socialKillSwitchActive: boolean;
  readonly threadsConnectionKillSwitchActive: boolean;
  readonly threadsRefreshKillSwitchActive: boolean;
  readonly threadsPublishKillSwitchActive: boolean;
  readonly socialMaintenanceEnabled: boolean;
  readonly publicationWorkerPollingIntervalMs: number;
  readonly publicationWorkerLeaseDurationSeconds: number;
  readonly minScheduleLeadTimeSeconds: number;
  readonly maxScheduleHorizonDays: number;
}

export type RawEnvironment = Record<string, string | undefined>;
