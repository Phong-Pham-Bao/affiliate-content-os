import type {
  ConfirmFactSetResponse,
  CreateFactSetPayload,
  FactSetDetailResponse,
  FactSetListResponse,
} from '../types/catalog.js';
import {
  handleNetworkError,
  parseProblemResponse,
  parseSuccessfulJson,
} from './catalog-api-fetch.js';
import {
  validateConfirmFactSetResponse,
  validateFactSetDetailResponse,
  validateFactSetListResponse,
} from './catalog-validators-fact.js';

export async function fetchFactSetsApi(
  workspaceId: string,
  productId: string,
  query?: { limit?: number; after?: string },
  signal?: AbortSignal,
): Promise<FactSetListResponse> {
  const params = new URLSearchParams();
  if (query?.limit) params.set('limit', String(query.limit));
  if (query?.after) params.set('after', query.after);

  const qs = params.toString() ? `?${params.toString()}` : '';
  let res: Response;
  try {
    res = await fetch(
      `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/products/${encodeURIComponent(productId)}/fact-sets${qs}`,
      {
        method: 'GET',
        headers: { Accept: 'application/json' },
        credentials: 'include',
        ...(signal ? { signal } : {}),
      },
    );
  } catch (err) {
    handleNetworkError(err, 'load fact sets');
  }

  if (!res.ok) return parseProblemResponse(res);
  const json = await parseSuccessfulJson(res);
  return validateFactSetListResponse(json);
}

export async function createFactSetApi(
  workspaceId: string,
  productId: string,
  payload: CreateFactSetPayload,
  idempotencyKey: string,
): Promise<FactSetDetailResponse> {
  let res: Response;
  try {
    res = await fetch(
      `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/products/${encodeURIComponent(productId)}/fact-sets`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        credentials: 'include',
        body: JSON.stringify(payload),
      },
    );
  } catch (err) {
    handleNetworkError(err, 'propose fact set');
  }

  if (!res.ok) return parseProblemResponse(res);
  const json = await parseSuccessfulJson(res);
  return validateFactSetDetailResponse(json);
}

export async function fetchFactSetApi(
  workspaceId: string,
  productId: string,
  factSetId: string,
  signal?: AbortSignal,
): Promise<FactSetDetailResponse> {
  let res: Response;
  try {
    res = await fetch(
      `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/products/${encodeURIComponent(productId)}/fact-sets/${encodeURIComponent(factSetId)}`,
      {
        method: 'GET',
        headers: { Accept: 'application/json' },
        credentials: 'include',
        ...(signal ? { signal } : {}),
      },
    );
  } catch (err) {
    handleNetworkError(err, 'load fact set details');
  }

  if (!res.ok) return parseProblemResponse(res);
  const json = await parseSuccessfulJson(res);
  return validateFactSetDetailResponse(json);
}

export async function confirmFactSetApi(
  workspaceId: string,
  productId: string,
  factSetId: string,
): Promise<ConfirmFactSetResponse> {
  let res: Response;
  try {
    res = await fetch(
      `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/products/${encodeURIComponent(productId)}/fact-sets/${encodeURIComponent(factSetId)}/confirm`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({}),
      },
    );
  } catch (err) {
    handleNetworkError(err, 'confirm fact set');
  }

  if (!res.ok) return parseProblemResponse(res);
  const json = await parseSuccessfulJson(res);
  return validateConfirmFactSetResponse(json);
}
