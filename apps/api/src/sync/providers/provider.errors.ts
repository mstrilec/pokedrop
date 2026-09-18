import type { CardSourceName } from './card-source-provider.js';

/**
 * Base for everything this layer throws. `provider` sits on the base so a log
 * line always names the upstream that failed, whatever the reason was.
 */
export class ProviderError extends Error {
  constructor(
    readonly provider: CardSourceName,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    // Without this, every subclass reports "Error" in a stack trace: the name
    // comes from the prototype, and subclassing does not set it. A 429 and a
    // 500 would be indistinguishable in the log.
    this.name = new.target.name;
  }
}

/**
 * 5xx, timeout, DNS failure, connection reset — the upstream is not answering
 * usefully. Counts toward PD-43's failover.
 *
 * The canonical instance, measured 2026-09-18: pokemontcg.io answering 500 on
 * /v2/cards while /v2/sets served normally.
 */
export class ProviderUnavailableError extends ProviderError {}

/**
 * 429.
 *
 * Deliberately not a failover signal. A rate limit means slow down, not "this
 * provider is broken", and switching on one would move the load onto the
 * fallback and rate-limit that too — turning a delay into an outage.
 */
export class ProviderRateLimitError extends ProviderError {
  constructor(
    provider: CardSourceName,
    message: string,
    /** From `Retry-After` when the upstream sent one. */
    readonly retryAfterMs: number | null,
    options?: ErrorOptions,
  ) {
    super(provider, message, options);
  }
}

/**
 * The response envelope did not parse at all — upstream changed its contract.
 * Counts toward failover, and is the loudest of the three: continuing would
 * fill the mirror with nonsense.
 */
export class ProviderContractError extends ProviderError {}

/**
 * Not an Error, and never thrown.
 *
 * One item inside a well-formed response failed to parse. It is skipped and
 * described, so a single malformed card cannot discard the good ones beside it
 * — which is what makes PD-42's "a single failing set does not abort the entire
 * run" reachable.
 */
export interface ProviderItemError {
  provider: CardSourceName;
  /** Null when the payload was malformed enough that no id could be read. */
  itemId: string | null;
  message: string;
}
