import { ValidationError } from '../errors.js';
import {
  assertExactAllowedKeys,
  extractExactInteger,
  extractExactNullableString,
  extractExactString,
  extractPageLimit,
  extractProductCreateStatus,
  snapshotAuditContext,
  snapshotIdempotencyInput,
  type ValidatedAuditContext,
  type ValidatedIdempotencyInput,
} from './snapshot-utils.js';

const CREATE_PRODUCT_ALLOWED_KEYS = [
  'workspaceId',
  'userId',
  'name',
  'merchantName',
  'canonicalUrl',
  'category',
  'description',
  'audienceNotes',
  'allowedClaimsNotes',
  'prohibitedClaimsNotes',
  'status',
  'idempotency',
  'auditContext',
] as const;

export interface SnappedCreateProductCommand {
  readonly workspaceId: string;
  readonly userId: string;
  readonly name: string;
  readonly merchantName: string;
  readonly canonicalUrl: string;
  readonly category: string;
  readonly description: string;
  readonly audienceNotes?: string | null | undefined;
  readonly allowedClaimsNotes?: string | null | undefined;
  readonly prohibitedClaimsNotes?: string | null | undefined;
  readonly status: 'draft' | 'active';
  readonly idempotency?: ValidatedIdempotencyInput | undefined;
  readonly auditContext?: ValidatedAuditContext | undefined;
}

export function snapshotCreateProductCommand(raw: unknown): SnappedCreateProductCommand {
  const obj = assertExactAllowedKeys(raw, CREATE_PRODUCT_ALLOWED_KEYS, 'CreateProductCommand');
  return Object.freeze({
    workspaceId: extractExactString(obj, 'workspaceId', true)!,
    userId: extractExactString(obj, 'userId', true)!,
    name: extractExactString(obj, 'name', true)!,
    merchantName: extractExactString(obj, 'merchantName', true)!,
    canonicalUrl: extractExactString(obj, 'canonicalUrl', true)!,
    category: extractExactString(obj, 'category', true)!,
    description: extractExactString(obj, 'description', true)!,
    audienceNotes: extractExactNullableString(obj, 'audienceNotes'),
    allowedClaimsNotes: extractExactNullableString(obj, 'allowedClaimsNotes'),
    prohibitedClaimsNotes: extractExactNullableString(obj, 'prohibitedClaimsNotes'),
    status: extractProductCreateStatus(obj, 'status'),
    idempotency: snapshotIdempotencyInput(obj['idempotency']),
    auditContext: snapshotAuditContext(obj['auditContext']),
  });
}

const LIST_PRODUCTS_ALLOWED_KEYS = ['workspaceId', 'userId', 'status', 'cursor', 'limit'] as const;

export interface SnappedListProductsCommand {
  readonly workspaceId: string;
  readonly userId: string;
  readonly status?: string | undefined;
  readonly limit: number;
  readonly cursor: string | null;
}

export function snapshotListProductsCommand(raw: unknown): SnappedListProductsCommand {
  const obj = assertExactAllowedKeys(raw, LIST_PRODUCTS_ALLOWED_KEYS, 'ListProductsCommand');
  const limit = extractPageLimit(obj, 'limit');
  const cursor = extractExactNullableString(obj, 'cursor') ?? null;
  const rawStatus = extractExactNullableString(obj, 'status');
  return Object.freeze({
    workspaceId: extractExactString(obj, 'workspaceId', true)!,
    userId: extractExactString(obj, 'userId', true)!,
    status: rawStatus ?? undefined,
    limit,
    cursor,
  });
}

const GET_PRODUCT_ALLOWED_KEYS = ['workspaceId', 'userId', 'productId'] as const;

export interface SnappedGetProductCommand {
  readonly workspaceId: string;
  readonly userId: string;
  readonly productId: string;
}

export function snapshotGetProductCommand(raw: unknown): SnappedGetProductCommand {
  const obj = assertExactAllowedKeys(raw, GET_PRODUCT_ALLOWED_KEYS, 'GetProductCommand');
  return Object.freeze({
    workspaceId: extractExactString(obj, 'workspaceId', true)!,
    userId: extractExactString(obj, 'userId', true)!,
    productId: extractExactString(obj, 'productId', true)!,
  });
}

const UPDATE_PRODUCT_ALLOWED_KEYS = [
  'workspaceId',
  'userId',
  'productId',
  'expectedVersion',
  'name',
  'merchantName',
  'canonicalUrl',
  'category',
  'description',
  'audienceNotes',
  'allowedClaimsNotes',
  'prohibitedClaimsNotes',
  'status',
  'auditContext',
] as const;

export interface SnappedUpdateProductCommand {
  readonly workspaceId: string;
  readonly userId: string;
  readonly productId: string;
  readonly expectedVersion: number;
  readonly name?: string | undefined;
  readonly merchantName?: string | undefined;
  readonly canonicalUrl?: string | undefined;
  readonly category?: string | undefined;
  readonly description?: string | undefined;
  readonly audienceNotes?: string | null | undefined;
  readonly allowedClaimsNotes?: string | null | undefined;
  readonly prohibitedClaimsNotes?: string | null | undefined;
  readonly status?: string | undefined;
  readonly auditContext?: ValidatedAuditContext | undefined;
}

export function snapshotUpdateProductCommand(raw: unknown): SnappedUpdateProductCommand {
  const obj = assertExactAllowedKeys(raw, UPDATE_PRODUCT_ALLOWED_KEYS, 'UpdateProductCommand');
  const status = extractExactString(obj, 'status', false);
  if (status === 'archived') {
    throw new ValidationError(
      'Product status cannot be updated to archived via updateProduct; use archiveProduct',
      'status',
    );
  }
  return Object.freeze({
    workspaceId: extractExactString(obj, 'workspaceId', true)!,
    userId: extractExactString(obj, 'userId', true)!,
    productId: extractExactString(obj, 'productId', true)!,
    expectedVersion: extractExactInteger(obj, 'expectedVersion', true)!,
    name: extractExactString(obj, 'name', false),
    merchantName: extractExactString(obj, 'merchantName', false),
    canonicalUrl: extractExactString(obj, 'canonicalUrl', false),
    category: extractExactString(obj, 'category', false),
    description: extractExactString(obj, 'description', false),
    audienceNotes: extractExactNullableString(obj, 'audienceNotes'),
    allowedClaimsNotes: extractExactNullableString(obj, 'allowedClaimsNotes'),
    prohibitedClaimsNotes: extractExactNullableString(obj, 'prohibitedClaimsNotes'),
    status,
    auditContext: snapshotAuditContext(obj['auditContext']),
  });
}

const ARCHIVE_PRODUCT_ALLOWED_KEYS = [
  'workspaceId',
  'userId',
  'productId',
  'auditContext',
] as const;

export interface SnappedArchiveProductCommand {
  readonly workspaceId: string;
  readonly userId: string;
  readonly productId: string;
  readonly auditContext?: ValidatedAuditContext | undefined;
}

export function snapshotArchiveProductCommand(raw: unknown): SnappedArchiveProductCommand {
  const obj = assertExactAllowedKeys(raw, ARCHIVE_PRODUCT_ALLOWED_KEYS, 'ArchiveProductCommand');
  return Object.freeze({
    workspaceId: extractExactString(obj, 'workspaceId', true)!,
    userId: extractExactString(obj, 'userId', true)!,
    productId: extractExactString(obj, 'productId', true)!,
    auditContext: snapshotAuditContext(obj['auditContext']),
  });
}
