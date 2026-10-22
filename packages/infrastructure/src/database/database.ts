import type { DatabaseConfig } from '@affiliate-content-os/config';
import pg from 'pg';
import { DatabaseError, sanitizeDatabaseError } from './errors.js';
import { resolveSslOptions } from './ssl.js';
import type {
  CreateDatabaseOptions,
  Database,
  DatabaseQueryResult,
  TransactionExecutor,
} from './types.js';

export function createDatabase(config: DatabaseConfig, options?: CreateDatabaseOptions): Database {
  const poolConfig: pg.PoolConfig = {
    connectionString: config.databaseUrl,
    max: config.poolMax,
    connectionTimeoutMillis: config.connectionTimeoutMs,
    idleTimeoutMillis: config.idleTimeoutMs,
    statement_timeout: config.statementTimeoutMs,
    ssl: resolveSslOptions(config, options?.caContent),
  };

  const pool = options?.poolFactory ? options.poolFactory(poolConfig) : new pg.Pool(poolConfig);

  pool.on('error', (err) => {
    const safeErr = sanitizeDatabaseError(err, 'PostgreSQL pool idle client error');
    options?.onPoolError?.(safeErr);
  });

  let isClosingState = false;
  let isClosedState = false;
  let closePromise: Promise<void> | undefined;

  const probe = async (signal?: AbortSignal): Promise<void> => {
    if (signal?.aborted) {
      throw new DatabaseError('Database connection probe aborted before execution');
    }
    if (isClosingState || isClosedState) {
      throw new DatabaseError('Cannot probe database: pool is closing or closed');
    }

    let abortHandler: (() => void) | undefined;
    const abortPromise = new Promise<never>((_, reject) => {
      if (signal) {
        abortHandler = () => {
          reject(new DatabaseError('Database connection probe aborted'));
        };
        signal.addEventListener('abort', abortHandler, { once: true });
      }
    });

    try {
      await Promise.race([pool.query('SELECT 1'), abortPromise]);
    } catch (err) {
      throw sanitizeDatabaseError(err, 'Database connection probe failed');
    } finally {
      if (signal && abortHandler) {
        signal.removeEventListener('abort', abortHandler);
      }
    }
  };

  const query = async <T = unknown>(
    text: string,
    params?: readonly unknown[],
  ): Promise<DatabaseQueryResult<T>> => {
    if (isClosingState || isClosedState) {
      throw new DatabaseError('Cannot execute query: database pool is closing or closed');
    }

    try {
      const res = await pool.query(text, params ? [...params] : undefined);
      return {
        rows: Object.freeze([...res.rows]) as readonly T[],
        rowCount: res.rowCount ?? 0,
        command: res.command,
      };
    } catch (err) {
      throw sanitizeDatabaseError(err, 'Database query execution failed');
    }
  };

  const withTransaction = async <T>(fn: (tx: TransactionExecutor) => Promise<T>): Promise<T> => {
    if (isClosingState || isClosedState) {
      throw new DatabaseError('Cannot start transaction: database pool is closing or closed');
    }

    let client: pg.PoolClient;
    try {
      client = await pool.connect();
    } catch (err) {
      throw sanitizeDatabaseError(err, 'Failed to acquire database connection for transaction');
    }

    const executor: TransactionExecutor = {
      async query<R = unknown>(
        text: string,
        params?: readonly unknown[],
      ): Promise<DatabaseQueryResult<R>> {
        try {
          const res = await client.query(text, params ? [...params] : undefined);
          return {
            rows: Object.freeze([...res.rows]) as readonly R[],
            rowCount: res.rowCount ?? 0,
            command: res.command,
          };
        } catch (err) {
          throw sanitizeDatabaseError(err, 'Transaction query execution failed');
        }
      },
    };

    try {
      await client.query('BEGIN');
      const result = await fn(executor);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      const primaryError = sanitizeDatabaseError(err, 'Transaction execution failed');
      try {
        await client.query('ROLLBACK');
      } catch {
        // Rollback failure ignored; primaryError is preserved
      }
      throw primaryError;
    } finally {
      client.release();
    }
  };

  const close = (): Promise<void> => {
    if (isClosedState) {
      return Promise.resolve();
    }
    if (closePromise) {
      return closePromise;
    }

    isClosingState = true;
    closePromise = pool
      .end()
      .then(() => {
        isClosedState = true;
      })
      .catch((err) => {
        isClosedState = true;
        throw sanitizeDatabaseError(err, 'Database pool shutdown failed');
      });

    return closePromise;
  };

  const isClosing = (): boolean => isClosingState || isClosedState;

  return {
    query,
    withTransaction,
    probe,
    close,
    isClosing,
  };
}
