/**
 * BullMQ's connection waits for Redis rather than giving up, so an admin read
 * against a dead Redis would hang the request. Two seconds is past any healthy
 * round trip and short enough for a page an operator is waiting on.
 */
export const ADMIN_REDIS_TIMEOUT_MS = 2_000;

export function withTimeout<T>(
  promise: Promise<T>,
  label: string,
  ms = ADMIN_REDIS_TIMEOUT_MS,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
