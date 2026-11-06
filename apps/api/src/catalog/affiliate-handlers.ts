import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  assertNoCoercionHooks,
  assertPlainObject,
  DomainValidationError,
  getDataPropertyDescriptor,
  isValidUuidV7,
  validateAffiliateLabel,
  validateAffiliateNetworkName,
  validateSafeHttpUrl,
} from '@affiliate-content-os/domain';
import {
  archiveAffiliateDestination,
  createAffiliateDestination,
  DefaultIdGenerator,
  listAffiliateDestinations,
  SystemClock,
  updateAffiliateDestination,
  ValidationError,
} from '@affiliate-content-os/application';
import { requireAuthenticatedSession } from '../auth/session-auth.js';
import {
  computeCanonicalAffiliateCreateHash,
  extractAuditContext,
  extractIdempotencyKey,
  extractIfMatchVersion,
  validateMutationOrigin,
} from './helpers.js';
import { serializeAffiliate } from './serializers.js';
import type { CatalogRouteDependencies } from './types.js';

export async function handleListAffiliateDestinations(
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
    readonly status?: string;
  };

  const result = await listAffiliateDestinations(
    {
      workspaceId,
      userId: authContext.user.id,
      productId,
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
      items: result.items.map((a) => serializeAffiliate(a)),
      page: {
        nextCursor: result.nextCursor,
        hasMore: result.nextCursor !== null,
      },
    });
}

export async function handleCreateAffiliateDestination(
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

  const labelDesc = getDataPropertyDescriptor(body, 'label');
  const urlDesc = getDataPropertyDescriptor(body, 'url');
  let networkNameVal: unknown = undefined;
  if ('networkName' in body) {
    networkNameVal = getDataPropertyDescriptor(body, 'networkName').value;
  }

  let label: string;
  let url: string;
  let networkName: string | null;

  try {
    label = validateAffiliateLabel(labelDesc.value);
    url = validateSafeHttpUrl(urlDesc.value, 'url');
    networkName = validateAffiliateNetworkName(networkNameVal);
  } catch (err) {
    if (err instanceof DomainValidationError) {
      throw new ValidationError(err.message, err.field);
    }
    throw err;
  }

  const requestHash = computeCanonicalAffiliateCreateHash({
    label,
    url,
    networkName,
  });

  const auditContext = extractAuditContext(request);

  const result = await createAffiliateDestination(
    {
      workspaceId,
      userId: authContext.user.id,
      productId,
      label,
      url,
      networkName,
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
      `/api/v1/workspaces/${result.workspaceId}/products/${result.productId}/affiliate-destinations/${result.id}`,
    )
    .header('ETag', `"${result.version}"`)
    .type('application/json; charset=utf-8')
    .send(serializeAffiliate(result));
}

export async function handleUpdateAffiliateDestination(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: CatalogRouteDependencies,
): Promise<void> {
  const authContext = await requireAuthenticatedSession(request, reply, deps.auth);
  const { workspaceId, productId, destinationId } = request.params as {
    readonly workspaceId: string;
    readonly productId: string;
    readonly destinationId: string;
  };
  if (!isValidUuidV7(workspaceId)) {
    throw new ValidationError('Invalid workspaceId parameter', 'workspaceId');
  }
  if (!isValidUuidV7(productId)) {
    throw new ValidationError('Invalid productId parameter', 'productId');
  }
  if (!isValidUuidV7(destinationId)) {
    throw new ValidationError('Invalid destinationId parameter', 'destinationId');
  }

  validateMutationOrigin(request, deps);
  const expectedVersion = extractIfMatchVersion(request);
  const auditContext = extractAuditContext(request);

  const body = assertPlainObject(request.body, 'body');

  for (const key of Object.getOwnPropertyNames(body)) {
    const desc = getDataPropertyDescriptor(body, key);
    assertNoCoercionHooks(desc.value, key);
  }

  let label: string | undefined;
  let url: string | undefined;
  let networkName: string | null | undefined;

  try {
    if ('label' in body) {
      label = validateAffiliateLabel(getDataPropertyDescriptor(body, 'label').value);
    }
    if ('url' in body) {
      url = validateSafeHttpUrl(getDataPropertyDescriptor(body, 'url').value, 'url');
    }
    if ('networkName' in body) {
      networkName = validateAffiliateNetworkName(
        getDataPropertyDescriptor(body, 'networkName').value,
      );
    }
  } catch (err) {
    if (err instanceof DomainValidationError) {
      throw new ValidationError(err.message, err.field);
    }
    throw err;
  }

  const result = await updateAffiliateDestination(
    {
      workspaceId,
      userId: authContext.user.id,
      productId,
      destinationId,
      expectedVersion,
      label,
      url,
      networkName,
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
    .header('ETag', `"${result.version}"`)
    .type('application/json; charset=utf-8')
    .send(serializeAffiliate(result));
}

export async function handleArchiveAffiliateDestination(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: CatalogRouteDependencies,
): Promise<void> {
  const authContext = await requireAuthenticatedSession(request, reply, deps.auth);
  const { workspaceId, productId, destinationId } = request.params as {
    readonly workspaceId: string;
    readonly productId: string;
    readonly destinationId: string;
  };
  if (!isValidUuidV7(workspaceId)) {
    throw new ValidationError('Invalid workspaceId parameter', 'workspaceId');
  }
  if (!isValidUuidV7(productId)) {
    throw new ValidationError('Invalid productId parameter', 'productId');
  }
  if (!isValidUuidV7(destinationId)) {
    throw new ValidationError('Invalid destinationId parameter', 'destinationId');
  }

  validateMutationOrigin(request, deps);
  const auditContext = extractAuditContext(request);

  const result = await archiveAffiliateDestination(
    {
      workspaceId,
      userId: authContext.user.id,
      productId,
      destinationId,
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
    .header('ETag', `"${result.destination.version}"`)
    .type('application/json; charset=utf-8')
    .send(serializeAffiliate(result.destination, { alreadyArchived: result.alreadyArchived }));
}
