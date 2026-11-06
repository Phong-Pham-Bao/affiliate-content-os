import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  assertNoCoercionHooks,
  assertPlainObject,
  DomainValidationError,
  getDataPropertyDescriptor,
  isValidUuidV7,
  normalizeCanonicalProductUrl,
  validateAllowedClaimsNotes,
  validateAudienceNotes,
  validateCategory,
  validateDescription,
  validateMerchantName,
  validateProductName,
  validateProhibitedClaimsNotes,
} from '@affiliate-content-os/domain';
import {
  archiveProduct,
  createProduct,
  DefaultIdGenerator,
  getProduct,
  listProducts,
  SystemClock,
  updateProduct,
  ValidationError,
} from '@affiliate-content-os/application';
import { requireAuthenticatedSession } from '../auth/session-auth.js';
import {
  computeCanonicalProductCreateHash,
  extractAuditContext,
  extractIdempotencyKey,
  extractIfMatchVersion,
  validateMutationOrigin,
} from './helpers.js';
import { serializeProduct } from './serializers.js';
import type { CatalogRouteDependencies } from './types.js';

export async function handleListProducts(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: CatalogRouteDependencies,
): Promise<void> {
  const authContext = await requireAuthenticatedSession(request, reply, deps.auth);
  const { workspaceId } = request.params as { readonly workspaceId: string };
  if (!isValidUuidV7(workspaceId)) {
    throw new ValidationError('Invalid workspaceId parameter', 'workspaceId');
  }

  const query = request.query as {
    readonly limit?: number;
    readonly after?: string;
    readonly status?: string;
  };

  const result = await listProducts(
    {
      workspaceId,
      userId: authContext.user.id,
      status: query.status,
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
      items: result.items.map((p) => serializeProduct(p)),
      page: {
        nextCursor: result.nextCursor,
        hasMore: result.nextCursor !== null,
      },
    });
}

