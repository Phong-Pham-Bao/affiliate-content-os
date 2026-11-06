import {
  dateToIsoTimestamp,
  type AffiliateDestinationId,
  type IdempotencyRecordSnapshot,
  type IsoTimestamp,
  type ProductFactSetId,
  type ProductId,
  type ProductSnapshot,
  type UserId,
  type WorkspaceId,
} from '@affiliate-content-os/domain';
import type { IdGeneratorPort } from '../ports.js';
import { resolveIdempotencyKeyId } from './id-and-clock-helpers.js';
import type { ValidatedIdempotencyInput } from './snapshot-utils.js';

export function buildProductCreateIdempotencyRecord(params: {
  readonly product: ProductSnapshot;
  readonly userId: UserId;
  readonly duplicateWarning: boolean;
  readonly now: IsoTimestamp;
  readonly clockDate: Date;
  readonly idGenerator: IdGeneratorPort;
  readonly idempotency: ValidatedIdempotencyInput;
}): IdempotencyRecordSnapshot {
  const keyId = resolveIdempotencyKeyId(params.idGenerator);
  const expiresDate = new Date(params.clockDate.getTime() + 86400 * 1000);
  const expiresAt = dateToIsoTimestamp(expiresDate);

  return Object.freeze({
    id: keyId,
    workspaceId: params.product.workspaceId,
    principalId: params.userId,
    routeKey: `POST /api/v1/workspaces/${params.product.workspaceId}/products`,
    keyHash: params.idempotency.keyHash,
    requestHash: params.idempotency.requestHash,
    statusCode: 201,
    responseJson: Object.freeze({
      id: params.product.id,
      name: params.product.name,
      status: params.product.status,
      duplicateWarning: params.duplicateWarning,
    }),
    resourceType: 'product',
    resourceId: params.product.id,
    expiresAt,
    createdAt: params.now,
  });
}

export function buildFactSetCreateIdempotencyRecord(params: {
  readonly workspaceId: WorkspaceId;
  readonly productId: ProductId;
  readonly factSetId: ProductFactSetId;
  readonly userId: UserId;
  readonly now: IsoTimestamp;
  readonly clockDate: Date;
  readonly idGenerator: IdGeneratorPort;
  readonly idempotency: ValidatedIdempotencyInput;
}): IdempotencyRecordSnapshot {
  const keyId = resolveIdempotencyKeyId(params.idGenerator);
  const expiresDate = new Date(params.clockDate.getTime() + 86400 * 1000);
  const expiresAt = dateToIsoTimestamp(expiresDate);

  return Object.freeze({
    id: keyId,
    workspaceId: params.workspaceId,
    principalId: params.userId,
    routeKey: `POST /api/v1/workspaces/${params.workspaceId}/products/${params.productId}/fact-sets`,
    keyHash: params.idempotency.keyHash,
    requestHash: params.idempotency.requestHash,
    statusCode: 201,
    responseJson: Object.freeze({
      id: params.factSetId,
      productId: params.productId,
    }),
    resourceType: 'product_fact_set',
    resourceId: params.factSetId,
    expiresAt,
    createdAt: params.now,
  });
}

export function buildAffiliateCreateIdempotencyRecord(params: {
  readonly workspaceId: WorkspaceId;
  readonly productId: ProductId;
  readonly destinationId: AffiliateDestinationId;
  readonly userId: UserId;
  readonly now: IsoTimestamp;
  readonly clockDate: Date;
  readonly idGenerator: IdGeneratorPort;
  readonly idempotency: ValidatedIdempotencyInput;
}): IdempotencyRecordSnapshot {
  const keyId = resolveIdempotencyKeyId(params.idGenerator);
  const expiresDate = new Date(params.clockDate.getTime() + 86400 * 1000);
  const expiresAt = dateToIsoTimestamp(expiresDate);

  return Object.freeze({
    id: keyId,
    workspaceId: params.workspaceId,
    principalId: params.userId,
    routeKey: `POST /api/v1/workspaces/${params.workspaceId}/products/${params.productId}/affiliate-destinations`,
    keyHash: params.idempotency.keyHash,
    requestHash: params.idempotency.requestHash,
    statusCode: 201,
    responseJson: Object.freeze({
      id: params.destinationId,
      productId: params.productId,
    }),
    resourceType: 'affiliate_destination',
    resourceId: params.destinationId,
    expiresAt,
    createdAt: params.now,
  });
}
