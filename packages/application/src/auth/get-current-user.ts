import util from 'node:util';
import { isValidIsoTimestamp, isValidUuidV7 } from '@affiliate-content-os/domain';
import { AuthenticationRequiredError } from './errors.js';
import type { AuthenticatedSessionContext } from './authenticate-session.js';
import type { WorkspaceSummaryItemDTO, WorkspaceSummaryPort } from './ports.js';

export interface CurrentUserResponseDTO {
  readonly user: {
    readonly id: string;
    readonly email: string | null;
    readonly displayName: string | null;
  };
  readonly session: {
    readonly idleExpiresAt: string;
    readonly absoluteExpiresAt: string;
  };
  readonly workspaceAccess: {
    readonly items: readonly WorkspaceSummaryItemDTO[];
    readonly hasMore: boolean;
  };
}

export interface GetCurrentUserDependencies {
  readonly workspaceSummary: WorkspaceSummaryPort;
}

function isProxySafe(value: unknown): boolean {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) {
    return false;
  }
  try {
    return util.types.isProxy(value);
  } catch {
    return true;
  }
}

const ALLOWED_CTX_KEYS = new Set(['user', 'session', 'rotatedToken']);
const ALLOWED_USER_KEYS = new Set([
  'id',
  'identityProvider',
  'identitySubject',
  'email',
  'displayName',
  'status',
  'createdAt',
  'updatedAt',
  'version',
]);
const ALLOWED_SESS_KEYS = new Set(['id', 'userId', 'idleExpiresAt', 'absoluteExpiresAt']);
const ALLOWED_SUMMARIES_KEYS = new Set(['items', 'hasMore']);
const ALLOWED_ITEM_KEYS = new Set(['id', 'name', 'slug', 'timezone', 'role']);
const SLUG_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const ROTATED_TOKEN_REGEX = /^[A-Za-z0-9_-]{43}$/;

