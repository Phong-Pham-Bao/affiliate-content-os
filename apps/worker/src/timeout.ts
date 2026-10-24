export type SetTimerFn = (callback: () => void, ms: number) => unknown;
export type ClearTimerFn = (timerId: unknown) => void;

export interface TimeoutOptions {
  readonly setTimer?: SetTimerFn | undefined;
  readonly clearTimer?: ClearTimerFn | undefined;
}

export async function raceWithDeadline<T>(
  promise: Promise<T>,
  remainingMs: number,
  timeoutErrorMessage: string,
  options?: TimeoutOptions,
): Promise<T> {
  if (remainingMs <= 0) {
    throw new Error(timeoutErrorMessage);
  }

  const setTimer: SetTimerFn = options?.setTimer ?? setTimeout;
  const clearTimer: ClearTimerFn =
    options?.clearTimer ??
    ((id: unknown) => {
      clearTimeout(id as Parameters<typeof clearTimeout>[0]);
    });

  let timerId: unknown;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timerId = setTimer(() => {
      reject(new Error(timeoutErrorMessage));
    }, remainingMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timerId !== undefined) {
      clearTimer(timerId);
    }
  }
}
