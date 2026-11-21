import type { ProblemSpec } from '../auth/problem-details-specs.js';
import {
  PublicationApprovalSnapshotNotFoundError,
  PublicationDriftError,
  PublicationFenceLostError,
  PublicationGatedError,
  PublicationNotFoundError,
  PublicationPreviewMismatchError,
  PublicationScheduleInvalidError,
  PublicationStateConflictError,
} from '@affiliate-content-os/domain';
import { SocialKillSwitchActiveError } from '@affiliate-content-os/application';

const createSpec = (
  status: number,
  code: string,
  type: string,
  title: string,
  detail: string,
): ProblemSpec => ({
  status,
  code,
  type: `https://affiliate-content-os.example/problems/${type}`,
  title,
  detail,
});

export const PUBLICATION_PROBLEM_SPECS: Record<string, ProblemSpec> = {
  PUBLICATION_NOT_FOUND: createSpec(
    404,
    'NOT_FOUND',
    'not-found',
    'Not Found',
    'The requested publication was not found in the workspace.',
  ),
  PUBLICATION_APPROVAL_SNAPSHOT_NOT_FOUND: createSpec(
    404,
    'NOT_FOUND',
    'not-found',
    'Not Found',
    'The requested publication approval snapshot was not found in the workspace.',
  ),
  PUBLICATION_STATE_CONFLICT: createSpec(
    409,
    'CONFLICT',
    'conflict',
    'Conflict',
    'Cannot perform the requested action on publication due to state or version conflict.',
  ),
  PUBLICATION_FENCE_LOST: createSpec(
    409,
    'FENCE_LOST',
    'conflict',
    'Conflict',
    'Publication operation lease or fencing was lost to a concurrent process.',
  ),
  PUBLICATION_SCHEDULE_INVALID: createSpec(
    422,
    'UNPROCESSABLE_CONTENT',
    'unprocessable-content',
    'Unprocessable Content',
    'The publication schedule specification is invalid or violates timing bounds.',
  ),
  PUBLICATION_PREVIEW_MISMATCH: createSpec(
    422,
    'UNPROCESSABLE_CONTENT',
    'unprocessable-content',
    'Unprocessable Content',
    'Client-supplied preview hash does not match server-rendered preview hash.',
  ),
  PUBLICATION_DRIFT: createSpec(
    422,
    'UNPROCESSABLE_CONTENT',
    'unprocessable-content',
    'Unprocessable Content',
    'Publication prerequisites drifted or no longer match approved state.',
  ),
  PUBLICATION_GATED: createSpec(
    422,
    'UNPROCESSABLE_CONTENT',
    'unprocessable-content',
    'Unprocessable Content',
    'Publication is gated and cannot proceed.',
  ),
  SOCIAL_KILL_SWITCH_ACTIVE: createSpec(
    503,
    'SERVICE_UNAVAILABLE',
    'service-unavailable',
    'Service Unavailable',
    'This social platform or feature is temporarily disabled by administrative policy.',
  ),
  MALFORMED_IDEMPOTENCY_KEY: createSpec(
    400,
    'MALFORMED_IDEMPOTENCY_KEY',
    'malformed-idempotency-key',
    'Bad Request',
    'Idempotency-Key header must be a printable ASCII string between 1 and 128 characters.',
  ),
  AUTH_ORIGIN_INVALID: createSpec(
    403,
    'AUTH_ORIGIN_INVALID',
    'auth-origin-invalid',
    'Forbidden',
    'Request origin is invalid or untrusted.',
  ),
};

export function resolvePublicationProblemSpec(error: unknown): ProblemSpec | null {
  if (typeof error !== 'object' || error === null) {
    return null;
  }

  const name = (error as { name?: string }).name;
  const message = (error as Error).message;

  if (error instanceof PublicationNotFoundError || name === 'PublicationNotFoundError') {
    return PUBLICATION_PROBLEM_SPECS['PUBLICATION_NOT_FOUND']!;
  }
  if (
    error instanceof PublicationApprovalSnapshotNotFoundError ||
    name === 'PublicationApprovalSnapshotNotFoundError'
  ) {
    return PUBLICATION_PROBLEM_SPECS['PUBLICATION_APPROVAL_SNAPSHOT_NOT_FOUND']!;
  }
  if (error instanceof PublicationStateConflictError || name === 'PublicationStateConflictError') {
    const spec = PUBLICATION_PROBLEM_SPECS['PUBLICATION_STATE_CONFLICT']!;
    return { ...spec, detail: message || spec.detail };
  }
  if (error instanceof PublicationFenceLostError || name === 'PublicationFenceLostError') {
    const spec = PUBLICATION_PROBLEM_SPECS['PUBLICATION_FENCE_LOST']!;
    return { ...spec, detail: message || spec.detail };
  }
  if (
    error instanceof PublicationScheduleInvalidError ||
    name === 'PublicationScheduleInvalidError'
  ) {
    const spec = PUBLICATION_PROBLEM_SPECS['PUBLICATION_SCHEDULE_INVALID']!;
    return { ...spec, detail: message || spec.detail };
  }
  if (
    error instanceof PublicationPreviewMismatchError ||
    name === 'PublicationPreviewMismatchError'
  ) {
    const spec = PUBLICATION_PROBLEM_SPECS['PUBLICATION_PREVIEW_MISMATCH']!;
    return { ...spec, detail: message || spec.detail };
  }
  if (error instanceof PublicationDriftError || name === 'PublicationDriftError') {
    const spec = PUBLICATION_PROBLEM_SPECS['PUBLICATION_DRIFT']!;
    return { ...spec, detail: message || spec.detail };
  }
  if (error instanceof PublicationGatedError || name === 'PublicationGatedError') {
    if ((error as { gateReason?: string }).gateReason === 'kill_switch') {
      return PUBLICATION_PROBLEM_SPECS['SOCIAL_KILL_SWITCH_ACTIVE']!;
    }
    const spec = PUBLICATION_PROBLEM_SPECS['PUBLICATION_GATED']!;
    return { ...spec, detail: message || spec.detail };
  }
  if (error instanceof SocialKillSwitchActiveError || name === 'SocialKillSwitchActiveError') {
    return PUBLICATION_PROBLEM_SPECS['SOCIAL_KILL_SWITCH_ACTIVE']!;
  }

  const validationErrors = (error as { validation?: unknown }).validation;
  const validationContext = (error as { validationContext?: unknown }).validationContext;
  if (validationContext === 'headers' && Array.isArray(validationErrors)) {
    for (const vErr of validationErrors) {
      if (typeof vErr !== 'object' || vErr === null) continue;
      const instancePath = (vErr as { instancePath?: string }).instancePath;
      const missingProp = (vErr as { params?: { missingProperty?: string } }).params
        ?.missingProperty;
      if (
        instancePath === '/idempotency-key' ||
        missingProp === 'idempotency-key' ||
        instancePath === '/headers/idempotency-key'
      ) {
        return PUBLICATION_PROBLEM_SPECS['MALFORMED_IDEMPOTENCY_KEY']!;
      }
      if (
        instancePath === '/origin' ||
        missingProp === 'origin' ||
        instancePath === '/headers/origin'
      ) {
        return PUBLICATION_PROBLEM_SPECS['AUTH_ORIGIN_INVALID']!;
      }
    }
  }

  return null;
}
