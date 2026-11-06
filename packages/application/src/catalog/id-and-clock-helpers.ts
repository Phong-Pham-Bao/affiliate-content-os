import {
  parseAffiliateDestinationId,
  parseAuditEventId,
  parseIdempotencyKeyId,
  parseProductFactId,
  parseProductFactSetId,
  parseProductId,
  type AffiliateDestinationId,
  type AuditEventId,
  type IdempotencyKeyId,
  type ProductFactId,
  type ProductFactSetId,
  type ProductId,
} from '@affiliate-content-os/domain';
import { ValidationError } from '../errors.js';
import { generateUuidV7 } from '../id-generator.js';
import type { ClockPort, IdGeneratorPort } from '../ports.js';
import { isProxy } from './snapshot-property-extractors.js';

export function getValidClockDate(clock: ClockPort): Date {
  let date: unknown;
  try {
    date = clock.now();
  } catch {
    throw new ValidationError('Clock failed to produce a valid time', 'clock');
  }

  if (typeof date !== 'object' || date === null || isProxy(date)) {
    throw new ValidationError('Clock must return a valid Date object', 'clock');
  }

  if (Object.getPrototypeOf(date) !== Date.prototype) {
    throw new ValidationError('Clock must return a valid Date object', 'clock');
  }

  if (Reflect.ownKeys(date).length > 0) {
    throw new ValidationError('Clock must return a valid Date object', 'clock');
  }

  let time: number;
  try {
    time = Date.prototype.getTime.call(date);
  } catch {
    throw new ValidationError('Clock must return a valid Date object', 'clock');
  }

  if (Number.isNaN(time)) {
    throw new ValidationError('Clock must return a valid Date object', 'clock');
  }

  return new Date(time);
}

export function resolveProductId(idGenerator: IdGeneratorPort): ProductId {
  if (typeof idGenerator.generateProductId === 'function') {
    const id = idGenerator.generateProductId();
    return parseProductId(id);
  }
  return parseProductId(generateUuidV7());
}

export function resolveProductFactSetId(idGenerator: IdGeneratorPort): ProductFactSetId {
  if (typeof idGenerator.generateProductFactSetId === 'function') {
    const id = idGenerator.generateProductFactSetId();
    return parseProductFactSetId(id);
  }
  return parseProductFactSetId(generateUuidV7());
}

export function resolveProductFactId(idGenerator: IdGeneratorPort): ProductFactId {
  if (typeof idGenerator.generateProductFactId === 'function') {
    const id = idGenerator.generateProductFactId();
    return parseProductFactId(id);
  }
  return parseProductFactId(generateUuidV7());
}

export function resolveAffiliateDestinationId(
  idGenerator: IdGeneratorPort,
): AffiliateDestinationId {
  if (typeof idGenerator.generateAffiliateDestinationId === 'function') {
    const id = idGenerator.generateAffiliateDestinationId();
    return parseAffiliateDestinationId(id);
  }
  return parseAffiliateDestinationId(generateUuidV7());
}

export function resolveAuditEventId(idGenerator: IdGeneratorPort): AuditEventId {
  if (typeof idGenerator.generateAuditEventId === 'function') {
    const id = idGenerator.generateAuditEventId();
    return parseAuditEventId(id);
  }
  return parseAuditEventId(generateUuidV7());
}

export function resolveIdempotencyKeyId(idGenerator: IdGeneratorPort): IdempotencyKeyId {
  if (typeof idGenerator.generateIdempotencyKeyId === 'function') {
    const id = idGenerator.generateIdempotencyKeyId();
    return parseIdempotencyKeyId(id);
  }
  return parseIdempotencyKeyId(generateUuidV7());
}
