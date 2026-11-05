import { describe, expect, expectTypeOf, it } from 'vitest';
import { AuditEventInputError, captureAuditEventSnapshot } from '../src/index.js';

const base = () => ({
  id: '0192b012-3456-789a-8bcd-ef0123456701',
  workspaceId: '0192b012-3456-789a-8bcd-ef0123456702',
  actorType: 'user',
  actorUserId: '0192b012-3456-789a-8bcd-ef0123456703',
  action: 'workspace.created',
  resourceType: 'workspace',
  resourceId: '0192b012-3456-789a-8bcd-ef0123456702',
  result: 'succeeded',
  reasonCode: null,
  changes: { status: { before: null, after: 'active' } },
  ipHash: null,
  userAgentSummary: 'web',
  correlationId: null,
  occurredAt: '2026-11-05T12:00:00.000Z',
  createdAt: '2026-11-05T12:00:00.000Z',
});

describe('captureAuditEventSnapshot', () => {
  it('has one fixed runtime-input parameter and returns a fresh deeply frozen snapshot', () => {
    expectTypeOf(captureAuditEventSnapshot).parameters.toEqualTypeOf<[unknown]>();
    const input = base();
    const result = captureAuditEventSnapshot(input);
    expect(result).not.toBe(input);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.changes)).toBe(true);
    expect(Object.isFrozen(result.changes.status)).toBe(true);
  });

  it.each([
    { actorType: 'system', actorUserId: '0192b012-3456-789a-8bcd-ef0123456703' },
    { action: 'Workspace.Created' },
    { resourceId: 'not-a-uuid' },
    { ipHash: '127.0.0.1' },
    { changes: { access_token: { before: null, after: 'x' } } },
    { changes: { status: { before: 'x', after: 'x' } } },
  ])('fails closed for invalid contract %#', (patch) => {
    expect(() => captureAuditEventSnapshot({ ...base(), ...patch })).toThrow(AuditEventInputError);
  });

  it.each(['root', 'changes', 'change'] as const)(
    'rejects %s proxies without executing traps',
    (location) => {
      let hits = 0;
      const handler: ProxyHandler<object> = {
        ownKeys() {
          hits += 1;
          return [];
        },
        getPrototypeOf() {
          hits += 1;
          return Object.prototype;
        },
        getOwnPropertyDescriptor() {
          hits += 1;
          return undefined;
        },
        get() {
          hits += 1;
          return undefined;
        },
      };
      const raw = base();
      let value: unknown = raw;
      if (location === 'root') value = new Proxy(raw, handler);
      if (location === 'changes') value = { ...raw, changes: new Proxy(raw.changes, handler) };
      if (location === 'change')
        value = { ...raw, changes: { status: new Proxy(raw.changes.status, handler) } };
      expect(() => captureAuditEventSnapshot(value)).toThrow(AuditEventInputError);
      expect(hits).toBe(0);
    },
  );

  it('rejects revoked proxies and cannot be bypassed by a caller-supplied detector argument', () => {
    let hits = 0;
    const { proxy, revoke } = Proxy.revocable(base(), {
      ownKeys() {
        hits += 1;
        return [];
      },
    });
    revoke();
    expect(() => captureAuditEventSnapshot(proxy)).toThrow(AuditEventInputError);
    expect(hits).toBe(0);

    const bypass = new Proxy(base(), {
      ownKeys() {
        hits += 1;
        return [];
      },
    });
    expect(() =>
      (captureAuditEventSnapshot as (...args: unknown[]) => unknown)(bypass, () => false),
    ).toThrow(AuditEventInputError);
    expect(hits).toBe(0);
  });

  it('rejects accessors, symbols, non-enumerable, classes, and inherited objects without hooks', () => {
    let getterHits = 0;
    const accessor = base();
    Object.defineProperty(accessor, 'action', {
      enumerable: true,
      get() {
        getterHits += 1;
        return 'workspace.created';
      },
    });
    expect(() => captureAuditEventSnapshot(accessor)).toThrow(AuditEventInputError);
    expect(getterHits).toBe(0);
    const symbol = base() as Record<PropertyKey, unknown>;
    symbol[Symbol('x')] = true;
    expect(() => captureAuditEventSnapshot(symbol)).toThrow(AuditEventInputError);
    const hidden = base();
    Object.defineProperty(hidden, 'action', { value: 'workspace.created', enumerable: false });
    expect(() => captureAuditEventSnapshot(hidden)).toThrow(AuditEventInputError);
    class EventInput {
      public id = base().id;
    }
    expect(() => captureAuditEventSnapshot(Object.assign(new EventInput(), base()))).toThrow(
      AuditEventInputError,
    );
    expect(() => captureAuditEventSnapshot(Object.create(base()))).toThrow(AuditEventInputError);
  });
});
