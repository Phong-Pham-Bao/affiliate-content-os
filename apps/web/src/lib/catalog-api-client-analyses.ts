import type {
  AnalysisDTO,
  AnalysisSummaryDTO,
  EnqueueAnalysisPayload,
  EnqueueAnalysisResponse,
  OperationDTO,
} from '../types/analysis.js';
import {
  handleNetworkError,
  parseProblemResponse,
  parseSuccessfulJson,
} from './catalog-api-fetch.js';
import {
  validateAnalysis,
  validateAnalysisList,
  validateEnqueueResponse,
  validateOperation,
} from './catalog-validators-analysis.js';

export async function enqueueAnalysisApi(
  workspaceId: string,
  productId: string,
  payload: EnqueueAnalysisPayload,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<EnqueueAnalysisResponse> {
  let res: Response;
  try {
    res = await fetch(
      `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/products/${encodeURIComponent(productId)}/analyses`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        credentials: 'include',
        body: JSON.stringify(payload),
        ...(signal ? { signal } : {}),
      },
    );
  } catch (err) {
    handleNetworkError(err, 'enqueue analysis');
  }

  if (res.status !== 202 && !res.ok) return parseProblemResponse(res);
  const json = await parseSuccessfulJson(res);
  return validateEnqueueResponse(json);
}

export async function fetchOperationApi(
  workspaceId: string,
  operationId: string,
  signal?: AbortSignal,
): Promise<OperationDTO> {
  let res: Response;
  try {
    res = await fetch(
      `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/operations/${encodeURIComponent(operationId)}`,
      {
        method: 'GET',
        headers: { Accept: 'application/json' },
        credentials: 'include',
        ...(signal ? { signal } : {}),
      },
    );
  } catch (err) {
    handleNetworkError(err, 'load operation status');
  }

  if (!res.ok) return parseProblemResponse(res);
  const json = await parseSuccessfulJson(res);
  return validateOperation(json);
}

export async function fetchAnalysesApi(
  workspaceId: string,
  productId: string,
  query?: { type?: string; status?: string; limit?: number; cursor?: string },
  signal?: AbortSignal,
): Promise<{
  items: readonly AnalysisSummaryDTO[];
  page: { nextCursor: string | null; hasMore: boolean };
}> {
  const params = new URLSearchParams();
  if (query?.type) params.set('type', query.type);
  if (query?.status) params.set('status', query.status);
  if (query?.limit) params.set('limit', String(query.limit));
  if (query?.cursor) params.set('cursor', query.cursor);

  const qs = params.toString() ? `?${params.toString()}` : '';
  let res: Response;
  try {
    res = await fetch(
      `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/products/${encodeURIComponent(productId)}/analyses${qs}`,
      {
        method: 'GET',
        headers: { Accept: 'application/json' },
        credentials: 'include',
        ...(signal ? { signal } : {}),
      },
    );
  } catch (err) {
    handleNetworkError(err, 'load analyses');
  }

  if (!res.ok) return parseProblemResponse(res);
  const json = await parseSuccessfulJson(res);
  return validateAnalysisList(json);
}

export async function fetchAnalysisApi(
  workspaceId: string,
  analysisId: string,
  signal?: AbortSignal,
): Promise<AnalysisDTO> {
  let res: Response;
  try {
    res = await fetch(
      `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/analyses/${encodeURIComponent(analysisId)}`,
      {
        method: 'GET',
        headers: { Accept: 'application/json' },
        credentials: 'include',
        ...(signal ? { signal } : {}),
      },
    );
  } catch (err) {
    handleNetworkError(err, 'load analysis');
  }

  if (!res.ok) return parseProblemResponse(res);
  const json = await parseSuccessfulJson(res);
  return validateAnalysis(json);
}
