import type { AnalysisDTO, WorkspaceAIPolicyDTO } from '../types/analysis.js';
import {
  handleNetworkError,
  parseProblemResponse,
  parseSuccessfulJson,
} from './catalog-api-fetch.js';
import { validateAIPolicy, validateAnalysis } from './catalog-validators-analysis.js';

export async function acceptAnalysisApi(
  workspaceId: string,
  analysisId: string,
  expectedVersion: number,
  signal?: AbortSignal,
): Promise<AnalysisDTO> {
  let res: Response;
  try {
    res = await fetch(
      `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/analyses/${encodeURIComponent(analysisId)}/accept`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'If-Match': `"${expectedVersion}"`,
        },
        credentials: 'include',
        body: JSON.stringify({ expectedVersion }),
        ...(signal ? { signal } : {}),
      },
    );
  } catch (err) {
    handleNetworkError(err, 'accept analysis');
  }

  if (!res.ok) return parseProblemResponse(res);
  const json = await parseSuccessfulJson(res);
  return validateAnalysis(json);
}

export async function rejectAnalysisApi(
  workspaceId: string,
  analysisId: string,
  expectedVersion: number,
  reason?: string,
  signal?: AbortSignal,
): Promise<AnalysisDTO> {
  let res: Response;
  try {
    res = await fetch(
      `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/analyses/${encodeURIComponent(analysisId)}/reject`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'If-Match': `"${expectedVersion}"`,
        },
        credentials: 'include',
        body: JSON.stringify({ expectedVersion, reason: reason ?? null }),
        ...(signal ? { signal } : {}),
      },
    );
  } catch (err) {
    handleNetworkError(err, 'reject analysis');
  }

  if (!res.ok) return parseProblemResponse(res);
  const json = await parseSuccessfulJson(res);
  return validateAnalysis(json);
}

export async function updateAIPolicyApi(
  workspaceId: string,
  payload: { aiEnabled: boolean; monthlyBudgetMicrounits: number; rateLimitPerMinute: number },
  signal?: AbortSignal,
): Promise<WorkspaceAIPolicyDTO> {
  let res: Response;
  try {
    res = await fetch(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/ai-policy`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify(payload),
      ...(signal ? { signal } : {}),
    });
  } catch (err) {
    handleNetworkError(err, 'update AI policy');
  }

  if (!res.ok) return parseProblemResponse(res);
  const json = await parseSuccessfulJson(res);
  return validateAIPolicy(json);
}