export async function getCurrentUser(
  context: AuthenticatedSessionContext,
  deps: GetCurrentUserDependencies,
): Promise<CurrentUserResponseDTO> {
  if (typeof context !== 'object' || context === null || isProxySafe(context)) {
    throw new AuthenticationRequiredError();
  }
  const ctxProto = Object.getPrototypeOf(context);
  if (ctxProto !== Object.prototype && ctxProto !== null) {
    throw new AuthenticationRequiredError();
  }

  const ctxKeys = Reflect.ownKeys(context);
  if (ctxKeys.length !== ALLOWED_CTX_KEYS.size) {
    throw new AuthenticationRequiredError();
  }
  for (const k of ctxKeys) {
    if (typeof k !== 'string' || !ALLOWED_CTX_KEYS.has(k)) {
      throw new AuthenticationRequiredError();
    }
  }

  const ctxUserDesc = Object.getOwnPropertyDescriptor(context, 'user');
  const ctxSessDesc = Object.getOwnPropertyDescriptor(context, 'session');
  const ctxRotatedDesc = Object.getOwnPropertyDescriptor(context, 'rotatedToken');

  if (
    !ctxUserDesc ||
    ctxUserDesc.get !== undefined ||
    ctxUserDesc.set !== undefined ||
    !ctxSessDesc ||
    ctxSessDesc.get !== undefined ||
    ctxSessDesc.set !== undefined ||
    !ctxRotatedDesc ||
    ctxRotatedDesc.get !== undefined ||
    ctxRotatedDesc.set !== undefined
  ) {
    throw new AuthenticationRequiredError();
  }

  const rotatedToken = ctxRotatedDesc.value;
  if (
    rotatedToken !== null &&
    (typeof rotatedToken !== 'string' || !ROTATED_TOKEN_REGEX.test(rotatedToken))
  ) {
    throw new AuthenticationRequiredError();
  }

  const rawUser = ctxUserDesc.value;
  if (typeof rawUser !== 'object' || rawUser === null || isProxySafe(rawUser)) {
    throw new AuthenticationRequiredError();
  }
  const userProto = Object.getPrototypeOf(rawUser);
  if (userProto !== Object.prototype && userProto !== null) {
    throw new AuthenticationRequiredError();
  }

  const userKeys = Reflect.ownKeys(rawUser);
  if (userKeys.length !== ALLOWED_USER_KEYS.size) {
    throw new AuthenticationRequiredError();
  }
  for (const k of userKeys) {
    if (typeof k !== 'string' || !ALLOWED_USER_KEYS.has(k)) {
      throw new AuthenticationRequiredError();
    }
  }

  const userDescriptors: Record<string, PropertyDescriptor | undefined> = Object.create(null);
  for (const k of ALLOWED_USER_KEYS) {
    const d = Object.getOwnPropertyDescriptor(rawUser, k);
    if (!d || d.get !== undefined || d.set !== undefined) {
      throw new AuthenticationRequiredError();
    }
    userDescriptors[k] = d;
  }

  const userId = userDescriptors['id']!.value;
  const identityProvider = userDescriptors['identityProvider']!.value;
  const identitySubject = userDescriptors['identitySubject']!.value;
  const userEmail = userDescriptors['email']!.value;
  const userDisplayName = userDescriptors['displayName']!.value;
  const userStatus = userDescriptors['status']!.value;
  const userCreatedAt = userDescriptors['createdAt']!.value;
  const userUpdatedAt = userDescriptors['updatedAt']!.value;
  const userVersion = userDescriptors['version']!.value;

  if (
    typeof userId !== 'string' ||
    !isValidUuidV7(userId) ||
    typeof identityProvider !== 'string' ||
    identityProvider.length === 0 ||
    identityProvider.trim() !== identityProvider ||
    typeof identitySubject !== 'string' ||
    identitySubject.length === 0 ||
    identitySubject.trim() !== identitySubject ||
    (userEmail !== null && typeof userEmail !== 'string') ||
    (userDisplayName !== null && typeof userDisplayName !== 'string') ||
    userStatus !== 'active' ||
    typeof userCreatedAt !== 'string' ||
    !isValidIsoTimestamp(userCreatedAt) ||
    typeof userUpdatedAt !== 'string' ||
    !isValidIsoTimestamp(userUpdatedAt) ||
    userCreatedAt > userUpdatedAt ||
    typeof userVersion !== 'number' ||
    !Number.isSafeInteger(userVersion) ||
    userVersion < 1
  ) {
    throw new AuthenticationRequiredError();
  }

  const rawSession = ctxSessDesc.value;
  if (typeof rawSession !== 'object' || rawSession === null || isProxySafe(rawSession)) {
    throw new AuthenticationRequiredError();
  }
  const sessProto = Object.getPrototypeOf(rawSession);
  if (sessProto !== Object.prototype && sessProto !== null) {
    throw new AuthenticationRequiredError();
  }

  const sessKeys = Reflect.ownKeys(rawSession);
  if (sessKeys.length !== ALLOWED_SESS_KEYS.size) {
    throw new AuthenticationRequiredError();
  }
  for (const k of sessKeys) {
    if (typeof k !== 'string' || !ALLOWED_SESS_KEYS.has(k)) {
      throw new AuthenticationRequiredError();
    }
  }

  const sessDescriptors: Record<string, PropertyDescriptor | undefined> = Object.create(null);
  for (const k of ALLOWED_SESS_KEYS) {
    const d = Object.getOwnPropertyDescriptor(rawSession, k);
    if (!d || d.get !== undefined || d.set !== undefined) {
      throw new AuthenticationRequiredError();
    }
    sessDescriptors[k] = d;
  }

  const sessId = sessDescriptors['id']!.value;
  const sessUserId = sessDescriptors['userId']!.value;
  const idleExpiresAt = sessDescriptors['idleExpiresAt']!.value;
  const absoluteExpiresAt = sessDescriptors['absoluteExpiresAt']!.value;

  if (
    typeof sessId !== 'string' ||
    !isValidUuidV7(sessId) ||
    typeof sessUserId !== 'string' ||
    !isValidUuidV7(sessUserId) ||
    sessUserId !== userId ||
    typeof idleExpiresAt !== 'string' ||
    !isValidIsoTimestamp(idleExpiresAt) ||
    typeof absoluteExpiresAt !== 'string' ||
    !isValidIsoTimestamp(absoluteExpiresAt) ||
    idleExpiresAt > absoluteExpiresAt
  ) {
    throw new AuthenticationRequiredError();
  }

  const rawSummaries = await deps.workspaceSummary.listActiveWorkspaceSummaries(userId);
  if (typeof rawSummaries !== 'object' || rawSummaries === null || isProxySafe(rawSummaries)) {
    throw new AuthenticationRequiredError();
  }
  const sumProto = Object.getPrototypeOf(rawSummaries);
  if (sumProto !== Object.prototype && sumProto !== null) {
    throw new AuthenticationRequiredError();
  }

  const sumKeys = Reflect.ownKeys(rawSummaries);
  if (sumKeys.length !== ALLOWED_SUMMARIES_KEYS.size) {
    throw new AuthenticationRequiredError();
  }
  for (const k of sumKeys) {
    if (typeof k !== 'string' || !ALLOWED_SUMMARIES_KEYS.has(k)) {
      throw new AuthenticationRequiredError();
    }
  }

  const itemsDesc = Object.getOwnPropertyDescriptor(rawSummaries, 'items');
  const hasMoreDesc = Object.getOwnPropertyDescriptor(rawSummaries, 'hasMore');
  if (
    !itemsDesc ||
    itemsDesc.get !== undefined ||
    itemsDesc.set !== undefined ||
    !hasMoreDesc ||
    hasMoreDesc.get !== undefined ||
    hasMoreDesc.set !== undefined ||
    typeof hasMoreDesc.value !== 'boolean'
  ) {
    throw new AuthenticationRequiredError();
  }

  const rawItems = itemsDesc.value;
  if (
    typeof rawItems !== 'object' ||
    rawItems === null ||
    isProxySafe(rawItems) ||
    !Array.isArray(rawItems) ||
    Object.getPrototypeOf(rawItems) !== Array.prototype
  ) {
    throw new AuthenticationRequiredError();
  }

  const lenDesc = Object.getOwnPropertyDescriptor(rawItems, 'length');
  if (
    !lenDesc ||
    lenDesc.get !== undefined ||
    lenDesc.set !== undefined ||
    typeof lenDesc.value !== 'number' ||
    !Number.isSafeInteger(lenDesc.value) ||
    lenDesc.value < 0 ||
    lenDesc.value > 100
  ) {
    throw new AuthenticationRequiredError();
  }

  const len = lenDesc.value;
  const itemKeys = Reflect.ownKeys(rawItems);
  if (itemKeys.length !== len + 1) {
    throw new AuthenticationRequiredError();
  }
  for (let i = 0; i < len; i++) {
    if (itemKeys[i] !== String(i)) {
      throw new AuthenticationRequiredError();
    }
  }
  if (itemKeys[len] !== 'length') {
    throw new AuthenticationRequiredError();
  }

  const items: WorkspaceSummaryItemDTO[] = new Array(len);
  for (let i = 0; i < len; i++) {
    const itemDesc = Object.getOwnPropertyDescriptor(rawItems, String(i));
    if (!itemDesc || itemDesc.get !== undefined || itemDesc.set !== undefined) {
      throw new AuthenticationRequiredError();
    }
    const item = itemDesc.value;
    if (typeof item !== 'object' || item === null || isProxySafe(item)) {
      throw new AuthenticationRequiredError();
    }
    const itemProto = Object.getPrototypeOf(item);
    if (itemProto !== Object.prototype && itemProto !== null) {
      throw new AuthenticationRequiredError();
    }

    const iKeys = Reflect.ownKeys(item);
    if (iKeys.length !== ALLOWED_ITEM_KEYS.size) {
      throw new AuthenticationRequiredError();
    }
    for (const k of iKeys) {
      if (typeof k !== 'string' || !ALLOWED_ITEM_KEYS.has(k)) {
        throw new AuthenticationRequiredError();
      }
    }

    const idD = Object.getOwnPropertyDescriptor(item, 'id');
    const nameD = Object.getOwnPropertyDescriptor(item, 'name');
    const slugD = Object.getOwnPropertyDescriptor(item, 'slug');
    const tzD = Object.getOwnPropertyDescriptor(item, 'timezone');
    const roleD = Object.getOwnPropertyDescriptor(item, 'role');

    if (
      !idD ||
      idD.get !== undefined ||
      idD.set !== undefined ||
      !nameD ||
      nameD.get !== undefined ||
      nameD.set !== undefined ||
      !slugD ||
      slugD.get !== undefined ||
      slugD.set !== undefined ||
      !tzD ||
      tzD.get !== undefined ||
      tzD.set !== undefined ||
      !roleD ||
      roleD.get !== undefined ||
      roleD.set !== undefined
    ) {
      throw new AuthenticationRequiredError();
    }

    const id = idD.value;
    const name = nameD.value;
    const slug = slugD.value;
    const timezone = tzD.value;
    const role = roleD.value;

    if (
      typeof id !== 'string' ||
      !isValidUuidV7(id) ||
      typeof name !== 'string' ||
      name.length === 0 ||
      typeof slug !== 'string' ||
      !SLUG_REGEX.test(slug) ||
      typeof timezone !== 'string' ||
      timezone.length === 0 ||
      (role !== 'owner' && role !== 'editor' && role !== 'viewer')
    ) {
      throw new AuthenticationRequiredError();
    }

    items[i] = Object.freeze({ id, name, slug, timezone, role });
  }

  return Object.freeze({
    user: Object.freeze({
      id: userId,
      email: userEmail,
      displayName: userDisplayName,
    }),
    session: Object.freeze({
      idleExpiresAt,
      absoluteExpiresAt,
    }),
    workspaceAccess: Object.freeze({
      items: Object.freeze(items),
      hasMore: hasMoreDesc.value,
    }),
  });
}
