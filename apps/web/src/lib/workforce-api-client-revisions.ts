import {
  handleNetworkError,
  parseProblemResponse,
  parseSuccessfulJson,
} from './catalog-api-fetch.js';
import type {
  ArtifactChangeRequestDTO,
  CreateManualRevisionPayload,
  RequestScriptChangesPayload,
} from '../types/script-studio.js';
import type { ContentArtifactDetailDTO, ContentArtifactRevisionDTO } from '../types/workforce.js';
import {
  validateArtifactChangeRequest,
  validateContentArtifactRevisionList,
} from './workforce-validators-script.js';
import {
  validateContentArtifactDetail,
  validateContentArtifactRevision,
} from './workforce-validators-artifact.js';

export async function fetchArtifactRevisionsApi(
  workspaceId: string,
  artifactId: string,
  signal?: AbortSignal,
): Promise<{ readonly items: readonly ContentArtifactRevisionDTO[] }> {
  let res: Response;
  try {
    res = await fetch(
      `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/artifacts/${encodeURIComponent(artifactId)}/revisions`,
      {
        method: 'GET',
        headers: { Accept: 'application/json' },
        credentials: 'include',
        ...(signal ? { signal } : {}),
      },
    );
  } catch (err) {
    handleNetworkError(err, 'load artifact revisions');
  }

  if (!res.ok) return parseProblemResponse(res);
  const json = await parseSuccessfulJson(res);
  return validateContentArtifactRevisionList(json);
}

export async function fetchArtifactRevisionByNumberApi(
  workspaceId: string,
  artifactId: string,
  revisionNumber: number,
  signal?: AbortSignal,
): Promise<ContentArtifactRevisionDTO> {
  let res: Response;
  try {
    res = await fetch(
      `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/artifacts/${encodeURIComponent(artifactId)}/revisions/${revisionNumber}`,
      {
        method: 'GET',
        headers: { Accept: 'application/json' },
        credentials: 'include',
        ...(signal ? { signal } : {}),
      },
    );
  } catch (err) {
    handleNetworkError(err, `load artifact revision ${revisionNumber}`);
  }

  if (!res.ok) return parseProblemResponse(res);
  const json = await parseSuccessfulJson(res);
  return validateContentArtifactRevision(json);
}

export async function createManualRevisionApi(
  workspaceId: string,
  artifactId: string,
  payload: CreateManualRevisionPayload,
  signal?: AbortSignal,
): Promise<ContentArtifactDetailDTO> {
  let res: Response;
  try {
    res = await fetch(
      `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/artifacts/${encodeURIComponent(artifactId)}/revisions`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify(payload),
        ...(signal ? { signal } : {}),
      },
    );
  } catch (err) {
    handleNetworkError(err, 'create manual revision');
  }

  if (!res.ok) return parseProblemResponse(res);
  const json = await parseSuccessfulJson(res);
  return validateContentArtifactDetail(json);
}

export async function requestScriptChangesApi(
  workspaceId: string,
  artifactId: string,
  payload: RequestScriptChangesPayload,
  idempotencyKey?: string,
  signal?: AbortSignal,
): Promise<ArtifactChangeRequestDTO> {
  let res: Response;
  try {
    res = await fetch(
      `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/artifacts/${encodeURIComponent(artifactId)}/request-changes`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
        },
        credentials: 'include',
        body: JSON.stringify(payload),
        ...(signal ? { signal } : {}),
      },
    );
  } catch (err) {
    handleNetworkError(err, 'request script changes');
  }

  if (!res.ok) return parseProblemResponse(res);
  const json = await parseSuccessfulJson(res);
  return validateArtifactChangeRequest(json);
}

export async function fetchChangeRequestByIdApi(
  workspaceId: string,
  artifactId: string,
  changeRequestId: string,
  signal?: AbortSignal,
): Promise<ArtifactChangeRequestDTO> {
  let res: Response;
  try {
    res = await fetch(
      `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/artifacts/${encodeURIComponent(artifactId)}/change-requests/${encodeURIComponent(changeRequestId)}`,
      {
        method: 'GET',
        headers: { Accept: 'application/json' },
        credentials: 'include',
        ...(signal ? { signal } : {}),
      },
    );
  } catch (err) {
    handleNetworkError(err, 'load change request status');
  }

  if (!res.ok) return parseProblemResponse(res);
  const json = await parseSuccessfulJson(res);
  return validateArtifactChangeRequest(json);
}
