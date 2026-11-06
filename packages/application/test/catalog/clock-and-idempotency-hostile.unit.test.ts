import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../src/errors.js';
import { getValidClockDate } from '../../src/catalog/id-and-clock-helpers.js';
import { snapshotIdempotencyInput } from '../../src/catalog/snapshot-utils.js';

describe('Clock and Idempotency Input - Hostile Proxy & Getter Defenses', () => {
  describe('Clock validation (getValidClockDate)', () => {
    it('returns a fresh valid Date clone when clock produces a standard Date', () => {
      const now = new Date('2026-11-06T12:00:00.000Z');
      const clock = { now: () => now };
      const result = getValidClockDate(clock);
      expect(result).not.toBe(now);
      expect(result.getTime()).toBe(now.getTime());
      expect(result.toISOString()).toBe('2026-11-06T12:00:00.000Z');
    });

    it('proves mutating original Date after getValidClockDate returns does not change returned Date or epoch', () => {
      const original = new Date('2026-11-06T12:00:00.000Z');
      const initialEpoch = original.getTime();
      const clock = { now: () => original };

      const returned = getValidClockDate(clock);

      expect(returned).not.toBe(original);
      expect(returned.getTime()).toBe(initialEpoch);

      // Mutate original Date after getValidClockDate returned
      original.setTime(initialEpoch + 100_000);

      expect(returned.getTime()).toBe(initialEpoch);
      expect(returned.toISOString()).toBe('2026-11-06T12:00:00.000Z');
      expect(returned.getTime()).not.toBe(original.getTime());
    });

    it('rejects a Proxy(Date) and executes ZERO get/getPrototypeOf traps', () => {
      let getProtoCount = 0;
      let getCount = 0;
      const target = new Date();
      const proxyDate = new Proxy(target, {
        getPrototypeOf() {
          getProtoCount++;
          return Date.prototype;
        },
        get(t, prop) {
          getCount++;
          return Reflect.get(t, prop);
        },
      });

      const clock = { now: () => proxyDate };
      expect(() => getValidClockDate(clock)).toThrow(ValidationError);
      expect(getProtoCount).toBe(0);
      expect(getCount).toBe(0);
    });

    it('rejects an overridden own getTime function without calling it', () => {
      let getTimeCallCount = 0;
      const hostileDate = new Date();
      hostileDate.getTime = () => {
        getTimeCallCount++;
        return 123456789;
      };

      const clock = { now: () => hostileDate };
      expect(() => getValidClockDate(clock)).toThrow(ValidationError);
      expect(getTimeCallCount).toBe(0);
    });

    it('rejects an overridden own getTime getter accessor without invoking it', () => {
      let getterCallCount = 0;
      const hostileDate = new Date();
      Object.defineProperty(hostileDate, 'getTime', {
        get() {
          getterCallCount++;
          return () => 123456789;
        },
      });

      const clock = { now: () => hostileDate };
      expect(() => getValidClockDate(clock)).toThrow(ValidationError);
      expect(getterCallCount).toBe(0);
    });

    it('rejects an object with custom own properties without invoking getters', () => {
      let ownGetterCount = 0;
      const hostileDate = new Date();
      Object.defineProperty(hostileDate, 'customProp', {
        get() {
          ownGetterCount++;
          return 'malicious';
        },
      });

      const clock = { now: () => hostileDate };
      expect(() => getValidClockDate(clock)).toThrow(ValidationError);
      expect(ownGetterCount).toBe(0);
    });

    it('rejects a Date subclass instance with custom prototype', () => {
      class SubDate extends Date {}
      const clock = { now: () => new SubDate() };
      expect(() => getValidClockDate(clock)).toThrow(ValidationError);
    });

    it('rejects an exotic prototype created with Object.create(Date.prototype)', () => {
      const clock = { now: () => Object.create(Date.prototype) };
      expect(() => getValidClockDate(clock)).toThrow(ValidationError);
    });

    it('rejects an invalid Date with NaN time', () => {
      const clock = { now: () => new Date('not-a-valid-date-string') };
      expect(() => getValidClockDate(clock)).toThrow(ValidationError);
    });

    it('rejects null, non-objects, and primitives', () => {
      expect(() => getValidClockDate({ now: () => null as unknown as Date })).toThrow(
        ValidationError,
      );
      expect(() => getValidClockDate({ now: () => '2026-11-06' as unknown as Date })).toThrow(
        ValidationError,
      );
      expect(() => getValidClockDate({ now: () => 123456789 as unknown as Date })).toThrow(
        ValidationError,
      );
    });

    it('rejects when clock.now() throws an error', () => {
      const clock = {
        now: () => {
          throw new Error('Hardware failure');
        },
      };
      expect(() => getValidClockDate(clock)).toThrow(ValidationError);
    });
  });

  describe('Idempotency input validation (snapshotIdempotencyInput)', () => {
    const validKeyHash = new Uint8Array(32).fill(0x11);
    const validReqHash = new Uint8Array(32).fill(0x22);

    it('successfully validates and freezes pure Uint8Array hashes', () => {
      const result = snapshotIdempotencyInput({
        keyHash: validKeyHash,
        requestHash: validReqHash,
      });

      expect(result).toBeDefined();
      expect(result?.keyHash).toEqual(validKeyHash);
      expect(result?.requestHash).toEqual(validReqHash);
      expect(Object.isFrozen(result)).toBe(true);
      // Ensures defensive copy
      expect(result?.keyHash).not.toBe(validKeyHash);
      expect(result?.requestHash).not.toBe(validReqHash);
    });

    it('successfully validates and converts Buffer hashes', () => {
      const bufKey = Buffer.alloc(32, 0x33);
      const bufReq = Buffer.alloc(32, 0x44);

      const result = snapshotIdempotencyInput({
        keyHash: bufKey,
        requestHash: bufReq,
      });

      expect(result).toBeDefined();
      expect(result?.keyHash).toEqual(new Uint8Array(bufKey));
      expect(result?.requestHash).toEqual(new Uint8Array(bufReq));
    });

    it('rejects keyHash as Proxy(Uint8Array) with ZERO get/getPrototypeOf traps', () => {
      let getProtoCount = 0;
      let getCount = 0;
      const target = new Uint8Array(32);
      const proxyKeyHash = new Proxy(target, {
        getPrototypeOf() {
          getProtoCount++;
          return Uint8Array.prototype;
        },
        get(t, prop) {
          getCount++;
          return Reflect.get(t, prop);
        },
      });

      expect(() =>
        snapshotIdempotencyInput({
          keyHash: proxyKeyHash,
          requestHash: validReqHash,
        }),
      ).toThrow(ValidationError);

      expect(getProtoCount).toBe(0);
      expect(getCount).toBe(0);
    });

    it('rejects keyHash as Proxy(Buffer) with ZERO get/getPrototypeOf traps', () => {
      let getProtoCount = 0;
      let getCount = 0;
      const target = Buffer.alloc(32);
      const proxyKeyHash = new Proxy(target, {
        getPrototypeOf() {
          getProtoCount++;
          return Buffer.prototype;
        },
        get(t, prop) {
          getCount++;
          return Reflect.get(t, prop);
        },
      });

      expect(() =>
        snapshotIdempotencyInput({
          keyHash: proxyKeyHash,
          requestHash: validReqHash,
        }),
      ).toThrow(ValidationError);

      expect(getProtoCount).toBe(0);
      expect(getCount).toBe(0);
    });

    it('rejects requestHash as Proxy(Uint8Array) with ZERO get/getPrototypeOf traps', () => {
      let getProtoCount = 0;
      let getCount = 0;
      const target = new Uint8Array(32);
      const proxyReqHash = new Proxy(target, {
        getPrototypeOf() {
          getProtoCount++;
          return Uint8Array.prototype;
        },
        get(t, prop) {
          getCount++;
          return Reflect.get(t, prop);
        },
      });

      expect(() =>
        snapshotIdempotencyInput({
          keyHash: validKeyHash,
          requestHash: proxyReqHash,
        }),
      ).toThrow(ValidationError);

      expect(getProtoCount).toBe(0);
      expect(getCount).toBe(0);
    });

    it('rejects requestHash as Proxy(Buffer) with ZERO get/getPrototypeOf traps', () => {
      let getProtoCount = 0;
      let getCount = 0;
      const target = Buffer.alloc(32);
      const proxyReqHash = new Proxy(target, {
        getPrototypeOf() {
          getProtoCount++;
          return Buffer.prototype;
        },
        get(t, prop) {
          getCount++;
          return Reflect.get(t, prop);
        },
      });

      expect(() =>
        snapshotIdempotencyInput({
          keyHash: validKeyHash,
          requestHash: proxyReqHash,
        }),
      ).toThrow(ValidationError);

      expect(getProtoCount).toBe(0);
      expect(getCount).toBe(0);
    });

    it('rejects binary buffer with own overridden byteLength without reading it', () => {
      let getterCalled = false;
      const hostileKey = new Uint8Array(32);
      Object.defineProperty(hostileKey, 'byteLength', {
        get() {
          getterCalled = true;
          return 32;
        },
      });

      expect(() =>
        snapshotIdempotencyInput({
          keyHash: hostileKey,
          requestHash: validReqHash,
        }),
      ).toThrow(ValidationError);

      expect(getterCalled).toBe(false);
    });

    it('rejects buffer with custom subclass prototype', () => {
      class SubBuffer extends Uint8Array {}
      const hostileKey = new SubBuffer(32);

      expect(() =>
        snapshotIdempotencyInput({
          keyHash: hostileKey,
          requestHash: validReqHash,
        }),
      ).toThrow(ValidationError);
    });

    it('rejects buffers of length other than 32', () => {
      expect(() =>
        snapshotIdempotencyInput({
          keyHash: new Uint8Array(16),
          requestHash: validReqHash,
        }),
      ).toThrow(ValidationError);

      expect(() =>
        snapshotIdempotencyInput({
          keyHash: validKeyHash,
          requestHash: new Uint8Array(64),
        }),
      ).toThrow(ValidationError);
    });

    it('rejects when the idempotency container itself is a Proxy', () => {
      let getProtoCount = 0;
      const proxyContainer = new Proxy(
        {
          keyHash: validKeyHash,
          requestHash: validReqHash,
        },
        {
          getPrototypeOf() {
            getProtoCount++;
            return Object.prototype;
          },
        },
      );

      expect(() => snapshotIdempotencyInput(proxyContainer)).toThrow(ValidationError);
      expect(getProtoCount).toBe(0);
    });
  });
});
