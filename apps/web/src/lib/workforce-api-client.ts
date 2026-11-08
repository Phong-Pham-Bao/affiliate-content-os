import {
  handleNetworkError,
  parseProblemResponse,
  parseSuccessfulJson,
} from './catalog-api-fetch.js';
import type {
  ContentArtifactDetailDTO,
  ContentArtifactSummaryDTO,
  KickoffWorkOrderPayload,
  KickoffWorkOrderResult,
  RetryWorkOrderResult,
  WorkOrderActivityDTO,
  WorkOrderDetailDTO,
  WorkOrderSummaryDTO,
} from '../types/workforce.js';
import {
  validateContentArtifactDetail,
  validateContentArtifactList,
  validateKickoffResult,
  validateRetryResult,
  validateWorkOrderActivityList,
  validateWorkOrderDetail,
  validateWorkOrderList,
} from './workforce-validators.js';

export async function kickoffWorkOrderApi(
  workspaceId: string,
  productId: string,
  payload: KickoffWorkOrderPayload,
  idempotencyKey: string,
): Promise<KickoffWorkOrderResult> {
  let res: Response;
  try {
    res = await fetch(
      `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/products/${encodeURIComponent(productId)}/work-orders`,
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
    handleNetworkError(err, 'assign mission to AI team');
  }

  if (!res.ok) return parseProblemResponse(res);
  const json = await parseSuccessfulJson(res);
  return validateKickoffResult(json);
}

export async function fetchWorkOrderApi(
  workspaceId: string,
  workOrderId: string,
  signal?: AbortSignal,
): Promise<WorkOrderDetailDTO> {
  let res: Response;
  try {
    res = await fetch(
      `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/work-orders/${encodeURIComponent(workOrderId)}`,
      {
        method: 'GET',
        headers: { Accept: 'application/json' },
        credentials: 'include',
        ...(signal ? { signal } : {}),
      },
    );
  } catch (err) {
    handleNetworkError(err, 'load work order details');
  }

  if (!res.ok) return parseProblemResponse(res);
  const json = await parseSuccessfulJson(res);
  return validateWorkOrderDetail(json);
}

export async function fetchWorkOrdersApi(
  workspaceId: string,
  options?: { readonly cursor?: string; readonly limit?: number; readonly productId?: string },
  signal?: AbortSignal,
): Promise<{ items: readonly WorkOrderSummaryDTO[]; nextCursor: string | null }> {
  const query = new URLSearchParams();
  if (options?.cursor) query.set('cursor', options.cursor);
  if (options?.limit) query.set('limit', String(options.limit));
  if (options?.productId) query.set('productId', options.productId);
  const qs = query.toString();

  let res: Response;
  try {
    res = await fetch(
      `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/work-orders${qs ? `?${qs}` : ''}`,
      {
        method: 'GET',
        headers: { Accept: 'application/json' },
        credentials: 'include',
        ...(signal ? { signal } : {}),
      },
    );
  } catch (err) {
    handleNetworkError(err, 'load work orders');
  }

  if (!res.ok) return parseProblemResponse(res);
  const json = await parseSuccessfulJson(res);
  return validateWorkOrderList(json);
}

export async function fetchWorkOrderArtifactsApi(
  workspaceId: string,
  workOrderId: string,
  signal?: AbortSignal,
): Promise<readonly ContentArtifactSummaryDTO[]> {
  let res: Response;
  try {
    res = await fetch(
      `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/work-orders/${encodeURIComponent(workOrderId)}/artifacts`,
      {
        method: 'GET',
        headers: { Accept: 'application/json' },
        credentials: 'include',
        ...(signal ? { signal } : {}),
      },
    );
  } catch (err) {
    handleNetworkError(err, 'load work order artifacts');
  }

  if (!res.ok) return parseProblemResponse(res);
  const json = await parseSuccessfulJson(res);
  return validateContentArtifactList(json).items;
}

export async function fetchArtifactDetailApi(
  workspaceId: string,
  artifactId: string,
  signal?: AbortSignal,
): Promise<ContentArtifactDetailDTO> {
  let res: Response;
  try {
    res = await fetch(
      `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/artifacts/${encodeURIComponent(artifactId)}`,
      {
        method: 'GET',
        headers: { Accept: 'application/json' },
        credentials: 'include',
        ...(signal ? { signal } : {}),
      },
    );
  } catch (err) {
    handleNetworkError(err, 'load artifact details');
  }

  if (!res.ok) return parseProblemResponse(res);
  const json = await parseSuccessfulJson(res);
  return validateContentArtifactDetail(json);
}

export async function fetchWorkOrderActivitiesApi(
  workspaceId: string,
  workOrderId: string,
  signal?: AbortSignal,
): Promise<readonly WorkOrderActivityDTO[]> {
  let res: Response;
  try {
    res = await fetch(
      `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/work-orders/${encodeURIComponent(workOrderId)}/activity`,
      {
        method: 'GET',
        headers: { Accept: 'application/json' },
        credentials: 'include',
        ...(signal ? { signal } : {}),
      },
    );
  } catch (err) {
    handleNetworkError(err, 'load work order activities');
  }

  if (!res.ok) return parseProblemResponse(res);
  const json = await parseSuccessfulJson(res);
  return validateWorkOrderActivityList(json).items;
}

export async function retryWorkOrderPlanningApi(
  workspaceId: string,
  workOrderId: string,
  idempotencyKey?: string,
): Promise<RetryWorkOrderResult> {
  let res: Response;
  try {
    res = await fetch(
      `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/work-orders/${encodeURIComponent(workOrderId)}/retry`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
        },
        credentials: 'include',
      },
    );
  } catch (err) {
    handleNetworkError(err, 'retry work order');
  }

  if (!res.ok) return parseProblemResponse(res);
  const json = await parseSuccessfulJson(res);
  return validateRetryResult(json);
}

export {
  fetchArtifactRevisionsApi,
  fetchArtifactRevisionByNumberApi,
  createManualRevisionApi,
  requestScriptChangesApi,
  fetchChangeRequestByIdApi,
} from './workforce-api-client-revisions.js';