export async function handleCreateProduct(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: CatalogRouteDependencies,
): Promise<void> {
  const authContext = await requireAuthenticatedSession(request, reply, deps.auth);
  const { workspaceId } = request.params as { readonly workspaceId: string };
  if (!isValidUuidV7(workspaceId)) {
    throw new ValidationError('Invalid workspaceId parameter', 'workspaceId');
  }

  validateMutationOrigin(request, deps);
  const { keyHash } = extractIdempotencyKey(request);

  const body = assertPlainObject(request.body, 'body');

  for (const key of Object.getOwnPropertyNames(body)) {
    const desc = getDataPropertyDescriptor(body, key);
    assertNoCoercionHooks(desc.value, key);
  }

  const nameDesc = getDataPropertyDescriptor(body, 'name');
  const merchantNameDesc = getDataPropertyDescriptor(body, 'merchantName');
  const canonicalUrlDesc = getDataPropertyDescriptor(body, 'canonicalUrl');
  const categoryDesc = getDataPropertyDescriptor(body, 'category');
  const descriptionDesc = getDataPropertyDescriptor(body, 'description');

  let audienceNotesVal: unknown = undefined;
  if ('audienceNotes' in body) {
    audienceNotesVal = getDataPropertyDescriptor(body, 'audienceNotes').value;
  }
  let allowedClaimsNotesVal: unknown = undefined;
  if ('allowedClaimsNotes' in body) {
    allowedClaimsNotesVal = getDataPropertyDescriptor(body, 'allowedClaimsNotes').value;
  }
  let prohibitedClaimsNotesVal: unknown = undefined;
  if ('prohibitedClaimsNotes' in body) {
    prohibitedClaimsNotesVal = getDataPropertyDescriptor(body, 'prohibitedClaimsNotes').value;
  }

  let name: string;
  let merchantName: string;
  let canonicalUrl: string;
  let category: string;
  let description: string;
  let audienceNotes: string | null;
  let allowedClaimsNotes: string | null;
  let prohibitedClaimsNotes: string | null;

  try {
    name = validateProductName(nameDesc.value);
    merchantName = validateMerchantName(merchantNameDesc.value);
    canonicalUrl = normalizeCanonicalProductUrl(canonicalUrlDesc.value);
    category = validateCategory(categoryDesc.value);
    description = validateDescription(descriptionDesc.value);
    audienceNotes = validateAudienceNotes(audienceNotesVal);
    allowedClaimsNotes = validateAllowedClaimsNotes(allowedClaimsNotesVal);
    prohibitedClaimsNotes = validateProhibitedClaimsNotes(prohibitedClaimsNotesVal);
  } catch (err) {
    if (err instanceof DomainValidationError) {
      throw new ValidationError(err.message, err.field);
    }
    throw err;
  }

  const requestHash = computeCanonicalProductCreateHash({
    name,
    merchantName,
    canonicalUrl,
    category,
    description,
    audienceNotes,
    allowedClaimsNotes,
    prohibitedClaimsNotes,
  });

  const auditContext = extractAuditContext(request);

  const result = await createProduct(
    {
      workspaceId,
      userId: authContext.user.id,
      name,
      merchantName,
      canonicalUrl,
      category,
      description,
      audienceNotes,
      allowedClaimsNotes,
      prohibitedClaimsNotes,
      status: 'draft',
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
      `/api/v1/workspaces/${result.product.workspaceId}/products/${result.product.id}`,
    )
    .header('ETag', `"${result.product.version}"`)
    .type('application/json; charset=utf-8')
    .send(serializeProduct(result.product, { duplicateWarning: result.duplicateWarning }));
}

export async function handleGetProduct(
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

  const product = await getProduct(
    {
      workspaceId,
      userId: authContext.user.id,
      productId,
    },
    {
      catalogPersistence: deps.catalogPersistence,
      workspaceAuthorization: deps.workspaceAuthorization,
    },
  );

  return reply
    .status(200)
    .header('ETag', `"${product.version}"`)
    .type('application/json; charset=utf-8')
    .send(serializeProduct(product));
}

export async function handleUpdateProduct(
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
  const expectedVersion = extractIfMatchVersion(request);
  const auditContext = extractAuditContext(request);

  const body = assertPlainObject(request.body, 'body');

  for (const key of Object.getOwnPropertyNames(body)) {
    const desc = getDataPropertyDescriptor(body, key);
    assertNoCoercionHooks(desc.value, key);
  }

  let name: string | undefined;
  let merchantName: string | undefined;
  let canonicalUrl: string | undefined;
  let category: string | undefined;
  let description: string | undefined;
  let audienceNotes: string | null | undefined;
  let allowedClaimsNotes: string | null | undefined;
  let prohibitedClaimsNotes: string | null | undefined;
  let status: 'draft' | 'active' | undefined;

  try {
    if ('name' in body) {
      name = validateProductName(getDataPropertyDescriptor(body, 'name').value);
    }
    if ('merchantName' in body) {
      merchantName = validateMerchantName(getDataPropertyDescriptor(body, 'merchantName').value);
    }
    if ('canonicalUrl' in body) {
      canonicalUrl = normalizeCanonicalProductUrl(
        getDataPropertyDescriptor(body, 'canonicalUrl').value,
      );
    }
    if ('category' in body) {
      category = validateCategory(getDataPropertyDescriptor(body, 'category').value);
    }
    if ('description' in body) {
      description = validateDescription(getDataPropertyDescriptor(body, 'description').value);
    }
    if ('audienceNotes' in body) {
      audienceNotes = validateAudienceNotes(getDataPropertyDescriptor(body, 'audienceNotes').value);
    }
    if ('allowedClaimsNotes' in body) {
      allowedClaimsNotes = validateAllowedClaimsNotes(
        getDataPropertyDescriptor(body, 'allowedClaimsNotes').value,
      );
    }
    if ('prohibitedClaimsNotes' in body) {
      prohibitedClaimsNotes = validateProhibitedClaimsNotes(
        getDataPropertyDescriptor(body, 'prohibitedClaimsNotes').value,
      );
    }
    if ('status' in body) {
      const rawStatus = getDataPropertyDescriptor(body, 'status').value;
      if (typeof rawStatus !== 'string' || (rawStatus !== 'draft' && rawStatus !== 'active')) {
        throw new DomainValidationError('status must be draft or active', 'status');
      }
      status = rawStatus;
    }
  } catch (err) {
    if (err instanceof DomainValidationError) {
      throw new ValidationError(err.message, err.field);
    }
    throw err;
  }

  const result = await updateProduct(
    {
      workspaceId,
      userId: authContext.user.id,
      productId,
      expectedVersion,
      name,
      merchantName,
      canonicalUrl,
      category,
      description,
      audienceNotes,
      allowedClaimsNotes,
      prohibitedClaimsNotes,
      status,
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
    .header('ETag', `"${result.product.version}"`)
    .type('application/json; charset=utf-8')
    .send(serializeProduct(result.product, { duplicateWarning: result.duplicateWarning }));
}

export async function handleArchiveProduct(
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
  const auditContext = extractAuditContext(request);

  const result = await archiveProduct(
    {
      workspaceId,
      userId: authContext.user.id,
      productId,
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
    .header('ETag', `"${result.product.version}"`)
    .type('application/json; charset=utf-8')
    .send(serializeProduct(result.product, { alreadyArchived: result.alreadyArchived }));
}
