import { describe, expect, it } from 'vitest';
import { DatabaseError } from '../../src/database/errors.js';
import { validateAndMapIdempotencyRow } from '../../src/tenancy/idempotency-row-mapper.js';
import { computeIdempotencyAdvisoryLockKey } from '../../src/tenancy/postgres-idempotency-adapter.js';

function makeValidRow(): Record<string, unknown> {
  return {
    id: '0192b012-3456-789a-8bcd-ef0123456701',
    workspace_id: '0192b012-3456-789a-8bcd-ef0123456702',
    principal_id: '0192b012-3456-789a-8bcd-ef0123456703',
    route_key: 'POST /api/v1/workspaces',
    key_hash: Buffer.alloc(32, 0x11),
    request_hash: Buffer.alloc(32, 0x22),
    status_code: 201,
    response_json: { id: '0192b012-3456-789a-8bcd-ef0123456702', name: 'Valid' },
    resource_type: 'workspace',
    resource_id: '0192b012-3456-789a-8bcd-ef0123456702',
    expires_at: '2026-11-03T12:00:00.000Z',
    created_at: '2026-11-02T12:00:00.000Z',
  };
}

describe('idempotency-row-mapper-adversarial.unit', () => {
  it('maps valid raw row with buffer cloning and frozen snapshot', () => {
    const raw = makeValidRow();
    const snapshot = validateAndMapIdempotencyRow(raw);
    expect(snapshot.id).toBe(raw.id);
    expect(snapshot.statusCode).toBe(201);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.responseJson)).toBe(true);

    // Modifying original buffer must not affect snapshot
    (raw.key_hash as Buffer)[0] = 0xff;
    expect(snapshot.keyHash[0]).toBe(0x11);
  });

  it('rejects proxy row, null, and non-object rows', () => {
    expect(() => validateAndMapIdempotencyRow(null)).toThrow(DatabaseError);
    expect(() => validateAndMapIdempotencyRow('not-an-object')).toThrow(DatabaseError);
    const proxyRow = new Proxy(makeValidRow(), {});
    expect(() => validateAndMapIdempotencyRow(proxyRow)).toThrow(DatabaseError);
  });

  it('rejects row with non-Object prototype or extra/missing keys', () => {
    const customProto = Object.create({ extra: 1 });
    Object.assign(customProto, makeValidRow());
    expect(() => validateAndMapIdempotencyRow(customProto)).toThrow(DatabaseError);

    const extraKeys = { ...makeValidRow(), unexpected_column: true };
    expect(() => validateAndMapIdempotencyRow(extraKeys)).toThrow(DatabaseError);

    const missingKey = makeValidRow();
    delete (missingKey as Record<string, unknown>).created_at;
    expect(() => validateAndMapIdempotencyRow(missingKey)).toThrow(DatabaseError);
  });

  it('rejects getter/setter descriptors on row properties without invoking getter', () => {
    let getterCalled = false;
    const row = makeValidRow();
    Object.defineProperty(row, 'status_code', {
      get() {
        getterCalled = true;
        return 201;
      },
      enumerable: true,
      configurable: true,
    });

    expect(() => validateAndMapIdempotencyRow(row)).toThrow(DatabaseError);
    expect(getterCalled).toBe(false);
  });

  it('rejects invalid or adversarial key_hash and request_hash', () => {
    const shortKey = { ...makeValidRow(), key_hash: Buffer.alloc(31) };
    expect(() => validateAndMapIdempotencyRow(shortKey)).toThrow(DatabaseError);

    const longReq = { ...makeValidRow(), request_hash: Buffer.alloc(33) };
    expect(() => validateAndMapIdempotencyRow(longReq)).toThrow(DatabaseError);

    const proxyHash = { ...makeValidRow(), key_hash: new Proxy(Buffer.alloc(32), {}) };
    expect(() => validateAndMapIdempotencyRow(proxyHash)).toThrow(DatabaseError);

    const stringHash = { ...makeValidRow(), request_hash: 'a'.repeat(32) };
    expect(() => validateAndMapIdempotencyRow(stringHash)).toThrow(DatabaseError);
  });

  it('validates IDs against UUIDv7 requirements', () => {
    const badId = { ...makeValidRow(), id: 'not-uuid-v7' };
    expect(() => validateAndMapIdempotencyRow(badId)).toThrow(DatabaseError);

    const badPrincipal = { ...makeValidRow(), principal_id: 'not-uuid-v7' };
    expect(() => validateAndMapIdempotencyRow(badPrincipal)).toThrow(DatabaseError);

    const badWorkspace = { ...makeValidRow(), workspace_id: 'not-uuid-v7' };
    expect(() => validateAndMapIdempotencyRow(badWorkspace)).toThrow(DatabaseError);

    const nullWorkspace = { ...makeValidRow(), workspace_id: null, resource_id: null };
    const snapshot = validateAndMapIdempotencyRow(nullWorkspace);
    expect(snapshot.workspaceId).toBeNull();
    expect(snapshot.resourceId).toBeNull();
  });

  it('validates status code, route key and resource type boundaries', () => {
    expect(() => validateAndMapIdempotencyRow({ ...makeValidRow(), status_code: 99 })).toThrow(
      DatabaseError,
    );
    expect(() => validateAndMapIdempotencyRow({ ...makeValidRow(), status_code: 600 })).toThrow(
      DatabaseError,
    );
    expect(() => validateAndMapIdempotencyRow({ ...makeValidRow(), status_code: 200.5 })).toThrow(
      DatabaseError,
    );

    expect(() => validateAndMapIdempotencyRow({ ...makeValidRow(), route_key: '' })).toThrow(
      DatabaseError,
    );
    expect(() =>
      validateAndMapIdempotencyRow({ ...makeValidRow(), route_key: '  POST /ws  ' }),
    ).toThrow(DatabaseError);
    expect(() =>
      validateAndMapIdempotencyRow({ ...makeValidRow(), route_key: 'POST /ws\n' }),
    ).toThrow(DatabaseError);

    expect(() =>
      validateAndMapIdempotencyRow({ ...makeValidRow(), resource_type: 'INVALID' }),
    ).toThrow(DatabaseError);
  });

  it('validates timestamps and strictly enforces expires_at > created_at', () => {
    const expiredRow = {
      ...makeValidRow(),
      created_at: '2026-11-02T12:00:00.000Z',
      expires_at: '2026-11-02T12:00:00.000Z',
    };
    expect(() => validateAndMapIdempotencyRow(expiredRow)).toThrow(DatabaseError);

    const earlierExpiry = {
      ...makeValidRow(),
      created_at: '2026-11-02T12:00:00.000Z',
      expires_at: '2026-11-02T11:00:00.000Z',
    };
    expect(() => validateAndMapIdempotencyRow(earlierExpiry)).toThrow(DatabaseError);
  });

  it('safely copies response_json rejecting proxies, prototype pollution, and getters', () => {
    const proxyJson = { ...makeValidRow(), response_json: new Proxy({}, {}) };
    expect(() => validateAndMapIdempotencyRow(proxyJson)).toThrow(DatabaseError);

    const pollutedJson = {
      ...makeValidRow(),
      response_json: JSON.parse('{"__proto__": {"polluted": true}}'),
    };
    expect(() => validateAndMapIdempotencyRow(pollutedJson)).toThrow(DatabaseError);

    let getterCalled = false;
    const getterJson: Record<string, unknown> = {};
    Object.defineProperty(getterJson, 'sneaky', {
      get() {
        getterCalled = true;
        return 'evil';
      },
      enumerable: true,
    });
    const withGetter = { ...makeValidRow(), response_json: getterJson };
    expect(() => validateAndMapIdempotencyRow(withGetter)).toThrow(DatabaseError);
    expect(getterCalled).toBe(false);
  });

  it('rejects array with indexed getter in response_json with zero getter calls', () => {
    let getterCalled = false;
    const hostileArray = ['first'];
    Object.defineProperty(hostileArray, '0', {
      get() {
        getterCalled = true;
        return 'evil';
      },
      enumerable: true,
      configurable: true,
    });
    const withArrayGetter = {
      ...makeValidRow(),
      response_json: { items: hostileArray },
    };
    expect(() => validateAndMapIdempotencyRow(withArrayGetter)).toThrow(DatabaseError);
    expect(getterCalled).toBe(false);
  });

  it('rejects sparse arrays and arrays with non-index properties in response_json', () => {
    const sparseArray = new Array(3);
    const withSparse = {
      ...makeValidRow(),
      response_json: { items: sparseArray },
    };
    expect(() => validateAndMapIdempotencyRow(withSparse)).toThrow(DatabaseError);

    const withExtraProp = [1, 2];
    (withExtraProp as unknown as Record<string, unknown>)['extra'] = 'bad';
    const withProp = {
      ...makeValidRow(),
      response_json: { items: withExtraProp },
    };
    expect(() => validateAndMapIdempotencyRow(withProp)).toThrow(DatabaseError);
  });

  it('computes deterministic 64-bit advisory lock key string', () => {
    const principalId = '0192b012-3456-789a-8bcd-ef0123456703';
    const routeKey = 'POST /api/v1/workspaces';
    const keyHash = Buffer.alloc(32, 0x11);

    const lockKey1 = computeIdempotencyAdvisoryLockKey(principalId, routeKey, keyHash);
    const lockKey2 = computeIdempotencyAdvisoryLockKey(principalId, routeKey, keyHash);
    expect(lockKey1).toBe(lockKey2);
    expect(typeof lockKey1).toBe('string');
    expect(() => BigInt(lockKey1)).not.toThrow();

    const diffKey = computeIdempotencyAdvisoryLockKey(
      principalId,
      routeKey,
      Buffer.alloc(32, 0x22),
    );
    expect(diffKey).not.toBe(lockKey1);
  });
});
