import util from 'node:util';
import {
  type AuditActorType,
  type AuditEventSnapshot,
  type AuditResult,
  type AuditScalarChange,
} from '@affiliate-content-os/domain';
import { AuditEventDependencyError, AuditEventInputError } from '../errors.js';
import type { AuditIdGeneratorPort, ClockPort } from '../ports.js';
import { captureAuditEventSnapshot } from './capture-audit-event-snapshot.js';

export interface CreateAuditEventInput {
  readonly workspaceId: string;
  readonly actorType: AuditActorType;
  readonly actorUserId: string | null;
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId: string;
  readonly result: AuditResult;
  readonly reasonCode: string | null;
  readonly changes: Readonly<Record<string, AuditScalarChange>>;
  readonly ipHash: string | null;
  readonly userAgentSummary: string | null;
  readonly correlationId: string | null;
  readonly occurredAt?: string;
}
const REQUIRED = [
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
] as const;
const FIXED_ID = '01890f47-e6b0-7cc5-9a22-123456789abc';
const FIXED_TIME = '2024-01-01T00:00:00.000Z';
type DependencyMethod = (...args: never[]) => unknown;

function captureInput(input: unknown): Record<string, unknown> {
  if (
    typeof input !== 'object' ||
    input === null ||
    util.types.isProxy(input) ||
    Array.isArray(input)
  )
    throw new AuditEventInputError();
  let proto: object | null;
  let keys: (string | symbol)[];
  try {
    proto = Object.getPrototypeOf(input);
    keys = Reflect.ownKeys(input);
  } catch {
    throw new AuditEventInputError();
  }
  if (proto !== Object.prototype && proto !== null) throw new AuditEventInputError();
  if (
    keys.some((k) => typeof k !== 'string') ||
    keys.length < 12 ||
    keys.length > 13 ||
    REQUIRED.some((k) => !keys.includes(k)) ||
    keys.some((k) => k !== 'occurredAt' && !REQUIRED.includes(k as (typeof REQUIRED)[number]))
  )
    throw new AuditEventInputError();
  const out = Object.create(null) as Record<string, unknown>;
  for (const key of keys as string[]) {
    const d = Object.getOwnPropertyDescriptor(input, key);
    if (!d || !d.enumerable || d.get !== undefined || d.set !== undefined)
      throw new AuditEventInputError();
    out[key] = d.value;
  }
  return out;
}

function captureMethod(
  target: unknown,
  name: string,
): { readonly target: object; readonly fn: DependencyMethod } {
  if (typeof target !== 'object' || target === null || util.types.isProxy(target))
    throw new AuditEventDependencyError();
  try {
    let descriptor = Object.getOwnPropertyDescriptor(target, name);
    if (!descriptor) {
      const prototype = Object.getPrototypeOf(target) as object | null;
      if (prototype === null || util.types.isProxy(prototype))
        throw new AuditEventDependencyError();
      descriptor = Object.getOwnPropertyDescriptor(prototype, name);
    }
    if (
      !descriptor ||
      descriptor.get !== undefined ||
      descriptor.set !== undefined ||
      typeof descriptor.value !== 'function' ||
      util.types.isProxy(descriptor.value)
    )
      throw new AuditEventDependencyError();
    return { target, fn: descriptor.value as DependencyMethod };
  } catch {
    throw new AuditEventDependencyError();
  }
}

function captureDependencies(deps: unknown): {
  readonly clock: { readonly target: object; readonly fn: DependencyMethod };
  readonly ids: { readonly target: object; readonly fn: DependencyMethod };
} {
  if (typeof deps !== 'object' || deps === null || util.types.isProxy(deps))
    throw new AuditEventDependencyError();
  try {
    const keys = Reflect.ownKeys(deps);
    if (keys.length !== 2 || !keys.includes('clock') || !keys.includes('ids'))
      throw new AuditEventDependencyError();
    const clock = Object.getOwnPropertyDescriptor(deps, 'clock');
    const ids = Object.getOwnPropertyDescriptor(deps, 'ids');
    if (
      !clock ||
      !clock.enumerable ||
      clock.get !== undefined ||
      clock.set !== undefined ||
      !ids ||
      !ids.enumerable ||
      ids.get !== undefined ||
      ids.set !== undefined
    )
      throw new AuditEventDependencyError();
    return {
      clock: captureMethod(clock.value, 'now'),
      ids: captureMethod(ids.value, 'generateAuditEventId'),
    };
  } catch {
    throw new AuditEventDependencyError();
  }
}

export function createAuditEvent(
  input: CreateAuditEventInput,
  deps: { readonly clock: ClockPort; readonly ids: AuditIdGeneratorPort },
): AuditEventSnapshot {
  let captured: Record<string, unknown>;
  try {
    captured = captureInput(input);
    const eventTime = captured.occurredAt ?? FIXED_TIME;
    captureAuditEventSnapshot({
      ...captured,
      id: FIXED_ID,
      occurredAt: eventTime,
      createdAt: eventTime,
    });
  } catch (error) {
    if (error instanceof AuditEventInputError) throw error;
    throw new AuditEventInputError();
  }

  let dependencies: ReturnType<typeof captureDependencies>;
  try {
    dependencies = captureDependencies(deps);
  } catch {
    throw new AuditEventDependencyError();
  }

  let createdAt: string;
  try {
    const now = Reflect.apply(dependencies.clock.fn, dependencies.clock.target, []) as unknown;
    if (
      typeof now !== 'object' ||
      now === null ||
      util.types.isProxy(now) ||
      Object.getPrototypeOf(now) !== Date.prototype
    )
      throw new Error();
    const time = Date.prototype.getTime.call(now) as number;
    if (Number.isNaN(time)) throw new Error();
    createdAt = Date.prototype.toISOString.call(now) as string;
  } catch {
    throw new AuditEventDependencyError();
  }

  if (typeof captured.occurredAt === 'string' && captured.occurredAt > createdAt)
    throw new AuditEventInputError();

  try {
    const id = Reflect.apply(dependencies.ids.fn, dependencies.ids.target, []) as unknown;
    return captureAuditEventSnapshot({
      ...captured,
      id,
      occurredAt: captured.occurredAt ?? createdAt,
      createdAt,
    });
  } catch {
    throw new AuditEventDependencyError();
  }
}
