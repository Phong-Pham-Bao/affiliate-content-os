import type { OperationDTO } from '../types/analysis.js';
import { fetchOperationApi } from './catalog-api-client-analyses.js';

export async function pollOperationApi(
  workspaceId: string,
  operationId: string,
  signal?: AbortSignal,
  onProgress?: (op: OperationDTO) => void,
): Promise<OperationDTO> {
  let delay = 1000;
  const maxDelay = 4000;

  while (!signal?.aborted) {
    const op = await fetchOperationApi(workspaceId, operationId, signal);
    onProgress?.(op);
    if (op.status === 'succeeded' || op.status === 'failed') {
      return op;
    }
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, delay);
      signal?.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          reject(new DOMException('Aborted', 'AbortError'));
        },
        { once: true },
      );
    });
    delay = Math.min(delay * 1.5, maxDelay);
  }

  throw new DOMException('Aborted', 'AbortError');
}
