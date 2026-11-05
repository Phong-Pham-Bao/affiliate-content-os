import { describe, expect, it, vi } from 'vitest';
import { createAuditEvent, AuditEventDependencyError, AuditEventInputError } from '../src/index.js';
import { parseAuditEventId } from '@affiliate-content-os/domain';

const input = () => ({
  workspaceId: '0192b012-3456-789a-8bcd-ef0123456702',
  actorType: 'user' as const,
  actorUserId: '0192b012-3456-789a-8bcd-ef0123456703',
  action: 'workspace.created',
  resourceType: 'workspace',
  resourceId: '0192b012-3456-789a-8bcd-ef0123456702',
  result: 'succeeded' as const,
  reasonCode: null,
  changes: { status: { before: null, after: 'active' } },
  ipHash: null,
  userAgentSummary: null,
  correlationId: null,
});
const deps = () => ({
  clock: { now: vi.fn(() => new Date('2026-11-05T12:00:00.000Z')) },
  ids: {
    generateAuditEventId: vi.fn(() => parseAuditEventId('0192b012-3456-789a-8bcd-ef0123456701')),
  },
});
describe('createAuditEvent', () => {
  it('captures one clock and one id and creates immutable event', () => {
    const d = deps();
    const result = createAuditEvent(input(), d);
    expect(d.clock.now).toHaveBeenCalledOnce();
    expect(d.ids.generateAuditEventId).toHaveBeenCalledOnce();
    expect(result.createdAt).toBe('2026-11-05T12:00:00.000Z');
    expect(Object.isFrozen(result)).toBe(true);
  });
  it('rejects malformed input before dependencies', () => {
    const d = deps();
    expect(() => createAuditEvent({ ...input(), extra: true } as never, d)).toThrow(
      AuditEventInputError,
    );
    expect(d.clock.now).not.toHaveBeenCalled();
    expect(d.ids.generateAuditEventId).not.toHaveBeenCalled();
  });
  it('rejects future occurredAt before generating an id', () => {
    const d = deps();
    expect(() =>
      createAuditEvent({ ...input(), occurredAt: '2026-11-06T00:00:00.000Z' }, d),
    ).toThrow(AuditEventInputError);
    expect(d.clock.now).toHaveBeenCalledOnce();
    expect(d.ids.generateAuditEventId).not.toHaveBeenCalled();
  });
  it('maps invalid dependency output to a fixed error', () => {
    const d = deps();
    d.ids.generateAuditEventId = vi.fn(() => 'bad' as never);
    expect(() => createAuditEvent(input(), d)).toThrow(AuditEventDependencyError);
  });
  it('rejects proxies without executing traps', () => {
    const d = deps();
    let hits = 0;
    const proxy = new Proxy(input(), {
      ownKeys() {
        hits++;
        return [];
      },
    });
    expect(() => createAuditEvent(proxy, d)).toThrow(AuditEventInputError);
    expect(hits).toBe(0);
  });

  it('rejects nested changes proxies without executing traps', () => {
    const d = deps();
    let hits = 0;
    const proxy = new Proxy(input().changes.status, {
      ownKeys() {
        hits += 1;
        return [];
      },
    });
    expect(() => createAuditEvent({ ...input(), changes: { status: proxy } }, d)).toThrow(
      AuditEventInputError,
    );
    expect(hits).toBe(0);
    expect(d.clock.now).not.toHaveBeenCalled();
  });

  it.each(['clock', 'ids'] as const)(
    'maps dependency-thrown input errors from %s to fresh dependency errors',
    (dependency) => {
      const d = deps();
      if (dependency === 'clock')
        d.clock.now = vi.fn(() => {
          throw new AuditEventInputError();
        });
      else
        d.ids.generateAuditEventId = vi.fn(() => {
          throw new AuditEventInputError();
        });
      const errors = [0, 1].map(() => {
        try {
          createAuditEvent(input(), d);
        } catch (error) {
          return error;
        }
        throw new Error('expected failure');
      });
      expect(errors[0]).toBeInstanceOf(AuditEventDependencyError);
      expect(errors[1]).toBeInstanceOf(AuditEventDependencyError);
      expect(errors[0]).not.toBe(errors[1]);
      expect(Object.prototype.hasOwnProperty.call(errors[0], 'cause')).toBe(false);
    },
  );

  it('rejects proxy and accessor dependencies without executing traps or getters', () => {
    let hits = 0;
    const clockProxy = new Proxy(
      { now: () => new Date() },
      {
        get() {
          hits += 1;
          return undefined;
        },
        ownKeys() {
          hits += 1;
          return [];
        },
        getOwnPropertyDescriptor() {
          hits += 1;
          return undefined;
        },
        getPrototypeOf() {
          hits += 1;
          return null;
        },
      },
    );
    expect(() => createAuditEvent(input(), { clock: clockProxy, ids: deps().ids })).toThrow(
      AuditEventDependencyError,
    );
    expect(hits).toBe(0);

    let getterHits = 0;
    const malformed = { ids: deps().ids } as Record<string, unknown>;
    Object.defineProperty(malformed, 'clock', {
      enumerable: true,
      get() {
        getterHits += 1;
        return deps().clock;
      },
    });
    expect(() => createAuditEvent(input(), malformed as never)).toThrow(AuditEventDependencyError);
    expect(getterHits).toBe(0);
  });
});
