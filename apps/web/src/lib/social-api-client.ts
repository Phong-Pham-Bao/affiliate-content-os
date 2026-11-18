import type {
  SocialAccountDTO,
  SocialAuthorizeResponseDTO,
  SocialCallbackResultDTO,
  SocialPlatform,
} from '../types/social.js';

export class SocialApiClientError extends Error {
  public readonly status: number;
  public readonly code: string;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = 'SocialApiClientError';
    this.status = status;
    this.code = code;
  }
}

async function handleApiResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let code = 'UNKNOWN_ERROR';
    let detail = `Request failed with status ${res.status}`;
    try {
      const data = await res.json();
      if (typeof data.code === 'string') code = data.code;
      if (typeof data.detail === 'string') detail = data.detail;
    } catch {
      // Ignore JSON parse errors on non-OK responses
    }
    throw new SocialApiClientError(detail, res.status, code);
  }
  return res.json() as Promise<T>;
}

export async function fetchSocialAccounts(
  workspaceId: string,
  signal?: AbortSignal,
): Promise<readonly SocialAccountDTO[]> {
  const res = await fetch(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/social-accounts`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    ...(signal ? { signal } : {}),
  });
  const data = await handleApiResponse<{ items: readonly SocialAccountDTO[] }>(res);
  return data.items;
}

export async function beginSocialAuthorize(
  workspaceId: string,
  platform: SocialPlatform,
  returnTo?: string,
): Promise<SocialAuthorizeResponseDTO> {
  const idempotencyKey = crypto.randomUUID();
  const res = await fetch(
    `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/social-connections/${encodeURIComponent(platform)}/authorize`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify({ returnTo: returnTo ?? window.location.pathname }),
    },
  );
  const data = await handleApiResponse<SocialAuthorizeResponseDTO>(res);

  // Validate authorizationUrl shape and origin
  try {
    const url = new URL(data.authorizationUrl, window.location.origin);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('Invalid authorization URL protocol');
    }
  } catch {
    throw new SocialApiClientError(
      'Server returned an invalid authorization URL.',
      500,
      'INVALID_AUTHORIZATION_URL',
    );
  }

  return data;
}

export async function fetchCallbackResult(
  workspaceId: string,
  resultKey: string,
  signal?: AbortSignal,
): Promise<SocialCallbackResultDTO> {
  const res = await fetch(
    `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/social-connections/callback-results/${encodeURIComponent(resultKey)}`,
    {
      method: 'GET',
      headers: { Accept: 'application/json' },
      ...(signal ? { signal } : {}),
    },
  );
  return handleApiResponse<SocialCallbackResultDTO>(res);
}
