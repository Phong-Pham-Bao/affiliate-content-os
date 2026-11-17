import {
  handleNetworkError,
  parseProblemResponse,
  parseSuccessfulJson,
} from './catalog-api-fetch.js';
import type {
  ComplianceEvaluationDTO,
  ContentApprovalSnapshotDTO,
  ContentReviewDecisionDTO,
} from '../types/compliance.js';
import type { ContentArtifactDetailDTO } from '../types/workforce.js';
import {
  validateAcceptRevisionResult,
  validateComplianceEvaluation,
  validateRejectRevisionResult,
  validateReviewDecisionList,
} from './workforce-validators-compliance.js';

export async function fetchArtifactComplianceApi(
  workspaceId: string,
  artifactId: string,
  revisionNumber?: number | undefined,
  signal?: AbortSignal,
): Promise<ComplianceEvaluationDTO> {
  const queryParam = revisionNumber ? `?revisionNumber=${encodeURIComponent(revisionNumber)}` : '';
  let res: Response;
  try {
    res = await fetch(
      `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/artifacts/${encodeURIComponent(artifactId)}/compliance${queryParam}`,
      {
        method: 'GET',
        headers: { Accept: 'application/json' },
        credentials: 'include',
        ...(signal ? { signal } : {}),
      },
    );
  } catch (err) {
    handleNetworkError(err, 'load artifact compliance evaluation');
  }

  if (!res.ok) return parseProblemResponse(res);
  const json = await parseSuccessfulJson(res);
  return validateComplianceEvaluation(json);
}

export async function fetchArtifactDecisionsApi(
  workspaceId: string,
  artifactId: string,
  signal?: AbortSignal,
): Promise<{ readonly items: readonly ContentReviewDecisionDTO[] }> {
  let res: Response;
  try {
    res = await fetch(
      `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/artifacts/${encodeURIComponent(artifactId)}/decisions`,
      {
        method: 'GET',
        headers: { Accept: 'application/json' },
        credentials: 'include',
        ...(signal ? { signal } : {}),
      },
    );
  } catch (err) {
    handleNetworkError(err, 'load artifact review decisions');
  }

  if (!res.ok) return parseProblemResponse(res);
  const json = await parseSuccessfulJson(res);
  return validateReviewDecisionList(json);
}

export async function acceptScriptRevisionApi(
  workspaceId: string,
  artifactId: string,
  payload: {
    readonly expectedVersion: number;
    readonly revisionNumber: number;
    readonly contentHashHex: string;
    readonly note?: string | undefined;
  },
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<{
  readonly artifact: ContentArtifactDetailDTO;
  readonly decision: ContentReviewDecisionDTO;
  readonly approvalSnapshot: ContentApprovalSnapshotDTO;
}> {
  const trimmedKey = idempotencyKey?.trim();
  if (!trimmedKey) {
    throw new Error('Idempotency key is required for accepting revision');
  }

  let res: Response;
  try {
    res = await fetch(
      `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/artifacts/${encodeURIComponent(artifactId)}/accept`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'Idempotency-Key': trimmedKey,
        },
        credentials: 'include',
        body: JSON.stringify(payload),
        ...(signal ? { signal } : {}),
      },
    );
  } catch (err) {
    handleNetworkError(err, 'accept artifact revision');
  }

  if (!res.ok) return parseProblemResponse(res);
  const json = await parseSuccessfulJson(res);
  return validateAcceptRevisionResult(json);
}

export async function rejectScriptRevisionApi(
  workspaceId: string,
  artifactId: string,
  payload: {
    readonly expectedVersion: number;
    readonly revisionNumber: number;
    readonly contentHashHex: string;
    readonly reason: string;
  },
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<{
  readonly artifact: ContentArtifactDetailDTO;
  readonly decision: ContentReviewDecisionDTO;
}> {
  const trimmedKey = idempotencyKey?.trim();
  if (!trimmedKey) {
    throw new Error('Idempotency key is required for rejecting revision');
  }

  let res: Response;
  try {
    res = await fetch(
      `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/artifacts/${encodeURIComponent(artifactId)}/reject`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'Idempotency-Key': trimmedKey,
        },
        credentials: 'include',
        body: JSON.stringify(payload),
        ...(signal ? { signal } : {}),
      },
    );
  } catch (err) {
    handleNetworkError(err, 'reject artifact revision');
  }

  if (!res.ok) return parseProblemResponse(res);
  const json = await parseSuccessfulJson(res);
  return validateRejectRevisionResult(json);
}
