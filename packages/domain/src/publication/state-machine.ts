import type {
  PublicationAttemptPhase,
  PublicationStatus,
  TerminalPublicationStatus,
} from './types.js';
import { TERMINAL_PUBLICATION_STATUSES } from './types.js';

const LEGAL_TRANSITIONS: ReadonlyMap<PublicationStatus, ReadonlySet<PublicationStatus>> = new Map([
  ['scheduled', new Set<PublicationStatus>(['scheduled', 'queued', 'canceled'])],
  ['queued', new Set<PublicationStatus>(['publishing', 'rejected', 'failed', 'canceled'])],
  [
    'publishing',
    new Set<PublicationStatus>([
      'published',
      'retry_wait',
      'failed',
      'outcome_unknown',
      'processing_remote',
    ]),
  ],
  ['processing_remote', new Set<PublicationStatus>(['published', 'failed', 'outcome_unknown'])],
  ['retry_wait', new Set<PublicationStatus>(['queued', 'publishing', 'failed'])],
  ['published', new Set<PublicationStatus>()],
  ['failed', new Set<PublicationStatus>()],
  ['rejected', new Set<PublicationStatus>()],
  ['canceled', new Set<PublicationStatus>()],
  ['outcome_unknown', new Set<PublicationStatus>()],
]);

export function canTransitionPublicationStatus(
  from: PublicationStatus,
  to: PublicationStatus,
): boolean {
  if (from === to && from === 'scheduled') return true; // reschedule allowed
  return LEGAL_TRANSITIONS.get(from)?.has(to) ?? false;
}

export function isTerminalPublication(
  status: PublicationStatus,
): status is TerminalPublicationStatus {
  return (TERMINAL_PUBLICATION_STATUSES as readonly string[]).includes(status);
}

export function canReschedulePublication(status: PublicationStatus, hasLease: boolean): boolean {
  return status === 'scheduled' && !hasLease;
}

export function canCancelPublication(
  status: PublicationStatus,
  attemptPhase?: PublicationAttemptPhase | undefined,
): boolean {
  if (status === 'canceled') return true; // idempotent re-cancel
  if (status === 'scheduled') return true;
  if (status === 'queued' && (!attemptPhase || attemptPhase === 'prepared')) return true;
  return false;
}

export const BASE_RETRY_DELAY_MS = 60_000; // 1 minute base backoff
export const MAX_RETRY_BACKOFF_MS = 3_600_000; // 1 hour max backoff

export function calculatePublicationBackoff(
  attemptNumber: number,
  retryAfterMs?: number | undefined,
  maxHorizonMs: number = MAX_RETRY_BACKOFF_MS,
): number {
  if (retryAfterMs !== undefined && retryAfterMs > 0) {
    return Math.min(Math.max(retryAfterMs, 1000), maxHorizonMs);
  }
  const factor = Math.pow(2, Math.max(0, attemptNumber - 1));
  const rawBackoff = BASE_RETRY_DELAY_MS * factor;
  return Math.min(rawBackoff, maxHorizonMs);
}
