import util from 'node:util';
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
  try {
    return util.types.isProxy(value);
  } catch {
    return true;
  }
}

function getOwnData(obj: object, prop: string): unknown {
  const desc = Object.getOwnPropertyDescriptor(obj, prop);
  if (!desc || desc.get !== undefined || desc.set !== undefined) {
    return undefined;
  }
  return desc.value;
}

export async function getCurrentUser(
  context: AuthenticatedSessionContext,
  deps: GetCurrentUserDependencies,
): Promise<CurrentUserResponseDTO> {
  if (typeof context !== 'object' || context === null || isProxySafe(context)) {
    throw new AuthenticationRequiredError();
  }

  const rawUser = getOwnData(context, 'user');
  if (typeof rawUser !== 'object' || rawUser === null || isProxySafe(rawUser)) {
    throw new AuthenticationRequiredError();
  }

  const userId = getOwnData(rawUser, 'id');
  const userEmail = getOwnData(rawUser, 'email');
  const userDisplayName = getOwnData(rawUser, 'displayName');
  if (typeof userId !== 'string') {
    throw new AuthenticationRequiredError();
  }

  const rawSession = getOwnData(context, 'session');
  if (typeof rawSession !== 'object' || rawSession === null || isProxySafe(rawSession)) {
    throw new AuthenticationRequiredError();
  }

  const idleExpiresAt = getOwnData(rawSession, 'idleExpiresAt');
  const absoluteExpiresAt = getOwnData(rawSession, 'absoluteExpiresAt');
  if (typeof idleExpiresAt !== 'string' || typeof absoluteExpiresAt !== 'string') {
    throw new AuthenticationRequiredError();
  }

  const rawSummaries = await deps.workspaceSummary.listActiveWorkspaceSummaries(userId);
  if (typeof rawSummaries !== 'object' || rawSummaries === null || isProxySafe(rawSummaries)) {
    throw new AuthenticationRequiredError();
  }

  const hasMore = getOwnData(rawSummaries, 'hasMore');
  const rawItems = getOwnData(rawSummaries, 'items');
  if (typeof hasMore !== 'boolean' || !Array.isArray(rawItems) || isProxySafe(rawItems)) {
    throw new AuthenticationRequiredError();
  }
  if (Object.getPrototypeOf(rawItems) !== Array.prototype) {
    throw new AuthenticationRequiredError();
  }

  const lenDesc = Object.getOwnPropertyDescriptor(rawItems, 'length');
  if (
    !lenDesc ||
    lenDesc.get !== undefined ||
    lenDesc.set !== undefined ||
    typeof lenDesc.value !== 'number'
  ) {
    throw new AuthenticationRequiredError();
  }

  const items: WorkspaceSummaryItemDTO[] = [];
  for (let i = 0; i < lenDesc.value; i++) {
    const itemDesc = Object.getOwnPropertyDescriptor(rawItems, String(i));
    if (!itemDesc || itemDesc.get !== undefined || itemDesc.set !== undefined) {
      throw new AuthenticationRequiredError();
    }
    const item = itemDesc.value;
    if (typeof item !== 'object' || item === null || isProxySafe(item)) {
      throw new AuthenticationRequiredError();
    }
    const id = getOwnData(item, 'id');
    const name = getOwnData(item, 'name');
    const slug = getOwnData(item, 'slug');
    const timezone = getOwnData(item, 'timezone');
    const role = getOwnData(item, 'role');
    if (
      typeof id !== 'string' ||
      typeof name !== 'string' ||
      typeof slug !== 'string' ||
      typeof timezone !== 'string' ||
      (role !== 'owner' && role !== 'editor' && role !== 'viewer')
    ) {
      throw new AuthenticationRequiredError();
    }
    items.push(Object.freeze({ id, name, slug, timezone, role }));
  }

  return Object.freeze({
    user: Object.freeze({
      id: userId,
      email: typeof userEmail === 'string' ? userEmail : null,
      displayName: typeof userDisplayName === 'string' ? userDisplayName : null,
    }),
    session: Object.freeze({
      idleExpiresAt,
      absoluteExpiresAt,
    }),
    workspaceAccess: Object.freeze({
      items: Object.freeze(items),
      hasMore,
    }),
  });
}
