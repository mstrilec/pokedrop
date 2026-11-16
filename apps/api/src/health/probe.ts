import type { HealthIndicatorResult } from '@nestjs/terminus';

interface ProbeDetail {
  status: 'up' | 'down';
  responseTime: number;
  message?: string;
}

/**
 * A dependency check with a timeout, reported in Terminus' shape. Not Terminus' own attempt(): it
 * builds an AbortSignal.any() per call, which Node 22.20 never frees, and the readiness probe
 * runs every 10 s - the API ran out of heap in under six days.
 */
export async function probe<Key extends string>(
  key: Key,
  check: () => Promise<unknown>,
  timeoutMs: number,
): Promise<HealthIndicatorResult<Key>> {
  const start = performance.now();
  const elapsed = (): number => Math.round(performance.now() - start);
  let timer: NodeJS.Timeout | undefined;

  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout of ${timeoutMs}ms exceeded`)), timeoutMs);
  });

  try {
    await Promise.race([check(), timeout]);
    return report(key, { status: 'up', responseTime: elapsed() });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return report(key, { status: 'down', message, responseTime: elapsed() });
  } finally {
    clearTimeout(timer);
  }
}

function report<Key extends string>(key: Key, detail: ProbeDetail): HealthIndicatorResult<Key> {
  return { [key]: detail } as Record<Key, ProbeDetail>;
}
