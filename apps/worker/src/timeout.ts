export async function raceWithDeadline<T>(
  promise: Promise<T>,
  remainingMs: number,
  timeoutErrorMessage: string,
): Promise<T> {
  if (remainingMs <= 0) {
    throw new Error(timeoutErrorMessage);
  }

  let timer: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(timeoutErrorMessage));
    }, remainingMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}
