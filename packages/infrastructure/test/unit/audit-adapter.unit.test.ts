import { describe, expect, it, vi } from 'vitest';
import { captureAuditEventSnapshot } from '@affiliate-content-os/application';
import { DatabaseError } from '../../src/database/errors.js';
import {
  createPostgresAuditAdapter,
  createTransactionScopedPostgresAuditAdapter,
} from '../../src/audit/index.js';

const event = captureAuditEventSnapshot({
  id: '0192b012-3456-789a-8bcd-ef0123456701',
  workspaceId: '0192b012-3456-789a-8bcd-ef0123456702',
  actorType: 'system',
  actorUserId: null,
  action: 'workspace.created',
  resourceType: 'workspace',
  resourceId: '0192b012-3456-789a-8bcd-ef0123456702',
  result: 'succeeded',
  reasonCode: null,
  changes: {},
  ipHash: null,
  userAgentSummary: null,
  correlationId: null,
  occurredAt: '2026-11-05T12:00:00.000Z',
  createdAt: '2026-11-05T12:00:00.000Z',
});
describe('PostgresAuditAdapter', () => {
  it('uses exactly one parameterized insert', async () => {
    const query = vi.fn(async () => ({ rows: [], rowCount: 1, command: 'INSERT' }));
    const adapter = createPostgresAuditAdapter({ query } as never);
    await adapter.appendAuditEvent(event);
    expect(query).toHaveBeenCalledOnce();
    const firstCall = query.mock.calls[0] as unknown as [string, readonly unknown[]];
    expect(firstCall[1]).toHaveLength(15);
  });
  it('fails closed on unexpected row count', async () => {
    const query = vi.fn(async () => ({ rows: [], rowCount: 0, command: 'INSERT' }));
    await expect(
      createPostgresAuditAdapter({ query } as never).appendAuditEvent(event),
    ).rejects.toBeInstanceOf(DatabaseError);
  });

  it('uses the same narrow insert contract for transaction-scoped adapters', async () => {
    const query = vi.fn(async () => ({ rows: [], rowCount: 1, command: 'INSERT' }));
    await createTransactionScopedPostgresAuditAdapter({ query } as never).appendAuditEvent(event);
    expect(query).toHaveBeenCalledOnce();
  });

  it.each([
    ['extra key', { rows: [], rowCount: 1, command: 'INSERT', extra: true }],
    ['wrong command', { rows: [], rowCount: 1, command: 'UPDATE' }],
    ['nonempty rows', { rows: [{}], rowCount: 1, command: 'INSERT' }],
    [
      'class result',
      Object.assign(new (class Result {})(), { rows: [], rowCount: 1, command: 'INSERT' }),
    ],
  ])('rejects malformed result: %s', async (_name, result) => {
    const query = vi.fn(async () => result as never);
    await expect(
      createPostgresAuditAdapter({ query } as never).appendAuditEvent(event),
    ).rejects.toBeInstanceOf(DatabaseError);
  });

  it('rejects proxy results and rows without executing traps', async () => {
    for (const target of ['result', 'rows'] as const) {
      let hits = 0;
      const handler: ProxyHandler<object> = {
        ownKeys() {
          hits += 1;
          return [];
        },
        getPrototypeOf() {
          hits += 1;
          return null;
        },
        getOwnPropertyDescriptor() {
          hits += 1;
          return undefined;
        },
        get(_target, property) {
          if (property === 'then') return undefined;
          hits += 1;
          return undefined;
        },
      };
      const result =
        target === 'result'
          ? new Proxy({ rows: [], rowCount: 1, command: 'INSERT' }, handler)
          : { rows: new Proxy([], handler), rowCount: 1, command: 'INSERT' };
      const query = vi.fn(async () => result as never);
      await expect(
        createPostgresAuditAdapter({ query } as never).appendAuditEvent(event),
      ).rejects.toBeInstanceOf(DatabaseError);
      expect(hits).toBe(0);
    }
  });

  it('rejects accessor, symbol, and non-enumerable result properties without invoking getters', async () => {
    let getterHits = 0;
    const accessor = { rows: [], rowCount: 1 } as Record<PropertyKey, unknown>;
    Object.defineProperty(accessor, 'command', {
      enumerable: true,
      get() {
        getterHits += 1;
        return 'INSERT';
      },
    });
    const symbol = { rows: [], rowCount: 1, command: 'INSERT', [Symbol('x')]: true };
    const hidden = { rows: [], command: 'INSERT' } as Record<string, unknown>;
    Object.defineProperty(hidden, 'rowCount', { enumerable: false, value: 1 });
    for (const result of [accessor, symbol, hidden]) {
      const query = vi.fn(async () => result as never);
      await expect(
        createPostgresAuditAdapter({ query } as never).appendAuditEvent(event),
      ).rejects.toBeInstanceOf(DatabaseError);
    }
    expect(getterHits).toBe(0);
  });

  it('sanitizes persistence failures without retaining sentinels', async () => {
    const original = new Error('password=sentinel-secret');
    const query = vi.fn(async () => {
      throw original;
    });
    const error = await createPostgresAuditAdapter({ query } as never)
      .appendAuditEvent(event)
      .catch((value: unknown) => value);
    expect(error).toBeInstanceOf(DatabaseError);
    expect(String(error)).not.toContain('sentinel-secret');
    expect(Object.prototype.hasOwnProperty.call(error, 'cause')).toBe(false);
    expect(error).not.toBe(original);
  });
});
