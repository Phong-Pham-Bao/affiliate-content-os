import type { DatabaseConfig } from '@affiliate-content-os/config';
import pg from 'pg';
import { DatabaseError, sanitizeCallbackError, sanitizeDatabaseError } from './errors.js';
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
    ssl: resolveSslOptions(config, options?.sslCaContent ?? options?.caContent),
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

    let client: pg.PoolClient | undefined;
    let abortListener: (() => void) | undefined;
    let clientError: Error | undefined;
    let clientErrorHandler: ((err: Error) => void) | undefined;
    let settled = false;

    try {
      const connectPromise = pool.connect().then((acquiredClient) => {
        if (settled || signal?.aborted || isClosingState || isClosedState) {
          try {
            (
              acquiredClient as unknown as { connection?: { stream?: { destroy: () => void } } }
            )?.connection?.stream?.destroy();
          } catch {
            // ignore destroy error
          }
          try {
            acquiredClient.release(true);
          } catch {
            // ignore release error
          }
          throw new DatabaseError('Database connection probe aborted');
        }
        return acquiredClient;
      });

      if (signal) {
        const abortPromise = new Promise<never>((_, reject) => {
          abortListener = () => {
            reject(new DatabaseError('Database connection probe aborted'));
          };
          signal.addEventListener('abort', abortListener, { once: true });
        });
        client = await Promise.race([connectPromise, abortPromise]);
      } else {
        client = await connectPromise;
      }

      if (signal?.aborted) {
        throw new DatabaseError('Database connection probe aborted');
      }

      clientErrorHandler = (err: Error) => {
        clientError = err;
      };
      client.on('error', clientErrorHandler);

      const queryPromise = client.query('SELECT 1');
      if (signal) {
        const queryAbortPromise = new Promise<never>((_, reject) => {
          if (signal.aborted) {
            reject(new DatabaseError('Database connection probe aborted'));
            return;
          }
          abortListener = () => {
            reject(new DatabaseError('Database connection probe aborted'));
          };
          signal.addEventListener('abort', abortListener, { once: true });
        });
        await Promise.race([queryPromise, queryAbortPromise]);
      } else {
        await queryPromise;
      }

      if (clientError) {
        throw clientError;
      }
    } catch (err) {
      settled = true;
      if (client) {
        try {
          (
            client as unknown as { connection?: { stream?: { destroy: () => void } } }
          )?.connection?.stream?.destroy();
        } catch {
          // ignore destroy error
        }
        try {
          client.release(true);
          client = undefined;
        } catch {
          // ignore release error
        }
      }
      throw sanitizeDatabaseError(err, 'Database connection probe failed');
    } finally {
      settled = true;
      if (signal && abortListener) {
        signal.removeEventListener('abort', abortListener);
      }
      if (client) {
        if (clientErrorHandler) {
          client.removeListener('error', clientErrorHandler);
        }
        try {
          client.release(clientError ? true : undefined);
        } catch {
          // ignore release error
        }
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

    let clientError: Error | undefined;
    const clientErrorHandler = (err: Error): void => {
      clientError = err;
    };
    client.on('error', clientErrorHandler);

    let active = true;
    const executor: TransactionExecutor = {
      async query<R = unknown>(
        text: string,
        params?: readonly unknown[],
      ): Promise<DatabaseQueryResult<R>> {
        if (!active) {
          throw new DatabaseError('Cannot execute query: transaction has already completed');
        }
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

    let hasTransactionFailure = false;
    let transactionFailureValue: unknown;
    let result: T | undefined;
    let callbackFailed = false;

    try {
      await client.query('BEGIN');
      try {
        result = await fn(executor);
      } catch (userErr) {
        callbackFailed = true;
        hasTransactionFailure = true;
        transactionFailureValue = sanitizeCallbackError(userErr);
      } finally {
        active = false;
      }

      if (callbackFailed) {
        // Callback failed; do not attempt COMMIT
      } else if (clientError) {
        hasTransactionFailure = true;
        transactionFailureValue = sanitizeDatabaseError(clientError, 'Transaction client error');
      } else {
        await client.query('COMMIT');
      }
    } catch (err) {
      if (!hasTransactionFailure) {
        hasTransactionFailure = true;
        transactionFailureValue = sanitizeDatabaseError(err, 'Transaction execution failed');
      }
    }

    if (hasTransactionFailure) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Rollback failure ignored; primary transactionFailureValue is preserved
      }
    }

    active = false;
    client.removeListener('error', clientErrorHandler);
    let releaseError: unknown;
    try {
      client.release(clientError ? true : undefined);
    } catch (releaseErr) {
      releaseError = releaseErr;
    }

    if (hasTransactionFailure) {
      throw transactionFailureValue;
    }

    if (releaseError) {
      throw sanitizeDatabaseError(releaseError, 'Failed to release database connection');
    }

    return result as T;
  };

  const close = (): Promise<void> => {
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
