import {
  assertExactAllowedKeys,
  extractExactNullableString,
  extractExactString,
  extractPageLimit,
  snapshotAuditContext,
  snapshotFacts,
  snapshotIdempotencyInput,
  type ValidatedAuditContext,
  type ValidatedFactInput,
  type ValidatedIdempotencyInput,
} from './snapshot-utils.js';

const CREATE_FACT_SET_ALLOWED_KEYS = [
  'workspaceId',
  'userId',
  'productId',
  'facts',
  'summary',
  'idempotency',
  'auditContext',
] as const;

export interface SnappedCreateFactSetCommand {
  readonly workspaceId: string;
  readonly userId: string;
  readonly productId: string;
  readonly facts: readonly ValidatedFactInput[];
  readonly summary?: string | null | undefined;
  readonly idempotency?: ValidatedIdempotencyInput | undefined;
  readonly auditContext?: ValidatedAuditContext | undefined;
}

export function snapshotCreateFactSetCommand(raw: unknown): SnappedCreateFactSetCommand {
  const obj = assertExactAllowedKeys(raw, CREATE_FACT_SET_ALLOWED_KEYS, 'CreateFactSetCommand');
  return Object.freeze({
    workspaceId: extractExactString(obj, 'workspaceId', true)!,
    userId: extractExactString(obj, 'userId', true)!,
    productId: extractExactString(obj, 'productId', true)!,
    facts: snapshotFacts(obj['facts']),
    summary: extractExactNullableString(obj, 'summary'),
    idempotency: snapshotIdempotencyInput(obj['idempotency']),
    auditContext: snapshotAuditContext(obj['auditContext']),
  });
}

const LIST_FACT_SETS_ALLOWED_KEYS = [
  'workspaceId',
  'userId',
  'productId',
  'limit',
  'cursor',
] as const;

export interface SnappedListFactSetsCommand {
  readonly workspaceId: string;
  readonly userId: string;
  readonly productId: string;
  readonly limit: number;
  readonly cursor: string | null;
}

export function snapshotListFactSetsCommand(raw: unknown): SnappedListFactSetsCommand {
  const obj = assertExactAllowedKeys(raw, LIST_FACT_SETS_ALLOWED_KEYS, 'ListFactSetsCommand');
  const limit = extractPageLimit(obj, 'limit');
  const cursor = extractExactNullableString(obj, 'cursor') ?? null;
  return Object.freeze({
    workspaceId: extractExactString(obj, 'workspaceId', true)!,
    userId: extractExactString(obj, 'userId', true)!,
    productId: extractExactString(obj, 'productId', true)!,
    limit,
    cursor,
  });
}

const GET_FACT_SET_ALLOWED_KEYS = ['workspaceId', 'userId', 'productId', 'factSetId'] as const;

export interface SnappedGetFactSetCommand {
  readonly workspaceId: string;
  readonly userId: string;
  readonly productId: string;
  readonly factSetId: string;
}

export function snapshotGetFactSetCommand(raw: unknown): SnappedGetFactSetCommand {
  const obj = assertExactAllowedKeys(raw, GET_FACT_SET_ALLOWED_KEYS, 'GetFactSetCommand');
  return Object.freeze({
    workspaceId: extractExactString(obj, 'workspaceId', true)!,
    userId: extractExactString(obj, 'userId', true)!,
    productId: extractExactString(obj, 'productId', true)!,
    factSetId: extractExactString(obj, 'factSetId', true)!,
  });
}

const CONFIRM_FACT_SET_ALLOWED_KEYS = [
  'workspaceId',
  'userId',
  'productId',
  'factSetId',
  'auditContext',
] as const;

export interface SnappedConfirmFactSetCommand {
  readonly workspaceId: string;
  readonly userId: string;
  readonly productId: string;
  readonly factSetId: string;
  readonly auditContext?: ValidatedAuditContext | undefined;
}

export function snapshotConfirmFactSetCommand(raw: unknown): SnappedConfirmFactSetCommand {
  const obj = assertExactAllowedKeys(raw, CONFIRM_FACT_SET_ALLOWED_KEYS, 'ConfirmFactSetCommand');
  return Object.freeze({
    workspaceId: extractExactString(obj, 'workspaceId', true)!,
    userId: extractExactString(obj, 'userId', true)!,
    productId: extractExactString(obj, 'productId', true)!,
    factSetId: extractExactString(obj, 'factSetId', true)!,
    auditContext: snapshotAuditContext(obj['auditContext']),
  });
}
