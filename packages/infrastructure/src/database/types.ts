import type { DatabaseConfig, DatabaseSslMode } from '@affiliate-content-os/config';
import type pg from 'pg';

export interface DatabaseQueryResult<T = unknown> {
  readonly rows: readonly T[];
  readonly rowCount: number;
  readonly command: string;
}

export interface TransactionExecutor {
  query<T = unknown>(text: string, params?: readonly unknown[]): Promise<DatabaseQueryResult<T>>;
}

export interface Database {
  query<T = unknown>(text: string, params?: readonly unknown[]): Promise<DatabaseQueryResult<T>>;

  withTransaction<T>(fn: (tx: TransactionExecutor) => Promise<T>): Promise<T>;

  probe(signal?: AbortSignal): Promise<void>;

  close(): Promise<void>;

  isClosing(): boolean;
}

export interface CreateDatabaseOptions {
  readonly caContent?: string | undefined;
  readonly poolFactory?: ((config: pg.PoolConfig) => pg.Pool) | undefined;
  readonly onPoolError?: ((error: Error) => void) | undefined;
}

export type { DatabaseConfig, DatabaseSslMode };
