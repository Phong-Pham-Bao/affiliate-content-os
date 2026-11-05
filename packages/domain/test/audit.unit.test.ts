import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  AUDIT_ACTOR_TYPES,
  AUDIT_RESULTS,
  isAuditActorType,
  isAuditResult,
  type AuditActorType,
  type AuditEventSnapshot,
  type AuditResult,
} from '../src/index.js';

describe('closed audit domain contract', () => {
  it('exports exact immutable actor and result tuples', () => {
    expect(AUDIT_ACTOR_TYPES).toEqual(['user', 'system']);
    expect(AUDIT_RESULTS).toEqual(['succeeded', 'denied', 'failed']);
  });

  it.each(['user', 'system'] as const)('recognizes actor type %s', (value) => {
    expect(isAuditActorType(value)).toBe(true);
  });

  it.each(['succeeded', 'denied', 'failed'] as const)('recognizes result %s', (value) => {
    expect(isAuditResult(value)).toBe(true);
  });

  it.each([null, undefined, 1, {}, 'owner', 'success'])(
    'rejects unknown primitive/objects %#',
    (value) => {
      expect(isAuditActorType(value)).toBe(false);
      expect(isAuditResult(value)).toBe(false);
    },
  );

  it('exposes only closed compile-time types and the immutable snapshot contract', () => {
    expectTypeOf<AuditActorType>().toEqualTypeOf<'user' | 'system'>();
    expectTypeOf<AuditResult>().toEqualTypeOf<'succeeded' | 'denied' | 'failed'>();
    expectTypeOf<AuditEventSnapshot>().toBeObject();
  });
});
