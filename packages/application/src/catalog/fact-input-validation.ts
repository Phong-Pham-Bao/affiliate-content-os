import {
  DomainValidationError,
  isFactClaimUsage,
  isFactConfidence,
  isFactSourceType,
  validateFactKey,
  validateFactValue,
  validateSafeHttpUrl,
  validateSourceExcerpt,
  type FactClaimUsage,
  type FactConfidence,
  type FactSourceType,
  type IsoTimestamp,
  type ProductFactSetId,
  type ProductFactSnapshot,
  type ProductId,
  type WorkspaceId,
} from '@affiliate-content-os/domain';
import { ValidationError } from '../errors.js';
import type { IdGeneratorPort } from '../ports.js';
import { resolveProductFactId } from './id-and-clock-helpers.js';
import type { ValidatedFactInput } from './snapshot-utils.js';

export function validateAndMapFactSnapshots(params: {
  readonly facts: readonly ValidatedFactInput[];
  readonly workspaceId: WorkspaceId;
  readonly productId: ProductId;
  readonly factSetId: ProductFactSetId;
  readonly now: IsoTimestamp;
  readonly idGenerator: IdGeneratorPort;
}): readonly ProductFactSnapshot[] {
  const validatedFacts: ProductFactSnapshot[] = [];

  for (const f of params.facts) {
    let validKey: string;
    let validValue: string;
    try {
      validKey = validateFactKey(f.factKey);
      validValue = validateFactValue(f.valueText);
    } catch (err) {
      if (err instanceof DomainValidationError) {
        throw new ValidationError(err.message, err.field);
      }
      throw err;
    }

    if (!isFactSourceType(f.sourceType)) {
      throw new ValidationError(`Invalid fact sourceType: ${f.sourceType}`, 'sourceType');
    }
    const sourceType = f.sourceType as FactSourceType;

    let sourceUrl: string | null = null;
    if (f.sourceUrl) {
      sourceUrl = validateSafeHttpUrl(f.sourceUrl, 'sourceUrl');
    }

    let sourceExcerpt: string | null = null;
    if (f.sourceExcerpt) {
      sourceExcerpt = validateSourceExcerpt(f.sourceExcerpt);
    }

    if (!isFactConfidence(f.confidence)) {
      throw new ValidationError(`Invalid fact confidence: ${f.confidence}`, 'confidence');
    }
    const confidence = f.confidence as FactConfidence;

    if (!isFactClaimUsage(f.claimUsage)) {
      throw new ValidationError(`Invalid fact claimUsage: ${f.claimUsage}`, 'claimUsage');
    }
    const claimUsage = f.claimUsage as FactClaimUsage;

    const factId = resolveProductFactId(params.idGenerator);

    validatedFacts.push(
      Object.freeze({
        id: factId,
        factSetId: params.factSetId,
        productId: params.productId,
        workspaceId: params.workspaceId,
        factKey: validKey,
        valueText: validValue,
        sourceType,
        sourceUrl,
        sourceExcerpt,
        confidence,
        claimUsage,
        createdAt: params.now,
        updatedAt: params.now,
        version: 1,
      }),
    );
  }

  return Object.freeze(validatedFacts);
}
