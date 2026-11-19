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

export function isAllowedAuthorizationUrl(rawUrl: string, windowOrigin: string): boolean {
  try {
    const url = new URL(rawUrl, windowOrigin);
    if (url.origin === windowOrigin && url.pathname === '/fake-social-auth') {
      return true;
    }
    if (
      (url.origin === 'https://threads.net' || url.origin === 'https://www.threads.net') &&
      url.pathname === '/oauth/authorize'
    ) {
      return true;
    }
    if (
      url.origin === 'https://www.tiktok.com' &&
      (url.pathname === '/v2/auth/authorize/' || url.pathname === '/auth/authorize/')
    ) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
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

  // Validate authorizationUrl against adapter/config-owned allowed origins and paths
  if (!isAllowedAuthorizationUrl(data.authorizationUrl, window.location.origin)) {
    throw new SocialApiClientError(
      'Server returned an untrusted or invalid authorization URL.',
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

export async function beginSocialReconnect(
  workspaceId: string,
  accountId: string,
  returnTo?: string,
): Promise<SocialAuthorizeResponseDTO> {
  const idempotencyKey = crypto.randomUUID();
  const res = await fetch(
    `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/social-accounts/${encodeURIComponent(accountId)}/reconnect`,
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

  if (!isAllowedAuthorizationUrl(data.authorizationUrl, window.location.origin)) {
    throw new SocialApiClientError(
      'Server returned an untrusted or invalid authorization URL.',
      500,
      'INVALID_AUTHORIZATION_URL',
    );
  }

  return data;
}

export async function refreshSocialAccount(
  workspaceId: string,
  accountId: string,
): Promise<SocialAccountDTO> {
  const idempotencyKey = crypto.randomUUID();
  const res = await fetch(
    `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/social-accounts/${encodeURIComponent(accountId)}/refresh`,
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
    },
  );
  return handleApiResponse<SocialAccountDTO>(res);
}

export async function disconnectSocialAccount(
  workspaceId: string,
  accountId: string,
  expectedVersion: number,
): Promise<SocialAccountDTO> {
  const idempotencyKey = crypto.randomUUID();
  const res = await fetch(
    `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/social-accounts/${encodeURIComponent(accountId)}`,
    {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'Idempotency-Key': idempotencyKey,
        'If-Match': `"${expectedVersion}"`,
      },
      body: JSON.stringify({ expectedVersion }),
    },
  );
  return handleApiResponse<SocialAccountDTO>(res);
}
