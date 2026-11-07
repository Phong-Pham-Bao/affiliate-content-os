import crypto from 'node:crypto';
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import {
  IdempotencyKeyReusedError,
  ProductArchivedError,
  ProductNotFoundError,
  WorkforceAnalysisNotAcceptedError,
  WorkforceFactSetNotConfirmedError,
  WorkforceStaleContextError,
  buildKickoffAtomicPayload,
  type KickoffWorkOrderAtomicParams,
} from '@affiliate-content-os/application';
import {
  parseAnalysisId,
  parseProductFactSetId,
  parseProductId,
  parseUserId,
  parseWorkspaceId,
} from '@affiliate-content-os/domain';
import { DatabaseError } from '../../src/database/errors.js';
import { executeKickoffWorkOrderTransaction } from '../../src/workforce/kickoff-work-order-transaction.js';
import type { KickoffInsertStage } from '../../src/workforce/workforce-types.js';

const WS_ID = parseWorkspaceId('018f6c5b-21a4-789a-8def-000000000001');
const PROD_ID = parseProductId('018f6c5b-21a4-789a-8def-000000000002');
const FACT_SET_ID = parseProductFactSetId('018f6c5b-21a4-789a-8def-000000000003');
const ACTOR_ID = parseUserId('018f6c5b-21a4-789a-8def-000000000004');
const ANALYSIS_ID_1 = parseAnalysisId('018f6c5b-21a4-789a-8def-000000000005');
const ANALYSIS_ID_2 = parseAnalysisId('018f6c5b-21a4-789a-8def-000000000006');

let seq = 100;
function testUuid(): string {
  const hex = (seq++).toString(16).padStart(12, '0');
  return `018f6c5b-21a4-789a-8def-${hex}`;
}

function createParams(
  overrides?: Partial<Parameters<typeof buildKickoffAtomicPayload>[0]>,
): KickoffWorkOrderAtomicParams {
  const key = `unit-key-${seq++}`;
  const keyHash = new Uint8Array(crypto.createHash('sha256').update(key).digest());
  const requestHash = new Uint8Array(crypto.createHash('sha256').update(`req-${key}`).digest());
  const routeKey = `POST /api/v1/workspaces/${WS_ID}/products/${PROD_ID}/work-orders`;

  return buildKickoffAtomicPayload({
    wsId: WS_ID,
    prodId: PROD_ID,
    factSetId: FACT_SET_ID,
    actorId: ACTOR_ID,
    missionType: 'short_video_series',
    directiveText: 'A high quality directive for testing',
    priority: 50,
    productVersion: 1,
    factSetVersion: 1,
    sourceAnalyses: [
      { id: ANALYSIS_ID_1, version: 1 },
      { id: ANALYSIS_ID_2, version: 1 },
    ],
    keyHash,
    requestHash,
    routeKey,
    generateId: testUuid,
    ...overrides,
  });
}

function createMockClient(handlers: {
  query?: (sql: string, params?: unknown[]) => Promise<{ rowCount: number; rows: unknown[] }>;
}): pg.PoolClient {
  return {
    query: handlers.query ?? (async () => ({ rowCount: 0, rows: [] })),
  } as unknown as pg.PoolClient;
}

