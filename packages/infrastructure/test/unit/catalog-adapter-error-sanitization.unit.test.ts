import { describe, expect, it } from 'vitest';
import { ProductNotFoundError, StaleVersionConflictError } from '@affiliate-content-os/application';
import {
  parseAffiliateDestinationId,
  parseAuditEventId,
  parseIsoTimestamp,
  parseProductFactSetId,
  parseProductId,
  parseUserId,
  parseWorkspaceId,
  type AuditEventSnapshot,
  type ProductFactSetSnapshot,
} from '@affiliate-content-os/domain';
import { DatabaseError } from '../../src/database/errors.js';
import { PostgresCatalogAdapter } from '../../src/catalog/postgres-catalog-adapter.js';
import type {
  Database,
  DatabaseQueryResult,
  TransactionExecutor,
} from '../../src/database/types.js';

describe('Catalog Adapter - Error Sanitization Boundaries', () => {
  const wsId = parseWorkspaceId('018f6c5b-21a4-789a-8def-0123456789ab');
  const prodId = parseProductId('018f6c5b-21a4-789a-8def-0123456789cd');
  const userId = parseUserId('018f6c5b-21a4-789a-8def-0123456789ef');
  const factSetId = parseProductFactSetId('018f6c5b-21a4-789a-8def-0123456789ee');
  const auditId = parseAuditEventId('018f6c5b-21a4-789a-8def-012345678911');

  function createMockDb(
    queryMock: (
      sql: string,
      params?: readonly unknown[],
    ) => Promise<{ rowCount: number; rows: readonly unknown[]; command?: string }>,
  ): Database {
    const runQuery = async <T = unknown>(
      sql: string,
      params?: readonly unknown[],
    ): Promise<DatabaseQueryResult<T>> => {
      const res = await queryMock(sql, params);
      return {
        rows: res.rows as readonly T[],
        rowCount: res.rowCount,
        command: res.command ?? 'SELECT',
      };
    };
    return {
      query: runQuery as Database['query'],
      withTransaction: async <T>(callback: (tx: TransactionExecutor) => Promise<T>): Promise<T> => {
        const fakeTx: TransactionExecutor = {
          query: runQuery as TransactionExecutor['query'],
        };
        return callback(fakeTx);
      },
      probe: async () => {},
      close: async () => {},
      isClosing: () => false,
    };
  }

  it('sanitizes driver errors containing sensitive connection strings and secrets', async () => {
    const rawDriverError = new Error(
      'FATAL: password authentication failed for user "postgres://admin:SUPER_SECRET_PASSWORD@db.internal:5432/acos"',
    );

    const db = createMockDb(async () => {
      throw rawDriverError;
    });

    const adapter = new PostgresCatalogAdapter(db);

    let caughtError: unknown;
    try {
      await adapter.findProductById({ workspaceId: wsId, productId: prodId });
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).toBeInstanceOf(DatabaseError);
    const msg = (caughtError as Error).message;
    expect(msg).not.toContain('SUPER_SECRET_PASSWORD');
  });

  it('preserves ProductNotFoundError thrown from transaction callbacks without wrapping in DatabaseError', async () => {
    const db = createMockDb(async (sql) => {
      if (sql.includes('SELECT id FROM products WHERE id = $1 AND workspace_id = $2 FOR UPDATE')) {
        return { rowCount: 0, rows: [] };
      }
      return { rowCount: 1, rows: [{ id: prodId }] };
    });

    const adapter = new PostgresCatalogAdapter(db);

    const factSet: ProductFactSetSnapshot = {
      id: factSetId,
      workspaceId: wsId,
      productId: prodId,
      revisionNumber: 1,
      status: 'proposed',
      summary: null,
      createdByUserId: userId,
      confirmedByUserId: null,
      confirmedAt: null,
      createdAt: parseIsoTimestamp('2026-11-06T12:00:00.000Z'),
      updatedAt: parseIsoTimestamp('2026-11-06T12:00:00.000Z'),
      version: 1,
    };

    const auditEvent: AuditEventSnapshot = {
      id: auditId,
      workspaceId: wsId,
      actorType: 'user',
      actorUserId: userId,
      action: 'catalog.fact_set_created',
      resourceType: 'product_fact_set',
      resourceId: factSetId,
      result: 'succeeded',
      reasonCode: null,
      changes: {},
      occurredAt: parseIsoTimestamp('2026-11-06T12:00:00.000Z'),
      createdAt: parseIsoTimestamp('2026-11-06T12:00:00.000Z'),
      ipHash: null,
      userAgentSummary: null,
      correlationId: null,
    };

    await expect(
      adapter.createFactSet({
        factSet,
        facts: [],
        auditEvent,
      }),
    ).rejects.toThrow(ProductNotFoundError);
  });

  describe('Database Version Coercion & Hostile Surface Protection (HIGH 3)', () => {
    const destId = parseAffiliateDestinationId('018f6c5b-21a4-789a-8def-0123456789ff');

    const updateProductParams = {
      workspaceId: wsId,
      productId: prodId,
      expectedVersion: 1,
      updates: {
        name: 'Updated Name',
        merchantName: 'Merchant',
        canonicalUrl: 'https://example.com/updated',
        canonicalUrlHash: new Uint8Array(32).fill(0x55),
        category: 'Cat',
        description: 'Desc',
        audienceNotes: null,
        allowedClaimsNotes: null,
        prohibitedClaimsNotes: null,
        status: 'draft' as const,
        updatedAt: parseIsoTimestamp('2026-11-06T12:00:00.000Z'),
      },
      auditEvent: {
        id: auditId,
        workspaceId: wsId,
        actorType: 'user' as const,
        actorUserId: userId,
        action: 'catalog.product_updated',
        resourceType: 'product',
        resourceId: prodId,
        result: 'succeeded' as const,
        reasonCode: null,
        changes: {},
        occurredAt: parseIsoTimestamp('2026-11-06T12:00:00.000Z'),
        createdAt: parseIsoTimestamp('2026-11-06T12:00:00.000Z'),
        ipHash: null,
        userAgentSummary: null,
        correlationId: null,
      },
    };

    const updateAffiliateParams = {
      workspaceId: wsId,
      productId: prodId,
      destinationId: destId,
      expectedVersion: 1,
      updates: {
        label: 'Updated Label',
        url: 'https://example.com/aff',
        networkName: null,
        updatedAt: parseIsoTimestamp('2026-11-06T12:00:00.000Z'),
      },
      auditEvent: {
        id: auditId,
        workspaceId: wsId,
        actorType: 'user' as const,
        actorUserId: userId,
        action: 'catalog.affiliate_destination_updated',
        resourceType: 'affiliate_destination',
        resourceId: destId,
        result: 'succeeded' as const,
        reasonCode: null,
        changes: {},
        occurredAt: parseIsoTimestamp('2026-11-06T12:00:00.000Z'),
        createdAt: parseIsoTimestamp('2026-11-06T12:00:00.000Z'),
        ipHash: null,
        userAgentSummary: null,
        correlationId: null,
      },
    };

    it('product update: rejects hostile object in version column without calling hooks and sanitizes to DatabaseError', async () => {
      let hookCalls = 0;
      const hostileVersion = {
        toString() {
          hookCalls++;
          return '2';
        },
        valueOf() {
          hookCalls++;
          return 2;
        },
        [Symbol.toPrimitive]() {
          hookCalls++;
          return 2;
        },
      };

      const db = createMockDb(async (sql) => {
        if (sql.includes('pg_advisory_xact_lock')) {
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes('SELECT id FROM products WHERE workspace_id = $1')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('UPDATE products')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('SELECT version FROM products')) {
          return { rowCount: 1, rows: [{ version: hostileVersion }] };
        }
        return { rowCount: 0, rows: [] };
      });

      const adapter = new PostgresCatalogAdapter(db);
      await expect(adapter.updateProduct(updateProductParams)).rejects.toThrow(DatabaseError);
      expect(hookCalls).toBe(0);
    });

    it('product update: rejects proxy in version column with ZERO traps and sanitizes to DatabaseError', async () => {
      let getProtoCount = 0;
      let getCount = 0;
      const proxyVersion = new Proxy(
        {},
        {
          getPrototypeOf() {
            getProtoCount++;
            return Object.prototype;
          },
          get(t, prop) {
            getCount++;
            return Reflect.get(t, prop);
          },
        },
      );

      const db = createMockDb(async (sql) => {
        if (sql.includes('pg_advisory_xact_lock')) return { rowCount: 1, rows: [] };
        if (sql.includes('SELECT id FROM products WHERE workspace_id = $1'))
          return { rowCount: 0, rows: [] };
        if (sql.includes('UPDATE products')) return { rowCount: 0, rows: [] };
        if (sql.includes('SELECT version FROM products')) {
          return { rowCount: 1, rows: [{ version: proxyVersion }] };
        }
        return { rowCount: 0, rows: [] };
      });

      const adapter = new PostgresCatalogAdapter(db);
      await expect(adapter.updateProduct(updateProductParams)).rejects.toThrow(DatabaseError);
      expect(getProtoCount).toBe(0);
      expect(getCount).toBe(0);
    });

    it('product update: rejects proxy row with ZERO traps and sanitizes to DatabaseError', async () => {
      let getProtoCount = 0;
      const proxyRow = new Proxy(
        { version: 2 },
        {
          getPrototypeOf() {
            getProtoCount++;
            return Object.prototype;
          },
        },
      );

      const db = createMockDb(async (sql) => {
        if (sql.includes('pg_advisory_xact_lock')) return { rowCount: 1, rows: [] };
        if (sql.includes('SELECT id FROM products WHERE workspace_id = $1'))
          return { rowCount: 0, rows: [] };
        if (sql.includes('UPDATE products')) return { rowCount: 0, rows: [] };
        if (sql.includes('SELECT version FROM products')) {
          return { rowCount: 1, rows: [proxyRow] };
        }
        return { rowCount: 0, rows: [] };
      });

      const adapter = new PostgresCatalogAdapter(db);
      await expect(adapter.updateProduct(updateProductParams)).rejects.toThrow(DatabaseError);
      expect(getProtoCount).toBe(0);
    });

    it('product update: throws StaleVersionConflictError when version is a valid number', async () => {
      const db = createMockDb(async (sql) => {
        if (sql.includes('pg_advisory_xact_lock')) return { rowCount: 1, rows: [] };
        if (sql.includes('SELECT id FROM products WHERE workspace_id = $1'))
          return { rowCount: 0, rows: [] };
        if (sql.includes('UPDATE products')) return { rowCount: 0, rows: [] };
        if (sql.includes('SELECT version FROM products')) {
          return { rowCount: 1, rows: [{ version: 2 }] };
        }
        return { rowCount: 0, rows: [] };
      });

      const adapter = new PostgresCatalogAdapter(db);
      await expect(adapter.updateProduct(updateProductParams)).rejects.toThrow(
        StaleVersionConflictError,
      );
    });

    it('product update: throws StaleVersionConflictError when version is a canonical string integer', async () => {
      const db = createMockDb(async (sql) => {
        if (sql.includes('pg_advisory_xact_lock')) return { rowCount: 1, rows: [] };
        if (sql.includes('SELECT id FROM products WHERE workspace_id = $1'))
          return { rowCount: 0, rows: [] };
        if (sql.includes('UPDATE products')) return { rowCount: 0, rows: [] };
        if (sql.includes('SELECT version FROM products')) {
          return { rowCount: 1, rows: [{ version: '3' }] };
        }
        return { rowCount: 0, rows: [] };
      });

      const adapter = new PostgresCatalogAdapter(db);
      await expect(adapter.updateProduct(updateProductParams)).rejects.toThrow(
        StaleVersionConflictError,
      );
    });

    it('affiliate update: rejects hostile object in version column without calling hooks and sanitizes to DatabaseError', async () => {
      let hookCalls = 0;
      const hostileVersion = {
        toString() {
          hookCalls++;
          return '2';
        },
        valueOf() {
          hookCalls++;
          return 2;
        },
      };

      const db = createMockDb(async (sql) => {
        if (sql.includes('UPDATE affiliate_destinations')) return { rowCount: 0, rows: [] };
        if (sql.includes('SELECT version FROM affiliate_destinations')) {
          return { rowCount: 1, rows: [{ version: hostileVersion }] };
        }
        return { rowCount: 0, rows: [] };
      });

      const adapter = new PostgresCatalogAdapter(db);
      await expect(adapter.updateAffiliateDestination(updateAffiliateParams)).rejects.toThrow(
        DatabaseError,
      );
      expect(hookCalls).toBe(0);
    });

    it('affiliate update: rejects proxy in version column with ZERO traps and sanitizes to DatabaseError', async () => {
      let getProtoCount = 0;
      let getCount = 0;
      const proxyVersion = new Proxy(
        {},
        {
          getPrototypeOf() {
            getProtoCount++;
            return Object.prototype;
          },
          get(t, prop) {
            getCount++;
            return Reflect.get(t, prop);
          },
        },
      );

      const db = createMockDb(async (sql) => {
        if (sql.includes('UPDATE affiliate_destinations')) return { rowCount: 0, rows: [] };
        if (sql.includes('SELECT version FROM affiliate_destinations')) {
          return { rowCount: 1, rows: [{ version: proxyVersion }] };
        }
        return { rowCount: 0, rows: [] };
      });

      const adapter = new PostgresCatalogAdapter(db);
      await expect(adapter.updateAffiliateDestination(updateAffiliateParams)).rejects.toThrow(
        DatabaseError,
      );
      expect(getProtoCount).toBe(0);
      expect(getCount).toBe(0);
    });
  });
});
