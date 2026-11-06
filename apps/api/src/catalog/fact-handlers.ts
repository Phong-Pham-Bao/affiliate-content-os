import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  assertNoCoercionHooks,
  assertPlainObject,
  DomainValidationError,
  getDataPropertyDescriptor,
  isFactClaimUsage,
  isFactConfidence,
  isFactSourceType,
  isValidUuidV7,
  validateFactKey,
  validateFactSetSummary,
  validateFactValue,
  validateSafeHttpUrl,
  validateSourceExcerpt,
} from '@affiliate-content-os/domain';
import {
  confirmFactSet,
  createFactSet,
  DefaultIdGenerator,
  getFactSet,
  listFactSets,
  SystemClock,
  ValidationError,
  type FactInput,
} from '@affiliate-content-os/application';
import { requireAuthenticatedSession } from '../auth/session-auth.js';
import {
  computeCanonicalFactSetCreateHash,
  extractAuditContext,
  extractIdempotencyKey,
  validateMutationOrigin,
} from './helpers.js';
import { serializeFact, serializeFactSet, serializeProduct } from './serializers.js';
import type { CatalogRouteDependencies } from './types.js';

export async function handleListFactSets(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: CatalogRouteDependencies,
): Promise<void> {
  const authContext = await requireAuthenticatedSession(request, reply, deps.auth);
  const { workspaceId, productId } = request.params as {
    readonly workspaceId: string;
    readonly productId: string;
  };
  if (!isValidUuidV7(workspaceId)) {
    throw new ValidationError('Invalid workspaceId parameter', 'workspaceId');
  }
  if (!isValidUuidV7(productId)) {
    throw new ValidationError('Invalid productId parameter', 'productId');
  }

  const query = request.query as {
    readonly limit?: number;
    readonly after?: string;
  };

  const result = await listFactSets(
    {
      workspaceId,
      userId: authContext.user.id,
      productId,
      cursor: query.after,
      limit: query.limit,
    },
    {
      catalogPersistence: deps.catalogPersistence,
      workspaceAuthorization: deps.workspaceAuthorization,
    },
  );

  return reply
    .status(200)
    .type('application/json; charset=utf-8')
    .send({
      items: result.items.map((f) => serializeFactSet(f)),
      page: {
        nextCursor: result.nextCursor,
        hasMore: result.nextCursor !== null,
      },
    });
}

export async function handleCreateFactSet(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: CatalogRouteDependencies,
): Promise<void> {
  const authContext = await requireAuthenticatedSession(request, reply, deps.auth);
  const { workspaceId, productId } = request.params as {
    readonly workspaceId: string;
    readonly productId: string;
  };
  if (!isValidUuidV7(workspaceId)) {
    throw new ValidationError('Invalid workspaceId parameter', 'workspaceId');
  }
  if (!isValidUuidV7(productId)) {
    throw new ValidationError('Invalid productId parameter', 'productId');
  }

  validateMutationOrigin(request, deps);
  const { keyHash } = extractIdempotencyKey(request);

  const body = assertPlainObject(request.body, 'body');

  for (const key of Object.getOwnPropertyNames(body)) {
    const desc = getDataPropertyDescriptor(body, key);
    assertNoCoercionHooks(desc.value, key);
  }

  let summaryVal: unknown = undefined;
  if ('summary' in body) {
    summaryVal = getDataPropertyDescriptor(body, 'summary').value;
  }
  const factsDesc = getDataPropertyDescriptor(body, 'facts');
  if (!Array.isArray(factsDesc.value)) {
    throw new ValidationError('facts must be an array', 'facts');
  }

  let summary: string | null;
  try {
    summary = validateFactSetSummary(summaryVal);
  } catch (err) {
    if (err instanceof DomainValidationError) {
      throw new ValidationError(err.message, err.field);
    }
    throw err;
  }

  const validatedFacts: FactInput[] = [];
  for (let i = 0; i < factsDesc.value.length; i++) {
    const rawFact = factsDesc.value[i];
    const factObj = assertPlainObject(rawFact, `facts[${i}]`);
    for (const fKey of Object.getOwnPropertyNames(factObj)) {
      const fDesc = getDataPropertyDescriptor(factObj, fKey);
      assertNoCoercionHooks(fDesc.value, `facts[${i}].${fKey}`);
    }

    const fkDesc = getDataPropertyDescriptor(factObj, 'factKey');
    const fvDesc = getDataPropertyDescriptor(factObj, 'valueText');
    const stDesc = getDataPropertyDescriptor(factObj, 'sourceType');
    const confDesc = getDataPropertyDescriptor(factObj, 'confidence');
    const cuDesc = getDataPropertyDescriptor(factObj, 'claimUsage');

    let sourceUrlVal: unknown = undefined;
    if ('sourceUrl' in factObj) {
      sourceUrlVal = getDataPropertyDescriptor(factObj, 'sourceUrl').value;
    }
    let sourceExcerptVal: unknown = undefined;
    if ('sourceExcerpt' in factObj) {
      sourceExcerptVal = getDataPropertyDescriptor(factObj, 'sourceExcerpt').value;
    }

    try {
      const validKey = validateFactKey(fkDesc.value);
      const validVal = validateFactValue(fvDesc.value);
      if (typeof stDesc.value !== 'string' || !isFactSourceType(stDesc.value)) {
        throw new DomainValidationError('Invalid sourceType', 'sourceType');
      }
      let sourceUrl: string | null = null;
      if (sourceUrlVal !== undefined && sourceUrlVal !== null && sourceUrlVal !== '') {
        sourceUrl = validateSafeHttpUrl(sourceUrlVal, 'sourceUrl');
      }
      let sourceExcerpt: string | null = null;
      if (sourceExcerptVal !== undefined && sourceExcerptVal !== null && sourceExcerptVal !== '') {
        sourceExcerpt = validateSourceExcerpt(sourceExcerptVal);
      }
      if (typeof confDesc.value !== 'string' || !isFactConfidence(confDesc.value)) {
        throw new DomainValidationError('Invalid confidence', 'confidence');
      }
      if (typeof cuDesc.value !== 'string' || !isFactClaimUsage(cuDesc.value)) {
        throw new DomainValidationError('Invalid claimUsage', 'claimUsage');
      }

      validatedFacts.push({
        factKey: validKey,
        valueText: validVal,
        sourceType: stDesc.value,
        sourceUrl,
        sourceExcerpt,
        confidence: confDesc.value,
        claimUsage: cuDesc.value,
      });
    } catch (err) {
      if (err instanceof DomainValidationError) {
        throw new ValidationError(err.message, err.field);
      }
      throw err;
    }
  }

  const requestHash = computeCanonicalFactSetCreateHash({
    summary,
    facts: validatedFacts,
  });

  const auditContext = extractAuditContext(request);

  const result = await createFactSet(
    {
      workspaceId,
      userId: authContext.user.id,
      productId,
      summary,
      facts: validatedFacts,
      idempotency: { keyHash, requestHash },
      auditContext,
    },
    {
      catalogPersistence: deps.catalogPersistence,
      workspaceAuthorization: deps.workspaceAuthorization,
      clock: deps.clock ?? new SystemClock(),
      idGenerator: deps.idGenerator ?? new DefaultIdGenerator(),
    },
  );

  return reply
    .status(201)
    .header(
      'Location',
      `/api/v1/workspaces/${result.factSet.workspaceId}/products/${result.factSet.productId}/fact-sets/${result.factSet.id}`,
    )
    .header('ETag', `"${result.factSet.version}"`)
    .type('application/json; charset=utf-8')
    .send({
      factSet: serializeFactSet(result.factSet),
      facts: result.facts.map((f) => serializeFact(f)),
    });
}