describe('kickoff-work-order-transaction.unit', () => {
  it('reclaims expired idempotency row and proceeds to create fresh work order', async () => {
    const params = createParams();
    const executedQueries: string[] = [];

    const mockClient = createMockClient({
      query: async (sql, queryParams) => {
        executedQueries.push(sql);

        // 1. Advisory lock
        if (sql.includes('pg_advisory_xact_lock')) {
          return { rowCount: 1, rows: [{ pg_advisory_xact_lock: null }] };
        }

        // 2. Idempotency check: return an expired row
        if (sql.includes('FROM idempotency_keys') && sql.includes('FOR UPDATE')) {
          return {
            rowCount: 1,
            rows: [
              {
                id: '018f6c5b-21a4-789a-8def-000000000099',
                workspace_id: WS_ID,
                principal_id: ACTOR_ID,
                route_key: params.idempotency.routeKey,
                key_hash: Buffer.from(params.idempotency.keyHash),
                request_hash: Buffer.from(params.idempotency.requestHash),
                status_code: 201,
                response_json: {},
                resource_type: 'work_order',
                resource_id: '018f6c5b-21a4-789a-8def-000000000088',
                expires_at: '2026-11-07T00:00:00.000Z', // Expired in the past
                created_at: '2026-11-06T00:00:00.000Z',
              },
            ],
          };
        }

        // DELETE expired idempotency row
        if (sql.includes('DELETE FROM idempotency_keys')) {
          return { rowCount: 1, rows: [] };
        }

        // 3. Product check
        if (sql.includes('FROM products') && sql.includes('FOR UPDATE')) {
          return {
            rowCount: 1,
            rows: [
              {
                id: PROD_ID,
                workspace_id: WS_ID,
                status: 'active',
                current_fact_set_id: FACT_SET_ID,
                version: 1,
              },
            ],
          };
        }

        // 4. Fact set check
        if (sql.includes('FROM product_fact_sets') && sql.includes('FOR UPDATE')) {
          return {
            rowCount: 1,
            rows: [
              {
                id: FACT_SET_ID,
                workspace_id: WS_ID,
                product_id: PROD_ID,
                status: 'confirmed',
                version: 1,
              },
            ],
          };
        }

        // 5. Analyses check
        if (sql.includes('FROM analyses') && sql.includes('FOR UPDATE')) {
          return {
            rowCount: 1,
            rows: [
              {
                id: (queryParams as unknown[])?.[1],
                workspace_id: WS_ID,
                product_id: PROD_ID,
                status: 'accepted',
                version: 1,
              },
            ],
          };
        }

        // Insert queries
        if (sql.includes('INSERT INTO work_orders')) {
          return {
            rowCount: 1,
            rows: [
              {
                id: params.workOrder.id,
                workspace_id: WS_ID,
                product_id: PROD_ID,
                context_package_id: params.contextPackage.id,
                mission_type: params.workOrder.missionType,
                graph_template: 'creative_office_v1',
                graph_version: 1,
                status: 'preparing',
                priority: 50,
                created_by_user_id: ACTOR_ID,
                failure_category: null,
                completed_at: null,
                created_at: '2026-11-08T00:00:00.000Z',
                updated_at: '2026-11-08T00:00:00.000Z',
                version: 1,
              },
            ],
          };
        }

        return { rowCount: 1, rows: [] };
      },
    });

    const result = await executeKickoffWorkOrderTransaction(mockClient, params);
    expect(result.cached).toBe(false);
    expect(result.workOrder.id).toBe(params.workOrder.id);
    expect(executedQueries.some((q) => q.includes('DELETE FROM idempotency_keys'))).toBe(true);
  });

  it('replays live matching idempotency row without creating new records', async () => {
    const params = createParams();
    const existingWorkOrderId = '018f6c5b-21a4-789a-8def-000000000077';

    const mockClient = createMockClient({
      query: async (sql) => {
        if (sql.includes('pg_advisory_xact_lock')) {
          return { rowCount: 1, rows: [] };
        }

        if (sql.includes('FROM idempotency_keys') && sql.includes('FOR UPDATE')) {
          return {
            rowCount: 1,
            rows: [
              {
                id: '018f6c5b-21a4-789a-8def-000000000099',
                workspace_id: WS_ID,
                principal_id: ACTOR_ID,
                route_key: params.idempotency.routeKey,
                key_hash: Buffer.from(params.idempotency.keyHash),
                request_hash: Buffer.from(params.idempotency.requestHash),
                status_code: 201,
                response_json: {},
                resource_type: 'work_order',
                resource_id: existingWorkOrderId,
                expires_at: '2026-11-09T00:00:00.000Z', // Live
                created_at: '2026-11-08T00:00:00.000Z',
              },
            ],
          };
        }

        if (sql.includes('FROM work_orders WHERE workspace_id = $1 AND id = $2')) {
          return {
            rowCount: 1,
            rows: [
              {
                id: existingWorkOrderId,
                workspace_id: WS_ID,
                product_id: PROD_ID,
                context_package_id: '018f6c5b-21a4-789a-8def-000000000066',
                mission_type: 'short_video_series',
                graph_template: 'creative_office_v1',
                graph_version: 1,
                status: 'preparing',
                priority: 50,
                created_by_user_id: ACTOR_ID,
                failure_category: null,
                completed_at: null,
                created_at: '2026-11-08T00:00:00.000Z',
                updated_at: '2026-11-08T00:00:00.000Z',
                version: 1,
              },
            ],
          };
        }

        throw new Error(`Unexpected query in replay: ${sql}`);
      },
    });

    const result = await executeKickoffWorkOrderTransaction(mockClient, params);
    expect(result.cached).toBe(true);
    expect(result.workOrder.id).toBe(existingWorkOrderId);
  });

  it('rejects live idempotency row with different fingerprint with IdempotencyKeyReusedError', async () => {
    const params = createParams();
    const differentReqHash = Buffer.alloc(32, 99);

    const mockClient = createMockClient({
      query: async (sql) => {
        if (sql.includes('pg_advisory_xact_lock')) return { rowCount: 1, rows: [] };
        if (sql.includes('FROM idempotency_keys') && sql.includes('FOR UPDATE')) {
          return {
            rowCount: 1,
            rows: [
              {
                id: '018f6c5b-21a4-789a-8def-000000000099',
                workspace_id: WS_ID,
                principal_id: ACTOR_ID,
                route_key: params.idempotency.routeKey,
                key_hash: Buffer.from(params.idempotency.keyHash),
                request_hash: differentReqHash,
                status_code: 201,
                response_json: {},
                resource_type: 'work_order',
                resource_id: '018f6c5b-21a4-789a-8def-000000000077',
                expires_at: '2026-11-09T00:00:00.000Z',
                created_at: '2026-11-08T00:00:00.000Z',
              },
            ],
          };
        }
        return { rowCount: 0, rows: [] };
      },
    });

    await expect(executeKickoffWorkOrderTransaction(mockClient, params)).rejects.toThrow(
      IdempotencyKeyReusedError,
    );
  });

  it('fails closed when cached work order is missing in DB (sanitized DatabaseError)', async () => {
    const params = createParams();

    const mockClient = createMockClient({
      query: async (sql) => {
        if (sql.includes('pg_advisory_xact_lock')) return { rowCount: 1, rows: [] };
        if (sql.includes('FROM idempotency_keys') && sql.includes('FOR UPDATE')) {
          return {
            rowCount: 1,
            rows: [
              {
                id: '018f6c5b-21a4-789a-8def-000000000099',
                workspace_id: WS_ID,
                principal_id: ACTOR_ID,
                route_key: params.idempotency.routeKey,
                key_hash: Buffer.from(params.idempotency.keyHash),
                request_hash: Buffer.from(params.idempotency.requestHash),
                status_code: 201,
                response_json: { id: 'should_never_be_returned' },
                resource_type: 'work_order',
                resource_id: '018f6c5b-21a4-789a-8def-000000000077',
                expires_at: '2026-11-09T00:00:00.000Z',
                created_at: '2026-11-08T00:00:00.000Z',
              },
            ],
          };
        }
        if (sql.includes('FROM work_orders')) {
          return { rowCount: 0, rows: [] }; // Missing work order row!
        }
        return { rowCount: 0, rows: [] };
      },
    });

    await expect(executeKickoffWorkOrderTransaction(mockClient, params)).rejects.toThrow(
      DatabaseError,
    );
  });

  it('rejects when product is not found under locks', async () => {
    const params = createParams();
    const mockClient = createMockClient({
      query: async (sql) => {
        if (sql.includes('pg_advisory_xact_lock')) return { rowCount: 1, rows: [] };
        if (sql.includes('FROM idempotency_keys')) return { rowCount: 0, rows: [] };
        if (sql.includes('FROM products') && sql.includes('FOR UPDATE')) {
          return { rowCount: 0, rows: [] };
        }
        return { rowCount: 0, rows: [] };
      },
    });

    await expect(executeKickoffWorkOrderTransaction(mockClient, params)).rejects.toThrow(
      ProductNotFoundError,
    );
  });

  it('rejects when product is archived under locks', async () => {
    const params = createParams();
    const mockClient = createMockClient({
      query: async (sql) => {
        if (sql.includes('pg_advisory_xact_lock')) return { rowCount: 1, rows: [] };
        if (sql.includes('FROM idempotency_keys')) return { rowCount: 0, rows: [] };
        if (sql.includes('FROM products') && sql.includes('FOR UPDATE')) {
          return {
            rowCount: 1,
            rows: [
              {
                id: PROD_ID,
                workspace_id: WS_ID,
                status: 'archived',
                current_fact_set_id: FACT_SET_ID,
                version: 1,
              },
            ],
          };
        }
        return { rowCount: 0, rows: [] };
      },
    });

    await expect(executeKickoffWorkOrderTransaction(mockClient, params)).rejects.toThrow(
      ProductArchivedError,
    );
  });

  it('rejects when fact set is unconfirmed under locks', async () => {
    const params = createParams();
    const mockClient = createMockClient({
      query: async (sql) => {
        if (sql.includes('pg_advisory_xact_lock')) return { rowCount: 1, rows: [] };
        if (sql.includes('FROM idempotency_keys')) return { rowCount: 0, rows: [] };
        if (sql.includes('FROM products') && sql.includes('FOR UPDATE')) {
          return {
            rowCount: 1,
            rows: [
              {
                id: PROD_ID,
                workspace_id: WS_ID,
                status: 'active',
                current_fact_set_id: FACT_SET_ID,
                version: 1,
              },
            ],
          };
        }
        if (sql.includes('FROM product_fact_sets') && sql.includes('FOR UPDATE')) {
          return {
            rowCount: 1,
            rows: [
              {
                id: FACT_SET_ID,
                workspace_id: WS_ID,
                product_id: PROD_ID,
                status: 'draft',
                version: 1,
              },
            ],
          };
        }
        return { rowCount: 0, rows: [] };
      },
    });

    await expect(executeKickoffWorkOrderTransaction(mockClient, params)).rejects.toThrow(
      WorkforceFactSetNotConfirmedError,
    );
  });

  it('detects product version change under lock and throws WorkforceStaleContextError', async () => {
    const params = createParams({ productVersion: 1 });

    const mockClient = createMockClient({
      query: async (sql) => {
        if (sql.includes('pg_advisory_xact_lock')) return { rowCount: 1, rows: [] };
        if (sql.includes('FROM idempotency_keys')) return { rowCount: 0, rows: [] };
        if (sql.includes('FROM products') && sql.includes('FOR UPDATE')) {
          return {
            rowCount: 1,
            rows: [
              {
                id: PROD_ID,
                workspace_id: WS_ID,
                status: 'active',
                current_fact_set_id: FACT_SET_ID,
                version: 2, // Version changed concurrently!
              },
            ],
          };
        }
        return { rowCount: 0, rows: [] };
      },
    });

    await expect(executeKickoffWorkOrderTransaction(mockClient, params)).rejects.toThrow(
      WorkforceStaleContextError,
    );
  });

  it('detects fact set version change under lock and throws WorkforceStaleContextError', async () => {
    const params = createParams({ factSetVersion: 1 });

    const mockClient = createMockClient({
      query: async (sql) => {
        if (sql.includes('pg_advisory_xact_lock')) return { rowCount: 1, rows: [] };
        if (sql.includes('FROM idempotency_keys')) return { rowCount: 0, rows: [] };
        if (sql.includes('FROM products') && sql.includes('FOR UPDATE')) {
          return {
            rowCount: 1,
            rows: [
              {
                id: PROD_ID,
                workspace_id: WS_ID,
                status: 'active',
                current_fact_set_id: FACT_SET_ID,
                version: 1,
              },
            ],
          };
        }
        if (sql.includes('FROM product_fact_sets') && sql.includes('FOR UPDATE')) {
          return {
            rowCount: 1,
            rows: [
              {
                id: FACT_SET_ID,
                workspace_id: WS_ID,
                product_id: PROD_ID,
                status: 'confirmed',
                version: 3, // Concurrently updated!
              },
            ],
          };
        }
        return { rowCount: 0, rows: [] };
      },
    });

    await expect(executeKickoffWorkOrderTransaction(mockClient, params)).rejects.toThrow(
      WorkforceStaleContextError,
    );
  });

  it('detects analysis version change under lock and throws WorkforceStaleContextError', async () => {
    const params = createParams({
      sourceAnalyses: [{ id: ANALYSIS_ID_1, version: 1 }],
    });

    const mockClient = createMockClient({
      query: async (sql) => {
        if (sql.includes('pg_advisory_xact_lock')) return { rowCount: 1, rows: [] };
        if (sql.includes('FROM idempotency_keys')) return { rowCount: 0, rows: [] };
        if (sql.includes('FROM products') && sql.includes('FOR UPDATE')) {
          return {
            rowCount: 1,
            rows: [
              {
                id: PROD_ID,
                workspace_id: WS_ID,
                status: 'active',
                current_fact_set_id: FACT_SET_ID,
                version: 1,
              },
            ],
          };
        }
        if (sql.includes('FROM product_fact_sets') && sql.includes('FOR UPDATE')) {
          return {
            rowCount: 1,
            rows: [
              {
                id: FACT_SET_ID,
                workspace_id: WS_ID,
                product_id: PROD_ID,
                status: 'confirmed',
                version: 1,
              },
            ],
          };
        }
        if (sql.includes('FROM analyses') && sql.includes('FOR UPDATE')) {
          return {
            rowCount: 1,
            rows: [
              {
                id: ANALYSIS_ID_1,
                workspace_id: WS_ID,
                product_id: PROD_ID,
                status: 'accepted',
                version: 2, // Concurrently modified!
              },
            ],
          };
        }
        return { rowCount: 0, rows: [] };
      },
    });

    await expect(executeKickoffWorkOrderTransaction(mockClient, params)).rejects.toThrow(
      WorkforceStaleContextError,
    );
  });

  it('rejects cross-workspace or wrong-product analysis inside the transaction', async () => {
    const params = createParams({
      sourceAnalyses: [{ id: ANALYSIS_ID_1, version: 1 }],
    });

    // Wrong product analysis
    const mockClientWrongProduct = createMockClient({
      query: async (sql) => {
        if (sql.includes('pg_advisory_xact_lock')) return { rowCount: 1, rows: [] };
        if (sql.includes('FROM idempotency_keys')) return { rowCount: 0, rows: [] };
        if (sql.includes('FROM products') && sql.includes('FOR UPDATE')) {
          return {
            rowCount: 1,
            rows: [
              {
                id: PROD_ID,
                workspace_id: WS_ID,
                status: 'active',
                current_fact_set_id: FACT_SET_ID,
                version: 1,
              },
            ],
          };
        }
        if (sql.includes('FROM product_fact_sets') && sql.includes('FOR UPDATE')) {
          return {
            rowCount: 1,
            rows: [
              {
                id: FACT_SET_ID,
                workspace_id: WS_ID,
                product_id: PROD_ID,
                status: 'confirmed',
                version: 1,
              },
            ],
          };
        }
        if (sql.includes('FROM analyses') && sql.includes('FOR UPDATE')) {
          return {
            rowCount: 1,
            rows: [
              {
                id: ANALYSIS_ID_1,
                workspace_id: WS_ID,
                product_id: '018f6c5b-21a4-789a-8def-999999999999',
                status: 'accepted',
                version: 1,
              },
            ],
          };
        }
        return { rowCount: 0, rows: [] };
      },
    });

    await expect(
      executeKickoffWorkOrderTransaction(mockClientWrongProduct, params),
    ).rejects.toThrow(WorkforceAnalysisNotAcceptedError);
  });

  it('triggers fault injection seam after each stage', async () => {
    const params = createParams({ sourceAnalyses: [] });
    const stages: KickoffInsertStage[] = [
      'context_packages',
      'context_package_analyses',
      'work_orders',
      'work_items',
      'work_item_dependencies',
      'agent_assignments',
      'idempotency_keys',
      'audit_events',
    ];

    for (const failStage of stages) {
      const mockClient = createMockClient({
        query: async (sql) => {
          if (sql.includes('pg_advisory_xact_lock')) return { rowCount: 1, rows: [] };
          if (sql.includes('FROM idempotency_keys')) return { rowCount: 0, rows: [] };
          if (sql.includes('FROM products') && sql.includes('FOR UPDATE')) {
            return {
              rowCount: 1,
              rows: [
                {
                  id: PROD_ID,
                  workspace_id: WS_ID,
                  status: 'active',
                  current_fact_set_id: FACT_SET_ID,
                  version: 1,
                },
              ],
            };
          }
          if (sql.includes('FROM product_fact_sets') && sql.includes('FOR UPDATE')) {
            return {
              rowCount: 1,
              rows: [
                {
                  id: FACT_SET_ID,
                  workspace_id: WS_ID,
                  product_id: PROD_ID,
                  status: 'confirmed',
                  version: 1,
                },
              ],
            };
          }
          if (sql.includes('INSERT INTO work_orders')) {
            return {
              rowCount: 1,
              rows: [
                {
                  id: params.workOrder.id,
                  workspace_id: WS_ID,
                  product_id: PROD_ID,
                  context_package_id: params.contextPackage.id,
                  mission_type: params.workOrder.missionType,
                  graph_template: 'creative_office_v1',
                  graph_version: 1,
                  status: 'preparing',
                  priority: 50,
                  created_by_user_id: ACTOR_ID,
                  failure_category: null,
                  completed_at: null,
                  created_at: '2026-11-08T00:00:00.000Z',
                  updated_at: '2026-11-08T00:00:00.000Z',
                  version: 1,
                },
              ],
            };
          }
          return { rowCount: 1, rows: [] };
        },
      });

      await expect(
        executeKickoffWorkOrderTransaction(mockClient, params, {
          onAfterStage: async (stage) => {
            if (stage === failStage) {
              throw new Error(`Injected failure at ${failStage}`);
            }
          },
        }),
      ).rejects.toThrow(`Injected failure at ${failStage}`);
    }
  });
});
