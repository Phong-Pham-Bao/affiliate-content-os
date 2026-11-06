import type {
  CurrentUserDTO,
  CurrentSessionDTO,
  CurrentUserResponse,
  WorkspaceSummaryItem,
} from '../types/web-state.js';
import {
  ApiError,
  hasExactOwnKeys,
  isPlainObject,
  isValidRfc3339DateTime,
  isValidUuidV7,
  validateProblemDetails,
} from './api-validators-common.js';
import { validateWorkspaceDetails } from './workspace-details-validator.js';

export {
  ApiError,
  hasExactOwnKeys,
  isPlainObject,
  isValidRfc3339DateTime,
  isValidUuidV7,
  validateProblemDetails,
  validateWorkspaceDetails,
};

const VALID_ROLES = new Set<string>(['owner', 'editor', 'viewer']);

export const EXPECTED_ME_ROOT_KEYS = ['user', 'session', 'workspaceAccess'] as const;
export const EXPECTED_USER_KEYS = ['id', 'email', 'displayName'] as const;
export const EXPECTED_SESSION_KEYS = ['idleExpiresAt', 'absoluteExpiresAt'] as const;
export const EXPECTED_WORKSPACE_ACCESS_KEYS = ['items', 'hasMore'] as const;
export const EXPECTED_SUMMARY_ITEM_KEYS = ['id', 'name', 'slug', 'timezone', 'role'] as const;

function createMalformedError(detail = 'Server returned an invalid response structure'): ApiError {
  return new ApiError(200, {
    status: 200,
    title: 'Malformed Response',
    detail,
  });
}

export function validateCurrentUserResponse(data: unknown): CurrentUserResponse {
  if (!isPlainObject(data)) {
    throw createMalformedError('Response root must be a plain object');
  }

  if (!hasExactOwnKeys(data, EXPECTED_ME_ROOT_KEYS)) {
    throw createMalformedError('Response root has unexpected, extra, or missing fields');
  }

  if (!isPlainObject(data.user)) {
    throw createMalformedError('Field user must be a plain object');
  }
  if (!hasExactOwnKeys(data.user, EXPECTED_USER_KEYS)) {
    throw createMalformedError('Field user has unexpected, extra, or missing fields');
  }

  const userObj = data.user;
  if (!isValidUuidV7(userObj.id)) {
    throw createMalformedError('Field user.id must be a valid canonical UUIDv7');
  }
  if (userObj.email !== null && (typeof userObj.email !== 'string' || userObj.email.length > 320)) {
    throw createMalformedError('Field user.email must be string or null');
  }
  if (
    userObj.displayName !== null &&
    (typeof userObj.displayName !== 'string' || userObj.displayName.length > 256)
  ) {
    throw createMalformedError('Field user.displayName must be string or null');
  }

  const user: CurrentUserDTO = {
    id: userObj.id,
    email: userObj.email as string | null,
    displayName: userObj.displayName as string | null,
  };

  if (!isPlainObject(data.session)) {
    throw createMalformedError('Field session must be a plain object');
  }
  if (!hasExactOwnKeys(data.session, EXPECTED_SESSION_KEYS)) {
    throw createMalformedError('Field session has unexpected, extra, or missing fields');
  }

  const sessionObj = data.session;
  if (!isValidRfc3339DateTime(sessionObj.idleExpiresAt)) {
    throw createMalformedError(
      'Field session.idleExpiresAt must be a valid RFC3339 date-time with timezone',
    );
  }
  if (!isValidRfc3339DateTime(sessionObj.absoluteExpiresAt)) {
    throw createMalformedError(
      'Field session.absoluteExpiresAt must be a valid RFC3339 date-time with timezone',
    );
  }
  if (
    Date.parse(sessionObj.idleExpiresAt as string) >
    Date.parse(sessionObj.absoluteExpiresAt as string)
  ) {
    throw createMalformedError('Field session.idleExpiresAt must be <= session.absoluteExpiresAt');
  }

  const session: CurrentSessionDTO = {
    idleExpiresAt: sessionObj.idleExpiresAt as string,
    absoluteExpiresAt: sessionObj.absoluteExpiresAt as string,
  };

  if (!isPlainObject(data.workspaceAccess)) {
    throw createMalformedError('Field workspaceAccess must be a plain object');
  }
  if (!hasExactOwnKeys(data.workspaceAccess, EXPECTED_WORKSPACE_ACCESS_KEYS)) {
    throw createMalformedError('Field workspaceAccess has unexpected, extra, or missing fields');
  }

  const wsAccessObj = data.workspaceAccess;
  if (typeof wsAccessObj.hasMore !== 'boolean') {
    throw createMalformedError('Field workspaceAccess.hasMore must be a boolean');
  }
  if (!Array.isArray(wsAccessObj.items)) {
    throw createMalformedError('Field workspaceAccess.items must be an array');
  }
  if (wsAccessObj.items.length > 100) {
    throw createMalformedError('Field workspaceAccess.items cannot exceed 100 items');
  }

  const items: WorkspaceSummaryItem[] = [];
  for (const item of wsAccessObj.items) {
    if (!isPlainObject(item)) {
      throw createMalformedError('WorkspaceSummaryItem must be a plain object');
    }
    if (!hasExactOwnKeys(item, EXPECTED_SUMMARY_ITEM_KEYS)) {
      throw createMalformedError('WorkspaceSummaryItem has unexpected, extra, or missing fields');
    }
    if (!isValidUuidV7(item.id)) {
      throw createMalformedError('WorkspaceSummaryItem.id must be a valid canonical UUIDv7');
    }
    if (typeof item.name !== 'string' || item.name.length < 1 || item.name.length > 100) {
      throw createMalformedError('WorkspaceSummaryItem.name must be between 1 and 100 characters');
    }
    if (typeof item.slug !== 'string' || item.slug.length < 2 || item.slug.length > 64) {
      throw createMalformedError('WorkspaceSummaryItem.slug must be between 2 and 64 characters');
    }
    if (
      typeof item.timezone !== 'string' ||
      item.timezone.length < 1 ||
      item.timezone.length > 64
    ) {
      throw createMalformedError(
        'WorkspaceSummaryItem.timezone must be between 1 and 64 characters',
      );
    }
    if (typeof item.role !== 'string' || !VALID_ROLES.has(item.role)) {
      throw createMalformedError('WorkspaceSummaryItem.role must be owner, editor, or viewer');
    }

    items.push({
      id: item.id,
      name: item.name,
      slug: item.slug,
      timezone: item.timezone,
      role: item.role as 'owner' | 'editor' | 'viewer',
    });
  }

  return {
    user,
    session,
    workspaceAccess: {
      items,
      hasMore: wsAccessObj.hasMore,
    },
  };
}
