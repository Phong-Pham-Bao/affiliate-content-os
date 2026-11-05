import util from 'node:util';
import { isValidIsoTimestamp, type IsoTimestamp } from '@affiliate-content-os/domain';

function isProxySafe(value: unknown): boolean {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) {
    return false;
  }
  try {
    return util.types.isProxy(value);
  } catch {
    return true;
  }
}

export interface SafeClockSnapshot {
  readonly date: Date;
  readonly epochMs: number;
  readonly iso: IsoTimestamp;
}

export function snapshotSafeClock(nowFn: () => Date): SafeClockSnapshot {
  let raw: unknown;
  try {
    raw = nowFn();
  } catch {
    throw new Error('Safe clock invocation failed');
  }

  if (typeof raw !== 'object' || raw === null || isProxySafe(raw)) {
    throw new Error('Safe clock rejected non-object or proxy value');
  }
  if (Object.getPrototypeOf(raw) !== Date.prototype) {
    throw new Error('Safe clock rejected non-Date prototype');
  }
  if (Reflect.ownKeys(raw).length !== 0) {
    throw new Error('Safe clock rejected Date instance with own keys');
  }

  const epoch = Date.prototype.getTime.call(raw);
  if (typeof epoch !== 'number' || !Number.isFinite(epoch)) {
    throw new Error('Safe clock rejected non-finite epoch value');
  }

  const freshDate = new Date(epoch);
  const isoString = Date.prototype.toISOString.call(freshDate);
  if (!isValidIsoTimestamp(isoString)) {
    throw new Error('Safe clock derived invalid ISO timestamp');
  }

  return {
    date: freshDate,
    epochMs: epoch,
    iso: isoString,
  };
}
