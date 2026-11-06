import type { WorkspaceDetails } from '../types/web-state.js';
import {
  ApiError,
  hasExactOwnKeys,
  isPlainObject,
  isValidRfc3339DateTime,
  isValidUuidV7,
} from './api-validators-common.js';

const VALID_ROLES = new Set<string>(['owner', 'editor', 'viewer']);
const VALID_WORKSPACE_STATUSES = new Set<string>(['active', 'suspended', 'deletion_pending']);

export const EXPECTED_WORKSPACE_DETAILS_KEYS = [
  'id',
  'name',
  'slug',
  'timezone',
  'brandVoice',
  'defaultDisclosure',
  'aiEnabled',
  'status',
  'role',
  'createdAt',
  'updatedAt',
  'version',
] as const;

export function validateWorkspaceDetails(data: unknown, status = 200): WorkspaceDetails {
  if (!isPlainObject(data)) {
    throw new ApiError(status, {
      status,
      title: 'Malformed Response',
      detail: 'Workspace details response must be a plain object',
    });
  }

  if (!hasExactOwnKeys(data, EXPECTED_WORKSPACE_DETAILS_KEYS)) {
    throw new ApiError(status, {
      status,
      title: 'Malformed Response',
      detail: 'Workspace details has unexpected, extra, or missing fields',
    });
  }

  if (!isValidUuidV7(data.id)) {
    throw new ApiError(status, {
      status,
      title: 'Malformed Response',
      detail: 'Field id must be a valid canonical UUIDv7',
    });
  }
  if (typeof data.name !== 'string' || data.name.length < 1 || data.name.length > 100) {
    throw new ApiError(status, {
      status,
      title: 'Malformed Response',
      detail: 'Field name must be between 1 and 100 characters',
    });
  }
  if (typeof data.slug !== 'string' || data.slug.length < 2 || data.slug.length > 64) {
    throw new ApiError(status, {
      status,
      title: 'Malformed Response',
      detail: 'Field slug must be between 2 and 64 characters',
    });
  }
  if (typeof data.timezone !== 'string' || data.timezone.length < 1 || data.timezone.length > 64) {
    throw new ApiError(status, {
      status,
      title: 'Malformed Response',
      detail: 'Field timezone must be between 1 and 64 characters',
    });
  }
  if (
    data.brandVoice !== null &&
    (typeof data.brandVoice !== 'string' || data.brandVoice.length > 2000)
  ) {
    throw new ApiError(status, {
      status,
      title: 'Malformed Response',
      detail: 'Field brandVoice must be string or null',
    });
  }
  if (
    data.defaultDisclosure !== null &&
    (typeof data.defaultDisclosure !== 'string' || data.defaultDisclosure.length > 2000)
  ) {
    throw new ApiError(status, {
      status,
      title: 'Malformed Response',
      detail: 'Field defaultDisclosure must be string or null',
    });
  }
  if (typeof data.aiEnabled !== 'boolean') {
    throw new ApiError(status, {
      status,
      title: 'Malformed Response',
      detail: 'Field aiEnabled must be a boolean',
    });
  }
  if (typeof data.status !== 'string' || !VALID_WORKSPACE_STATUSES.has(data.status)) {
    throw new ApiError(status, {
      status,
      title: 'Malformed Response',
      detail: 'Field status must be active, suspended, or deletion_pending',
    });
  }
  if (typeof data.role !== 'string' || !VALID_ROLES.has(data.role)) {
    throw new ApiError(status, {
      status,
      title: 'Malformed Response',
      detail: 'Field role must be owner, editor, or viewer',
    });
  }
  if (!isValidRfc3339DateTime(data.createdAt)) {
    throw new ApiError(status, {
      status,
      title: 'Malformed Response',
      detail: 'Field createdAt must be a valid RFC3339 date-time with timezone',
    });
  }
  if (!isValidRfc3339DateTime(data.updatedAt)) {
    throw new ApiError(status, {
      status,
      title: 'Malformed Response',
      detail: 'Field updatedAt must be a valid RFC3339 date-time with timezone',
    });
  }
  if (Date.parse(data.createdAt as string) > Date.parse(data.updatedAt as string)) {
    throw new ApiError(status, {
      status,
      title: 'Malformed Response',
      detail: 'Field createdAt must be <= updatedAt',
    });
  }
  if (typeof data.version !== 'number' || !Number.isInteger(data.version) || data.version < 1) {
    throw new ApiError(status, {
      status,
      title: 'Malformed Response',
      detail: 'Field version must be a positive integer >= 1',
    });
  }

  return {
    id: data.id,
    name: data.name,
    slug: data.slug,
    timezone: data.timezone,
    brandVoice: data.brandVoice as string | null,
    defaultDisclosure: data.defaultDisclosure as string | null,
    aiEnabled: data.aiEnabled,
    status: data.status as 'active' | 'suspended' | 'deletion_pending',
    role: data.role as 'owner' | 'editor' | 'viewer',
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
    version: data.version,
  };
}
