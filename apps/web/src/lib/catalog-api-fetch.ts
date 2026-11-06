import { ApiError, validateProblemDetails } from './api-validators-common.js';

export async function parseProblemResponse(res: Response): Promise<never> {
  const contentType = res.headers.get('content-type') ?? '';
  const isJson =
    contentType.includes('application/json') || contentType.includes('application/problem+json');

  let raw: unknown = null;
  if (isJson) {
    try {
      raw = await res.json();
    } catch {
      // Fallback
    }
  }

  const problem = validateProblemDetails(raw, res.status, res.statusText);
  throw new ApiError(res.status, problem);
}

export async function parseSuccessfulJson(res: Response): Promise<unknown> {
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

export function handleNetworkError(err: unknown, action: string): never {
  if (err instanceof Error && err.name === 'AbortError') {
    throw err;
  }
  throw new ApiError(0, {
    status: 0,
    title: 'Network Error',
    detail: `Unable to connect to service to ${action}. Please check your connection and retry.`,
  });
}
