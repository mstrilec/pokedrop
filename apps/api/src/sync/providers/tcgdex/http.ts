import type { CardSourceName } from '../card-source-provider.js';
import { ProviderRateLimitError, ProviderUnavailableError } from '../provider.errors.js';

const PROVIDER: CardSourceName = 'tcgdex';

const NOT_FOUND = 404;
const RATE_LIMITED = 429;
const SERVER_ERROR_FLOOR = 500;
const BACKOFF_BASE_MS = 250;
const RATE_LIMIT_BACKOFF_MS = 5_000;

const MAX_RETRY_AFTER_MS = 60_000;

export interface TcgdexHttpOptions {
  baseUrl: string;
  language: string;
  timeoutMs: number;
  maxAttempts: number;
  onRetry?: (attempt: number, reason: string) => void;
  /** Awaited before every request, retries included: this is where the daily budget is counted. */
  onRequest?: () => Promise<void>;
}

function backoffMs(attempt: number): number {
  const step = BACKOFF_BASE_MS * 2 ** (attempt - 1);
  return step / 2 + Math.random() * (step / 2);
}

function retryAfterMs(response: Response): number | null {
  const header = response.headers.get('retry-after');
  if (header === null) {
    return null;
  }

  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1_000 : null;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export async function getJson(path: string, options: TcgdexHttpOptions): Promise<unknown> {
  const url = `${options.baseUrl}/${options.language}${path}`;
  let lastReason = 'no attempt was made';

  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    await options.onRequest?.();

    let response: Response;

    try {
      response = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(options.timeoutMs),
      });
    } catch (error) {
      lastReason = error instanceof Error ? error.message : 'network failure';
      if (attempt === options.maxAttempts) break;
      options.onRetry?.(attempt, lastReason);
      await sleep(backoffMs(attempt));
      continue;
    }

    if (response.ok) {
      try {
        const body: unknown = await response.json();
        return body;
      } catch (error) {
        throw new ProviderUnavailableError(PROVIDER, `${path} returned a 200 that is not JSON`, {
          cause: error,
        });
      }
    }

    if (response.status === NOT_FOUND) {
      await response.body?.cancel();
      return null;
    }

    if (response.status === RATE_LIMITED) {
      const wait = retryAfterMs(response);
      await response.body?.cancel();
      if (attempt === options.maxAttempts) {
        throw new ProviderRateLimitError(PROVIDER, `${path} is rate limited`, wait);
      }
      options.onRetry?.(attempt, 'HTTP 429');
      await sleep(Math.min(wait ?? RATE_LIMIT_BACKOFF_MS, MAX_RETRY_AFTER_MS));
      continue;
    }

    if (response.status >= SERVER_ERROR_FLOOR) {
      lastReason = `HTTP ${response.status}`;
      await response.body?.cancel();
      if (attempt === options.maxAttempts) break;
      options.onRetry?.(attempt, lastReason);
      await sleep(backoffMs(attempt));
      continue;
    }

    throw new ProviderUnavailableError(PROVIDER, `${path} failed with HTTP ${response.status}`);
  }

  throw new ProviderUnavailableError(
    PROVIDER,
    `${path} failed after ${options.maxAttempts} attempts: ${lastReason}`,
  );
}