export async function handleGetFactSet(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: CatalogRouteDependencies,
): Promise<void> {
  const authContext = await requireAuthenticatedSession(request, reply, deps.auth);
  const { workspaceId, productId, factSetId } = request.params as {
    readonly workspaceId: string;
    readonly productId: string;
    readonly factSetId: string;
  };
  if (!isValidUuidV7(workspaceId)) {
    throw new ValidationError('Invalid workspaceId parameter', 'workspaceId');
  }
  if (!isValidUuidV7(productId)) {
    throw new ValidationError('Invalid productId parameter', 'productId');
  }
  if (!isValidUuidV7(factSetId)) {
    throw new ValidationError('Invalid factSetId parameter', 'factSetId');
  }

  const result = await getFactSet(
    {
      workspaceId,
      userId: authContext.user.id,
      productId,
      factSetId,
    },
    {
      catalogPersistence: deps.catalogPersistence,
      workspaceAuthorization: deps.workspaceAuthorization,
    },
  );

  return reply
    .status(200)
    .header('ETag', `"${result.factSet.version}"`)
    .type('application/json; charset=utf-8')
    .send({
      factSet: serializeFactSet(result.factSet),
      facts: result.facts.map((f) => serializeFact(f)),
    });
}

export async function handleConfirmFactSet(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: CatalogRouteDependencies,
): Promise<void> {
  const authContext = await requireAuthenticatedSession(request, reply, deps.auth);
  const { workspaceId, productId, factSetId } = request.params as {
    readonly workspaceId: string;
    readonly productId: string;
    readonly factSetId: string;
  };
  if (!isValidUuidV7(workspaceId)) {
    throw new ValidationError('Invalid workspaceId parameter', 'workspaceId');
  }
  if (!isValidUuidV7(productId)) {
    throw new ValidationError('Invalid productId parameter', 'productId');
  }
  if (!isValidUuidV7(factSetId)) {
    throw new ValidationError('Invalid factSetId parameter', 'factSetId');
  }

  validateMutationOrigin(request, deps);
  const auditContext = extractAuditContext(request);

  const result = await confirmFactSet(
    {
      workspaceId,
      userId: authContext.user.id,
      productId,
      factSetId,
      auditContext,
    },
    {
      catalogPersistence: deps.catalogPersistence,
      workspaceAuthorization: deps.workspaceAuthorization,
      clock: deps.clock ?? new SystemClock(),
      idGenerator: deps.idGenerator ?? new DefaultIdGenerator(),
    },
  );

  return reply
    .status(200)
    .header('ETag', `"${result.factSet.version}"`)
    .type('application/json; charset=utf-8')
    .send({
      factSet: serializeFactSet(result.factSet),
      product: serializeProduct(result.product),
      alreadyConfirmed: result.alreadyConfirmed,
    });
}
