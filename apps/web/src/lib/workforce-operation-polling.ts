import type { WorkOrderDetailDTO } from '../types/workforce.js';
import type { ArtifactChangeRequestDTO } from '../types/script-studio.js';
import { fetchChangeRequestByIdApi, fetchWorkOrderApi } from './workforce-api-client.js';

export class PollingDeadlineError extends Error {
  readonly code = 'POLLING_DEADLINE_EXCEEDED';
  readonly changeRequestId: string;
  readonly elapsedMs: number;
  readonly attempts: number;

  constructor(message: string, changeRequestId: string, elapsedMs: number, attempts: number) {
    super(message);
    this.name = 'PollingDeadlineError';
    this.changeRequestId = changeRequestId;
    this.elapsedMs = elapsedMs;
    this.attempts = attempts;
  }
}

export interface PollWorkOrderOptions {
  readonly intervalMs?: number;
  readonly maxAttempts?: number;
}

export interface PollChangeRequestOptions {
  readonly initialIntervalMs?: number;
  readonly maxIntervalMs?: number;
  readonly backoffMultiplier?: number;
  readonly maxDurationMs?: number;
  readonly maxAttempts?: number;
  readonly intervalMs?: number;
}

function sleepAbortable(delayMs: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Polling aborted', 'AbortError'));
      return;
    }

    let timer: ReturnType<typeof setTimeout> | null = null;
    const onAbort = () => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      signal.removeEventListener('abort', onAbort);
      reject(new DOMException('Polling aborted', 'AbortError'));
    };

    timer = setTimeout(() => {
      timer = null;
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);

    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export async function pollChangeRequestUntilTerminal(
  workspaceId: string,
  artifactId: string,
  changeRequestId: string,
  signal: AbortSignal,
  onUpdate?: (cr: ArtifactChangeRequestDTO) => void,
  options?: PollChangeRequestOptions,
): Promise<ArtifactChangeRequestDTO> {
  const initialIntervalMs = options?.initialIntervalMs ?? options?.intervalMs ?? 2000;
  const maxIntervalMs = Math.max(initialIntervalMs, options?.maxIntervalMs ?? 15000);
  const backoffMultiplier = options?.backoffMultiplier ?? 1.5;
  const maxDurationMs = options?.maxDurationMs ?? 60 * 60 * 1000;
  const maxAttempts = options?.maxAttempts;

  let currentInterval = initialIntervalMs;
  let attempts = 0;
  const startTime = Date.now();

  while (true) {
    if (signal.aborted) {
      throw new DOMException('Polling aborted', 'AbortError');
    }

    const cr = await fetchChangeRequestByIdApi(workspaceId, artifactId, changeRequestId, signal);
    attempts++;
    onUpdate?.(cr);

    const isTerminal =
      cr.status === 'completed' || cr.status === 'failed' || cr.status === 'canceled';

    if (isTerminal) {
      return cr;
    }

    const elapsedMs = Date.now() - startTime;

    if (maxAttempts !== undefined && attempts >= maxAttempts) {
      throw new PollingDeadlineError(
        `Quá giới hạn số lần kiểm tra trạng thái (${maxAttempts} lần) cho yêu cầu thay đổi ${changeRequestId}`,
        changeRequestId,
        elapsedMs,
        attempts,
      );
    }

    if (elapsedMs >= maxDurationMs) {
      throw new PollingDeadlineError(
        `Hết thời gian chờ phản hồi từ máy chủ (${Math.round(maxDurationMs / 1000)}s) cho yêu cầu thay đổi ${changeRequestId}`,
        changeRequestId,
        elapsedMs,
        attempts,
      );
    }

    const nextDelay = Math.min(currentInterval, Math.max(0, maxDurationMs - elapsedMs));
    await sleepAbortable(nextDelay, signal);
    currentInterval = Math.min(Math.round(currentInterval * backoffMultiplier), maxIntervalMs);
  }
}

export async function pollWorkOrderUntilTerminal(
  workspaceId: string,
  workOrderId: string,
  signal: AbortSignal,
  onUpdate: (detail: WorkOrderDetailDTO) => void,
  options?: PollWorkOrderOptions,
): Promise<WorkOrderDetailDTO> {
  const intervalMs = options?.intervalMs ?? 2000;
  const maxAttempts = options?.maxAttempts ?? 60;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (signal.aborted) {
      throw new DOMException('Polling aborted', 'AbortError');
    }

    const detail = await fetchWorkOrderApi(workspaceId, workOrderId, signal);
    onUpdate(detail);

    const isTerminal =
      detail.workOrder.status === 'completed' ||
      detail.workOrder.status === 'failed' ||
      detail.workOrder.status === 'cancelled';

    // In Checkpoint B, if all 3 planning items are completed, the planning phase is finished
    const planningItems = detail.workItems.filter((i) =>
      ['product_strategy', 'audience_strategy', 'creative_direction'].includes(i.taskKey),
    );
    const allPlanningFinished =
      planningItems.length === 3 &&
      planningItems.every((i) => i.status === 'completed' || i.status === 'failed');

    if (isTerminal || allPlanningFinished) {
      return detail;
    }

    await sleepAbortable(intervalMs, signal);
  }

  // Final fetch
  return fetchWorkOrderApi(workspaceId, workOrderId, signal);
}
