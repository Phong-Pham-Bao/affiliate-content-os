import type { CurrentUserResponse, WorkspaceDetails } from '../types/web-state.js';
import {
  ApiError,
  validateCurrentUserResponse,
  validateProblemDetails,
  validateWorkspaceDetails,
} from './api-validators.js';

export { ApiError };

async function parseProblemResponse(res: Response): Promise<never> {
  const contentType = res.headers.get('content-type') ?? '';
  const isJson =
    contentType.includes('application/json') || contentType.includes('application/problem+json');

  let raw: unknown = null;
  if (isJson) {
    try {
      raw = await res.json();
    } catch {
      // Fall back to defensive problem payload below
    }
  }

  const problem = validateProblemDetails(raw, res.status, res.statusText);
  throw new ApiError(res.status, problem);
}

async function parseSuccessfulJson(res: Response): Promise<unknown> {
  const contentType = res.headers.get('content-type') ?? '';
  const isJson =
    contentType.includes('application/json') || contentType.includes('application/problem+json');

  if (!isJson) {
    throw new ApiError(res.status, {
      status: res.status,
      title: 'Malformed Response',
      detail: 'Server response is not JSON',
    });
  }

  try {
    return await res.json();
  } catch {
    throw new ApiError(res.status, {
      status: res.status,
      title: 'Malformed Response',
      detail: 'Server response contains malformed JSON',
    });
  }
}

export async function fetchCurrentUser(): Promise<CurrentUserResponse | null> {
  let res: Response;
  try {
    res = await fetch('/api/v1/me', {
      method: 'GET',
      headers: { Accept: 'application/json' },
      credentials: 'include',
    });
  } catch (_err: unknown) {
    throw new ApiError(0, {
      status: 0,
      title: 'Network Error',
      detail:
        'Unable to connect to authentication service. Please check your connection and retry.',
    });
  }

  if (res.status === 401) {
    return null;
  }

  if (!res.ok) {
    return parseProblemResponse(res);
  }

  const json = await parseSuccessfulJson(res);
  return validateCurrentUserResponse(json);
}

export async function logoutUser(): Promise<void> {
  let res: Response;
  try {
    res = await fetch('/api/v1/logout', {
      method: 'POST',
      credentials: 'include',
    });
  } catch (_err: unknown) {
    throw new ApiError(0, {
      status: 0,
      title: 'Network Error',
      detail: 'Unable to connect to authentication service for sign out. Please retry.',
    });
  }

  if (res.status === 204) {
    return;
  }

  if (res.status >= 200 && res.status < 300) {
    throw new ApiError(res.status, {
      status: res.status,
      title: 'Unexpected Response',
      detail: `Logout returned unexpected success status ${res.status}`,
    });
  }

  return parseProblemResponse(res);
}

export interface CreateWorkspacePayload {
  readonly name: string;
  readonly slug: string;
  readonly timezone: string;
  readonly brandVoice?: string | null | undefined;
  readonly defaultDisclosure?: string | null | undefined;
  readonly aiEnabled?: boolean | undefined;
}

export async function createWorkspaceApi(
  payload: CreateWorkspacePayload,
  idempotencyKey: string,
): Promise<WorkspaceDetails> {
  if (typeof idempotencyKey !== 'string' || idempotencyKey.trim().length === 0) {
    throw new Error('createWorkspaceApi requires a non-empty idempotency key');
  }

  let res: Response;
  try {
    res = await fetch('/api/v1/workspaces', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      credentials: 'include',
      body: JSON.stringify(payload),
    });
  } catch (_err: unknown) {
    throw new ApiError(0, {
      status: 0,
      title: 'Network Error',
      detail: 'Unable to connect to workspace service. Please check your connection and retry.',
    });
  }

  if (!res.ok) {
    return parseProblemResponse(res);
  }

  const json = await parseSuccessfulJson(res);
  return validateWorkspaceDetails(json, res.status);
}

export async function fetchWorkspaceDetails(
  workspaceId: string,
  signal?: AbortSignal,
): Promise<WorkspaceDetails> {
  let res: Response;
  try {
    res = await fetch(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      credentials: 'include',
      ...(signal ? { signal } : {}),
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw err;
    }
    throw new ApiError(0, {
      status: 0,
      title: 'Network Error',
      detail: 'Unable to connect to workspace service. Please check your connection and retry.',
    });
  }

  if (!res.ok) {
    return parseProblemResponse(res);
  }

  const json = await parseSuccessfulJson(res);
  return validateWorkspaceDetails(json, res.status);
}
