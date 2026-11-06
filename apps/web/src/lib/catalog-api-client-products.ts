import type {
  CreateProductPayload,
  ProductDTO,
  ProductListResponse,
  UpdateProductPayload,
} from '../types/catalog.js';
import {
  handleNetworkError,
  parseProblemResponse,
  parseSuccessfulJson,
} from './catalog-api-fetch.js';
import { validateProduct, validateProductListResponse } from './catalog-validators-product.js';

export async function fetchProductsApi(
  workspaceId: string,
  query?: { limit?: number; after?: string; status?: string },
  signal?: AbortSignal,
): Promise<ProductListResponse> {
  const params = new URLSearchParams();
  if (query?.limit) params.set('limit', String(query.limit));
  if (query?.after) params.set('after', query.after);
  if (query?.status) params.set('status', query.status);

  const qs = params.toString() ? `?${params.toString()}` : '';
  let res: Response;
  try {
    res = await fetch(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/products${qs}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      credentials: 'include',
      ...(signal ? { signal } : {}),
    });
  } catch (err) {
    handleNetworkError(err, 'load products');
  }

  if (!res.ok) return parseProblemResponse(res);
  const json = await parseSuccessfulJson(res);
  return validateProductListResponse(json);
}

export async function createProductApi(
  workspaceId: string,
  payload: CreateProductPayload,
  idempotencyKey: string,
): Promise<ProductDTO> {
  let res: Response;
  try {
    res = await fetch(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/products`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      credentials: 'include',
      body: JSON.stringify(payload),
    });
  } catch (err) {
    handleNetworkError(err, 'create product');
  }

  if (!res.ok) return parseProblemResponse(res);
  const json = await parseSuccessfulJson(res);
  return validateProduct(json);
}

export async function fetchProductApi(
  workspaceId: string,
  productId: string,
  signal?: AbortSignal,
): Promise<ProductDTO> {
  let res: Response;
  try {
    res = await fetch(
      `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/products/${encodeURIComponent(productId)}`,
      {
        method: 'GET',
        headers: { Accept: 'application/json' },
        credentials: 'include',
        ...(signal ? { signal } : {}),
      },
    );
  } catch (err) {
    handleNetworkError(err, 'load product details');
  }

  if (!res.ok) return parseProblemResponse(res);
  const json = await parseSuccessfulJson(res);
  return validateProduct(json);
}

export async function updateProductApi(
  workspaceId: string,
  productId: string,
  version: number,
  payload: UpdateProductPayload,
): Promise<ProductDTO> {
  let res: Response;
  try {
    res = await fetch(
      `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/products/${encodeURIComponent(productId)}`,
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
    handleNetworkError(err, 'update product');
  }

  if (!res.ok) return parseProblemResponse(res);
  const json = await parseSuccessfulJson(res);
  return validateProduct(json);
}

export async function archiveProductApi(
  workspaceId: string,
  productId: string,
): Promise<ProductDTO> {
  let res: Response;
  try {
    res = await fetch(
      `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/products/${encodeURIComponent(productId)}/archive`,
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
    handleNetworkError(err, 'archive product');
  }

  if (!res.ok) return parseProblemResponse(res);
  const json = await parseSuccessfulJson(res);
  return validateProduct(json);
}
