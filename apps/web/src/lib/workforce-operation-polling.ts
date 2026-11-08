import type { WorkOrderDetailDTO } from '../types/workforce.js';
import { fetchWorkOrderApi } from './workforce-api-client.js';

export interface PollWorkOrderOptions {
  readonly intervalMs?: number;
  readonly maxAttempts?: number;
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

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      }, intervalMs);

      const onAbort = () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        reject(new DOMException('Polling aborted', 'AbortError'));
      };

      signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  // Final fetch
  return fetchWorkOrderApi(workspaceId, workOrderId, signal);
}
