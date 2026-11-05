import util from 'node:util';
import {
  isAuditActorType,
  isAuditResult,
  parseAuditEventId,
  parseCorrelationId,
  parseIsoTimestamp,
  parseUserId,
  parseWorkspaceId,
  type AuditEventSnapshot,
  type AuditScalarChange,
  type AuditScalarValue,
} from '@affiliate-content-os/domain';
import { AuditEventInputError } from '../errors.js';

const TOKEN = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/;
// Intentional security validation: audit text must not contain C0/C1 controls.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
const FORBIDDEN = new Set([
  'token',
  'secret',
  'password',
  'credential',
  'authorization',
  'cookie',
  'session',
  'body',
  'content',
  'prompt',
  'output',
  'email',
  'url',
  'ip',
]);
const SNAPSHOT_KEYS = [
  'id',
  'workspaceId',
  'actorType',
  'actorUserId',
  'action',
  'resourceType',
  'resourceId',
  'result',
  'reasonCode',
  'changes',
  'ipHash',
  'userAgentSummary',
  'correlationId',
  'occurredAt',
  'createdAt',
] as const;

function fail(): never {
  throw new AuditEventInputError();
}
function token(value: unknown): string {
  if (typeof value !== 'string' || value.length > 128 || !TOKEN.test(value)) fail();
  return value;
}
function descriptor(object: object, key: string): unknown {
  const value = Object.getOwnPropertyDescriptor(object, key);
  if (!value || !value.enumerable || value.get !== undefined || value.set !== undefined) fail();
  return value.value;
}
function exactObject(value: unknown, keys: readonly string[]): object {
  if (typeof value !== 'object' || value === null || util.types.isProxy(value)) fail();
  if (Array.isArray(value)) fail();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail();
  const actual = Reflect.ownKeys(value);
  if (
    actual.some((key) => typeof key !== 'string') ||
    actual.length !== keys.length ||
    keys.some((key) => !actual.includes(key))
  )
    fail();
  return value;
}
function scalar(value: unknown): AuditScalarValue {
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) fail();
    return value;
  }
  if (typeof value === 'string' && [...value].length <= 256 && !CONTROL.test(value)) return value;
  return fail();
}
function copyChanges(raw: unknown): Readonly<Record<string, AuditScalarChange>> {
  if (typeof raw !== 'object' || raw === null || util.types.isProxy(raw)) fail();
  if (Array.isArray(raw)) fail();
  const prototype = Object.getPrototypeOf(raw);
  if (prototype !== Object.prototype && prototype !== null) fail();
  const keys = Reflect.ownKeys(raw);
  if (keys.length > 32 || keys.some((key) => typeof key !== 'string')) fail();
  const output = Object.create(null) as Record<string, AuditScalarChange>;
  for (const rawKey of keys) {
    const key = rawKey as string;
    token(key);
    if (key.split(/[._]/).some((part) => FORBIDDEN.has(part))) fail();
    const change = exactObject(descriptor(raw, key), ['before', 'after']);
    const before = scalar(descriptor(change, 'before'));
    const after = scalar(descriptor(change, 'after'));
    if (Object.is(before, after)) fail();
    output[key] = Object.freeze({ before, after });
  }
  return Object.freeze(output);
}

export function captureAuditEventSnapshot(raw: unknown): AuditEventSnapshot {
  try {
    const input = exactObject(raw, SNAPSHOT_KEYS);
    const actorType = descriptor(input, 'actorType');
    if (!isAuditActorType(actorType)) fail();
    const actorRaw = descriptor(input, 'actorUserId');
    const actorUserId =
      actorType === 'user' ? parseUserId(actorRaw) : actorRaw === null ? null : fail();
    const result = descriptor(input, 'result');
    if (!isAuditResult(result)) fail();
    const reasonRaw = descriptor(input, 'reasonCode');
    const reasonCode = reasonRaw === null ? null : token(reasonRaw);
    const ipRaw = descriptor(input, 'ipHash');
    if (ipRaw !== null && (typeof ipRaw !== 'string' || !/^[0-9a-f]{64}$/.test(ipRaw))) fail();
    const uaRaw = descriptor(input, 'userAgentSummary');
    if (
      uaRaw !== null &&
      (typeof uaRaw !== 'string' ||
        uaRaw !== uaRaw.trim() ||
        [...uaRaw].length < 1 ||
        [...uaRaw].length > 128 ||
        CONTROL.test(uaRaw))
    )
      fail();
    const occurredAt = parseIsoTimestamp(descriptor(input, 'occurredAt'));
    const createdAt = parseIsoTimestamp(descriptor(input, 'createdAt'));
    if (createdAt < occurredAt) fail();
    return Object.freeze({
      id: parseAuditEventId(descriptor(input, 'id')),
      workspaceId: parseWorkspaceId(descriptor(input, 'workspaceId')),
      actorType,
      actorUserId,
      action: token(descriptor(input, 'action')),
      resourceType: token(descriptor(input, 'resourceType')),
      resourceId: parseAuditEventId(descriptor(input, 'resourceId')),
      result,
      reasonCode,
      changes: copyChanges(descriptor(input, 'changes')),
      ipHash: ipRaw as string | null,
      userAgentSummary: uaRaw as string | null,
      correlationId:
        descriptor(input, 'correlationId') === null
          ? null
          : parseCorrelationId(descriptor(input, 'correlationId')),
      occurredAt,
      createdAt,
    });
  } catch (error) {
    if (error instanceof AuditEventInputError) throw error;
    throw new AuditEventInputError();
  }
}
