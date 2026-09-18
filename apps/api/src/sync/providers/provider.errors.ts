import type { CardSourceName } from './card-source-provider.js';

export class ProviderError extends Error {
  constructor(
    readonly provider: CardSourceName,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);

    this.name = new.target.name;
  }
}

export class ProviderUnavailableError extends ProviderError {}

export class ProviderRateLimitError extends ProviderError {
  constructor(
    provider: CardSourceName,
    message: string,

    readonly retryAfterMs: number | null,
    options?: ErrorOptions,
  ) {
    super(provider, message, options);
  }
}

export class ProviderContractError extends ProviderError {}

export interface ProviderItemError {
  provider: CardSourceName;

  itemId: string | null;
  message: string;
}
