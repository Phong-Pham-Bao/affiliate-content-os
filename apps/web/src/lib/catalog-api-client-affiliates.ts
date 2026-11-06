import type {
  AffiliateDestinationDTO,
  AffiliateListResponse,
  CreateAffiliatePayload,
  UpdateAffiliatePayload,
} from '../types/catalog.js';
import {
  handleNetworkError,
  parseProblemResponse,
  parseSuccessfulJson,
} from './catalog-api-fetch.js';
import {
  validateAffiliate,
  validateAffiliateListResponse,
} from './catalog-validators-affiliate.js';

export async function fetchAffiliatesApi(
  workspaceId: string,
  productId: string,
  query?: { limit?: number; after?: string; status?: string },
  signal?: AbortSignal,
): Promise<AffiliateListResponse> {
  const params = new URLSearchParams();
  if (query?.limit) params.set('limit', String(query.limit));
  if (query?.after) params.set('after', query.after);
  if (query?.status) params.set('status', query.status);

  const qs = params.toString() ? `?${params.toString()}` : '';
  let res: Response;
  try {
    res = await fetch(
      `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/products/${encodeURIComponent(productId)}/affiliate-destinations${qs}`,
      {
        method: 'GET',
        headers: { Accept: 'application/json' },
        credentials: 'include',
        ...(signal ? { signal } : {}),
      },
    );
  } catch (err) {
    handleNetworkError(err, 'load affiliate destinations');
  }

  if (!res.ok) return parseProblemResponse(res);
  const json = await parseSuccessfulJson(res);
  return validateAffiliateListResponse(json);
}

export async function createAffiliateApi(
  workspaceId: string,
  productId: string,
  payload: CreateAffiliatePayload,
  idempotencyKey: string,
): Promise<AffiliateDestinationDTO> {
  let res: Response;
  try {
    res = await fetch(
      `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/products/${encodeURIComponent(productId)}/affiliate-destinations`,
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
    handleNetworkError(err, 'create affiliate destination');
  }

  if (!res.ok) return parseProblemResponse(res);
  const json = await parseSuccessfulJson(res);
  return validateAffiliate(json);
}

export async function updateAffiliateApi(
  workspaceId: string,
  productId: string,
  destinationId: string,
  version: number,
  payload: UpdateAffiliatePayload,
): Promise<AffiliateDestinationDTO> {
  let res: Response;
  try {
    res = await fetch(
      `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/products/${encodeURIComponent(productId)}/affiliate-destinations/${encodeURIComponent(destinationId)}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'If-Match': `"${version}"`,
        },
        credentials: 'include',
        body: JSON.stringify(payload),
      },
    );
  } catch (err) {
    handleNetworkError(err, 'update affiliate destination');
  }

  if (!res.ok) return parseProblemResponse(res);
  const json = await parseSuccessfulJson(res);
  return validateAffiliate(json);
}

export async function archiveAffiliateApi(
  workspaceId: string,
  productId: string,
  destinationId: string,
): Promise<AffiliateDestinationDTO> {
  let res: Response;
  try {
    res = await fetch(
      `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/products/${encodeURIComponent(productId)}/affiliate-destinations/${encodeURIComponent(destinationId)}/archive`,
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
    handleNetworkError(err, 'archive affiliate destination');
  }

  if (!res.ok) return parseProblemResponse(res);
  const json = await parseSuccessfulJson(res);
  return validateAffiliate(json);
}
