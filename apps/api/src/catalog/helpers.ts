import crypto from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import {
  DomainValidationError,
  isValidUuidV7,
  validateIdempotencyKey,
} from '@affiliate-content-os/domain';
import type { CatalogAuditContext } from '@affiliate-content-os/application';
import { AuthOriginInvalidError, validateOrigin } from '../auth/origin.js';
import { MalformedIdempotencyKeyError, PreconditionRequiredError } from './errors.js';
import type { CatalogRouteDependencies } from './types.js';

export function validateMutationOrigin(
  request: FastifyRequest,
  deps: CatalogRouteDependencies,
): void {
  const originHeader = request.headers['origin'];
  if (typeof originHeader !== 'string' || originHeader === 'null' || originHeader.trim() === '') {
    throw new AuthOriginInvalidError();
  }
  const appBaseUrl = deps.auth.appBaseUrl ?? 'http://127.0.0.1:3000';
  const redirectUri = deps.auth.config.redirectUri ?? appBaseUrl;
  validateOrigin(originHeader, appBaseUrl, redirectUri);
}

export function extractIdempotencyKey(request: FastifyRequest): {
  rawKey: string;
  keyHash: Uint8Array;
} {
  const rawKey = request.headers['idempotency-key'];
  if (typeof rawKey !== 'string' || rawKey === '') {
    throw new MalformedIdempotencyKeyError();
  }
  try {
    const validKey = validateIdempotencyKey(rawKey);
    const keyHash = crypto.createHash('sha256').update(validKey).digest();
    return { rawKey: validKey, keyHash };
  } catch (err) {
    if (err instanceof DomainValidationError) {
      throw new MalformedIdempotencyKeyError();
    }
    throw err;
  }
}

export function extractIfMatchVersion(request: FastifyRequest): number {
  const rawHeader = request.headers['if-match'];
  if (typeof rawHeader !== 'string' || rawHeader.trim() === '') {
    throw new PreconditionRequiredError('If-Match header is required');
  }
  const trimmed = rawHeader.trim();
  const match = /^"([1-9][0-9]*)"$/.exec(trimmed);
  if (!match) {
    throw new PreconditionRequiredError(
      'If-Match header must be a quoted positive integer version',
    );
  }
  const parsed = Number(match[1]);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new PreconditionRequiredError('If-Match header must be a positive safe integer version');
  }
  return parsed;
}

export function extractAuditContext(request: FastifyRequest): CatalogAuditContext {
  const rawReqId = request.headers['x-request-id'];
  const correlationId = typeof rawReqId === 'string' && isValidUuidV7(rawReqId) ? rawReqId : null;
  const rawUserAgent =
    typeof request.headers['user-agent'] === 'string' ? request.headers['user-agent'] : null;

  return {
    ipHash: null,
    userAgentSummary: rawUserAgent,
    correlationId,
  };
}

export function computeCanonicalProductCreateHash(params: {
  readonly name: string;
  readonly merchantName: string;
  readonly canonicalUrl: string;
  readonly category: string;
  readonly description: string;
  readonly audienceNotes: string | null;
  readonly allowedClaimsNotes: string | null;
  readonly prohibitedClaimsNotes: string | null;
}): Uint8Array {
  const canonicalObject = {
    allowedClaimsNotes: params.allowedClaimsNotes,
    audienceNotes: params.audienceNotes,
    canonicalUrl: params.canonicalUrl,
    category: params.category,
    description: params.description,
    merchantName: params.merchantName,
    name: params.name,
    prohibitedClaimsNotes: params.prohibitedClaimsNotes,
  };
  return crypto.createHash('sha256').update(JSON.stringify(canonicalObject)).digest();
}

export function computeCanonicalFactSetCreateHash(params: {
  readonly summary: string | null;
  readonly facts: ReadonlyArray<{
    readonly factKey: string;
    readonly valueText: string;
    readonly sourceType: string;
    readonly sourceUrl?: string | null | undefined;
    readonly sourceExcerpt?: string | null | undefined;
    readonly confidence: string;
    readonly claimUsage: string;
  }>;
}): Uint8Array {
  const canonicalObject = {
    facts: params.facts.map((f) => ({
      claimUsage: f.claimUsage,
      confidence: f.confidence,
      factKey: f.factKey,
      sourceExcerpt: f.sourceExcerpt ?? null,
      sourceType: f.sourceType,
      sourceUrl: f.sourceUrl ?? null,
      valueText: f.valueText,
    })),
    summary: params.summary ?? null,
  };
  return crypto.createHash('sha256').update(JSON.stringify(canonicalObject)).digest();
}

export function computeCanonicalAffiliateCreateHash(params: {
  readonly label: string;
  readonly url: string;
  readonly networkName: string | null;
}): Uint8Array {
  const canonicalObject = {
    label: params.label,
    networkName: params.networkName,
    url: params.url,
  };
  return crypto.createHash('sha256').update(JSON.stringify(canonicalObject)).digest();
}
